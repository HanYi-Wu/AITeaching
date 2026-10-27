"""Task status reads stay available while another connection writes."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3

import pytest

from solaire.web.export_tasks import ExportTaskService
from solaire.web.task_tracking.store import TaskProjectionStore


@pytest.mark.parametrize("factory", [ExportTaskService, TaskProjectionStore])
def test_warm_store_initializes_without_waiting_for_writer(tmp_path: Path, factory):
    first = factory(tmp_path)
    writer = sqlite3.connect(first.db_path)
    try:
        writer.execute("BEGIN IMMEDIATE")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(factory, tmp_path)
            try:
                assert future.result(timeout=2).db_path == first.db_path
            finally:
                writer.rollback()
    finally:
        writer.close()


@pytest.mark.parametrize("factory", [ExportTaskService, TaskProjectionStore])
def test_store_initialization_handles_concurrent_first_use(tmp_path: Path, factory):
    with ThreadPoolExecutor(max_workers=4) as pool:
        stores = list(pool.map(factory, [tmp_path] * 8))
    with sqlite3.connect(stores[0].db_path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0] >= 1


@pytest.mark.parametrize("factory,index", [
    (ExportTaskService, "export_tasks_owner"),
    (TaskProjectionStore, "idx_task_proj_source"),
])
def test_store_recreates_a_missing_index(tmp_path: Path, factory, index):
    store = factory(tmp_path)
    with sqlite3.connect(store.db_path) as db:
        db.execute(f"DROP INDEX {index}")
    factory(tmp_path)
    with sqlite3.connect(store.db_path) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name=?", (index,)).fetchone() == (index,)


def test_export_store_upgrades_existing_unversioned_rows(tmp_path: Path):
    folder = tmp_path / ".solaire"
    folder.mkdir()
    with sqlite3.connect(folder / "export-tasks.sqlite3") as db:
        db.execute("""CREATE TABLE export_tasks (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, format TEXT NOT NULL,
            request_json TEXT NOT NULL, request_key TEXT,
            status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 1, result_json TEXT, error_json TEXT,
            UNIQUE(owner, request_key))""")
        db.execute("""INSERT INTO export_tasks
            (id, owner, format, request_json, status, created_at, updated_at)
            VALUES ('old', 'teacher:1', 'pdf', '{}', 'succeeded', '2026-01-01', '2026-01-01')""")
    store = ExportTaskService(tmp_path)
    with sqlite3.connect(store.db_path) as db:
        assert db.execute("SELECT id, recovery_ids_json FROM export_tasks").fetchall() == [("old", "[]")]
