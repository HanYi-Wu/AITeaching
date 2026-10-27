"""Task plan tracking and confirmation execution coordination for multi-step agent work."""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from solaire.agent_layer.models import (
    InvocationContext,
    SessionState,
)

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]


def set_plan(session: SessionState, steps: list[dict[str, Any]]) -> None:
    session.task_plan = [{"title": s.get("title", ""), "status": s.get("status", "pending")} for s in steps]
    session.touch()


def update_step(session: SessionState, index: int, status: str) -> None:
    if 0 <= index < len(session.task_plan):
        session.task_plan[index]["status"] = status
        session.touch()


def plan_to_prompt_block(session: SessionState) -> str:
    if not session.task_plan:
        return ""
    lines = ["当前任务步骤："]
    for i, s in enumerate(session.task_plan, start=1):
        lines.append(f"{i}. [{s.get('status', '?')}] {s.get('title', '')}")
    return "\n".join(lines)


def build_task_plan_dynamic_block(session: SessionState) -> str:
    """并入动态系统提示的任务步骤摘要（不写第三条 system）。"""
    if not session.task_plan:
        return ""
    lines = [
        f"{i}. [{s.get('status', '?')}] {s.get('title', '')}" for i, s in enumerate(session.task_plan, start=1)
    ]
    return "## 当前任务进度\n" + "\n".join(lines)


