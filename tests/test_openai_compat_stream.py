from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter


class _FakeStream:
    def __init__(self, events: list[Any]) -> None:
        self._events = events

    def __aiter__(self):
        async def _events():
            for event in self._events:
                yield event

        return _events()


class _FakeCompletions:
    def __init__(self, events: list[Any]) -> None:
        self.events = events
        self.request: dict[str, Any] | None = None

    async def create(self, **request: Any) -> _FakeStream:
        self.request = request
        return _FakeStream(self.events)


def _tool_delta(
    index: int,
    *,
    call_id: str | None = None,
    name: str | None = None,
    arguments: Any = None,
) -> Any:
    return SimpleNamespace(
        index=index,
        id=call_id,
        function=SimpleNamespace(name=name, arguments=arguments),
    )


def _event(
    *,
    content: str | None = None,
    reasoning: str | None = None,
    tool_calls: list[Any] | None = None,
    finish_reason: str | None = None,
    usage: Any = None,
) -> Any:
    delta = SimpleNamespace(
        content=content,
        reasoning_content=reasoning,
        reasoning=None,
        tool_calls=tool_calls,
    )
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)],
        usage=usage,
    )


def test_openai_compat_stream_joins_interleaved_tool_argument_fragments() -> None:
    events = [
        _event(content="正文"),
        _event(reasoning="思考"),
        _event(
            tool_calls=[
                _tool_delta(1, call_id="call-1", name="graph.", arguments=""),
                _tool_delta(2, call_id="call-empty", name="memory.", arguments=None),
            ]
        ),
        _event(tool_calls=[_tool_delta(0, call_id="call-0", name="bank.", arguments='{"query":')]),
        _event(
            tool_calls=[
                _tool_delta(1, name="search_nodes", arguments='{"limit":'),
                _tool_delta(2, name="read_index", arguments=""),
            ]
        ),
        _event(tool_calls=[_tool_delta(0, name="search_items", arguments='"数学"}')]),
        _event(tool_calls=[_tool_delta(1, arguments="10}")]),
        _event(
            finish_reason="tool_calls",
            usage=SimpleNamespace(
                prompt_tokens=11,
                completion_tokens=7,
                total_tokens=18,
                prompt_cache_hit_tokens=2,
                prompt_cache_miss_tokens=9,
            ),
        ),
    ]
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "offline-test"
    adapter._deepseek_compat = False
    adapter._reasoning_effort = None
    completions = _FakeCompletions(events)
    adapter._client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    messages = [{"role": "user", "content": "hi"}]
    tools = [
        {
            "type": "function",
            "function": {
                "name": "bank.search_items",
                "description": "search",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    async def _collect() -> list[Any]:
        return [chunk async for chunk in adapter.chat_stream(messages, tools=tools, max_tokens=128)]

    chunks = asyncio.run(_collect())

    assert [chunk.delta_content for chunk in chunks[:-1] if chunk.delta_content is not None] == ["正文"]
    assert [chunk.delta_reasoning for chunk in chunks[:-1] if chunk.delta_reasoning is not None] == ["思考"]
    terminal = chunks[-1]
    assert terminal.finish_reason == "tool_calls"
    assert terminal.accumulated_reasoning == "思考"
    assert terminal.usage == {
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "total_tokens": 18,
        "prompt_cache_hit_tokens": 2,
        "prompt_cache_miss_tokens": 9,
    }
    assert terminal.raw_tool_calls == [
        {
            "id": "call-0",
            "type": "function",
            "function": {"name": "bank.search_items", "arguments": '{"query":"数学"}'},
        },
        {
            "id": "call-1",
            "type": "function",
            "function": {"name": "graph.search_nodes", "arguments": '{"limit":10}'},
        },
        {
            "id": "call-empty",
            "type": "function",
            "function": {"name": "memory.read_index", "arguments": "{}"},
        },
    ]
    assert messages == [{"role": "user", "content": "hi"}]
    assert completions.request is not None
    assert completions.request["parallel_tool_calls"] is True


def test_openai_compat_stream_does_not_suppress_invalid_argument_fragment() -> None:
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "offline-test"
    adapter._deepseek_compat = False
    adapter._reasoning_effort = None
    adapter._client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=_FakeCompletions(
                [
                    _event(content="before-error"),
                    _event(
                        tool_calls=[
                            _tool_delta(0, call_id="call-bad", name="bad_tool", arguments=7),
                        ]
                    ),
                    _event(content="after-error"),
                    _event(finish_reason="tool_calls"),
                ]
            )
        )
    )
    emitted: list[Any] = []

    async def _consume() -> None:
        async for _chunk in adapter.chat_stream([{"role": "user", "content": "hi"}]):
            emitted.append(_chunk)

    with pytest.raises(TypeError):
        asyncio.run(_consume())
    assert [chunk.delta_content for chunk in emitted] == ["before-error"]
