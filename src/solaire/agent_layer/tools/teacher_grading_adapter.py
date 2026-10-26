"""Teacher submissions, manual grading, and completion adapter."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.teacher_tool_helpers import _actor, _ok, _required, _run
from solaire.web.platform_db import default_platform_root
from solaire.web.paper_service import (
    complete_paper_attempt_grading,
    find_paper_submissions,
    grade_paper_answer,
    list_paper_submissions,
    suggest_ai_grades_for_pending_attempts,
)

def tool_paper_submissions(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: list_paper_submissions(
            default_platform_root(), ctx.project_root, paper_id=_required(args, "paper_id"), user=_actor(ctx)
        )
    )

def tool_paper_find_submissions(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: find_paper_submissions(
            default_platform_root(),
            paper_id=_required(args, "paper_id"),
            user=_actor(ctx),
            student_query=str(args.get("student_query") or "") or None,
            status=str(args.get("status") or "") or None,
            grading_status=str(args.get("grading_status") or "") or None,
            limit=int(args.get("limit") or 20),
        )
    )

def tool_paper_ai_grade_pending(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: suggest_ai_grades_for_pending_attempts(
            default_platform_root(),
            ctx.project_root,
            paper_id=_required(args, "paper_id"),
            user=_actor(ctx),
            max_attempts=int(args.get("max_attempts") or 5),
            max_questions_total=int(args.get("max_questions_total") or 50),
        )
    )

def tool_paper_manual_grade(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: grade_paper_answer(
            default_platform_root(),
            ctx.project_root,
            paper_id=_required(args, "paper_id"),
            attempt_id=_required(args, "attempt_id"),
            question_id=_required(args, "question_id"),
            user=_actor(ctx),
            score=float(args.get("score")),
            feedback=str(args.get("feedback") or "") or None,
            is_correct=args.get("is_correct") if isinstance(args.get("is_correct"), bool) else None,
        )
    )

def tool_paper_complete_grading(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: complete_paper_attempt_grading(
            default_platform_root(),
            ctx.project_root,
            paper_id=_required(args, "paper_id"),
            attempt_id=_required(args, "attempt_id"),
            user=_actor(ctx),
        )
    )
