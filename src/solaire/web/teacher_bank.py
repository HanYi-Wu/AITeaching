"""Private physical banks, with a one-time copy of the formerly shared bank."""
import json
from pathlib import Path
import shutil
import threading
import uuid

from solaire.common.actor_context import actor, teacher_key

_migration_lock = threading.RLock()


def bank_resource_root(project_root: Path) -> Path:
    resource = (project_root / 'resource').resolve()
    key = teacher_key()
    if not key:
        return resource
    target = resource / '__teachers' / key
    from solaire.common.security import assert_within_project
    assert_within_project(project_root, target)
    if (target / '.initialized').is_file():
        return target
    with _migration_lock:
        if (target / '.initialized').is_file():
            return target
        from solaire.web.platform_db import connect, default_platform_root, init_platform_db
        platform = default_platform_root()
        init_platform_db(platform)
        migration = project_root / '.solaire' / 'bank-migration.json'
        snapshot = project_root / '.solaire' / 'legacy_bank_snapshot'
        if not migration.is_file():
            with connect(platform) as con:
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
        eligible = json.loads(migration.read_text('utf-8'))['existing_teacher_ids']
        staging = resource / '__teachers' / f'.staging-{uuid.uuid4().hex}'
        staging.mkdir(parents=True)
        if str(actor.get()['id']) in eligible:
            shutil.copytree(snapshot, staging, dirs_exist_ok=True)
            # Imported legacy images now resolve to the teacher's own copy.
            import re
            for file in staging.rglob('*.yaml'):
                original = file.read_text('utf-8')
                updated = re.sub(r':::EMBED_(IMG|SVG|PDF):(?!(?:__teachers/))', rf':::EMBED_\1:__teachers/{key}/', original)
                if updated != original:
                    file.write_text(updated, encoding='utf-8')
        (staging / '.initialized').write_text('1', encoding='ascii')
        if target.exists():
            # An incomplete prior migration is retained rather than overwritten.
            target.rename(target.with_name(f'{key}.incomplete-{uuid.uuid4().hex[:8]}'))
        staging.rename(target)
    return target


def bank_export_root(project_root: Path) -> Path:
    key = teacher_key()
    return project_root / '.solaire' / 'bank_exports' / key if key else project_root / '.solaire' / 'exports'
