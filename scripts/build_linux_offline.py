"""Build on Linux from a prepared conda runtime and compiled frontend, not user data."""
import argparse
import fnmatch
import hashlib
import io
import json
import posixpath
from pathlib import Path
from pathlib import PurePosixPath
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib


RUNTIME_EXCLUDE_PATTERNS = (
    'lib/python*/site-packages/solaire/**',
    'lib/libtesseract.a',
)
SOURCE_PATH_PTH_NAME = 'solaire-source.pth'


def _runtime_exclusion_records(files):
    records = []
    for entry in files:
        if not any(
            fnmatch.fnmatchcase(entry.target, pattern)
            for pattern in RUNTIME_EXCLUDE_PATTERNS
        ):
            continue
        source = Path(entry.source)
        if source.is_symlink():
            size = 0
        elif source.is_file():
            size = source.stat().st_size
        else:
            size = 0
        records.append({'path': entry.target, 'bytes': size})
    return records


def pack_runtime(runtime, output, staging_dir, conda_pack, console_scripts=()):
    """Pack dependencies while resolving application modules from release/src."""
    runtime = Path(runtime).resolve()
    env = conda_pack.CondaEnv.from_prefix(str(runtime))
    original_files = list(env.files)
    exclusion_records = _runtime_exclusion_records(original_files)
    package_files = [
        entry for entry in original_files
        if fnmatch.fnmatchcase(entry.target, RUNTIME_EXCLUDE_PATTERNS[0])
    ]
    if not package_files:
        raise ValueError('Installed solaire package was not found in the runtime environment')

    site_targets = set()
    for entry in package_files:
        parts = PurePosixPath(entry.target).parts
        try:
            site_index = parts.index('site-packages')
        except ValueError:
            raise ValueError(
                f'Unexpected installed solaire path: {entry.target}'
            ) from None
        if site_index + 1 >= len(parts) or parts[site_index + 1] != 'solaire':
            raise ValueError(
                f'Unexpected installed solaire path: {entry.target}'
            )
        site_targets.add(PurePosixPath(*parts[:site_index + 1]))
    site_packages = sorted(site_targets)
    if len(site_packages) != 1:
        candidates = ', '.join(path.as_posix() for path in site_packages) or '(none)'
        raise ValueError(
            'Expected exactly one runtime Python site-packages directory containing '
            f'installed solaire; found: {candidates}'
        )
    site_target = site_packages[0]
    pth_target = (site_target / SOURCE_PATH_PTH_NAME).as_posix()

    filtered = env
    for pattern in (*RUNTIME_EXCLUDE_PATTERNS, pth_target):
        filtered = filtered.exclude(pattern)
    if any(
        fnmatch.fnmatchcase(entry.target, pattern)
        for entry in filtered.files
        for pattern in RUNTIME_EXCLUDE_PATTERNS
    ):
        raise ValueError('Runtime exclusion patterns left matching files in the package')
    remaining_targets = {entry.target for entry in filtered.files}
    missing_scripts = [
        name for name in console_scripts if f'bin/{name}' not in remaining_targets
    ]
    if missing_scripts:
        raise ValueError(
            'Runtime console scripts would be missing: ' + ', '.join(missing_scripts)
        )

    pth_source = Path(staging_dir) / SOURCE_PATH_PTH_NAME
    pth_source.write_bytes(
        (posixpath.relpath('../src', site_target.as_posix()) + '\n').encode('utf-8')
    )
    filtered.files.append(
        conda_pack.File(
            source=str(pth_source),
            target=pth_target,
            is_conda=False,
            file_mode='text',
        )
    )
    filtered.files.sort(key=lambda entry: entry.target)
    filtered.pack(output=str(output), format='tar.gz')

    with tarfile.open(output, 'r:*') as archive:
        packed_targets = {member.name for member in archive.getmembers()}
        if any(
            fnmatch.fnmatchcase(target, pattern)
            for target in packed_targets
            for pattern in RUNTIME_EXCLUDE_PATTERNS
        ):
            raise ValueError('Packed runtime still contains an excluded file')
        expected_scripts = {f'bin/{name}' for name in console_scripts}
        if not expected_scripts.issubset(packed_targets):
            raise ValueError('Packed runtime is missing a console script')
        packed_pth = archive.extractfile(pth_target)
        packed_pth_bytes = packed_pth.read() if packed_pth is not None else None
        expected_pth_bytes = posixpath.relpath('../src', site_target.as_posix()).encode() + b'\n'
        if packed_pth_bytes != expected_pth_bytes:
            raise ValueError(
                f'Packed runtime source path redirect is missing or invalid: {packed_pth_bytes!r}'
            )
    return exclusion_records


def _archive_unpacked_file_bytes(archive_path):
    """Count regular-file payload bytes actually present in a tar archive."""
    with tarfile.open(archive_path, 'r:*') as archive:
        return sum(member.size for member in archive if member.isfile())


