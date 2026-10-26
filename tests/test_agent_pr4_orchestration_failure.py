"""Regression tests for Task D06: Tool failure classification, safe recovery boundaries, and cancel handling."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from solaire.agent_layer.cancel_signal import request_cancel
from solaire.agent_layer.failure_recovery import (
    MAX_READ_RETRIES,
    FailureCategory,
    classify_tool_failure,
    is_idempotent_tool_call,
    wrap_write_failure_payload,
)
from solaire.agent_layer.models import (
    ChatMessage,
    InvocationContext,
    SessionState,
    ToolResult,
    ToolRisk,
)
from solaire.agent_layer.tool_executor import (
    DraftToolContext,
    _execute_single_tool,
    run_draft_tool_loop,
)
from solaire.agent_layer import tool_executor
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.policy import update_school_ai_enabled


def _setup_db_user(
    root: Path,
    *,
    user_id: str = "teacher-d06",
    school_id: str = "school-d06",
    status: str = "active",
    ai_enabled: bool = True,
) -> dict[str, object]:
    init_platform_db(root)
    with connect(root) as con:
        con.execute(
            """
            INSERT OR REPLACE INTO schools (id, name, status, ai_enabled, created_at, updated_at)
            VALUES (?, 'D06 Test School', 'active', ?, datetime('now'), datetime('now'))
            """,
            (school_id, 1 if ai_enabled else 0),
        )
        con.execute(
            """
            INSERT OR REPLACE INTO users (
                id, school_id, role, username, password_hash, display_name, status, created_at, updated_at
            )
            VALUES (?, ?, 'teacher', ?, 'hash123', 'Teacher D06', ?, datetime('now'), datetime('now'))
            """,
            (user_id, school_id, f"user_{user_id}", status),
        )
    return {
        "id": user_id,
        "school_id": school_id,
        "role": "teacher",
        "username": f"user_{user_id}",
        "display_name": "Teacher D06",
        "status": status,
    }


def test_classify_tool_failure_categories() -> None:
    assert classify_tool_failure("file.read", "connection reset by peer") == FailureCategory.READ_TRANSIENT
    assert classify_tool_failure("file.read", "file not found") == FailureCategory.READ_FATAL
    assert classify_tool_failure("file.write", "disk full") == FailureCategory.WRITE_NON_IDEMPOTENT
    assert classify_tool_failure("file.write", "operation cancelled", error_code="cancelled") == FailureCategory.CANCELLED
    assert classify_tool_failure("agent.run_subtask", "School AI is disabled", error_code="school_ai_disabled") == FailureCategory.AUTH_POLICY_VIOLATION


def test_wrap_write_failure_payload() -> None:
    # Non-idempotent write
    payload_non_idempotent = wrap_write_failure_payload(
        "file.write",
        {"path": "test.txt", "content": "data"},
        "network drop during upload",
    )
    assert payload_non_idempotent["needs_verification"] is True
    assert payload_non_idempotent["idempotent"] is False
    assert payload_non_idempotent["error_code"] == "write_interrupted_requires_verification"

    # Idempotent write with token
    payload_idempotent = wrap_write_failure_payload(
        "file.write",
        {"path": "test.txt", "content": "data", "idempotency_token": "token-xyz"},
        "timeout",
    )
    assert payload_idempotent["idempotent"] is True
    assert payload_idempotent.get("needs_verification") is not True


def test_read_retry_has_upper_limit_and_does_not_restart_turn(tmp_path: Path, monkeypatch) -> None:
    async def run():
        session = SessionState(session_id="s-retry")
        ctx = InvocationContext(project_root=tmp_path, session_id="s-retry", session=session)
        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        dtc = DraftToolContext(
            project_root=tmp_path,
            session=session,
            ctx=ctx,
            safety_mode="prestissimo",
            adapter=MagicMock(),
            fast_adapter=MagicMock(),
            emit=emit,
        )

        attempts = 0

        def fake_invoke(name, args, ctx_arg):
            nonlocal attempts
            attempts += 1
            return ToolResult(
                status="failed",
                error_code="read_timeout",
                error_message="temporarily unavailable connection reset",
            )

        monkeypatch.setattr(tool_executor, "invoke_registered_tool", fake_invoke)

        tc = {"id": "c-read", "function": {"name": "file.read", "arguments": '{"path": "a.txt"}'}}
        stopped, result = await _execute_single_tool(dtc=dtc, tc=tc, index=0, skip_guardrails=True)

        assert stopped is False
        assert result is not None
        # Must retry up to MAX_READ_RETRIES (1 initial + 2 retries = 3 attempts)
        assert attempts == MAX_READ_RETRIES + 1
        assert len(session.draft_tool_results) == 1
        assert session.draft_tool_results[0]["name"] == "file.read"

    asyncio.run(run())


def test_explicit_cancellation_at_safe_point_aborts_subsequent_writes(tmp_path: Path, monkeypatch) -> None:
    """明确安全点取消后不继续下一个写工具。"""
    async def run():
        session = SessionState(
            session_id="s-cancel",
            draft_assistant={
                "content": "multi-writes",
                "tool_calls": [
                    {"id": "w1", "function": {"name": "file.write", "arguments": '{"path": "1.txt", "content": "1"}'}},
                    {"id": "w2", "function": {"name": "file.write", "arguments": '{"path": "2.txt", "content": "2"}'}},
                ],
            },
            draft_tool_results=[],
        )
        ctx = InvocationContext(project_root=tmp_path, session_id="s-cancel", session=session)
        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        dtc = DraftToolContext(
            project_root=tmp_path,
            session=session,
            ctx=ctx,
            safety_mode="prestissimo",
            adapter=MagicMock(),
            fast_adapter=MagicMock(),
            emit=emit,
        )

        executed_tools: list[str] = []

        def fake_invoke(name, args, ctx_arg):
            executed_tools.append(name)
            # Cancel after first tool
            request_cancel("s-cancel")
            return ToolResult(status="succeeded", data={"written": True})

        monkeypatch.setattr(tool_executor, "invoke_registered_tool", fake_invoke)

        stopped = await run_draft_tool_loop(dtc=dtc)
        assert stopped is True
        # First tool executed, then cancel detected; second tool must NOT be executed!
        assert len(executed_tools) == 1
        assert any(e[0] == "error" and e[1].get("code") == "cancelled" for e in events)
        assert any(e[0] == "done" and e[1].get("cancelled") is True for e in events)
        assert session.draft_assistant is None

    asyncio.run(run())


def test_session_started_then_user_disabled_blocks_real_tool_handler(tmp_path: Path, monkeypatch) -> None:
    """覆盖会话开始后禁用当前用户：真实 tool handler 不得继续执行。"""
    async def run():
        actor = _setup_db_user(tmp_path, user_id="teacher-disable-test", status="active")
        session = SessionState(session_id="s-disable-test", owner_user_id="teacher-disable-test")
        ctx = InvocationContext(project_root=tmp_path, session_id="s-disable-test", session=session, platform_user=actor)
        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        dtc = DraftToolContext(
            project_root=tmp_path,
            session=session,
            ctx=ctx,
            safety_mode="prestissimo",
            adapter=MagicMock(),
            fast_adapter=MagicMock(),
            emit=emit,
        )

        tool_handler_invoked = False

        def fake_invoke(name, args, ctx_arg):
            nonlocal tool_handler_invoked
            tool_handler_invoked = True
            return ToolResult(status="succeeded", data={"ok": True})

        monkeypatch.setattr(tool_executor, "invoke_registered_tool", fake_invoke)

        # 会话开始后，在执行工具前把该用户置为 disabled
        with connect(tmp_path) as con:
            con.execute("UPDATE users SET status = 'disabled' WHERE id = 'teacher-disable-test'")

        tc = {"id": "c-write", "function": {"name": "file.write", "arguments": '{"path": "f.txt", "content": "c"}'}}
        stopped, result = await _execute_single_tool(dtc=dtc, tc=tc, index=0, skip_guardrails=True)

        assert stopped is True
        assert tool_handler_invoked is False
        assert any(e[0] == "error" and e[1].get("code") == "user_inactive" for e in events)
        assert any(e[0] == "done" for e in events)

    asyncio.run(run())


def test_session_started_then_school_ai_disabled_blocks_real_ai_tool_handler(tmp_path: Path, monkeypatch) -> None:
    """覆盖会话开始后关闭学校AI开关：真实 AI tool handler 不得继续执行。"""
    async def run():
        monkeypatch.setenv("SOLAIRE_LLM_API_KEY", "sk-test-admin-key")
        actor = _setup_db_user(tmp_path, user_id="teacher-ai-test", school_id="school-ai-test", status="active", ai_enabled=True)
        session = SessionState(session_id="s-ai-test", owner_user_id="teacher-ai-test")
        ctx = InvocationContext(project_root=tmp_path, session_id="s-ai-test", session=session, platform_user=actor)
        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        dtc = DraftToolContext(
            project_root=tmp_path,
            session=session,
            ctx=ctx,
            safety_mode="prestissimo",
            adapter=MagicMock(),
            fast_adapter=MagicMock(),
            emit=emit,
        )

        subagent_invoked = False

        async def fake_subagent(*args, **kw):
            nonlocal subagent_invoked
            subagent_invoked = True
            return "summary"

        monkeypatch.setattr(tool_executor, "run_subagent", fake_subagent)

        # 会话开始后关闭学校 AI 开关
        update_school_ai_enabled(tmp_path, school_id="school-ai-test", ai_enabled=False)

        tc = {"id": "c-subtask", "function": {"name": "agent.run_subtask", "arguments": '{"objective": "test"}'}}
        stopped, result = await _execute_single_tool(dtc=dtc, tc=tc, index=0, skip_guardrails=True)

        assert stopped is True
        assert subagent_invoked is False
        assert any(e[0] == "error" and e[1].get("code") == "school_ai_disabled" for e in events)
        assert any(e[0] == "done" for e in events)

    asyncio.run(run())
