"""Asynchronous AI pre-grade execution service and adapter.

Enforces authoritative database checks for:
1. Active user account status.
2. Paper ownership and teacher visibility.
3. Authoritative school AI policy via policy.check_school_ai_allowed reusing shared SQLite connection.
4. Answer revision check against paper_answer_grading_versions to reject late suggestions.
5. Strict non-generation and non-publishing of teacher final score/grades.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from solaire.agent_layer.llm.router import load_llm_settings
from solaire.web.paper_service import (
    _attempt_scan_payloads,
    _clamp_score,
    _contains_grading_prompt_injection,
    _extract_json_object,
    _json_payload,
    _ocr_attempt_scan_images,
    _ocr_images,
    _paper_attempt_row,
    _question_maps_for_attempt,
    _run_async_blocking,
    find_paper_submissions,
)
from solaire.web.papers import ai_grading
from solaire.web.papers.visibility import ensure_paper_access
from solaire.web.platform_db import connect, row_to_dict
from solaire.web.project_scope import project_scope_id
from solaire.web.school.policy import check_school_ai_allowed

logger = logging.getLogger(__name__)

# Bounded, dedicated thread pool for AI pre-grade tasks (max 2 workers)
_pregrade_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai-pregrade")

_tasks_lock = threading.RLock()
_in_memory_tasks: dict[str, dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_owner(user: dict[str, Any] | None | str) -> str:
    if isinstance(user, str):
        cleaned = user.strip()
        return cleaned if cleaned else "local"
    if user is None:
        return "local"
    role = user.get("role")
    user_id = user.get("id")
    if role and user_id:
        return f"{role}:{user_id}"
    return "local"


def verify_security_context(
    con: sqlite3.Connection,
    root: Path,
    *,
    paper_id: str,
    user_id: str,
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
    if school_id:
        check_school_ai_allowed(root, school_id=school_id, _connection=con)
    else:
        from solaire.web.school.policy import check_admin_ai_available

        if not check_admin_ai_available(root):
            raise ValueError("AI API is not configured by admin")

    return user, paper


class AiPregradeTaskService:
    """Service managing bounded, asynchronous AI pregrade jobs with durable/projection state."""

    def __init__(
        self,
        root: Path,
        project_root: Path,
        *,
        executor: ThreadPoolExecutor | None = None,
    ):
        self.root = root.resolve()
        self.project_root = project_root.resolve()
        self.pool = executor if executor is not None else _pregrade_executor
        self.project_scope = project_scope_id(self.project_root)

    def submit(
        self,
        *,
        paper_id: str,
        user: dict[str, Any],
        attempt_id: str | None = None,
        max_attempts: int = 5,
        max_questions_total: int = 50,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        """Submit an asynchronous AI pregrade job."""
        if not user or not user.get("id"):
            raise HTTPException(status_code=401, detail="未认证的用户")

        user_id = str(user["id"])
        # Synchronous pre-flight security check
        con = connect(self.root)
        try:
            user_info, paper_info = verify_security_context(
                con, self.root, paper_id=paper_id, user_id=user_id
            )
        finally:
            con.close()

        task_id = task_id or uuid.uuid4().hex
        owner_str = normalize_owner(user_info)

        task_record = {
            "task_id": task_id,
            "task_type": "ai_pregrade",
            "owner": owner_str,
            "project_scope": self.project_scope,
            "source_id": f"pregrade:{paper_id}:{attempt_id or 'all'}",
            "paper_id": paper_id,
            "attempt_id": attempt_id,
            "status": "queued",
            "progress": 0.0,
            "stage": "queued",
            "event_version": 1,
            "attempt": 1,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "result_summary": None,
            "error_summary": None,
        }

        self._record_projection(task_record)

        self.pool.submit(
            self._execute_worker,
            task_id=task_id,
            paper_id=paper_id,
            user_id=user_id,
            attempt_id=attempt_id,
            max_attempts=max_attempts,
            max_questions_total=max_questions_total,
        )

        return task_record

    def get(self, task_id: str, *, user: dict[str, Any]) -> dict[str, Any]:
        """Retrieve task details, enforcing owner isolation."""
        owner = normalize_owner(user)
        try:
            from solaire.web.task_tracking.contract import get_task_projection

            proj = get_task_projection(
                self.project_root,
                task_id=task_id,
                owner=owner,
                project_scope=self.project_scope,
            )
            if proj is not None:
                return proj.model_dump()
        except ImportError:
            pass

        with _tasks_lock:
            task = _in_memory_tasks.get(task_id)
            if not task:
                raise HTTPException(status_code=404, detail="AI预批改任务不存在")
            if task.get("owner") != owner and user.get("role") != "admin":
                raise HTTPException(status_code=403, detail="无权访问该任务")
            return dict(task)

    def _record_projection(self, record: dict[str, Any]) -> None:
        """Record task state to durable TaskProjection store if present, and in-memory fallback."""
        with _tasks_lock:
            _in_memory_tasks[record["task_id"]] = dict(record)

        try:
            from solaire.web.task_tracking.contract import create_or_update_projection
            from solaire.web.task_tracking.models import TaskEvent

            event = TaskEvent(
                task_id=record["task_id"],
                task_type="ai_pregrade",
                owner=record["owner"],
                project_scope=record["project_scope"],
                source_id=record.get("source_id"),
                attempt=record.get("attempt", 1),
                status=record["status"],
                event_version=record.get("event_version", 1),
                progress=record.get("progress"),
                stage=record.get("stage"),
                title=f"AI预批改: {record.get('paper_id')}",
                result_summary=record.get("result_summary"),
                error_summary=record.get("error_summary"),
                is_retryable=False,
            )
            create_or_update_projection(self.project_root, event)
        except ImportError:
            pass

    def _update_task(
        self,
        task_id: str,
        *,
        status: str,
        progress: float | None = None,
        stage: str | None = None,
        result_summary: dict[str, Any] | None = None,
        error_summary: dict[str, Any] | None = None,
    ) -> None:
        with _tasks_lock:
            task = _in_memory_tasks.get(task_id)
            if not task:
                return
            task["status"] = status
            if progress is not None:
                task["progress"] = progress
            if stage is not None:
                task["stage"] = stage
            if result_summary is not None:
                task["result_summary"] = result_summary
            if error_summary is not None:
                task["error_summary"] = error_summary
            task["event_version"] = task.get("event_version", 1) + 1
            task["updated_at"] = _now_iso()
            self._record_projection(task)

    def _execute_worker(
        self,
        *,
        task_id: str,
        paper_id: str,
        user_id: str,
        attempt_id: str | None,
        max_attempts: int,
        max_questions_total: int,
    ) -> None:
        self._update_task(task_id, status="running", progress=0.05, stage="validating_context")
        clean_limit = max(1, min(int(max_attempts or 5), 20))
        question_budget = max(1, min(int(max_questions_total or 50), 100))

        try:
            con = connect(self.root)
            try:
                user, paper = verify_security_context(
                    con, self.root, paper_id=paper_id, user_id=user_id
                )
            finally:
                con.close()

            if attempt_id:
                full_att = _paper_attempt_row(
                    self.root, paper_id=paper_id, attempt_id=attempt_id, user=user
                )
                if not full_att:
                    raise ValueError(f"答卷不存在: {attempt_id}")
                target_attempts = [full_att]
            else:
                submissions = find_paper_submissions(
                    self.root,
                    paper_id=paper_id,
                    user=user,
                    status="submitted",
                    grading_status="pending",
                    limit=clean_limit,
                )
                target_attempts = [
                    _paper_attempt_row(
                        self.root,
                        paper_id=paper_id,
                        attempt_id=str(item["attempt_id"]),
                        user=user,
                    )
                    for item in submissions
                ]

            if not target_attempts:
                self._update_task(
                    task_id,
                    status="succeeded",
                    progress=1.0,
                    stage="completed",
                    result_summary={
                        "processed_count": 0,
                        "suggestion_count": 0,
                        "attempted_question_count": 0,
                        "items": [],
                    },
                )
                return

            total_attempts = len(target_attempts)
            items_summary: list[dict[str, Any]] = []
            total_suggestion_count = 0
            attempted_question_count = 0

            for idx, attempt in enumerate(target_attempts):
                if attempted_question_count >= question_budget:
                    break

                att_id = str(attempt.get("attempt_id") or attempt.get("id"))
                # Re-verify account & policy before each attempt batch
                con = connect(self.root)
                try:
                    user, paper = verify_security_context(
                        con, self.root, paper_id=paper_id, user_id=user_id
                    )
                    pending_rows = con.execute(
                        """
                        SELECT id, question_id, answer_payload, grading_status
                        FROM student_answers
                        WHERE attempt_id = ? AND COALESCE(grading_status, 'pending') = 'pending'
                        """,
                        (att_id,),
                    ).fetchall()
                    ver_rows = con.execute(
                        "SELECT question_id, revision FROM paper_answer_grading_versions WHERE attempt_id = ?",
                        (att_id,),
                    ).fetchall()
                    initial_revisions = {
                        str(r["question_id"]): int(r["revision"]) for r in ver_rows
                    }
                finally:
                    con.close()

                if not pending_rows:
                    continue

                questions, by_id, score_by_id = _question_maps_for_attempt(
                    self.root,
                    self.project_root,
                    paper,
                    attempt,
                )

                candidate_qids = [
                    str(r["question_id"])
                    for r in pending_rows
                    if str(r["question_id"]) in by_id
                ]
                remaining = question_budget - attempted_question_count
                selected_qids = candidate_qids[:remaining]
                if not selected_qids:
                    continue
                attempted_question_count += len(selected_qids)

                by_question = {
                    str(r["question_id"]): row_to_dict(r) or {} for r in pending_rows
                }

                shared_scan_images = _attempt_scan_payloads(
                    self.root, att_id, include_content=False
                )
                shared_ocr_text, shared_ocr_errors = _ocr_attempt_scan_images(
                    self.root, att_id
                )
                has_api_key = bool(load_llm_settings(self.project_root).api_key)

                attempt_suggestions = 0

                for qid in selected_qids:
                    # Re-verify before each AI model call
                    con = connect(self.root)
                    try:
                        verify_security_context(
                            con, self.root, paper_id=paper_id, user_id=user_id
                        )
                        ans_info = by_question.get(qid)
                        if not ans_info:
                            continue
                        check_curr = con.execute(
                            "SELECT grading_status FROM student_answers WHERE id = ?",
                            (ans_info["id"],),
                        ).fetchone()
                    finally:
                        con.close()

                    if not check_curr or str(check_curr["grading_status"] or "pending") != "pending":
                        continue

                    payload = _json_payload(ans_info.get("answer_payload"))
                    answer_images = (
                        payload.get("images")
                        if isinstance(payload.get("images"), list)
                        else []
                    )
                    has_images = bool(answer_images or shared_scan_images)
                    if answer_images:
                        ocr_text, ocr_errors = _ocr_images(answer_images)
                    else:
                        ocr_text, ocr_errors = shared_ocr_text, shared_ocr_errors
                    ocr_text = (ocr_text or "")[:12000]
                    answer_text = str(payload.get("answer") or "").strip()
                    max_score = float(score_by_id.get(qid, 0.0))

                    suggestion = None
                    ai_error: str | None = None
                    if _contains_grading_prompt_injection(f"{answer_text}\n{ocr_text}"):
                        ai_error = (
                            "检测到疑似操纵评分的答题指令，已禁止 AI 自动给分，请教师人工核对实际作答"
                        )
                    elif not answer_text and not ocr_text:
                        ai_error = "未识别到可用于 AI 判分的答案文本"
                    elif not has_api_key:
                        ai_error = "未配置 AI 模型"
                    else:
                        try:
                            suggestion = _run_async_blocking(
                                ai_grading.ai_grade_answer(
                                    self.project_root,
                                    question=by_id[qid],
                                    answer_text=answer_text,
                                    ocr_text=ocr_text,
                                    max_score=max_score,
                                    extract_json_object_fn=_extract_json_object,
                                    clamp_score_fn=_clamp_score,
                                )
                            )
                            if suggestion is None:
                                ai_error = "模型未返回有效的结构化建议"
                        except Exception as exc:
                            ai_error = str(exc)
                        print(f"DEBUG: model returned for {qid}: {suggestion}", flush=True)

                    if suggestion is None:
                        feedback_parts = []
                        if has_images:
                            feedback_parts.append("图片答案需要教师复核。")
                            if ocr_text:
                                feedback_parts.append("已提取 OCR 文本，可作为参考。")
                            elif ocr_errors:
                                feedback_parts.append("OCR 未能清晰识别，请人工查看图片。")
                        else:
                            feedback_parts.append("主观题答案需要教师复核。")
                        if ai_error:
                            feedback_parts.append(f"AI 建议暂未生成：{ai_error}")
                        feedback = "".join(feedback_parts)
                        suggested_score = None
                        status_val = "pending"
                    else:
                        feedback = str(
                            suggestion.get("feedback")
                            or "AI 已生成建议，请教师复核。"
                        )
                        suggested_score = suggestion.get("suggested_score")
                        status_val = "needs_review"

                    # WRITE-BACK TRANSACTION
                    # Re-verify account and policy, and check answer/grading version before commit
                    con = connect(self.root)
                    try:
                        with con:
                            verify_security_context(
                                con, self.root, paper_id=paper_id, user_id=user_id
                            )

                            current_ans = con.execute(
                                "SELECT grading_status FROM student_answers WHERE id = ?",
                                (ans_info["id"],),
                            ).fetchone()
                            if (
                                not current_ans
                                or str(current_ans["grading_status"] or "pending") != "pending"
                            ):
                                # Late suggestion rejected: Teacher manual grading already confirmed
                                continue

                            ver_now = con.execute(
                                "SELECT revision FROM paper_answer_grading_versions WHERE attempt_id = ? AND question_id = ?",
                                (att_id, qid),
                            ).fetchone()
                            curr_revision = int(ver_now["revision"]) if ver_now else 0
                            if curr_revision != initial_revisions.get(qid, 0):
                                # Late suggestion rejected: Manual revision updated while AI was running
                                continue

                            # Update suggestion ONLY — NEVER write teacher score, graded_by, or graded_at!
                            upd = con.execute(
                                """
                                UPDATE student_answers
                                SET grading_status = ?,
                                    ai_suggested_score = ?,
                                    ai_feedback = ?,
                                    ai_ocr_text = ?,
                                    responded_at = responded_at
                                WHERE id = ?
                                  AND COALESCE(grading_status, 'pending') = 'pending'
                                """,
                                (
                                    status_val,
                                    suggested_score,
                                    feedback,
                                    ocr_text or "\n".join(ocr_errors),
                                    ans_info["id"],
                                ),
                            )
                            if upd.rowcount == 1 and status_val == "needs_review":
                                attempt_suggestions += 1
                                total_suggestion_count += 1
                    finally:
                        con.close()

                items_summary.append(
                    {
                        "attempt_id": att_id,
                        "student_no": attempt.get("student_no"),
                        "student_name": attempt.get("student_name"),
                        "status": "succeeded",
                        "suggestion_count": attempt_suggestions,
                        "attempted_question_count": len(selected_qids),
                    }
                )

                progress = round(
                    0.05 + 0.90 * ((idx + 1) / total_attempts), 2
                )
                self._update_task(
                    task_id,
                    status="running",
                    progress=progress,
                    stage=f"processed_{idx + 1}_of_{total_attempts}",
                )

            self._update_task(
                task_id,
                status="succeeded",
                progress=1.0,
                stage="completed",
                result_summary={
                    "items": items_summary,
                    "processed_count": len(items_summary),
                    "suggestion_count": total_suggestion_count,
                    "attempted_question_count": attempted_question_count,
                },
            )
        except Exception as exc:
            logger.exception("AI pregrade task failed: %s", exc)
            self._update_task(
                task_id,
                status="failed",
                stage="failed",
                error_summary={"detail": str(exc)},
            )
