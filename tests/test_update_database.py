import sqlite3
import sys
from contextlib import closing
from pathlib import Path

import pytest

from solaire.web.platform_db import SCHEMA_VERSION, init_platform_db, platform_db_path
from tools.release_verify.update_database import rehearse_platform_migration


def test_real_candidate_reads_database_copy_including_wal_without_writing_source(tmp_path):
    init_platform_db(tmp_path)
    database = platform_db_path(tmp_path)
    repository = Path(__file__).resolve().parents[1]
    with closing(sqlite3.connect(database)) as active:
        assert active.execute("pragma journal_mode=wal").fetchone() == ("wal",)
        active.execute("INSERT INTO schools(id, name, created_at, updated_at) VALUES ('s1','Fixture','2026','2026')")
        active.commit()
        result = rehearse_platform_migration(repository, Path(sys.executable), database)
        assert result == {"schema_before": SCHEMA_VERSION, "schema_after": SCHEMA_VERSION, "schema_unchanged": True}
        assert active.execute("SELECT id FROM schools").fetchall() == [("s1",)]


@pytest.mark.parametrize("loses_records", [False, True])
def test_schema_change_is_not_hot_compatible_and_data_loss_is_rejected(tmp_path, loses_records):
    init_platform_db(tmp_path)
    database = platform_db_path(tmp_path)
    candidate = tmp_path / "candidate"
    source = candidate / "src" / "solaire" / "web"
    source.mkdir(parents=True)
    for parent in (source, source.parent):
        (parent / "__init__.py").touch()
    action = "DELETE FROM schools" if loses_records else "CREATE TABLE fixture_upgrade(id INTEGER)"
    (source / "platform_db.py").write_text(
        "import sqlite3\n"
        "def init_platform_db(root):\n"
        "    with sqlite3.connect(root / '.solaire' / 'platform.db') as db:\n"
        f"        db.execute({action!r})\n"
        f"        db.execute('PRAGMA user_version={SCHEMA_VERSION + 1}')\n",
        encoding="utf-8",
    )
    with closing(sqlite3.connect(database)) as active:
        active.execute("INSERT INTO schools(id, name, created_at, updated_at) VALUES ('s1','Fixture','2026','2026')")
        active.commit()
        if loses_records:
            with pytest.raises(ValueError, match="removed protected records"):
                rehearse_platform_migration(candidate, Path(sys.executable), database)
        else:
            result = rehearse_platform_migration(candidate, Path(sys.executable), database)
            assert result["schema_after"] == SCHEMA_VERSION + 1
            assert result["schema_unchanged"] is False
        assert active.execute("PRAGMA user_version").fetchone() == (SCHEMA_VERSION,)
        assert active.execute("SELECT id FROM schools").fetchall() == [("s1",)]
