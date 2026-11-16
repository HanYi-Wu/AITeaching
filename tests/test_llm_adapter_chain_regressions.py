from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace as NS
from typing import Any

import httpx
import pytest

from solaire.agent_layer.llm import anthropic_messages
from solaire.agent_layer.llm import openai_compat
from solaire.agent_layer.llm.anthropic_messages import (
    AnthropicMessagesAdapter,
    _anthropic_response_to_chat,
    _build_anthropic_messages,
)
from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter, _map_raw_tool_calls_inbound
from solaire.agent_layer.llm.message_utils import ensure_assistant_tool_calls_have_reasoning
from solaire.agent_layer.llm.openai_responses import OpenAIResponsesAdapter
from solaire.agent_layer.llm import token_budget


class _FakeStream:
    def __init__(self, events: list[Any], final_message: Any = None) -> None:
        self.events = events
        self.final_message = final_message

    def __aiter__(self):
        async def event_iterator():
            for event in self.events:
                yield event

        return event_iterator()

    async def get_final_message(self) -> Any:
        return self.final_message


class _FakeEndpoint:
    def __init__(self, stream: _FakeStream) -> None:
        self.stream = stream
        self.request: dict[str, Any] | None = None

    async def create(self, **request: Any) -> _FakeStream:
        self.request = request
        return self.stream


class _FakeCompatCompletions:
    def __init__(self, events: list[Any], response: Any) -> None:
        self.stream = _FakeStream(events)
        self.response = response
        self.requests: list[dict[str, Any]] = []

    async def create(self, **request: Any) -> Any:
        self.requests.append(request)
        return self.stream if request.get("stream") else self.response


def _compat_event(
    *,
    content: str | None = None,
    reasoning: str | None = None,
    tool_calls: list[Any] | None = None,
    finish_reason: str | None = None,
    usage: Any = None,
    choices: bool = True,
) -> Any:
    if not choices:
        return NS(choices=[], usage=usage)
    delta = NS(content=content, reasoning_content=reasoning, reasoning=None, tool_calls=tool_calls)
    return NS(choices=[NS(delta=delta, finish_reason=finish_reason)], usage=usage)


def _compat_tool_delta(index: int, *, call_id: str | None = None, name: str | None = None, arguments: Any = None):
    return NS(index=index, id=call_id, function=NS(name=name, arguments=arguments))


def _responses_usage() -> Any:
    return NS(
        input_tokens=17,
        output_tokens=9,
        total_tokens=26,
        input_tokens_details=NS(cached_tokens=5),
    )


def _responses_final() -> Any:
    return NS(
        output=[
            NS(type="message", content=[NS(type="output_text", text="完整答复")]),
            NS(type="reasoning", summary=[NS(type="summary_text", text="最终思考")]),
            NS(type="function_call", call_id="resp-call", name="lookup", arguments='{"q":"x"}'),
        ],
        incomplete_details=None,
        usage=_responses_usage(),
    )


def test_compat_projection_only_copies_entries_that_change() -> None:
    unchanged_call = {"id": "plain", "function": {"name": "read_index", "arguments": "{}"}}
    dotted_call = {"id": "dotted", "function": {"name": "bank.read", "arguments": "{}", "extra": 1}}
    unchanged_message = {"role": "user", "content": "hello"}
    unchanged_assistant = {"role": "assistant", "reasoning_content": "known", "tool_calls": [unchanged_call]}
    mixed_assistant = {"role": "assistant", "tool_calls": [unchanged_call, dotted_call]}
    unchanged_tool = {"role": "tool", "name": "local_tool", "content": "ok"}
    dotted_tool = {"role": "tool", "name": "bank.read", "content": "ok"}
    plain_definition = {"type": "function", "function": {"name": "read_index", "parameters": {}}}
    dotted_definition = {"type": "function", "function": {"name": "bank.read", "parameters": {}}}
    messages = [unchanged_message, unchanged_assistant, mixed_assistant, unchanged_tool, dotted_tool]
    tools = [plain_definition, dotted_definition]

    projected, projected_tools = openai_compat._prepare_compat_request_payload(messages, tools)

    assert projected is not messages
    assert projected[0] is unchanged_message
    assert projected[1] is unchanged_assistant
    assert projected[2] is not mixed_assistant
    assert projected[2]["tool_calls"][0] is unchanged_call
    assert projected[2]["tool_calls"][1] is not dotted_call
    assert projected[2]["tool_calls"][1]["function"] == {
        "name": "bank_read",
        "arguments": "{}",
        "extra": 1,
    }
    assert projected[3] is unchanged_tool
    assert projected[4] == {"role": "tool", "name": "bank_read", "content": "ok"}
    assert projected_tools is not None
    assert projected_tools[0] is plain_definition
    assert projected_tools[1]["function"]["name"] == "bank_read"


