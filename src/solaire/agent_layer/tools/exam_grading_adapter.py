"""AI submission grading adapter."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.exam_publish_adapter import _platform_actor
from solaire.web.paper_service import resolve_paper_attempt, suggest_ai_grades_for_attempt
from solaire.web.platform_db import connect, default_platform_root

def tool_ai_grade_submission(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    actor = _platform_actor(ctx)
    if actor is None:
        return ToolResult(
            status="failed",
            error_code="platform_user_required",
            error_message="需要先创建管理员或教师账号，才能通过 AI 批改提交。",
        )
    paper_id = str(args.get("paper_id") or "").strip()
    attempt_id = str(args.get("attempt_id") or "").strip()
    student_query = str(args.get("student_query") or "").strip()
    if not paper_id or (not attempt_id and not student_query):
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="paper_id 和 attempt_id 不能为空。",
        )
    raw_qids = args.get("question_ids")
    question_ids = [str(item).strip() for item in raw_qids if str(item).strip()][:50] if isinstance(raw_qids, list) else None
    try:
        attempt = resolve_paper_attempt(
            default_platform_root(),
            paper_id=paper_id,
            user=actor,
            attempt_id=attempt_id or None,
            student_query=student_query or None,
            require_submitted=True,
        )
        if question_ids is None:
            with connect(default_platform_root()) as con:
                rows = con.execute(
                    """
                    SELECT question_id
                    FROM student_answers
                    WHERE attempt_id = ? AND COALESCE(grading_status, 'pending') = 'pending'
                    ORDER BY responded_at, question_id
                    """,
                    (str(attempt["id"]),),
                ).fetchall()
            question_ids = [str(row["question_id"]) for row in rows][:50]
            if not question_ids:
                return ToolResult(
                    status="succeeded",
                    data={
                        "attempt_id": attempt.get("id"),
                        "student_no": attempt.get("student_no"),
                        "student_name": attempt.get("student_name"),
                        "suggestions": [],
                    },
                    summary_for_llm="该答卷没有待预批改题目，未覆盖教师已审核结果。",
                )
        suggestions = suggest_ai_grades_for_attempt(
            default_platform_root(),
            ctx.project_root,
            paper_id=paper_id,
            attempt_id=str(attempt["id"]),
            user=actor,
            question_ids=question_ids,
        )
    except (ValueError, PermissionError, FileNotFoundError) as e:
        return ToolResult(status="failed", error_code="ai_grade_failed", error_message=str(e))
    return ToolResult(
        status="succeeded",
        data={
            "attempt_id": attempt.get("id"),
            "student_no": attempt.get("student_no"),
            "student_name": attempt.get("student_name"),
            "suggestions": suggestions,
        },
        summary_for_llm=f"已生成 {len(suggestions)} 条 AI 批改建议，等待教师审核。",
    )
