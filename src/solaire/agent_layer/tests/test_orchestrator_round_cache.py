from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

from solaire.agent_layer import orchestrator
from solaire.agent_layer.models import SessionState
from solaire.agent_layer.tool_executor import flush_draft_to_messages


def test_rendered_task_plan_change_rebuilds_prompt_after_pipeline_tool(monkeypatch, tmp_path):
    session = SessionState(
        session_id="round-cache",
        task_plan=[{"title": "Prepare", "status": "pending"}],
    )
    events: list[tuple[str, dict]] = []
    prompts: list[str] = []

    async def emit(event: str, data: dict) -> None:
        events.append((event, data))

    async def fake_llm_round_call(_adapter, api_messages, _tools, **_kwargs):
        prompts.append(api_messages[1]["content"])
        if len(prompts) == 1:
            return (
                "",
                [{
                    "id": "pipeline-1",
                    "type": "function",
                    "function": {"name": "agent.run_tool_pipeline", "arguments": "{}"},
                }],
                {},
                "",
                "tool_calls",
            )
        return "Complete", [], {}, "", "stop"

    async def fake_draft_loop(*, dtc):
        dtc.session.task_plan[0]["status"] = "completed"
        flush_draft_to_messages(dtc.session)
        return False

    monkeypatch.setattr(orchestrator, "_llm_round_call", fake_llm_round_call)
    monkeypatch.setattr(orchestrator, "run_draft_tool_loop", fake_draft_loop)
    router = SimpleNamespace(main=lambda: MagicMock(), fast=lambda: MagicMock())

    asyncio.run(
        orchestrator.run_agent_turn(
            tmp_path,
            session,
            user_message="Start the plan",
            project_ctx={},
            router=router,
            emit=emit,
        )
    )

    assert len(prompts) == 2
    assert "[pending] Prepare" in prompts[0]
    assert "[completed] Prepare" in prompts[1]
    metrics = [data for name, data in events if name == "context_metrics"]
    assert len(metrics) == 2
    assert metrics[0]["task_plan_sha12"] != metrics[1]["task_plan_sha12"]