def test_compat_projection_copies_assistant_before_reasoning_normalization() -> None:
    original = {"role": "assistant", "tool_calls": [{"id": "plain", "function": {"name": "plain", "arguments": "{}"}}]}

    projected, _ = openai_compat._prepare_compat_request_payload([original], None)
    ensure_assistant_tool_calls_have_reasoning(projected)

    assert projected[0] is not original
    assert projected[0]["reasoning_content"] == ""
    assert "reasoning_content" not in original


def test_compat_stream_rejects_non_string_tool_name_at_the_fragment() -> None:
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "local"
    adapter._deepseek_compat = False
    adapter._reasoning_effort = None
    endpoint = _FakeEndpoint(
        _FakeStream(
            [
                _compat_event(
                    tool_calls=[_compat_tool_delta(0, call_id="bad", name=7)],
                ),
                _compat_event(content="must not be consumed"),
            ]
        )
    )
    adapter._client = NS(chat=NS(completions=endpoint))
    emitted: list[Any] = []

    async def collect():
        async for chunk in adapter.chat_stream([{"role": "user", "content": "hi"}]):
            emitted.append(chunk)

    try:
        asyncio.run(collect())
    except TypeError as exc:
        assert 'can only concatenate str (not "int") to str' in str(exc)
    else:
        raise AssertionError("malformed tool name should raise TypeError")
    assert emitted == []


def test_inbound_tool_name_mapping_is_built_once_and_copies_only_changed_calls(monkeypatch) -> None:
    build_count = 0

    def mapping() -> dict[str, str]:
        nonlocal build_count
        build_count += 1
        return {"bank_read": "bank.read"}

    monkeypatch.setattr(openai_compat, "_wire_to_canonical_tool_names", mapping)
    changed = {"id": "1", "function": {"name": "bank_read", "arguments": "{}"}}
    unchanged = {"id": "2", "function": {"name": "plain", "arguments": "{}"}}

    result = _map_raw_tool_calls_inbound([changed, unchanged])

    assert build_count == 1
    assert result[0] is not changed
    assert result[0]["function"] is not changed["function"]
    assert result[0]["function"]["name"] == "bank.read"
    assert result[1] is unchanged
    assert changed["function"]["name"] == "bank_read"


