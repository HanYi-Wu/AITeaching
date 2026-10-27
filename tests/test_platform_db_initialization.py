"""Database opening must keep migrations out of current-version requests."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import sqlite3
import os
import subprocess
import sys

import pytest

from solaire.web import platform_db
from solaire.web.school.accounts import create_teacher
from solaire.web.school.importer import import_teachers
from solaire.web.school.organization import create_school


def test_current_database_opening_does_not_repair_or_write(tmp_path, monkeypatch):
    platform_db.init_platform_db(tmp_path)
    statements = []
    original = platform_db.connect

    def traced(root):
        con = original(root)
        con.set_trace_callback(statements.append)
        return con

    monkeypatch.setattr(platform_db, "connect", traced)
    for _ in range(4):
        platform_db.init_platform_db(tmp_path)
    assert statements == ["PRAGMA user_version"] * 4


def test_upgrade_is_atomic_and_can_retry_after_a_migration_failure(tmp_path, monkeypatch):
    path = platform_db.platform_db_path(tmp_path)
    path.parent.mkdir(parents=True)
    with closing(sqlite3.connect(path)) as con, con:
        con.executescript(platform_db.SCHEMA_SQL)
        con.execute("ALTER TABLE users DROP COLUMN preferences_json")
        con.execute("PRAGMA user_version = 11")

    with monkeypatch.context() as patch:
        def fail(_con):
            raise OSError("migration interrupted")
        patch.setattr(platform_db, "_dedupe_active_publication_classes", fail)
        with pytest.raises(OSError, match="migration interrupted"):
            platform_db.init_platform_db(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == 11
        assert "preferences_json" not in {row["name"] for row in con.execute("PRAGMA table_info(users)")}
        assert not con.execute("SELECT 1 FROM sqlite_master WHERE type='trigger'").fetchall()

    platform_db.init_platform_db(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == platform_db.SCHEMA_VERSION
        assert "preferences_json" in {row["name"] for row in con.execute("PRAGMA table_info(users)")}
        assert con.execute("PRAGMA foreign_key_check").fetchall() == []
    backups = list((path.parent / "backups").glob("*.db"))
    assert backups
    with closing(sqlite3.connect(backups[0])) as backup:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 11


def test_concurrent_processes_open_one_complete_database(tmp_path):
    code = "from pathlib import Path; from solaire.web.platform_db import init_platform_db; import sys; init_platform_db(Path(sys.argv[1]))"
    environment = dict(os.environ)
    environment["PYTHONPATH"] = os.pathsep.join(filter(None, (
        str(Path(__file__).resolve().parents[1] / "src"), environment.get("PYTHONPATH"),
    )))
    def initialize(_):
        return subprocess.run([sys.executable, "-c", code, str(tmp_path)], env=environment, capture_output=True, text=True, timeout=30)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(initialize, range(4)))
    assert all(result.returncode == 0 for result in results), [result.stderr for result in results]
    with closing(platform_db.connect(tmp_path)) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == platform_db.SCHEMA_VERSION
        assert len(con.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()) == 2


def test_newer_database_is_never_downgraded(tmp_path):
    platform_db.init_platform_db(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con, con:
        con.execute(f"PRAGMA user_version = {platform_db.SCHEMA_VERSION + 1}")
    with pytest.raises(RuntimeError, match="newer than supported"):
        platform_db.init_platform_db(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == platform_db.SCHEMA_VERSION + 1


def test_teacher_creation_and_import_create_default_folders_in_their_transactions(tmp_path):
    school = create_school(tmp_path, name="School")
    teacher = create_teacher(tmp_path, school_id=school["id"], username="teacher", password="teacher123", display_name="Teacher", subjects=["Math"])
    imported = import_teachers(tmp_path, school_id=school["id"], teachers=[{"username": "imported", "password": "teacher123"}])
    with closing(platform_db.connect(tmp_path)) as con:
        folders = {row[0] for row in con.execute("SELECT id FROM content_folders")}
    assert folders == {f"paper-default-{teacher['id']}", f"paper-default-{imported['teachers'][0]['id']}"}

    with pytest.raises(ValueError, match="Row 2"):
        import_teachers(tmp_path, school_id=school["id"], teachers=[{"username": "rolled-back"}, {"username": "x"}])
    with closing(platform_db.connect(tmp_path)) as con:
        assert {row[0] for row in con.execute("SELECT id FROM content_folders")} == folders
        assert con.execute("SELECT 1 FROM users WHERE username='rolled-back'").fetchone() is None
