import importlib.util
import io
from pathlib import Path
import sqlite3
import sys
import tarfile
from types import SimpleNamespace

import pytest


@pytest.fixture
def installer(monkeypatch):
    if sys.platform == 'win32':
        monkeypatch.setitem(sys.modules, 'fcntl', SimpleNamespace())
        monkeypatch.setitem(sys.modules, 'pwd', SimpleNamespace())
    path = Path(__file__).resolve().parents[1] / 'scripts/offline/installer.py'
    spec = importlib.util.spec_from_file_location('offline_installer_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_archive(path, entries):
    with tarfile.open(path, 'w:gz') as target:
        for name, kind, data in entries:
            member = tarfile.TarInfo(name)
            if kind == 'file':
                member.size = len(data)
                target.addfile(member, io.BytesIO(data))
            else:
                member.type = tarfile.SYMTYPE
                member.linkname = data
                target.addfile(member)


@pytest.mark.parametrize('name', ['../outside', '/etc/shadow', 'safe/../../outside'])
def test_archive_rejects_traversal(installer, tmp_path, name):
    path = tmp_path / 'malicious.tar.gz'
    make_archive(path, [(name, 'file', b'attack')])
    with pytest.raises(ValueError):
        installer.extract_safe(path, tmp_path / 'release')
    assert not (tmp_path / 'outside').exists()


def test_archive_rejects_symlink_escape_and_parent_links(installer, tmp_path):
    archive = tmp_path / 'bad.tar.gz'
    make_archive(archive, [('escape', 'link', '../outside')])
    with pytest.raises(ValueError):
        installer.extract_safe(archive, tmp_path / 'one', allow_links=True)
    make_archive(archive, [('directory', 'link', 'inside'), ('directory/file', 'file', b'data')])
    with pytest.raises((ValueError, FileExistsError)):
        installer.extract_safe(archive, tmp_path / 'two', allow_links=True)


def test_online_backup_includes_wal_without_changing_live_data(installer, tmp_path):
    source = tmp_path / 'data'
    source.mkdir()
    database = source / 'platform.sqlite3'
    with sqlite3.connect(database) as con:
        con.execute('PRAGMA journal_mode=WAL')
        con.execute('CREATE TABLE answers(value TEXT)')
        con.execute("INSERT INTO answers VALUES ('saved answer')")
        con.commit()
        installer.backup_databases([source], tmp_path / 'backups')
        con.execute("INSERT INTO answers VALUES ('later answer')")
        con.commit()
        assert con.execute('SELECT count(*) FROM answers').fetchone()[0] == 2
    with sqlite3.connect(tmp_path / 'backups/0/platform.sqlite3') as con:
        assert con.execute('SELECT value FROM answers').fetchall() == [('saved answer',)]


def test_environment_preserves_quoted_original_paths(installer, tmp_path):
    cfg = tmp_path / 'original.env'
    cfg.write_text('# original settings\nSOLAIRE_PROJECT_ROOT="/var/lib/eh/workspace"\nSECRET=keepme\n')
    original = cfg.read_bytes()
    assert installer.environment_file(cfg)['SOLAIRE_PROJECT_ROOT'] == '/var/lib/eh/workspace'
    assert cfg.read_bytes() == original


def test_unit_uses_offline_runtime_and_graceful_bounded_restart(installer, tmp_path):
    text = installer.unit(tmp_path / 'current', tmp_path / 'data', tmp_path / 'config', 'wzx', 5173, 8000, web=True)
    assert '/runtime/bin/python -m uvicorn solaire.web.offline_frontend:app' in text
    assert 'timeout-graceful-shutdown 12' in text
    assert 'TimeoutStopSec=15' in text
    assert 'npm' not in text and 'pixi' not in text


def test_recovery_timeout_does_not_abort_remaining_recovery(installer, monkeypatch):
    import subprocess
    def timeout(*args, **kw):
        raise subprocess.TimeoutExpired(args[0], 45)
    monkeypatch.setattr(installer.subprocess, 'run', timeout)
    assert installer.recovery_command('systemctl', 'stop', 'test.service') is False
