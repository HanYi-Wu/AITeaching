"""Rehearse platform database migration on a WAL-consistent temporary copy."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import tempfile
import time
from contextlib import closing
from pathlib import Path


_MIGRATE = """
import sqlite3, sys
from contextlib import closing
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'src'))
from solaire.web.platform_db import init_platform_db
root = Path(sys.argv[1])
init_platform_db(root)
with closing(sqlite3.connect(root / '.solaire' / 'platform.db')) as db:
    if db.execute('PRAGMA quick_check').fetchone() != ('ok',):
        raise RuntimeError('Candidate database failed integrity check')
"""


def _fingerprint(path: Path) -> tuple[int, tuple, dict[str, int]]:
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=3)) as con:
        version = con.execute("PRAGMA user_version").fetchone()[0]
        schema = tuple(con.execute("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name"))
        tables = {name for kind, name, _ in schema if kind == "table"}
        counts = {name: con.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
                  for name in ("schools", "users", "exam_publications", "student_attempts") if name in tables}
        return version, schema, counts


def rehearse_platform_migration(candidate: Path, python: Path, source_db: Path,
                               *, timeout: float = 45) -> dict:
    source_db = source_db.resolve(strict=True)
    candidate = candidate.resolve(strict=True)
    python = python.resolve(strict=True)
    deadline = time.monotonic() + timeout

    def remaining():
        left = deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError("Platform database rehearsal timed out")
        return left

    with tempfile.TemporaryDirectory(prefix="eh-update-db-") as temp:
        root = Path(temp)
        database = root / ".solaire" / "platform.db"
        database.parent.mkdir(mode=0o700)
        with closing(sqlite3.connect(source_db.as_uri() + "?mode=ro", uri=True, timeout=min(3, remaining()))) as source:
            with closing(sqlite3.connect(database)) as copy:
                source.backup(copy, pages=256, sleep=0.05, progress=lambda *_: remaining())
        before_version, before_schema, before_counts = _fingerprint(database)
        env = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR", "COMSPEC"}}
        env.update({"EH_DATA_ROOT": temp, "APPDATA": temp, "LOCALAPPDATA": temp,
                    "XDG_CONFIG_HOME": temp, "XDG_DATA_HOME": temp, "XDG_CACHE_HOME": temp,
                    "PATH": os.pathsep.join((str(python.parent), str(python.parent / "Library" / "bin"), os.defpath)),
                    "TMP": temp, "TEMP": temp, "TMPDIR": temp})
        outcome = subprocess.run([str(python), "-IB", "-c", _MIGRATE, temp], cwd=candidate, env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 timeout=remaining(), check=False)
        if outcome.returncode != 0:
            raise ValueError("Candidate could not open or migrate the platform database copy")
        after_version, after_schema, after_counts = _fingerprint(database)
        if after_version < before_version or any(after_counts.get(key, -1) < count for key, count in before_counts.items()):
            raise ValueError("Candidate migration removed protected records or downgraded the database")
        return {"schema_before": before_version, "schema_after": after_version,
                "schema_unchanged": before_version == after_version and before_schema == after_schema}