def test_compat_stream_keeps_delta_order_tool_order_and_terminal_usage(monkeypatch) -> None:
    monkeypatch.setattr(openai_compat, "_wire_to_canonical_tool_names", lambda: {"bank_read": "bank.read"})
    events = [
        _compat_event(content="先"),
        _compat_event(reasoning="思考-"),
        _compat_event(
            tool_calls=[
                _compat_tool_delta(1, call_id="call-1", name="bank_", arguments='{"id":'),
                _compat_tool_delta(0, call_id="call-0", name="status", arguments="{}"),
            ]
        ),
        _compat_event(reasoning="继续"),
        _compat_event(tool_calls=[_compat_tool_delta(1, name="read", arguments="7}")]),
        _compat_event(
            usage=NS(prompt_tokens=10, completion_tokens=7, total_tokens=17),
            finish_reason="tool_calls",
        ),
    ]
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "local"
    adapter._deepseek_compat = False
    adapter._reasoning_effort = None
    endpoint = _FakeEndpoint(_FakeStream(events))
    adapter._client = NS(chat=NS(completions=endpoint))
    history = [{"role": "assistant", "tool_calls": [{"id": "old", "function": {"name": "bank.read", "arguments": "{}"}}]}]
    tools = [{"type": "function", "function": {"name": "bank.read", "parameters": {"type": "object"}}}]

    async def collect():
        return [chunk async for chunk in adapter.chat_stream(history, tools=tools, max_tokens=64)]

    chunks = asyncio.run(collect())

    assert [(c.delta_content, c.delta_reasoning) for c in chunks[:-1]] == [
        ("先", None),
        (None, "思考-"),
        (None, "继续"),
    ]
    terminal = chunks[-1]
    assert terminal.finish_reason == "tool_calls"
    assert terminal.accumulated_reasoning == "思考-继续"
    assert terminal.usage == {"prompt_tokens": 10, "completion_tokens": 7, "total_tokens": 17}
    assert terminal.raw_tool_calls == [
        {"id": "call-0", "type": "function", "function": {"name": "status", "arguments": "{}"}},
        {"id": "call-1", "type": "function", "function": {"name": "bank.read", "arguments": '{"id":7}'}},
    ]
    assert endpoint.request is not None
    assert endpoint.request["tools"][0]["function"]["name"] == "bank_read"
    assert endpoint.request["parallel_tool_calls"] is True
    assert history[0]["tool_calls"][0]["function"]["name"] == "bank.read"


def test_compat_entrypoints_do_not_add_reasoning_to_caller_history() -> None:
    response = NS(
        choices=[NS(message=NS(content="done", tool_calls=None), finish_reason="stop")],
        usage=None,
    )
    endpoint = _FakeCompatCompletions(
        [_compat_event(content="chunk"), _compat_event(finish_reason="stop")],
        response,
    )
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "local"
    adapter._deepseek_compat = False
    adapter._reasoning_effort = None
    adapter._client = NS(chat=NS(completions=endpoint))

    def history() -> list[dict[str, Any]]:
        return [
            {
                "role": "assistant",
                "tool_calls": [{"id": "prior", "function": {"name": "plain", "arguments": "{}"}}],
            }
        ]

    chat_history = history()
    asyncio.run(adapter.chat(chat_history))
    assert "reasoning_content" not in chat_history[0]
    assert endpoint.requests[-1]["messages"][0]["reasoning_content"] == ""

    stream_history = history()

    async def collect_stream():
        return [chunk async for chunk in adapter.chat_stream(stream_history)]

    asyncio.run(collect_stream())
    assert "reasoning_content" not in stream_history[0]
    assert endpoint.requests[-1]["messages"][0]["reasoning_content"] == ""

    text_history = history()

    async def collect_text():
        return [chunk async for chunk in adapter.chat_stream_text(text_history)]

    assert asyncio.run(collect_text()) == ["chunk"]
    assert "reasoning_content" not in text_history[0]
    assert endpoint.requests[-1] == {
        "model": "local",
        "messages": text_history,
        "temperature": 0.3,
        "stream": True,
    }


