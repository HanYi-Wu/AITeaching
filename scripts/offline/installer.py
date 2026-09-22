"""Offline, immutable systemd deployment. Never installs dependencies or restores live DBs."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import shlex
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import urllib.request

SERVICES = ['educationhelper-web.service', 'educationhelper-backend.service']


def log(message):
    print('[EH 离线安装] ' + message, flush=True)


def run(*args, **kwargs):
    return subprocess.run(list(map(str, args)), check=True, timeout=kwargs.pop('timeout', 300), **kwargs)


def recovery_command(*args):
    try:
        return subprocess.run(list(args), timeout=45, check=False).returncode == 0
    except Exception as error:
        log('恢复命令未完成：' + str(error))
        return False


def safe_directory(raw):
    path = Path(raw)
    if not path.is_absolute() or path.resolve() in [Path('/'), Path('/opt'), Path('/etc'), Path('/var'), Path('/tmp'), Path('/home')]:
        raise ValueError('必须指定独立的绝对目录，不能指定系统根目录')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(path)) or '..' in path.parts:
        raise ValueError('安装路径仅支持无空格的安全绝对路径')
    return path.resolve()


def verify(package, manifest):
    if manifest.get('format') != 1 or manifest.get('arch') != platform.machine():
        raise ValueError('安装包格式或 CPU 架构不匹配（当前只提供 x86_64）')
    libc, version = platform.libc_ver()
    if libc != 'glibc' or tuple(map(int, version.split('.'))) < (2, 35):
        raise ValueError('需要 glibc 2.35+，例如 Ubuntu 22.04/24.04，不支持 Alpine')
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', manifest.get('version', '')):
        raise ValueError('版本号无效')
    if not re.fullmatch(r'[0-9a-f]{40}', manifest.get('commit', '')) or type(manifest.get('unpacked_bytes')) is not int or manifest['unpacked_bytes'] <= 0:
        raise ValueError('提交或磁盘元数据无效')
    for name in ['app.tar.gz', 'runtime.tar.gz']:
        digest = hashlib.sha256()
        with (package / name).open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != manifest['sha256'].get(name):
            raise ValueError('安装包校验失败：' + name)


def extract_safe(archive, destination, allow_links=False):
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive) as source:
        members = source.getmembers()
        links = {Path(m.name) for m in members if m.issym() or m.islnk()}
        for member in members:
            path = destination / member.name
            if any(parent in links for parent in Path(member.name).parents):
                raise ValueError('压缩包链接不能包含子文件')
            if Path(member.name).is_absolute() or '..' in Path(member.name).parts or not path.resolve().is_relative_to(destination.resolve()):
                raise ValueError('压缩包包含越界路径')
            if not (member.isfile() or member.isdir() or (allow_links and (member.issym() or member.islnk()))):
                raise ValueError('压缩包包含不支持的特殊文件')
            if member.issym():
                link = Path(member.linkname)
                if link.is_absolute() or not (path.parent / link).resolve().is_relative_to(destination.resolve()):
                    raise ValueError('压缩包符号链接越界')
            if member.islnk():
                link = Path(member.linkname)
                if link.is_absolute() or '..' in link.parts:
                    raise ValueError('压缩包硬链接越界')
        # Files first; no extraction can follow a symlink created by the archive.
        for member in sorted(members, key=lambda m: (m.issym(), m.islnk())):
            for parent in (destination / member.name).parents:
                if parent == destination:
                    break
                if parent.is_symlink():
                    raise ValueError('符号链接不能作为压缩包文件父目录')
            if member.islnk() and not (destination / member.linkname).is_file():
                raise ValueError('硬链接必须指向已解压的文件')
            source.extract(member, destination)


def switch(current, target):
    temporary = current.with_name('.current-' + secrets.token_hex(8))
    temporary.symlink_to(target)
    os.replace(temporary, current)


def environment_file(path):
    values = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                parts = shlex.split(value)
                values[key.strip()] = parts[0] if len(parts) == 1 else value
    return values


def backup_databases(roots, output):
    seen = set()
    for index, root in enumerate(roots):
        if not root.is_dir():
            continue
        for path in root.rglob('*'):
            if path.suffix not in {'.db', '.sqlite', '.sqlite3'} or path.is_symlink() or not path.is_file():
                continue
            actual = path.resolve()
            if actual in seen:
                continue
            seen.add(actual)
            with path.open('rb') as probe:
                if probe.read(16) != b'SQLite format 3\x00':
                    continue
            target = output / str(index) / path.relative_to(root)
            target.parent.mkdir(parents=True, exist_ok=True)
            # SQLite's online backup API includes committed WAL data.
            with sqlite3.connect(actual.as_uri() + '?mode=ro', uri=True, timeout=10) as source, sqlite3.connect(target) as copy:
                source.backup(copy, pages=256, sleep=0.01)
            log('已备份数据库：' + str(path))


def unit(current, data, config, user, port, backend, web=False):
    module = 'solaire.web.offline_frontend:app' if web else 'solaire.web.app:app'
    host = '0.0.0.0' if web else '127.0.0.1'
    dependencies = 'Requires=educationhelper-backend.service\nAfter=educationhelper-backend.service\n' if web else ''
    return f'''[Unit]
Description=EducationHelper {'Web' if web else 'backend'} (offline runtime)
After=network.target
{dependencies}
[Service]
Type=simple
User={user}
WorkingDirectory={current}
Environment=PYTHONPATH={current}/src
Environment=PATH={current}/runtime/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONNOUSERSITE=1
Environment=LD_LIBRARY_PATH={current}/runtime/lib
Environment=EH_RELEASE_ID={current.resolve().name}
Environment=EH_WEB_ROOT={current}/web/dist
Environment=EH_BACKEND_URL=http://127.0.0.1:{backend}
Environment=TESSDATA_PREFIX={current}/runtime/share/tessdata
EnvironmentFile={config}/educationhelper.env
ExecStart={current}/runtime/bin/python -m uvicorn {module} --host {host} --port {port if web else backend} --timeout-graceful-shutdown 12
Restart=on-failure
RestartSec=2
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths={data}
UMask=0077

[Install]
WantedBy=multi-user.target
'''


def healthy(web, backend, release_id, seconds=60):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with opener.open(f'http://127.0.0.1:{backend}/api/health', timeout=2) as response:
                if json.load(response).get('status') != 'ok':
                    raise ValueError('backend not ready')
            with opener.open(f'http://127.0.0.1:{web}/', timeout=2) as response:
                if response.status != 200:
                    raise ValueError('frontend not ready')
            if release_id:
                with opener.open(f'http://127.0.0.1:{web}/_eh_release', timeout=2) as response:
                    if json.load(response)['release_id'] != release_id:
                        raise ValueError('wrong frontend release')
            with opener.open(f'http://127.0.0.1:{web}/api/health', timeout=2) as response:
                if json.load(response).get('status') != 'ok':
                    raise ValueError('proxy not ready')
            return True
        except Exception:
            time.sleep(1)
    return False


def install(args):
    if os.geteuid() != 0:
        raise ValueError('请使用 sudo bash install.sh')
    if not Path('/run/systemd/system').is_dir():
        raise ValueError('需要运行中的 systemd Linux 系统')
    app, data, config = [safe_directory(p) for p in [args.app_base, args.data_dir, args.config_dir]]
    for a, b in [(app, data), (app, config), (data, config)]:
        if a.is_relative_to(b) or b.is_relative_to(a):
            raise ValueError('代码、数据、配置目录必须互不嵌套')
    current = app / 'current'
    if current.exists() and not current.is_symlink():
        raise ValueError('current 不是版本链接，拒绝覆盖原项目；请先进行目录迁移')
    old = current.resolve() if current.is_symlink() else None
    if old and not old.is_dir():
        raise ValueError('旧版本链接目标缺失，拒绝自动修复')
    app_created = not app.exists()
    app.mkdir(parents=True, exist_ok=True)
    if app_created:
        app.chmod(0o755)
    with (app / '.offline-install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.umask(0o077)
        _install_locked(args, app, data, config, current, old)


def _install_locked(args, app, data, config, current, old):
    package = args.package.resolve()
    manifest = json.loads((package / 'manifest.json').read_text())
    verify(package, manifest)
    release_id = manifest['version'] + '-' + manifest['commit'][:10] + '-' + secrets.token_hex(4)
    release = app / 'releases' / release_id
    releases_created = not release.parent.exists()
    release.parent.mkdir(parents=True, exist_ok=True)
    if releases_created:
        release.parent.chmod(0o755)
    available = shutil.disk_usage(app).free
    if available < manifest['unpacked_bytes'] * 2 + 512 * 1024 * 1024:
        raise ValueError('磁盘空间不足：需新版本空间、数据库备份空间及至少512MB余量')
    cfg = config / 'educationhelper.env'
    if old and not cfg.is_file():
        raise ValueError('已有部署缺少配置文件，拒绝创建替代配置')
    values = environment_file(cfg)
    for key in ['SOLAIRE_PROJECT_ROOT', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'EH_DATA_ROOT']:
        if key in values and not safe_directory(values[key]).is_relative_to(data):
            raise ValueError(key + ' 不在指定持久化目录中；请用 --data-dir 指定原数据根目录')
    units = Path('/etc/systemd/system')
    originals = {name: (units / name).read_bytes() if (units / name).is_file() else None for name in SERVICES}
    modes = {name: (units / name).stat().st_mode & 0o777 if body is not None else 0o644 for name, body in originals.items()}
    if any((units / name).is_symlink() for name in SERVICES):
        raise ValueError('自定义 systemd 单元是符号链接，拒绝覆盖')
    for name in SERVICES:
        if list((units / (name + '.d')).glob('*.conf')) or list((Path('/run/systemd/system') / (name + '.d')).glob('*.conf')):
            raise ValueError('存在自定义 systemd drop-in，需管理员先核实，拒绝自动替换')
    user = args.service_user
    if not user and old:
        user = subprocess.check_output(['systemctl', 'show', SERVICES[1], '-p', 'User', '--value'], text=True).strip()
    user = user or 'educationhelper'
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*', user) or user == 'root':
        raise ValueError('服务必须使用合法的非 root 账户')
    try:
        account = pwd.getpwnam(user)
    except KeyError:
        if old or args.service_user:
            raise ValueError('原服务账户不存在')
        run('useradd', '--system', '--create-home', '--home-dir', str(data / 'home'), '--shell', '/usr/sbin/nologin', user)
        account = pwd.getpwnam(user)
    web_port, backend_port = args.port, args.backend_port
    for name, option in [(SERVICES[0], 'port'), (SERVICES[1], 'backend_port')]:
        if getattr(args, option) is None and originals[name]:
            found = re.search(rb'--port\s+(\d+)', originals[name])
            if not found:
                raise ValueError('无法识别原服务端口，请显式指定 --port / --backend-port')
            if option == 'port': web_port = int(found[1])
            else: backend_port = int(found[1])
    web_port, backend_port = web_port or 5173, backend_port or 8000
    if web_port == backend_port or not all(1024 <= port <= 65535 for port in [web_port, backend_port]):
        raise ValueError('端口必须不同且在1024–65535之间')
    log('开始离线准备；原服务保持运行')
    extract_safe(package / 'app.tar.gz', release)
    extract_safe(package / 'runtime.tar.gz', release / 'runtime', allow_links=True)
    run(release / 'runtime/bin/python', release / 'runtime/bin/conda-unpack', timeout=300)
    for directory, dirs, files in os.walk(release):
        os.chown(directory, account.pw_uid, account.pw_gid)
        os.chmod(directory, 0o755)
        for name in files:
            path = Path(directory) / name
            if not path.is_symlink():
                os.chown(path, account.pw_uid, account.pw_gid)
                os.chmod(path, path.stat().st_mode | 0o444)
    if not (release / 'web/dist/index.html').is_file():
        raise ValueError('前端成品缺失')
    with tempfile.TemporaryDirectory(prefix='eh-preflight-') as probe:
        os.chown(probe, account.pw_uid, account.pw_gid)
        os.chmod(probe, 0o700)
        env = {**os.environ, 'PYTHONPATH': str(release / 'src'), 'PYTHONNOUSERSITE': '1',
               'LD_LIBRARY_PATH': str(release / 'runtime/lib'),
               'XDG_DATA_HOME': probe, 'XDG_CONFIG_HOME': probe, 'SOLAIRE_PROJECT_ROOT': probe}
        def as_service_user():
            os.setgroups([])
            os.setgid(account.pw_gid)
            os.setuid(account.pw_uid)
        run(release / 'runtime/bin/python', '-c',
            "import solaire.web.app, solaire.web.offline_frontend, rdkit, cairosvg; print('Runtime imports: OK')", env=env,
            preexec_fn=as_service_user)
    stamp = time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3)
    backup = app / 'backups' / stamp
    backup.mkdir(parents=True)
    if config.exists():
        shutil.copytree(config, backup / 'config', symlinks=True)
    for name, body in originals.items():
        if body is not None:
            (backup / name).write_bytes(body)
    backup_databases([data], backup / 'databases')
    # Repair only evidence-backed legacy records, while the old service remains
    # available. The repair tool creates its own online SQLite backup as well.
    repair_env = {**os.environ, 'PYTHONPATH': str(release / 'src'), 'PYTHONNOUSERSITE': '1',
                  'LD_LIBRARY_PATH': str(release / 'runtime/lib'),
                  'XDG_DATA_HOME': values.get('XDG_DATA_HOME', str(data / 'appdata')),
                  'XDG_CONFIG_HOME': values.get('XDG_CONFIG_HOME', str(data / 'config'))}
    if values.get('EH_DATA_ROOT'):
        repair_env['EH_DATA_ROOT'] = values['EH_DATA_ROOT']
    else:
        repair_env.pop('EH_DATA_ROOT', None)
    repair_platform = (Path(repair_env['EH_DATA_ROOT']) if repair_env.get('EH_DATA_ROOT')
                       else Path(repair_env['XDG_DATA_HOME']) / 'SolEdu') / 'platform'
    run(release / 'runtime/bin/python', '-m', 'solaire.web.legacy_exam_repair',
        '--project-root', values.get('SOLAIRE_PROJECT_ROOT', str(data / 'workspace')),
        '--platform-root', str(repair_platform),
        '--apply', env=repair_env, preexec_fn=as_service_user, timeout=300)
    record = {'previous_release': str(old) if old else None, 'new_release': str(release),
              'data_dir': str(data), 'config_dir': str(config), 'status': 'prepared'}
    journal = backup / 'transaction.json'
    journal.write_text(json.dumps(record, indent=2))
    cfg_created = not cfg.exists()
    downtime = time.monotonic()
    stopped = False
    try:
        if old:
            log('准备完成，短暂停服并切换版本')
            stopped = True  # Roll back even if stop itself times out.
            run('systemctl', 'stop', *SERVICES, timeout=45)
        else:
            for directory in [data, data / 'workspace', data / 'appdata', data / 'config']:
                directory.mkdir(parents=True, exist_ok=True)
                os.chown(directory, account.pw_uid, account.pw_gid)
        config.mkdir(parents=True, exist_ok=True)
        if cfg_created:
            cfg.write_text(f'XDG_DATA_HOME={data}/appdata\nXDG_CONFIG_HOME={data}/config\n'
                           f'SOLAIRE_PROJECT_ROOT={data}/workspace\nSOLAIRE_BIND_PROJECT_FROM_ENV=1\n'
                           f'SOLAIRE_PUBLIC_MODE=1\nSOLAIRE_CONTROL_TOKEN={secrets.token_hex(32)}\n')
            cfg.chmod(0o600)
        switch(current, release)
        for name in SERVICES:
            path = units / name
            path.write_text(unit(current, data, config, user, web_port, backend_port, web=name == SERVICES[0]))
            path.chmod(0o644)
        run('systemctl', 'daemon-reload', timeout=30)
        stopped = True
        run('systemctl', 'start', SERVICES[1], SERVICES[0], timeout=45)
        if not healthy(web_port, backend_port, release_id, seconds=args.health_timeout):
            raise RuntimeError('新版健康检查失败')
        if not old:
            run('systemctl', 'enable', *SERVICES, timeout=30)
        record['status'] = 'completed'
        record['restart_seconds'] = round(time.monotonic() - downtime, 1)
        journal.write_text(json.dumps(record, indent=2))
        log(f"安装/更新成功；切换与检查耗时 {record['restart_seconds']} 秒")
        log(f'访问 http://<Linux-IP>:{web_port}；原资料保留，备份：{backup}')
    except BaseException:
        log('失败，恢复旧代码和原 systemd 单元；不覆盖实时业务数据')
        if stopped:
            recovery_command('systemctl', 'stop', *SERVICES)
        if old:
            switch(current, old)
        elif current.is_symlink():
            current.unlink()
        for name, body in originals.items():
            path = units / name
            if body is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(body)
                path.chmod(modes[name])
        if cfg_created:
            cfg.unlink(missing_ok=True)
        recovery_command('systemctl', 'daemon-reload')
        if old and stopped:
            recovery_command('systemctl', 'start', SERVICES[1], SERVICES[0])
            record['rollback_healthy'] = healthy(web_port, backend_port, None, seconds=30)
        record['status'] = 'rolled_back' if record.get('rollback_healthy') else 'failed'
        journal.write_text(json.dumps(record, indent=2))
        log('恢复结果与备份位于：' + str(backup))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='EducationHelper Linux 离线安装/更新（保留数据）')
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--app-base', default='/opt/educationhelper')
    parser.add_argument('--data-dir', default='/var/lib/educationhelper')
    parser.add_argument('--config-dir', default='/etc/educationhelper')
    parser.add_argument('--service-user')
    parser.add_argument('--port', type=int)
    parser.add_argument('--backend-port', type=int)
    parser.add_argument('--health-timeout', type=int, default=60, choices=range(5, 121), metavar='5..120')
    options = parser.parse_args()
    try:
        install(options)
    except Exception as error:
        log('失败：' + str(error))
        raise SystemExit(1)
