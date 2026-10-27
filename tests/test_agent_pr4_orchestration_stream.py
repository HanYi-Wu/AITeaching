"""Regression tests for Task D04: Agent SSE stream event dispatching, keepalive, and terminal state."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from solaire.agent_layer.models import SessionState
from solaire.agent_layer.stream_dispatcher import (
    StreamDispatcher,
    dispatch_agent_turn_sse,
    format_sse_comment,
    format_sse_event,
)
from solaire.agent_layer import orchestrator


def test_format_sse_event_and_comment() -> None:
    ev = format_sse_event("thinking", {"message": "正在分析…"})
    assert ev == 'event: thinking\ndata: {"message": "正在分析…"}\n\n'

    comment = format_sse_comment("keepalive")
    assert comment == ": keepalive\n\n"

    ev_str = format_sse_event("session", '{"session_id": "s1"}')
    assert ev_str == 'event: session\ndata: {"session_id": "s1"}\n\n'


def test_stream_dispatcher_preserves_order_and_enforces_terminal_state() -> None:
    async def run():
        dispatcher = StreamDispatcher(heartbeat_seconds=1.0)
        await dispatcher.emit("thinking", {"message": "t1"})
        await dispatcher.emit("text_delta", {"text": "hello "})
        await dispatcher.emit("text_delta", {"text": "world"})
        await dispatcher.emit("done", {"usage": {"total_tokens": 15}})

        # Any emit after done must be dropped
        await dispatcher.emit("text_delta", {"text": "after done should be dropped"})
        await dispatcher.emit("done", {"usage": {}})
        await dispatcher.close()

        chunks = [chunk async for chunk in dispatcher.dispatch_stream()]
        assert len(chunks) == 4
        assert chunks[0] == 'event: thinking\ndata: {"message": "t1"}\n\n'
        assert chunks[1] == 'event: text_delta\ndata: {"text": "hello "}\n\n'
        assert chunks[2] == 'event: text_delta\ndata: {"text": "world"}\n\n'
        assert chunks[3] == 'event: done\ndata: {"usage": {"total_tokens": 15}}\n\n'
        assert dispatcher.terminal_reached is True

    asyncio.run(run())


def test_stream_disconnect_cleans_pending_draft(tmp_path: Path) -> None:
    async def run():
        session = SessionState(
            session_id="s-disconnect",
            draft_assistant={"content": "pending write", "tool_calls": [{"id": "c1", "function": {"name": "file.write"}}]},
            draft_tool_results=[],
        )
        unobserved_write_executed = False

        async def dummy_turn(root, sess, emit, **kw):
            nonlocal unobserved_write_executed
            await emit("tool_start", {"tool_name": "file.write"})
            try:
                await asyncio.sleep(10.0)
                unobserved_write_executed = True
            except asyncio.CancelledError:
                raise

        stream = dispatch_agent_turn_sse(
            tmp_path,
            session,
            run_turn_fn=dummy_turn,
            heartbeat_seconds=0.05,
        )

        first_item = await anext(stream)
        assert "tool_start" in first_item

        # Disconnect client
        await stream.aclose()

        # The background turn must be cancelled and not execute further writes
        assert unobserved_write_executed is False
        # Draft should be cleared on disconnect to prevent stale write replay
        assert session.draft_assistant is None
        assert session.draft_tool_results == []

    asyncio.run(run())


def test_orchestrator_iter_sse_with_error_and_terminal_done(tmp_path: Path, monkeypatch) -> None:
    async def run():
        session = SessionState(session_id="s-err")

        async def error_turn(root, sess, emit, **kw):
            raise RuntimeError("database connection stalled")

        monkeypatch.setattr(orchestrator, "run_agent_turn", error_turn)
        stream = orchestrator.iter_agent_turn_sse(
            tmp_path,
            session,
        )
        chunks = [c async for c in stream]

        assert len(chunks) == 2
        err_data = json.loads(chunks[0].split("data: ")[1])
        done_data = json.loads(chunks[1].split("data: ")[1])
        assert err_data["code"] == "internal"
        assert "database connection stalled" in err_data["message"]
        assert "usage" in done_data

    asyncio.run(run())
