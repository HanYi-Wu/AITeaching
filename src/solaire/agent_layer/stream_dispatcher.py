"""SSE event stream dispatching, heartbeats, and terminal state management for Agent turns."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress, aclosing
from pathlib import Path
from typing import Any

from solaire.agent_layer.models import SessionState

logger = logging.getLogger(__name__)

SSE_HEARTBEAT_SECONDS: float = 10.0

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]


def format_sse_event(event: str, data: dict[str, Any] | str) -> str:
    """Format a standard Server-Sent Event message."""
    if isinstance(data, str):
        text = data
    else:
        text = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {text}\n\n"


def format_sse_comment(comment: str) -> str:
    """Format an SSE comment (used for keepalive heartbeats)."""
    return f": {comment}\n\n"


class StreamDispatcher:
    """Manages queue-based SSE event dispatching with keepalive and terminal state enforcement."""

    def __init__(self, heartbeat_seconds: float = SSE_HEARTBEAT_SECONDS) -> None:
        self.heartbeat_seconds = heartbeat_seconds
        self._queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
        self._is_closed: bool = False
        self._is_cancelled: bool = False
        self._terminal_reached: bool = False
        self._disconnect_event: asyncio.Event = asyncio.Event()
        self._emitted_events: list[str] = []

    @property
    def is_cancelled(self) -> bool:
        return self._is_cancelled

    @property
    def is_closed(self) -> bool:
        return self._is_closed

    @property
    def terminal_reached(self) -> bool:
        return self._terminal_reached

    @property
    def emitted_event_names(self) -> list[str]:
        return list(self._emitted_events)

    async def emit(self, event: str, data: dict[str, Any]) -> None:
        """Emit an SSE event to the queue. Disallows emitting after terminal state or closure."""
        if self._is_closed or self._terminal_reached:
            logger.debug("Dropping event %s after terminal state or close", event)
            return

        self._emitted_events.append(event)
        if event == "done":
            self._terminal_reached = True

        await self._queue.put((event, data))

    async def close(self) -> None:
        """Signal clean end of stream to consumer."""
        if not self._is_closed:
            self._is_closed = True
            await self._queue.put(None)

    def notify_disconnect(self) -> None:
        """Record client disconnection and trigger cancellation."""
        self._is_cancelled = True
        self._disconnect_event.set()
        self._is_closed = True

    async def dispatch_stream(self) -> AsyncIterator[str]:
        """Consume queue items and yield formatted SSE strings, yielding keepalives on timeout."""
        while True:
            try:
                item = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                try:
                    item = await asyncio.wait_for(self._queue.get(), timeout=self.heartbeat_seconds)
                except TimeoutError:
                    yield format_sse_comment("keepalive")
                    continue

            if item is None:
                break

            ev, data = item
            yield format_sse_event(ev, data)


async def _dispatch_agent_turn_sse(
    project_root: Path,
    session: SessionState,
    run_turn_fn: Callable[..., Awaitable[None]],
    heartbeat_seconds: float = SSE_HEARTBEAT_SECONDS,
    **kwargs: Any,
) -> AsyncIterator[str]:
    """Execute run_turn_fn and yield SSE chunks with keepalive, handling clean disconnection."""
    from solaire.agent_layer.session import save_session

    dispatcher = StreamDispatcher(heartbeat_seconds=heartbeat_seconds)
    from solaire.agent_layer.task_projection_adapter import attach_agent_task_projection
    from solaire.web.task_tracking.live_tasks import mark_live, mark_finished
    from solaire.web.task_tracking.contract import get_task_projection
    from solaire.web.task_tracking.models import normalize_owner

    owner = (kwargs.get("project_ctx") or {}).get("_platform_user")
    if not kwargs.get("confirm_action_id") or not session.active_task_turn_id:
        session.active_task_turn_id = uuid.uuid4().hex
    adapter = attach_agent_task_projection(dispatcher, project_root, owner, session.session_id,
                                            turn_id=session.active_task_turn_id)
    mark_live(project_root, adapter.task_id)
    try:
        adapter.on_turn_start()
    except Exception:
        logger.exception("Unable to start Agent task projection")
    save_session(project_root, session)

    async def runner() -> None:
        try:
            await run_turn_fn(project_root, session, emit=dispatcher.emit, **kwargs)
        except asyncio.CancelledError:
            dispatcher.notify_disconnect()
            # Clean up pending draft on disconnect so unobserved writes are not replayed
            if session is not None:
                session.draft_assistant = None
                session.draft_tool_results = []
                session.pending_confirmations.clear()
                with suppress(Exception):
                    save_session(project_root, session)
            raise
        except Exception as e:
            logger.exception("Unexpected error in agent turn runner")
            await dispatcher.emit("error", {"code": "internal", "message": str(e)})
            await dispatcher.emit("done", {"usage": {}})
        finally:
            mark_finished(project_root, adapter.task_id)
            current = get_task_projection(project_root, adapter.task_id, normalize_owner(owner))
            if current and current.status in {"succeeded", "failed", "cancelled"}:
                session.active_task_turn_id = None
                save_session(project_root, session)
            await dispatcher.close()

    task = asyncio.create_task(runner())
    try:
        async for chunk in dispatcher.dispatch_stream():
            yield chunk
        await task
    finally:
        if not task.done():
            dispatcher.notify_disconnect()
            task.cancel()
        with suppress(asyncio.CancelledError):
            await task


async def dispatch_agent_turn_sse(project_root, session, run_turn_fn, heartbeat_seconds=SSE_HEARTBEAT_SECONDS, **kwargs):
    """Serialize a session and reload persisted confirmations before consuming them."""
    from solaire.web.export_lock import FileLease, ExportBusyError
    from solaire.agent_layer.session import load_session
    lease = FileLease(project_root / ".solaire" / "agent" / "turn-locks" / f"{session.session_id}.lock")
    try:
        lease.__enter__()
    except ExportBusyError:
        yield format_sse_event("error", {"code": "session_busy", "message": "当前会话仍在处理，请稍后重试。"})
        yield format_sse_event("done", {"usage": {}})
        return
    try:
        if kwargs.get("confirm_action_id"):
            latest = load_session(project_root, session.session_id)
            if latest is not None:
                session = latest
        async with aclosing(_dispatch_agent_turn_sse(project_root, session, run_turn_fn,
                                                    heartbeat_seconds, **kwargs)) as stream:
            async for chunk in stream:
                yield chunk
    finally:
        lease.close()
