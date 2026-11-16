"""Focused regressions for tool batch argument preparation."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import solaire.agent_layer.tool_executor as executor
from solaire.agent_layer.models import GuardrailDecision, InvocationContext, ToolResult, ToolRisk
from solaire.agent_layer.tool_validator import validate_tool_call
from solaire.agent_layer.tools.tool_definitions import RegisteredTool


def _make_read_tool(name: str = "file.read") -> RegisteredTool:
    return RegisteredTool(
        name=name,
        description="Read file",
        parameters_schema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        handler=lambda _ctx, _args: ToolResult(status="succeeded"),
        risk=ToolRisk.READ,
    )


def test_consecutive_read_batch_reuses_parsed_arguments(monkeypatch, tmp_path):
    parse_calls: list[Any] = []
    parse_arguments = executor._parse_args

    def counted_parse(raw: Any):
        parse_calls.append(raw)
        return parse_arguments(raw)

    monkeypatch.setattr(executor, "_parse_args", counted_parse)
    monkeypatch.setattr(
        executor,
        "get_registered_tool",
        lambda _name: SimpleNamespace(risk=ToolRisk.READ),
    )
    monkeypatch.setattr(
        executor,
        "check_tool_call",
        lambda *_args, **_kwargs: GuardrailDecision.AUTO_APPROVE,
    )

    calls = [
        {"function": {"name": "bank.search_items", "arguments": json.dumps({"query": "linear"})}},
        {"function": {"name": "bank.get_item", "arguments": json.dumps({"qualified_id": "math/q1"})}},
    ]
    parsed: dict[int, tuple[Any, str | None]] = {}
    context = InvocationContext(session_id="test", project_root=tmp_path)

    assert executor.consecutive_read_tool_indices(
        calls, 0, context, "balanced", parsed_arguments=parsed,
    ) == [0, 1]
    assert len(parse_calls) == 2
    assert parsed[0] == ({"query": "linear"}, None)
    assert parsed[1] == ({"qualified_id": "math/q1"}, None)

    # A second preparation pass in the same draft loop uses the saved results.
    assert executor.consecutive_read_tool_indices(
        calls, 0, context, "balanced", parsed_arguments=parsed,
    ) == [0, 1]
    assert len(parse_calls) == 2


def test_batch_validation_reuses_only_parsed_object_arguments():
    tool = _make_read_tool()
    for raw in ('{"path":"notes.md"}', '["path"]', '"path"', "{broken"):
        parsed, parse_error = executor._parse_args(raw)
        chosen = executor._arguments_for_batch_validation(raw, parsed, parse_error)

        expected = validate_tool_call("file.read", raw, [tool])
        actual = validate_tool_call("file.read", chosen, [tool])
        assert (
            actual.tool_name,
            actual.arguments,
            actual.is_valid,
            actual.error_code,
            actual.error_message,
            actual.suggestion,
        ) == (
            expected.tool_name,
            expected.arguments,
            expected.is_valid,
            expected.error_code,
            expected.error_message,
            expected.suggestion,
        )


def test_tool_start_arguments_are_detached_from_handler_arguments():
    handler_arguments = {"filters": {"types": ["exam"]}}

    event_arguments = executor._copy_tool_event_arguments(handler_arguments)
    event_arguments["filters"]["types"].append("answer")

    assert handler_arguments == {"filters": {"types": ["exam"]}}


def test_draft_tool_context_recompiles_catalog_after_selected_tools_change(tmp_path):
    async def emit(_event: str, _data: dict[str, Any]) -> None:
        return None

    context = executor.DraftToolContext(
        project_root=tmp_path,
        session=SimpleNamespace(),
        ctx=SimpleNamespace(),
        safety_mode="balanced",
        adapter=SimpleNamespace(),
        fast_adapter=SimpleNamespace(),
        emit=emit,
        tools=[_make_read_tool("file.read")],
    )

    first_catalog = context.compiled_tool_catalog()
    assert first_catalog.get("file.read") is not None
    assert first_catalog.get("file.write") is None
    assert context.compiled_tool_catalog() is first_catalog

    # run_agent_turn replaces the selected list after focus/plan changes.
    context.tools = [_make_read_tool("file.write")]
    second_catalog = context.compiled_tool_catalog()
    assert second_catalog is not first_catalog
    assert second_catalog.get("file.read") is None
    assert second_catalog.get("file.write") is not None
    assert context.compiled_tool_catalog() is second_catalog
