"""Build on Linux from a prepared conda runtime and compiled frontend, not user data."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import tomllib


def build(runtime, output):
    import conda_pack
    root = Path(__file__).resolve().parents[1]
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('必须在 Linux x86_64 构建，不能打包 Windows 运行环境')
    version = tomllib.loads((root / 'pyproject.toml').read_text())['project']['version']
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if not (root / 'web/dist/index.html').is_file():
        raise SystemExit('请先在 web 目录执行 npm ci && npm run build')
    output.mkdir(parents=True, exist_ok=True)
    name = f'EducationHelper-{version}-{commit[:10]}-linux-x86_64-offline'
    with tempfile.TemporaryDirectory(prefix='eh-offline-build-') as temporary:
        package = Path(temporary) / name
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
            app_size = sum(p.stat().st_size for p in stage.rglob('*') if p.is_file())
        conda_pack.pack(prefix=str(runtime.resolve()), output=str(package / 'runtime.tar.gz'), format='tar.gz')
        for file in ['install.sh', 'installer.py']:
            shutil.copy2(root / 'scripts/offline' / file, package / file)
        shutil.copy2(root / 'docs/linux-offline-install.md', package / '使用说明.md')
        runtime_size = sum(p.stat().st_size for p in runtime.rglob('*') if p.is_file())
        manifest = {'format': 1, 'version': version, 'commit': commit, 'arch': 'x86_64',
                    'min_glibc': '2.35', 'unpacked_bytes': app_size + runtime_size,
                    'sha256': {}}
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
