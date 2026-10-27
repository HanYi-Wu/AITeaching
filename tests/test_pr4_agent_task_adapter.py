"""Tests for Agent task projection adapter (PR4 D14).

Verifies mapping of session/turn/tool/plan lifecycles to durable TaskProjection,
monotonic versioning, owner isolation, cancellation handling, and zero prompt/token logging.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from solaire.agent_layer.stream_dispatcher import StreamDispatcher
from solaire.agent_layer.task_projection_adapter import (
    AgentTaskProjectionAdapter,
    attach_agent_task_projection,
    derive_agent_task_id,
)
from solaire.web.task_tracking.contract import (
    get_project_scope_id,
    get_task_projection,
    list_task_projections,
)


def test_derive_agent_task_id() -> None:
    assert derive_agent_task_id("sess-123") == "agent:sess-123"
    assert derive_agent_task_id("sess-123", turn_id=1) == "agent:sess-123:turn_1"
    assert derive_agent_task_id("sess-123", turn_id="t2") == "agent:sess-123:turn_t2"


def test_agent_task_projection_lifecycle(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    owner = "teacher:teacher_001"
    session_id = "test-session-42"
    turn_id = 1

    adapter = AgentTaskProjectionAdapter(
        project_root=project_root,
        owner=owner,
        session_id=session_id,
        turn_id=turn_id,
        title="测试Agent问答任务",
    )

    # 1. Start turn
    rec = adapter.on_turn_start(attempt=1)
    assert rec.status == "running"
    assert rec.progress is None
    assert rec.stage == "turn_started"
    assert rec.task_id == f"agent:{session_id}:turn_{turn_id}"
    assert rec.event_version == 1

    # 2. Thinking
    rec = adapter.on_event("thinking", {"thought": "analyzing user question..."})
    assert rec.status == "running"
    assert rec.progress is None
    assert rec.stage == "reasoning"
    assert rec.event_version == 2

    # 3. Tool execution
    rec = adapter.on_event("tool_start", {"tool": "search_exam_questions"})
    assert rec.status == "running"
    assert rec.stage == "tool_start:search_exam_questions"
    assert rec.event_version == 3

    rec = adapter.on_event("tool_result", {"tool": "search_exam_questions", "success": True})
    assert rec.status == "running"
    assert rec.stage == "tool_done:search_exam_questions"
    assert rec.event_version == 4

    # 4. Plan update with steps
    steps = [
        {"id": "step_1", "title": "检索试题", "status": "completed"},
        {"id": "step_2", "title": "生成变式题", "status": "running"},
        {"id": "step_3", "title": "组装试卷", "status": "pending"},
    ]
    rec = adapter.on_event("task_update", {"steps": steps})
    assert rec.status == "running"
    assert rec.progress == pytest.approx(1 / 3, abs=0.001)
    assert "生成变式题" in rec.stage
    assert rec.result_summary["completed_steps"] == 1
    assert rec.result_summary["total_steps"] == 3
    assert rec.event_version == 5

    # 5. Confirm needed
    rec = adapter.on_event("confirm_needed", {"tool": "save_paper", "risk_level": "medium"})
    assert rec.status == "running"
    assert rec.stage == "awaiting_confirmation:save_paper"
    assert rec.result_summary.get("awaiting_confirmation") is True

    # 6. Done event
    rec = adapter.on_event("done", {})
    assert rec.status == "succeeded"
    assert rec.progress == 1.0
    assert rec.stage == "completed"

    # Verify durable store reflects final projection
    stored = get_task_projection(project_root, adapter.task_id, owner=owner)
    assert stored is not None
    assert stored.status == "succeeded"
    assert stored.progress == 1.0
    assert stored.task_type == "agent"
    assert stored.source_id == f"session:{session_id}"


def test_agent_task_projection_error_and_cancellation(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    owner = "teacher:teacher_001"

    # Error scenario
    adapter_err = AgentTaskProjectionAdapter(
        project_root=project_root,
        owner=owner,
        session_id="err-sess",
        turn_id=1,
    )
    adapter_err.on_turn_start()
    rec_err = adapter_err.on_event("error", {"error": "LLM API connection timed out", "code": 504})
    assert rec_err.status == "failed"
    assert rec_err.stage == "error"
    assert rec_err.error_summary["code"] == 504
    assert "timed out" in rec_err.error_summary["detail"]

    # Cancellation / client disconnect scenario
    adapter_cancel = AgentTaskProjectionAdapter(
        project_root=project_root,
        owner=owner,
        session_id="cancel-sess",
        turn_id=1,
    )
    adapter_cancel.on_turn_start()
    rec_cancel = adapter_cancel.on_disconnect_or_cancel()
    assert rec_cancel.status == "cancelled"
    assert rec_cancel.stage == "cancelled_client_disconnect"
    assert "主动取消" in rec_cancel.error_summary["detail"]


def test_attach_agent_task_projection_with_stream_dispatcher(tmp_path: Path) -> None:
    async def run() -> None:
        project_root = tmp_path / "project"
        project_root.mkdir()
        owner = {"role": "teacher", "id": "t99"}
        session_id = "stream-sess-1"

        dispatcher = StreamDispatcher(heartbeat_seconds=1.0)
        adapter = attach_agent_task_projection(
            dispatcher=dispatcher,
            project_root=project_root,
            owner=owner,
            session_id=session_id,
            turn_id=1,
            title="流式Agent问答任务",
        )

        # Dispatcher emits events
        await dispatcher.emit("session", {"session_id": session_id})
        assert adapter.current_status == "running"

        await dispatcher.emit("thinking", {"detail": "thinking..."})
        assert adapter.current_status == "running"

        await dispatcher.emit("done", {})
        assert adapter.current_status == "succeeded"

        # Query projection
        stored = get_task_projection(project_root, adapter.task_id, owner="teacher:t99")
        assert stored is not None
        assert stored.status == "succeeded"
        assert stored.progress == 1.0

    asyncio.run(run())


def test_stream_dispatcher_disconnect_cancels_projection(tmp_path: Path) -> None:
    async def run() -> None:
        project_root = tmp_path / "project"
        project_root.mkdir()
        owner = "teacher:t99"
        session_id = "stream-sess-dc"

        dispatcher = StreamDispatcher(heartbeat_seconds=1.0)
        adapter = attach_agent_task_projection(
            dispatcher=dispatcher,
            project_root=project_root,
            owner=owner,
            session_id=session_id,
            turn_id=1,
        )

        await dispatcher.emit("session", {"session_id": session_id})
        assert adapter.current_status == "running"

        # Client disconnect triggers notify_disconnect
        dispatcher.notify_disconnect()
        assert adapter.current_status == "cancelled"

        stored = get_task_projection(project_root, adapter.task_id, owner=owner)
        assert stored is not None
        assert stored.status == "cancelled"

    asyncio.run(run())


def test_no_prompt_or_token_leakage(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    owner = "teacher:teacher_sec"
    session_id = "security-sess"

    adapter = AgentTaskProjectionAdapter(
        project_root=project_root,
        owner=owner,
        session_id=session_id,
        turn_id=1,
    )
    adapter.on_turn_start()

    # Pass sensitive prompt/tokens in event data
    sensitive_data = {
        "prompt": "SELECT * FROM confidential_exam_questions;",
        "completion": "Confidential question text with answers",
        "prompt_tokens": 1250,
        "completion_tokens": 300,
        "total_tokens": 1550,
        "tool": "safe_tool",
    }
    adapter.on_event("tool_start", sensitive_data)
    adapter.on_event("tool_result", sensitive_data)
    adapter.on_event("done", {})

    stored = get_task_projection(project_root, adapter.task_id, owner=owner)
    assert stored is not None

    record_json = stored.model_dump_json()
    assert "confidential_exam_questions" not in record_json
    assert "prompt_tokens" not in record_json
    assert "total_tokens" not in record_json
    assert "Confidential question text" not in record_json
