"""Bounded, owner-scoped export jobs with durable state and crash detection."""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from solaire.common.actor_context import actor
from solaire.web import auth_service, export_workflow
from solaire.web.export_lock import ExportBusyError, FileLease
from solaire.web.platform_db import default_platform_root
from solaire.web.schemas.exams import ExamExportBody
from solaire.web.security import assert_within_project

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="exam-export")
_PENDING = ("queued", "running")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _owner(user: dict | None) -> str:
    if user is None:
        # Public deployment authentication is enforced by request middleware.
        return "local"
    if user.get("role") not in {"teacher", "admin"} or user.get("status") != "active" or not user.get("id"):
        raise HTTPException(status_code=403, detail="教师或管理员权限不足。")
    return f"{user['role']}:{user['id']}"


class ExportTaskService:
    def __init__(self, root: Path, *, executor=None):
        self.root = root.resolve()
        self.pool = executor if executor is not None else _executor
        self.db_path = self.root / ".solaire" / "export-tasks.sqlite3"
        assert_within_project(self.root, self.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS export_tasks (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, format TEXT NOT NULL,
                request_json TEXT NOT NULL, request_key TEXT,
                status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                attempt INTEGER NOT NULL DEFAULT 1, result_json TEXT, error_json TEXT,
                UNIQUE(owner, request_key)
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS export_tasks_owner ON export_tasks(owner, created_at)")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def _lease(self, task_id: str):
        if not re.fullmatch(r"[a-f0-9]{32}", task_id):
            raise HTTPException(status_code=404, detail="导出任务不存在。")
        path = self.root / ".solaire" / "export-task-locks" / f"{task_id}.lock"
        assert_within_project(self.root, path)
        return FileLease(path)

    def _recover_interrupted(self):
        with self._connect() as db:
            rows = db.execute("SELECT id FROM export_tasks WHERE status IN ('queued','running')").fetchall()
        for row in rows:
            try:
                lease = self._lease(row["id"]).__enter__()
            except ExportBusyError:
                continue
            try:
                error = json.dumps({"status": 503, "detail": "导出进程已中断，可重试此任务。"}, ensure_ascii=False)
                with self._connect() as db:
                    db.execute("UPDATE export_tasks SET status='failed', error_json=?, updated_at=? WHERE id=? AND status IN ('queued','running')", (error, _now(), row["id"]))
            finally:
                lease.close()

    def _row(self, task_id, owner):
        with self._connect() as db:
            row = db.execute("SELECT * FROM export_tasks WHERE id=? AND owner=?", (task_id, owner)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="导出任务不存在。")
        return row

    @staticmethod
    def _public(row):
        return {
            key: row[key] for key in ("id", "format", "status", "created_at", "updated_at", "attempt")
        } | {
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
        }

    @staticmethod
    def _check_capacity(db, owner):
        pending = db.execute("SELECT owner FROM export_tasks WHERE status IN ('queued','running')").fetchall()
        if len(pending) >= 12 or sum(row["owner"] == owner for row in pending) >= 4:
            raise HTTPException(status_code=429, detail="待处理导出任务过多，请等待已有任务完成。")

    def submit(self, body: ExamExportBody, *, format: str, user: dict | None, request_key: str | None = None):
        owner = _owner(user)
        request_key = request_key.strip() or None if request_key else None
        if request_key and len(request_key) > 100:
            raise HTTPException(status_code=400, detail="请求标识过长。")
        if format not in {"pdf", "docx"}:
            raise HTTPException(status_code=400, detail="不支持的导出格式。")
        payload = json.dumps(body.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if len(payload.encode("utf-8")) > 1_048_576:
            raise HTTPException(status_code=413, detail="导出配置过大。")
        self._recover_interrupted()
        task_id = uuid.uuid4().hex
        lease = self._lease(task_id).__enter__()
        try:
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                existing = db.execute("SELECT * FROM export_tasks WHERE owner=? AND request_key=?", (owner, request_key)).fetchone() if request_key else None
                if existing:
                    if existing["request_json"] != payload or existing["format"] != format:
                        raise HTTPException(status_code=409, detail="同一请求标识已用于不同的导出内容。")
                    lease.close()
                    return self._public(existing)
                self._check_capacity(db, owner)
                now = _now()
                db.execute("INSERT INTO export_tasks (id,owner,format,request_json,request_key,status,created_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?)", (task_id, owner, format, payload, request_key, now, now))
        except BaseException:
            lease.close()
            raise
        self._dispatch(task_id, body.model_copy(deep=True), format, user, lease)
        return self._public(self._row(task_id, owner))

    def get(self, task_id, *, user):
        owner = _owner(user)
        self._row(task_id, owner)
        self._recover_interrupted()
        return self._public(self._row(task_id, owner))

    def list(self, *, user, limit=20):
        owner = _owner(user)
        self._recover_interrupted()
        with self._connect() as db:
            rows = db.execute("SELECT * FROM export_tasks WHERE owner=? ORDER BY created_at DESC, id DESC LIMIT ?", (owner, max(1, min(100, limit)))).fetchall()
        return [self._public(row) for row in rows]

    def retry(self, task_id, *, user):
        owner = _owner(user)
        current = self.get(task_id, user=user)
        if current["status"] != "failed":
            return current
        try:
            lease = self._lease(task_id).__enter__()
        except ExportBusyError:
            return self._public(self._row(task_id, owner))
        try:
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT * FROM export_tasks WHERE id=? AND owner=?", (task_id, owner)).fetchone()
                if row["status"] != "failed":
                    lease.close()
                    return self._public(row)
                self._check_capacity(db, owner)
                db.execute("UPDATE export_tasks SET status='queued', result_json=NULL, error_json=NULL, attempt=attempt+1, updated_at=? WHERE id=?", (_now(), task_id))
        except BaseException:
            lease.close()
            raise
        self._dispatch(task_id, ExamExportBody.model_validate_json(row["request_json"]), row["format"], user, lease)
        return self._public(self._row(task_id, owner))

    def _dispatch(self, task_id, body, format, user, lease):
        context = contextvars.copy_context()
        try:
            platform_root = default_platform_root() if user else None
            self.pool.submit(context.run, self._run, task_id, body, format, dict(user) if user else None, platform_root, lease)
        except Exception:
            self._finish(task_id, error={"status": 503, "detail": "导出服务正在停止，请稍后重试。"})
            lease.close()
            raise HTTPException(status_code=503, detail="暂时无法启动导出任务。") from None

    def _finish(self, task_id, *, result=None, error=None):
        with self._connect() as db:
            db.execute("UPDATE export_tasks SET status=?,result_json=?,error_json=?,updated_at=? WHERE id=?", (
                "failed" if error else "succeeded",
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                json.dumps(error, ensure_ascii=False) if error is not None else None,
                _now(), task_id,
            ))

    def _run(self, task_id, body, format, user, platform_root, lease):
        token = None
        try:
            with self._connect() as db:
                db.execute("UPDATE export_tasks SET status='running', updated_at=? WHERE id=?", (_now(), task_id))
            if user:
                try:
                    fresh = auth_service.get_user_profile(platform_root, str(user["id"]))
                except (ValueError, LookupError) as exc:
                    raise HTTPException(status_code=403, detail="任务发起人的账号已不可用。") from exc
                if _owner(fresh) != _owner(user):
                    raise HTTPException(status_code=403, detail="任务发起人的权限已变更。")
                user = dict(fresh)
            token = actor.set(user)
            result = export_workflow.export_exam(self.root, body, format=format)
            self._finish(task_id, result=result)
        except HTTPException as exc:
            self._finish(task_id, error={"status": exc.status_code, "detail": exc.detail})
        except Exception:
            logging.getLogger(__name__).exception("Export task failed: %s", task_id)
            self._finish(task_id, error={"status": 500, "detail": "导出任务失败，请检查日志后重试。"})
        finally:
            if token is not None:
                actor.reset(token)
            lease.close()
