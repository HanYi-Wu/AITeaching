"""Durable SQLite-backed store for owner-isolated task status projections."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from solaire.web.security import assert_within_project
from .models import (
    ACTIVE_STATUSES,
    TERMINAL_STATUSES,
    TaskEvent,
    TaskProjectionRecord,
    utc_now_iso,
)

MAX_ACTIVE_PER_OWNER = 20
MAX_TERMINAL_RECORDS_PER_OWNER = 100


class TaskProjectionStore:
    """Manages persistent task projection rows inside project `.solaire` folder."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.db_path = self.root / ".solaire" / "task-projections.sqlite3"
        assert_within_project(self.root, self.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""
                CREATE TABLE IF NOT EXISTS task_projections (
                    task_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    project_scope TEXT NOT NULL,
                    task_type TEXT NOT NULL,
                    source_id TEXT,
                    attempt INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL,
                    event_version INTEGER NOT NULL DEFAULT 1,
                    progress REAL,
                    stage TEXT,
                    title TEXT,
                    result_summary_json TEXT,
                    error_json TEXT,
                    is_retryable INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            db.execute("""
                CREATE INDEX IF NOT EXISTS idx_task_proj_owner_scope
                ON task_projections(owner, project_scope, created_at DESC)
            """)
            db.execute("""
                CREATE INDEX IF NOT EXISTS idx_task_proj_source
                ON task_projections(task_type, source_id)
            """)

    @staticmethod
    def _to_record(row: sqlite3.Row) -> TaskProjectionRecord:
        res_summary = None
        if row["result_summary_json"]:
            try:
                res_summary = json.loads(row["result_summary_json"])
            except Exception:
                res_summary = None

        err_summary = None
        if row["error_json"]:
            try:
                err_summary = json.loads(row["error_json"])
            except Exception:
                err_summary = None

        return TaskProjectionRecord(
            task_id=row["task_id"],
            owner=row["owner"],
            project_scope=row["project_scope"],
            task_type=row["task_type"],
            source_id=row["source_id"],
            attempt=row["attempt"],
            status=row["status"],
            event_version=row["event_version"],
            progress=row["progress"],
            stage=row["stage"],
            title=row["title"],
            result_summary=res_summary,
            error_summary=err_summary,
            is_retryable=bool(row["is_retryable"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def _prune_terminal_records(self, db: sqlite3.Connection, owner: str, project_scope: str) -> None:
        """Keep at most MAX_TERMINAL_RECORDS_PER_OWNER terminal records."""
        placeholders = ",".join(f"'{s}'" for s in TERMINAL_STATUSES)
        db.execute(
            f"""
            DELETE FROM task_projections
            WHERE task_id IN (
                SELECT task_id FROM task_projections
                WHERE owner = ? AND project_scope = ? AND status IN ({placeholders})
                ORDER BY created_at DESC, task_id DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (owner, project_scope, MAX_TERMINAL_RECORDS_PER_OWNER),
        )

    def record_event(self, event: TaskEvent) -> TaskProjectionRecord:
        """Persist or update a task projection based on an event.

        Enforces version sequencing, attempt monotonicity, finite progress,
        owner/project isolation, and capacity bounds.
        """
        now = utc_now_iso()
        res_json = (
            json.dumps(event.result_summary, ensure_ascii=False)
            if event.result_summary is not None
            else None
        )
        err_json = (
            json.dumps(event.error_summary, ensure_ascii=False)
            if event.error_summary is not None
            else None
        )
        if any(value is not None and len(value.encode("utf-8")) > 16384 for value in (res_json, err_json)):
            raise ValueError("Task summaries must not exceed 16 KiB each.")

        # A task without a source_id cannot claim reliable source retry
        effective_retryable = bool(event.is_retryable and event.source_id)

        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM task_projections WHERE task_id = ?", (event.task_id,)
            ).fetchone()

            if existing is not None:
                # Disallow cross-owner or cross-project hijacking
                if existing["owner"] != event.owner or existing["project_scope"] != event.project_scope:
                    raise PermissionError("Task projection owner or project scope mismatch.")
                if existing["task_type"] != event.task_type or (
                    event.source_id is not None and existing["source_id"] not in (None, event.source_id)
                ):
                    raise ValueError("Task projection source identity cannot change.")

                existing_attempt = int(existing["attempt"])
                existing_ver = int(existing["event_version"])
                existing_status = str(existing["status"])

                if event.attempt < existing_attempt:
                    # Stale attempt replay -> ignore update
                    return self._to_record(existing)

                if event.attempt == existing_attempt:
                    # Same attempt: version check
                    if event.event_version <= existing_ver:
                        # Out of order or replayed event version -> ignore
                        return self._to_record(existing)

                    # Terminal state cannot regress to active in same attempt
                    if existing_status in TERMINAL_STATUSES:
                        return self._to_record(existing)

                if existing_status not in ACTIVE_STATUSES and event.status in ACTIVE_STATUSES:
                    self._check_active_capacity(db, event.owner, event.project_scope)
                if event.attempt > existing_attempt:
                    db.execute(
                        "UPDATE task_projections SET result_summary_json=NULL, error_json=NULL, stage=NULL WHERE task_id=?",
                        (event.task_id,),
                    )

                # Safe to update
                db.execute(
                    """
                    UPDATE task_projections SET
                        task_type = ?,
                        source_id = COALESCE(?, source_id),
                        attempt = ?,
                        status = ?,
                        event_version = ?,
                        progress = ?,
                        stage = COALESCE(?, stage),
                        title = COALESCE(?, title),
                        result_summary_json = COALESCE(?, result_summary_json),
                        error_json = COALESCE(?, error_json),
                        is_retryable = ?,
                        updated_at = ?
                    WHERE task_id = ?
                    """,
                    (
                        event.task_type,
                        event.source_id,
                        event.attempt,
                        event.status,
                        event.event_version,
                        event.progress,
                        event.stage,
                        event.title,
                        res_json,
                        err_json,
                        1 if effective_retryable else 0,
                        now,
                        event.task_id,
                    ),
                )
            else:
                # Capacity check for active queued/running tasks
                if event.status in ACTIVE_STATUSES:
                    self._check_active_capacity(db, event.owner, event.project_scope)

                db.execute(
                    """
                    INSERT INTO task_projections (
                        task_id, owner, project_scope, task_type, source_id,
                        attempt, status, event_version, progress, stage, title,
                        result_summary_json, error_json, is_retryable,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event.task_id,
                        event.owner,
                        event.project_scope,
                        event.task_type,
                        event.source_id,
                        event.attempt,
                        event.status,
                        event.event_version,
                        event.progress,
                        event.stage,
                        event.title,
                        res_json,
                        err_json,
                        1 if effective_retryable else 0,
                        now,
                        now,
                    ),
                )

            if event.status in TERMINAL_STATUSES:
                self._prune_terminal_records(db, event.owner, event.project_scope)

            row = db.execute(
                "SELECT * FROM task_projections WHERE task_id = ?", (event.task_id,)
            ).fetchone()
            return self._to_record(row)

    @staticmethod
    def _check_active_capacity(db, owner, project_scope):
        count = db.execute(
            "SELECT COUNT(*) FROM task_projections WHERE owner=? AND project_scope=? AND status IN ('queued','running')",
            (owner, project_scope),
        ).fetchone()[0]
        if count >= MAX_ACTIVE_PER_OWNER:
            raise RuntimeError(f"待处理任务已达上限 ({MAX_ACTIVE_PER_OWNER})，请等待已有任务结束。")

    def get_projection(
        self,
        task_id: str,
        owner: str,
        project_scope: str | None = None,
    ) -> TaskProjectionRecord | None:
        """Find a task projection by task_id (or source_id fallback) under owner/project scope."""
        with self._connect() as db:
            query = "SELECT * FROM task_projections WHERE task_id = ? AND owner = ?"
            params: list[Any] = [task_id, owner]
            if project_scope is not None:
                query += " AND project_scope = ?"
                params.append(project_scope)

            row = db.execute(query, params).fetchone()
            if row is not None:
                return self._to_record(row)

            # Fallback by source_id
            query_src = "SELECT * FROM task_projections WHERE source_id = ? AND owner = ?"
            params_src: list[Any] = [task_id, owner]
            if project_scope is not None:
                query_src += " AND project_scope = ?"
                params_src.append(project_scope)

            row_src = db.execute(query_src, params_src).fetchone()
            if row_src is not None:
                return self._to_record(row_src)

            return None

    def list_projections(
        self,
        owner: str,
        project_scope: str,
        *,
        task_type: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[TaskProjectionRecord]:
        """List task projections for an owner and project scope with optional filters."""
        bounded_limit = max(1, min(100, limit))
        clauses = ["owner = ?", "project_scope = ?"]
        params: list[Any] = [owner, project_scope]

        if task_type:
            clauses.append("task_type = ?")
            params.append(task_type)

        if status:
            clauses.append("status = ?")
            params.append(status)

        query = f"""
            SELECT * FROM task_projections
            WHERE {' AND '.join(clauses)}
            ORDER BY created_at DESC, task_id DESC
            LIMIT ?
        """
        params.append(bounded_limit)

        with self._connect() as db:
            rows = db.execute(query, params).fetchall()
            return [self._to_record(r) for r in rows]

    def find_by_source(
        self,
        task_type: str,
        source_id: str,
        owner: str,
        project_scope: str,
    ) -> TaskProjectionRecord | None:
        with self._connect() as db:
            row = db.execute(
                """
                SELECT * FROM task_projections
                WHERE task_type = ? AND source_id = ? AND owner = ? AND project_scope = ?
                """,
                (task_type, source_id, owner, project_scope),
            ).fetchone()
            if row is not None:
                return self._to_record(row)
            return None