def build(runtime, output, *, root=None):
    if root is None:
        root = Path(__file__).resolve().parents[1]
    root = Path(root).resolve()

    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('必须在 Linux x86_64 构建，不能打包 Windows 运行环境')
    project = tomllib.loads((root / 'pyproject.toml').read_text())['project']
    version = project['version']
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if not (root / 'web/dist/index.html').is_file():
        raise SystemExit('请先在 web 目录执行 npm ci && npm run build')

    stamp_path = root / 'web/dist/build-stamp.json'
    if not stamp_path.is_file():
        raise SystemExit('前端 dist 缺少 build-stamp.json，请在 web 目录重新执行 npm run build')
    try:
        stamp = json.loads(stamp_path.read_text(encoding='utf-8'))
    except Exception as e:
        raise SystemExit(f'前端 dist 的 build-stamp.json 损坏或无法解析: {e}')

    sys.path.insert(0, str(root))
    from scripts.build_stamp import (
        FORMAT_VERSION,
        SCHEMA_NAME,
        compute_input_fingerprint,
        compute_output_fingerprint,
        validate_stamp_schema,
    )
    if stamp.get('schema') != SCHEMA_NAME or stamp.get('format_version') != FORMAT_VERSION:
        raise SystemExit('前端 dist 的 build-stamp.json schema 或版本不匹配')
    try:
        validate_stamp_schema(stamp)
    except ValueError as e:
        raise SystemExit(f'前端 dist 的 build-stamp.json 字段无效: {e}') from e

    current_fp, current_inputs = compute_input_fingerprint(root / 'web')
    if stamp['fingerprint'] != current_fp or stamp['inputs'] != current_inputs:
        raise SystemExit(
            f'前端 dist 指纹与当前 web 源码不匹配: dist={stamp["fingerprint"]}, current={current_fp}'
        )
    current_output_fp, current_outputs = compute_output_fingerprint(root / 'web/dist')
    if (
        stamp['output_fingerprint'] != current_output_fp
        or stamp['outputs'] != current_outputs
    ):
        raise SystemExit('前端 dist 实际产物与 build-stamp.json 不匹配')
    if stamp['revision'] != commit:
        raise SystemExit(
            f'前端 dist revision ({stamp["revision"]}) 与发布 commit ({commit}) 不匹配'
        )
    if stamp['git_dirty'] is not False:
        raise SystemExit('前端源码工作区未 clean 或状态 unknown，拒绝按当前 commit 发布')

    import conda_pack

    output.mkdir(parents=True, exist_ok=True)
    name = f'EducationHelper-{version}-{commit[:10]}-linux-x86_64-offline'
    with tempfile.TemporaryDirectory(prefix='eh-offline-build-') as temporary:
        temporary = Path(temporary)
        package = temporary / name
        package.mkdir()
        with tempfile.TemporaryDirectory(prefix='eh-source-') as staged:
            stage = Path(staged)
            archive = subprocess.check_output(['git', 'archive', 'HEAD', 'src', 'pyproject.toml', 'README.md', 'LICENSE'], cwd=root)
            with tarfile.open(fileobj=io.BytesIO(archive)) as source:
                source.extractall(stage, filter='data')
            shutil.copytree(root / 'web/dist', stage / 'web/dist')
            with tarfile.open(package / 'app.tar.gz', 'w:gz') as target:
                for path in sorted(stage.iterdir()):
                    target.add(path, arcname=path.name)
        app_size = _archive_unpacked_file_bytes(package / 'app.tar.gz')
        excluded_runtime = pack_runtime(
            runtime,
            package / 'runtime.tar.gz',
            temporary,
            conda_pack,
            console_scripts=project.get('scripts', {}),
        )
        excluded_solaire = sum(
            item['bytes'] for item in excluded_runtime
            if fnmatch.fnmatchcase(item['path'], RUNTIME_EXCLUDE_PATTERNS[0])
        )
        excluded_tesseract = sum(
            item['bytes'] for item in excluded_runtime
            if fnmatch.fnmatchcase(item['path'], RUNTIME_EXCLUDE_PATTERNS[1])
        )
        excluded_solaire_count = sum(
            fnmatch.fnmatchcase(item['path'], RUNTIME_EXCLUDE_PATTERNS[0])
            for item in excluded_runtime
        )
        excluded_tesseract_count = sum(
            fnmatch.fnmatchcase(item['path'], RUNTIME_EXCLUDE_PATTERNS[1])
            for item in excluded_runtime
        )
        print(
            f'Runtime exclusions: installed solaire={excluded_solaire_count} files, '
            f'{excluded_solaire} bytes; libtesseract.a={excluded_tesseract_count} files, '
            f'{excluded_tesseract} bytes',
            flush=True,
        )
        for file in ['install.sh', 'installer.py']:
            shutil.copy2(root / 'scripts/offline' / file, package / file)
        shutil.copy2(root / 'docs/linux-offline-install.md', package / '使用说明.md')
        runtime_size = _archive_unpacked_file_bytes(package / 'runtime.tar.gz')
        manifest = {
            'format': 1,
            'version': version,
            'commit': commit,
            'arch': 'x86_64',
            'min_glibc': '2.35',
            'unpacked_bytes': app_size + runtime_size,
            'sha256': {},
            'frontend': {
                'schema': stamp['schema'],
                'format_version': stamp['format_version'],
                'fingerprint': stamp['fingerprint'],
                'output_fingerprint': stamp['output_fingerprint'],
                'revision': stamp.get('revision', 'unknown'),
                'git_dirty': stamp.get('git_dirty', False),
            },
        }
        for file in ['app.tar.gz', 'runtime.tar.gz']:
            h = hashlib.sha256()
            with (package / file).open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    h.update(chunk)
            manifest['sha256'][file] = h.hexdigest()
        (package / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        subprocess.run([str(runtime / 'bin/python'), '-m', 'pip', 'freeze'], check=True,
                       stdout=(package / 'python-dependencies.txt').open('w'))
        bundle = output / (name + '.tar.gz')
        with tarfile.open(bundle, 'w:gz') as target:
            target.add(package, arcname=name)
    h = hashlib.sha256()
    with bundle.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            h.update(chunk)
    bundle.with_suffix('.gz.sha256').write_text(f'{h.hexdigest()}  {bundle.name}\n')
    print(bundle, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime-prefix', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('dist-offline'))
    args = parser.parse_args()
    build(args.runtime_prefix, args.output)
