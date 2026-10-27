"""Private banks. Unattributed legacy copies are quarantined, never assigned to everyone."""
from contextlib import closing
import json
from pathlib import Path
import shutil
import threading
import uuid

from solaire.common.actor_context import actor, teacher_key

_migration_lock = threading.RLock()


def _quarantine_inherited(project_root: Path, target: Path, key: str) -> None:
    """Keep edited/new files; remove only exact, unchanged legacy YAML copies."""
    marker = target / '.ownership-v2'
    if marker.exists():
        return
    import re
    snapshot = project_root / '.solaire' / 'legacy_bank_snapshot'
    quarantine = project_root / '.solaire' / 'bank_quarantine' / key
    if not quarantine.resolve().is_relative_to(project_root.resolve()):
        raise PermissionError('旧题隔离目录不能位于项目之外')
    for original in snapshot.rglob('*.yaml') if snapshot.is_dir() else []:
        relative = original.relative_to(snapshot)
        candidate = target / relative
        if (not candidate.is_file() or candidate.is_symlink() or original.is_symlink()
                or not candidate.resolve().is_relative_to(target.resolve())
                or not original.resolve().is_relative_to(snapshot.resolve())):
            continue
        inherited = re.sub(r':::EMBED_(IMG|SVG|PDF):(?!(?:__teachers/))',
                           rf':::EMBED_\1:__teachers/{key}/', original.read_text('utf-8'))
        if candidate.read_text('utf-8') != inherited:
            continue
        destination = quarantine / relative
        if not destination.resolve().is_relative_to(quarantine.resolve()):
            raise PermissionError('旧题隔离目标路径无效')
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            destination = destination.with_name(destination.name + '.' + uuid.uuid4().hex)
        shutil.move(str(candidate), str(destination))
    marker.write_text('Unowned legacy copies preserved in .solaire/bank_quarantine', encoding='utf-8')


def bank_resource_root(project_root: Path) -> Path:
    resource = (project_root / 'resource').resolve()
    key = teacher_key()
    if not key:
        return resource
    target = resource / '__teachers' / key
    from solaire.common.security import assert_within_project
    assert_within_project(project_root, target)
    if (target / '.initialized').is_file():
        with _migration_lock:
            _quarantine_inherited(project_root, target, key)
        return target
    with _migration_lock:
        if (target / '.initialized').is_file():
            _quarantine_inherited(project_root, target, key)
            return target
        from solaire.web.platform_db import connect, default_platform_root, init_platform_db
        platform = default_platform_root()
        init_platform_db(platform)
        migration = project_root / '.solaire' / 'bank-migration.json'
        snapshot = project_root / '.solaire' / 'legacy_bank_snapshot'
        if not migration.is_file():
            with closing(connect(platform)) as con, con:
                ids = [str(row['id']) for row in con.execute("SELECT id FROM users WHERE role='teacher'")]
            snapshot.mkdir(parents=True, exist_ok=True)
            if resource.is_dir():
                for entry in resource.iterdir():
                    if entry.name.startswith('.') or entry.name == '__teachers' or entry.is_symlink():
                        continue
                    destination = snapshot / entry.name
                    if entry.is_dir():
                        shutil.copytree(entry, destination, dirs_exist_ok=True, ignore=lambda _p, names: [n for n in names if (Path(_p)/n).is_symlink()])
                    elif entry.is_file():
                        shutil.copy2(entry, destination)
            migration.write_text(json.dumps({'existing_teacher_ids': ids, 'policy': 'private copies of previously shared files'}, ensure_ascii=False), encoding='utf-8')
        staging = resource / '__teachers' / f'.staging-{uuid.uuid4().hex}'
        staging.mkdir(parents=True)
        (staging / '.initialized').write_text('1', encoding='ascii')
        (staging / '.ownership-v2').write_text('1', encoding='ascii')
        if target.exists():
            # An incomplete prior migration is retained rather than overwritten.
            target.rename(target.with_name(f'{key}.incomplete-{uuid.uuid4().hex[:8]}'))
        staging.rename(target)
    return target


def bank_export_root(project_root: Path) -> Path:
    key = teacher_key()
    return project_root / '.solaire' / 'bank_exports' / key if key else project_root / '.solaire' / 'exports'
