"""Bounded optional background adapter for the existing pregrading service."""
from __future__ import annotations

from contextlib import closing
import logging
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from solaire.agent_layer.llm.router import load_llm_settings
from solaire.web.paper_service import _paper_attempt_row, find_paper_submissions, suggest_ai_grades_for_attempt
from solaire.web.papers.visibility import ensure_paper_access
from solaire.web.platform_db import connect, row_to_dict
from solaire.web.project_scope import project_scope_id
from solaire.web.school.policy import check_school_ai_allowed
from solaire.web.task_tracking import TaskEvent, create_or_update_projection, get_task_projection, normalize_owner
from solaire.web.task_tracking.live_tasks import mark_live, mark_finished

logger = logging.getLogger(__name__)
_pregrade_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai-pregrade")

def verify_security_context(
    con: sqlite3.Connection,
    root: Path,
    *,
    paper_id: str,
    user_id: str,
    require_ai: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Authoritatively verify current user account status, paper access, and school AI policy.

    Reuses the authoritative SQLite connection directly to prevent stale session or login cache bypass.
    Raises PermissionError or ValueError on policy violation.
    """
    # 1. Authoritative user account status verification
    user_row = con.execute(
        "SELECT * FROM users WHERE id = ? AND status = 'active'",
        (user_id,),
    ).fetchone()
    if user_row is None:
        raise PermissionError("用户账户不存在或已被禁用")
    user = row_to_dict(user_row)
    if not user:
        raise PermissionError("无法解析用户账户信息")

    role = str(user.get("role") or "")
    if role not in {"admin", "teacher"}:
        raise PermissionError("只有教师或管理员可以生成 AI 预批改建议")

    # 2. Authoritative paper record and ownership/scope verification
    paper_row = con.execute(
        "SELECT * FROM paper_records WHERE id = ?",
        (paper_id,),
    ).fetchone()
    if paper_row is None:
        raise ValueError(f"试卷不存在: {paper_id}")
    paper = row_to_dict(paper_row)
    if not paper:
        raise ValueError(f"无法解析试卷信息: {paper_id}")

    ensure_paper_access(paper, user)

    # 3. Authoritative school AI policy verification reusing shared SQLite connection
    school_id = str(user.get("school_id") or paper.get("school_id") or "")
    if not require_ai:
        return user, paper
    if school_id:
        check_school_ai_allowed(root, school_id=school_id, _connection=con)
    else:
        from solaire.web.school.policy import check_admin_ai_available

        if not check_admin_ai_available(root):
            raise ValueError("AI API is not configured by admin")

    return user, paper


class AiPregradeTaskService:
    def __init__(self, root: Path, project_root: Path, *, executor=None):
        self.root = root.resolve()
        self.project_root = project_root.resolve()
        self.pool = executor if executor is not None else _pregrade_executor
        self.project_scope = project_scope_id(self.project_root)

    def submit(self, *, paper_id, user, attempt_id=None, max_attempts=5, max_questions_total=50, task_id=None):
        if not user or not user.get("id"):
            raise HTTPException(status_code=401, detail="未认证的用户")
        user_id = str(user["id"])
        with closing(connect(self.root)) as con, con:
            fresh_user, _ = verify_security_context(con, self.root, paper_id=paper_id, user_id=user_id)
        if attempt_id:
            _paper_attempt_row(self.root, paper_id=paper_id, attempt_id=attempt_id, user=fresh_user)
        task_id = task_id or uuid.uuid4().hex
        owner = normalize_owner(fresh_user)
        if get_task_projection(self.project_root, task_id, owner):
            raise ValueError("任务标识已存在，不能重复提交。")
        event = TaskEvent(task_id=task_id, task_type="ai_pregrade", owner=owner,
                          project_scope=self.project_scope, source_id=paper_id,
                          status="queued", stage="排队中", title="AI预批改")
        mark_live(self.project_root, task_id)
        try:
            record = create_or_update_projection(self.project_root, event)
            self.pool.submit(self._execute_worker, event=event, paper_id=paper_id, user_id=user_id,
                             attempt_id=attempt_id, max_attempts=max_attempts,
                             max_questions_total=max_questions_total)
        except Exception:
            mark_finished(self.project_root, task_id)
            raise
        return record.model_dump()

    def get(self, task_id, *, user, paper_id=None):
        from solaire.web.task_tracking.reconciliation import reconcile_task
        record = get_task_projection(self.project_root, task_id, normalize_owner(user))
        if record is None or record.task_type != "ai_pregrade" or (paper_id and record.source_id != paper_id):
            raise HTTPException(status_code=404, detail="AI预批改任务不存在")
        with closing(connect(self.root)) as con, con:
            verify_security_context(con, self.root, paper_id=record.source_id, user_id=str(user["id"]), require_ai=False)
        return reconcile_task(self.project_root, record, user).model_dump()

    def _execute_worker(self, *, event, paper_id, user_id, attempt_id, max_attempts, max_questions_total):
        def verify(con):
            return verify_security_context(con, self.root, paper_id=paper_id, user_id=user_id)

        def update(status, stage, progress=None, result=None, error=None):
            nonlocal event
            event = event.model_copy(update={"status": status, "stage": stage, "progress": progress,
                                             "result_summary": result, "error_summary": error,
                                             "event_version": event.event_version + 1})
            return create_or_update_projection(self.project_root, event)

        try:
            update("running", "核对权限与答卷")
            with closing(connect(self.root)) as con, con:
                user, _ = verify(con)
            if attempt_id:
                attempts = [{"attempt_id": attempt_id}]
            else:
                attempts = find_paper_submissions(self.root, paper_id=paper_id, user=user,
                            status="submitted", grading_status="pending",
                            limit=max(1, min(int(max_attempts), 20)))
            budget = max(1, min(int(max_questions_total), 100))
            processed = 0
            count = 0
            attempted = 0
            for item in attempts:
                if budget <= 0:
                    break
                aid = str(item["attempt_id"])
                with closing(connect(self.root)) as con, con:
                    user, _ = verify(con)
                    ids = [str(r[0]) for r in con.execute(
                        "SELECT question_id FROM student_answers WHERE attempt_id=? AND COALESCE(grading_status,'pending')='pending' ORDER BY question_id LIMIT ?",
                        (aid, min(budget, 50)))]
                if ids:
                    suggestions = suggest_ai_grades_for_attempt(self.root, self.project_root,
                        paper_id=paper_id, attempt_id=aid, user=user, question_ids=ids,
                        _verify_context=verify)
                    count += sum(s["status"] == "needs_review" for s in suggestions)
                    budget -= len(ids)
                    attempted += len(ids)
                processed += 1
                update("running", f"已处理 {processed}/{len(attempts)} 份答卷", processed / len(attempts))
            update("succeeded", "预批改完成", 1.0,
                   {"processed_count": processed, "suggestion_count": count, "attempted_question_count": attempted})
        except Exception as exc:
            logger.exception("AI pregrade task failed")
            update("failed", "预批改失败", error={"detail": str(exc)[:500]})
        finally:
            mark_finished(self.project_root, event.task_id)
