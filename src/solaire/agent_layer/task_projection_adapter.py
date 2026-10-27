"""Persist finite Agent turn metadata without storing prompts or responses."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from solaire.web.task_tracking.contract import (
    create_or_update_projection,
    get_project_scope_id,
    get_task_projection,
)
from solaire.web.task_tracking.models import (
    TaskEvent,
    TaskProjectionRecord,
    TaskStatus,
    normalize_owner,
    normalize_progress,
)

logger = logging.getLogger(__name__)


def derive_agent_task_id(session_id: str, turn_id: str | int | None = None) -> str:
    """Generate deterministic, unique task_id for an agent turn under a session."""
    clean_session = str(session_id).strip()
    if turn_id is not None:
        return f"agent:{clean_session}:turn_{turn_id}"
    return f"agent:{clean_session}"


class AgentTaskProjectionAdapter:
    """Projection adapter converting agent lifecycle events into durable TaskEvents."""

    def __init__(
        self,
        project_root: Path,
        owner: str | dict[str, Any] | None,
        session_id: str,
        turn_id: str | int | None = None,
        *,
        title: str | None = None,
    ) -> None:
        self.project_root = project_root.resolve()
        self.owner = normalize_owner(owner)
        self.project_scope = get_project_scope_id(self.project_root)
        self.session_id = str(session_id).strip()
        self.turn_id = turn_id
        self.task_id = derive_agent_task_id(self.session_id, self.turn_id)
        self.source_id = f"session:{self.session_id}"
        self.title = title or f"Agent 问答/组卷 ({self.session_id[:8]})"

        self._event_version: int = 1
        self._attempt: int = 1
        self._current_status: TaskStatus = "queued"
        self._current_progress: float = 0.0
        self._current_stage: str = "initialized"
        self._terminal_reached: bool = False
        current = get_task_projection(self.project_root, self.task_id, self.owner)
        if current is not None:
            self._event_version = current.event_version + 1
            self._terminal_reached = current.status in {"succeeded", "failed", "cancelled"}

    @property
    def current_status(self) -> TaskStatus:
        return self._current_status

    @property
    def event_version(self) -> int:
        return self._event_version

    def _next_version(self) -> int:
        ver = self._event_version
        self._event_version += 1
        return ver

    def _record(
        self,
        *,
        status: TaskStatus,
        progress: float | None = None,
        stage: str | None = None,
        result_summary: dict[str, Any] | None = None,
        error_summary: dict[str, Any] | None = None,
    ) -> TaskProjectionRecord:
        if self._terminal_reached:
            # Prevent state regressions once terminal state reached in current attempt
            current = get_task_projection(
                self.project_root,
                self.task_id,
                owner=self.owner,
                project_scope=self.project_scope,
            )
            if current is not None:
                return current

        self._current_status = status
        self._current_progress = normalize_progress(progress)
        if stage is not None:
            self._current_stage = stage

        if status in {"succeeded", "failed", "cancelled"}:
            self._terminal_reached = True

        event = TaskEvent(
            task_id=self.task_id,
            task_type="agent",
            owner=self.owner,
            project_scope=self.project_scope,
            source_id=self.source_id,
            attempt=self._attempt,
            status=status,
            event_version=self._next_version(),
            progress=self._current_progress,
            stage=self._current_stage,
            title=self.title,
            result_summary=result_summary,
            error_summary=error_summary,
            is_retryable=False,  # Agent turns must be intentionally initiated by user, not blind retry
        )
        return create_or_update_projection(self.project_root, event)

    def on_turn_start(self, attempt: int = 1) -> TaskProjectionRecord:
        """Invoked when agent begins processing a user request."""
        self._attempt = max(1, int(attempt))
        self._terminal_reached = False
        return self._record(
            status="running",
            stage="turn_started",
        )

    def on_event(self, event_name: str, payload: dict[str, Any]) -> TaskProjectionRecord | None:
        """Route raw SSE / orchestrator events to corresponding projection state."""
        data = payload or {}
        if event_name == "session":
            return self.on_turn_start()

        if event_name == "thinking":
            return self._record(
                status="running",
                stage="reasoning",
            )

        if event_name == "tool_start":
            tool_name = str(data.get("tool_name") or data.get("tool") or data.get("name") or "unknown_tool")
            return self._record(
                status="running",
                stage=f"tool_start:{tool_name}",
            )

        if event_name == "tool_result":
            tool_name = str(data.get("tool_name") or data.get("tool") or data.get("name") or "unknown_tool")
            success = data.get("status", "succeeded") == "succeeded"
            stage = f"tool_done:{tool_name}" if success else f"tool_failed:{tool_name}"
            return self._record(
                status="running",
                stage=stage,
            )

        if event_name in {"task_update", "plan_ready"}:
            steps = data.get("steps") if isinstance(data.get("steps"), list) else []
            return self.on_plan_update(steps)

        if event_name == "confirm_needed":
            tool_name = str(data.get("tool_name") or data.get("tool") or "unknown_tool")
            return self._record(
                status="running",
                stage=f"awaiting_confirmation:{tool_name}",
                result_summary={"awaiting_confirmation": True, "tool": tool_name},
            )

        if event_name == "error":
            detail = str(data.get("message") or data.get("error") or data.get("detail") or "Agent回合异常中止")
            code = data.get("code")
            return self._record(
                status="cancelled" if code == "cancelled" else "failed",
                stage="error",
                error_summary={"code": code, "detail": detail[:500]},
            )

        if event_name == "done":
            awaiting = bool(data.get("awaiting_confirmation"))
            if awaiting:
                return self._record(
                    status="running",
                    stage="awaiting_confirmation",
                )
            return self._record(
                status="succeeded",
                progress=1.0,
                stage="completed",
                result_summary={"status": "completed"},
            )

        return None

    def on_plan_update(self, steps: list[dict[str, Any]]) -> TaskProjectionRecord:
        """Compute finite progress and stage mapping from plan steps."""
        if not steps:
            return self._record(status="running", stage="plan_updated")

        total = len(steps)
        completed = sum(1 for s in steps if str(s.get("status") or "") in {"completed", "done", "succeeded"})
        running_steps = [s for s in steps if str(s.get("status") or "") == "running"]

        progress_val = round(completed / total, 4)
        if running_steps:
            stage_title = str(running_steps[0].get("title") or running_steps[0].get("name") or f"step_{completed+1}")
            stage_str = f"step_{completed+1}/{total}: {stage_title}"
        else:
            stage_str = f"plan_progress_{completed}/{total}"

        return self._record(
            status="running",
            progress=progress_val,
            stage=stage_str[:100],
            result_summary={"total_steps": total, "completed_steps": completed},
        )

    def on_disconnect_or_cancel(self) -> TaskProjectionRecord:
        """Invoked when client stream disconnects or cancel event fires."""
        return self._record(
            status="cancelled",
            stage="cancelled_client_disconnect",
            error_summary={"detail": "客户端断开或操作已主动取消；已完成的写入保留，请核对结果。", "needs_verification": True},
        )


def attach_agent_task_projection(
    dispatcher: Any,
    project_root: Path,
    owner: str | dict[str, Any] | None,
    session_id: str,
    turn_id: str | int | None = None,
    *,
    title: str | None = None,
) -> AgentTaskProjectionAdapter:
    """Convenience attachment hook wrapping StreamDispatcher to auto-project events.

    This provides a minimal, clean 1-line integration hook for the main coordinator/orchestrator.
    """
    adapter = AgentTaskProjectionAdapter(
        project_root=project_root,
        owner=owner,
        session_id=session_id,
        turn_id=turn_id,
        title=title,
    )

    original_emit = dispatcher.emit

    async def hooked_emit(event: str, data: dict[str, Any]) -> None:
        if dispatcher.is_closed or dispatcher.terminal_reached:
            return
        try:
            adapter.on_event(event, data)
        except Exception as exc:
            logger.warning("Agent task projection adapter failed to process event %s: %s", event, exc)
        await original_emit(event, data)

    dispatcher.emit = hooked_emit

    if hasattr(dispatcher, "notify_disconnect"):
        original_notify = dispatcher.notify_disconnect

        def hooked_notify_disconnect() -> None:
            try:
                adapter.on_disconnect_or_cancel()
            except Exception as exc:
                logger.warning("Agent task projection adapter failed on disconnect: %s", exc)
            original_notify()

        dispatcher.notify_disconnect = hooked_notify_disconnect

    return adapter