def test_responses_stream_uses_shared_payload_builder_and_preserves_output_order() -> None:
    final = _responses_final()
    events = [
        NS(type="response.output_text.delta", delta="部分"),
        NS(type="response.reasoning_text.delta", delta="reason-a"),
        NS(type="response.reasoning_text.delta", delta="reason-b"),
        NS(type="response.completed", response=final),
    ]
    adapter = object.__new__(OpenAIResponsesAdapter)
    adapter.model = "responses-local"
    endpoint = _FakeEndpoint(_FakeStream(events))
    adapter._client = NS(responses=endpoint)
    messages = [
        {"role": "system", "content": "只回答"},
        {"role": "user", "content": "查找"},
        {
            "role": "assistant",
            "tool_calls": [{"id": "prior-call", "function": {"name": "lookup", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "prior-call", "content": "结果"},
    ]
    tools = [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}]

    async def collect():
        return [chunk async for chunk in adapter.chat_stream(messages, tools=tools, temperature=0.25, max_tokens=96)]

    chunks = asyncio.run(collect())

    assert [(c.delta_content, c.delta_reasoning) for c in chunks[:-1]] == [
        ("部分", None),
        (None, "reason-a"),
        (None, "reason-b"),
    ]
    terminal = chunks[-1]
    assert terminal.finish_reason == "tool_calls"
    assert terminal.accumulated_reasoning == "reason-areason-b"
    assert terminal.raw_tool_calls == [
        {"id": "resp-call", "type": "function", "function": {"name": "lookup", "arguments": '{"q":"x"}'}},
    ]
    assert terminal.usage == {
        "prompt_tokens": 17,
        "completion_tokens": 9,
        "total_tokens": 26,
        "prompt_cache_hit_tokens": 5,
        "prompt_cache_miss_tokens": 12,
    }
    assert endpoint.request == {
        "model": "responses-local",
        "input": [
            {"type": "message", "role": "user", "content": "查找"},
            {"type": "function_call", "call_id": "prior-call", "name": "lookup", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "prior-call", "output": "结果"},
        ],
        "temperature": 0.25,
        "parallel_tool_calls": True,
        "stream": True,
        "instructions": "只回答",
        "max_output_tokens": 96,
        "tools": [{"type": "function", "name": "lookup", "description": None, "parameters": {"type": "object"}}],
        "tool_choice": "auto",
        "stream_options": {"include_usage": True},
    }


def test_anthropic_stream_keeps_tool_block_order_and_usage() -> None:
    final = NS(
        content=[
            NS(type="text", text="答复"),
            NS(type="thinking", thinking="完整推理"),
            NS(type="tool_use", id="first", name="search", input={"q": "x"}),
            NS(type="tool_use", id="second", name="read", input={}),
        ],
        stop_reason="tool_use",
        usage=NS(input_tokens=21, output_tokens=8, cache_read_input_tokens=3, cache_creation_input_tokens=2),
    )
    events = [
        NS(type="content_block_delta", delta=NS(type="text_delta", text="答")),
        NS(type="content_block_delta", delta=NS(type="thinking_delta", thinking="推理-")),
        NS(type="content_block_delta", delta=NS(type="thinking_delta", thinking="片段")),
    ]
    adapter = object.__new__(AnthropicMessagesAdapter)
    adapter.model = "anthropic-local"
    endpoint = _FakeEndpoint(_FakeStream(events, final_message=final))
    adapter._client = NS(messages=endpoint)
    messages = [
        {"role": "system", "content": "规则一"},
        {"role": "system", "content": "规则二"},
        {"role": "user", "content": "查找"},
    ]
    tools = [{"type": "function", "function": {"name": "search", "parameters": {"type": "object"}}}]

    async def collect():
        return [chunk async for chunk in adapter.chat_stream(messages, tools=tools, temperature=0.4, max_tokens=128)]

    chunks = asyncio.run(collect())

    assert [(c.delta_content, c.delta_reasoning) for c in chunks[:-1]] == [
        ("答", None),
        (None, "推理-"),
        (None, "片段"),
    ]
    terminal = chunks[-1]
    assert terminal.finish_reason == "tool_calls"
    assert terminal.accumulated_reasoning == "推理-片段"
    assert terminal.usage == {
        "prompt_tokens": 21,
        "completion_tokens": 8,
        "total_tokens": 29,
        "prompt_cache_hit_tokens": 3,
        "prompt_cache_write_tokens": 2,
    }
    assert terminal.raw_tool_calls == [
        {"id": "first", "type": "function", "function": {"name": "search", "arguments": '{"q": "x"}'}},
        {"id": "second", "type": "function", "function": {"name": "read", "arguments": "{}"}},
    ]
    assert endpoint.request is not None
    assert endpoint.request["stream"] is True
    assert endpoint.request["system"] == "规则一\n\n规则二"
    assert endpoint.request["max_tokens"] == 128
    assert endpoint.request["tool_choice"] == {"type": "auto"}


def test_anthropic_sdk_serializes_request_through_mock_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    received: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        received.append((request.url.path, json.loads(request.content)))
        return httpx.Response(
            200,
            json={
                "id": "msg-local",
                "type": "message",
                "role": "assistant",
                "model": "anthropic-local",
                "content": [{"type": "text", "text": "sdk response"}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": 4, "output_tokens": 2},
            },
        )

    def mock_http_client(**options: Any) -> httpx.AsyncClient:
        options.pop("transport", None)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **options)

    monkeypatch.setattr(anthropic_messages, "DefaultAsyncHttpxClient", mock_http_client)
    monkeypatch.setenv("EH_PROXY_HOSTS", "")
    monkeypatch.setenv("EH_EXTERNAL_PROXY_URL", "")
    adapter = AnthropicMessagesAdapter(
        api_key="test-only",
        base_url="https://provider.example",
        model="anthropic-local",
    )

    async def request():
        try:
            return await adapter.chat(
                [{"role": "system", "content": "system"}, {"role": "user", "content": "question"}],
                max_tokens=77,
            )
        finally:
            await adapter._client.close()

    response = asyncio.run(request())

    assert response.content == "sdk response"
    assert response.usage == {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6}
    assert received == [
        (
            "/v1/messages",
            {
                "model": "anthropic-local",
                "max_tokens": 77,
                "messages": [{"role": "user", "content": [{"type": "text", "text": "question"}]}],
                "temperature": 0.3,
                "system": "system",
            },
        )
    ]


def test_openai_compat_sdk_serializes_projected_tools_through_mock_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        received.append((request.url.path, json.loads(request.content)))
        return httpx.Response(
            200,
            json={
                "id": "chat-local",
                "object": "chat.completion",
                "created": 1,
                "model": "compat-local",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "result-call",
                                    "type": "function",
                                    "function": {"name": "bank_search", "arguments": "{\"q\":\"x\"}"},
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
            },
        )

    def mock_http_client(**options: Any) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **options)

    monkeypatch.setattr(openai_compat, "DefaultAsyncHttpxClient", mock_http_client)
    monkeypatch.setattr(openai_compat, "_wire_to_canonical_tool_names", lambda: {"bank_search": "bank.search"})
    monkeypatch.setenv("EH_PROXY_HOSTS", "")
    monkeypatch.setenv("EH_EXTERNAL_PROXY_URL", "")
    adapter = OpenAICompatAdapter(api_key="test-only", base_url="https://provider.example/v1", model="compat-local")
    history = [
        {
            "role": "assistant",
            "tool_calls": [
                {"id": "prior", "type": "function", "function": {"name": "bank.search", "arguments": "{}"}}
            ],
        },
        {"role": "tool", "tool_call_id": "prior", "name": "bank.search", "content": "{}"},
    ]
    tools = [{"type": "function", "function": {"name": "bank.search", "parameters": {"type": "object"}}}]

    async def request():
        try:
            return await adapter.chat(history, tools=tools, max_tokens=77)
        finally:
            await adapter._client.close()

    response = asyncio.run(request())

    assert response.tool_calls == [
        {"id": "result-call", "type": "function", "function": {"name": "bank.search", "arguments": '{"q":"x"}'}},
    ]
    assert response.reasoning_content == ""
    assert received == [
        (
            "/v1/chat/completions",
            {
                "model": "compat-local",
                "messages": [
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "prior",
                                "type": "function",
                                "function": {"name": "bank_search", "arguments": "{}"},
                            }
                        ],
                        "reasoning_content": "",
                    },
                    {"role": "tool", "tool_call_id": "prior", "name": "bank_search", "content": "{}"},
                ],
                "temperature": 0.3,
                "max_tokens": 77,
                "tools": [
                    {"type": "function", "function": {"name": "bank_search", "parameters": {"type": "object"}}}
                ],
                "tool_choice": "auto",
                "parallel_tool_calls": True,
            },
        )
    ]
    assert "reasoning_content" not in history[0]
    assert history[1]["name"] == "bank.search"