def verify_authoritative_actor_and_policy(
    project_root: Path,
    platform_user: dict[str, Any] | None,
    *,
    is_ai_call: bool = False,
    connection: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Verify live user validity, role, and school AI policy against authoritative SQLite DB.

    Never trusts cached session state or creation-time authorization.
    Re-reads user status/role and invokes authoritative check_school_ai_allowed.
    """
    if platform_user is None:
        return {}

    user_id = str(platform_user.get("id") or "").strip()
    if not user_id:
        return platform_user

    from solaire.web.platform_db import connect, platform_db_path, row_to_dict
    from solaire.web.school.policy import check_school_ai_allowed

    db_file = platform_db_path(project_root)
    if not db_file.is_file():
        if str(platform_user.get("status") or "") in ("disabled", "inactive"):
            raise PermissionError("当前用户账号已被禁用或失效")
        return platform_user

    def _verify_with_conn(con: sqlite3.Connection) -> dict[str, Any]:
        row = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        user_row = row_to_dict(row)
        if user_row is None:
            raise PermissionError("当前用户不存在或已被删除")
        if str(user_row.get("status") or "") != "active":
            raise PermissionError("当前用户账号已被禁用或失效")

        for key in ("role", "status", "school_id"):
            platform_user[key] = user_row.get(key)

        school_id = user_row.get("school_id")
        if is_ai_call and school_id:
            check_school_ai_allowed(project_root, school_id=str(school_id), _connection=con)

        return user_row

    if connection is not None:
        return _verify_with_conn(connection)
    with connect(project_root) as conn:
        return _verify_with_conn(conn)


async def resolve_plan_and_execution_path(
    project_root: Path,
    session: SessionState,
    project_ctx: dict[str, Any],
    emit: EmitFn,
) -> bool:
    """Resolve plan clear/execution paths from project_ctx. Returns True if should abort turn."""
    from solaire.agent_layer.plan_document import (
        load_plan_steps_from_rel_path,
        normalize_rel_path,
        validate_agent_plan_rel_path,
    )
    from solaire.agent_layer.session import save_session

    raw_clear = project_ctx.get("_clear_pending_plan_path")
    if isinstance(raw_clear, str) and raw_clear.strip():
        cnorm = normalize_rel_path(raw_clear.strip())
        pend = session.pending_plan_path
        if pend and normalize_rel_path(pend) == cnorm:
            session.pending_plan_path = None
            session.execution_plan_path = None
            session.touch()

    raw_exec = project_ctx.get("_execution_plan_path")
    if not (isinstance(raw_exec, str) and raw_exec.strip()):
        return False

    ep = normalize_rel_path(raw_exec.strip())
    if not ep:
        await emit("error", {"code": "invalid_plan", "message": "执行计划路径无效。"})
        save_session(project_root, session)
        await emit("done", {"usage": {}})
        return True

    ok_plan, plan_err = validate_agent_plan_rel_path(project_root, ep)
    if not ok_plan:
        await emit("error", {"code": "invalid_plan", "message": plan_err})
        save_session(project_root, session)
        await emit("done", {"usage": {}})
        return True

    pend = session.pending_plan_path
    if pend is None or normalize_rel_path(pend) != ep:
        await emit(
            "error",
            {
                "code": "plan_not_approved",
                "message": "请先在对话中生成计划，并在界面点击「执行」后再运行；若计划已变更请重新生成。",
            },
        )
        save_session(project_root, session)
        await emit("done", {"usage": {}})
        return True

    session.execution_plan_path = ep
    steps = load_plan_steps_from_rel_path(project_root, ep)
    if steps:
        set_plan(session, steps)
        await emit("task_update", {"steps": list(session.task_plan)})
    session.touch()
    return False


def _tool_requires_ai(tool_name: str) -> bool:
    """Check if tool execution requires AI invocation."""
    from solaire.agent_layer.failure_recovery import is_tool_ai_powered
    return is_tool_ai_powered(tool_name)


async def handle_confirmation_resume(
    *,
    project_root: Path,
    session: SessionState,
    ctx: InvocationContext,
    confirm_action_id: str,
    confirm_accepted: bool,
    emit: EmitFn,
) -> str | None:
    """Handle confirmation resume with authoritative policy verification.

    Returns user_message override (or None on early exit).
    """
    from solaire.agent_layer.audit import append_audit
    from solaire.agent_layer.compactor import summarize_tool_result
    from solaire.agent_layer.context import tool_result_to_content
    from solaire.agent_layer.guardrails import register_approval
    from solaire.agent_layer.registry import invoke_registered_tool
    from solaire.agent_layer.session import save_session
    from solaire.agent_layer.tools import analysis_tools

    confirm_accepted = confirm_accepted is True
    pending = session.pending_confirmations.pop(confirm_action_id, None)
    if pending is None:
        await emit("error", {"code": "unknown_action", "message": "无效或已过期的确认项"})
        save_session(project_root, session)
        await emit("done", {"usage": {}})
        return None

    if confirm_accepted is False:
        await emit("text_delta", {"text": "已取消该操作。"})
        session.draft_assistant = None
        session.draft_tool_results = []
        save_session(project_root, session)
        await emit("done", {"usage": {}})
        return None

    # Re-verify live actor validity and school AI policy
    try:
        is_ai = _tool_requires_ai(pending.tool_name)
        verify_authoritative_actor_and_policy(ctx.platform_root or project_root, ctx.platform_user, is_ai_call=is_ai)
    except Exception as err:
        err_msg = str(err)
        err_code = "school_ai_disabled" if ("School AI" in err_msg or "AI API" in err_msg) else "user_inactive"
        await emit("error", {"code": err_code, "message": f"权限复核未通过: {err_msg}"})
        session.draft_assistant = None
        session.draft_tool_results = []
        save_session(project_root, session)
        await emit("done", {"usage": {}})
        return None

    ran_ok = True
    if pending.tool_name == "analysis.save_script" and pending.arguments.get("code"):
        ok, err = analysis_tools.validate_python_syntax(str(pending.arguments["code"]))
        if not ok:
            ran_ok = False
            session.draft_tool_results.append(
                {
                    "tool_call_id": pending.tool_call_id,
                    "name": pending.tool_name,
                    "content": json.dumps(
                        {"tool": pending.tool_name, "error": err},
                        ensure_ascii=False,
                    ),
                }
            )
            append_audit(
                project_root,
                session_id=session.session_id,
                tool_name=pending.tool_name,
                status="failed",
                detail={"confirmed": True, "syntax": err},
            )
            await emit(
                "tool_result",
                {
                    "tool_name": pending.tool_name,
                "tool_call_id": pending.tool_call_id,
                    "status": "failed",
                    "summary": err[:200],
                },
            )

    if ran_ok:
        result_index = len(session.draft_tool_results)
        session.draft_tool_results.append({
            "tool_call_id": pending.tool_call_id, "name": pending.tool_name,
            "content": json.dumps({"error_code": "write_interrupted_requires_verification",
                                   "needs_verification": True,
                                   "error": "操作已开始，若未收到结果请核对数据，不能自动重放。"}, ensure_ascii=False),
        })
        save_session(project_root, session)
        register_approval(session, ctx, pending.tool_name, pending.arguments)
        tr = invoke_registered_tool(pending.tool_name, pending.arguments, ctx)
        payload = (
            tr.data
            if tr.status == "succeeded"
            else {**tr.data, "error": tr.error_message, "error_code": tr.error_code}
        )
        session.draft_tool_results[result_index] = (
            {
                "tool_call_id": pending.tool_call_id,
                "name": pending.tool_name,
                "content": tool_result_to_content(pending.tool_name, payload),
            }
        )
        save_session(project_root, session)
        append_audit(
            project_root,
            session_id=session.session_id,
            tool_name=pending.tool_name,
            status=tr.status,
            detail={"confirmed": True},
        )
        await emit(
            "tool_result",
            {
                "tool_name": pending.tool_name,
                "tool_call_id": pending.tool_call_id,
                "status": tr.status,
                "summary": summarize_tool_result(pending.tool_name, payload),
            },
        )
        if ctx.session and pending.tool_name in (
            "agent.set_task_plan",
            "agent.update_task_step",
        ):
            await emit("task_update", {"steps": list(ctx.session.task_plan)})

    return ""