def test_anthropic_grouped_tool_results_and_fragmented_response_reasoning() -> None:
    mapped = _build_anthropic_messages(
        [
            {"role": "assistant", "content": "执行", "tool_calls": [
                {"id": "a", "function": {"name": "first", "arguments": '{"x":1}'}},
                {"id": "b", "function": {"name": "second", "arguments": "{}"}},
            ]},
            {"role": "tool", "tool_call_id": "a", "content": "one"},
            {"role": "tool", "tool_call_id": "b", "content": "two"},
        ]
    )
    assert mapped == [
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "执行"},
                {"type": "tool_use", "id": "a", "name": "first", "input": {"x": 1}},
                {"type": "tool_use", "id": "b", "name": "second", "input": {}},
            ],
        },
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "a", "content": "one"},
                {"type": "tool_result", "tool_use_id": "b", "content": "two"},
            ],
        },
    ]
    blocks = [NS(type="thinking", thinking="x" * 20_000), NS(type="thinking", thinking="y" * 20_000)]
    response = _anthropic_response_to_chat(NS(content=blocks, stop_reason="end_turn", usage=None))
    assert response.reasoning_content == "x" * 20_000 + "y" * 20_000


def test_token_budget_cools_down_after_offline_encoder_resolution_failure(monkeypatch) -> None:
    calls = {"model": 0, "fallback": 0}

    class MissingEncoderTables:
        @staticmethod
        def encoding_for_model(_model: str):
            calls["model"] += 1
            raise LookupError("model encoding is unavailable")

        @staticmethod
        def get_encoding(_name: str):
            calls["fallback"] += 1
            raise OSError("token table is unavailable offline")

    monkeypatch.setattr(token_budget, "tiktoken", MissingEncoderTables)
    monkeypatch.setattr(token_budget, "_ENCODING_CACHE", {})
    monkeypatch.setattr(token_budget, "_ENCODING_RETRY_AFTER", {})

    estimate = token_budget.estimate_messages_tokens(
        [{"content": "a longer prompt"}, {"content": "another prompt"}, {"content": "third"}],
        model_hint="offline-model",
    )

    assert estimate == sum(max(1, len(text) // 4) for text in ("a longer prompt", "another prompt", "third"))
    assert calls == {"model": 1, "fallback": 1}


def test_token_budget_counts_literal_special_token_text_as_content(monkeypatch) -> None:
    seen: list[tuple[str, tuple[str, ...]]] = []

    class FakeEncoding:
        @staticmethod
        def encode(text: str, *, disallowed_special: tuple[str, ...]) -> list[int]:
            seen.append((text, disallowed_special))
            return [1, 2, 3]

    class FakeTiktoken:
        @staticmethod
        def encoding_for_model(_model: str) -> FakeEncoding:
            return FakeEncoding()

    monkeypatch.setattr(token_budget, "tiktoken", FakeTiktoken)
    monkeypatch.setattr(token_budget, "_ENCODING_CACHE", {})
    monkeypatch.setattr(token_budget, "_ENCODING_RETRY_AFTER", {})

    assert token_budget.estimate_tokens("write <|endoftext|> literally", model_hint="literal-test") == 3
    assert seen == [("write <|endoftext|> literally", ())]
