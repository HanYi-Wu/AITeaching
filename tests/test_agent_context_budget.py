from __future__ import annotations

import copy
import random

import pytest

from solaire.agent_layer import context as context_module
from solaire.agent_layer.context import ContextManager, _sanitize_tool_chains
from solaire.agent_layer.llm import token_budget
from solaire.agent_layer.llm.token_budget import estimate_message_tokens, estimate_messages_tokens
from solaire.agent_layer.models import ChatMessage, SessionState


def test_message_token_estimate_keeps_content_and_tool_calls_separate(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, str]] = []

    def count_chars(text: str, *, model_hint: str = "gpt-4o") -> int:
        seen.append((text, model_hint))
        return len(text)

    monkeypatch.setattr(token_budget, "estimate_tokens", count_chars)
    message = {"content": ["content", "field"], "tool_calls": [{"id": "call-1"}]}
    content_text = str(message["content"])
    tool_calls_text = str(message["tool_calls"])

    assert estimate_message_tokens(message, model_hint="model-x") == len(content_text) + len(tool_calls_text)
    assert seen == [(content_text, "model-x"), (tool_calls_text, "model-x")]

    seen.clear()
    assert estimate_messages_tokens([message, {"content": None, "tool_calls": []}], model_hint="model-x") == (
        len(content_text) + len(tool_calls_text)
    )
    assert seen == [(content_text, "model-x"), (tool_calls_text, "model-x"), ("", "model-x")]


def _legacy_sanitize_tool_chains(messages: list[dict], *, start: int) -> None:
    """Reference the former sanitizer for deterministic differential coverage."""
    i = start
    while i < len(messages):
        if messages[i].get("role") != "tool":
            i += 1
            continue
        j = i - 1
        while j >= start and messages[j].get("role") == "tool":
            j -= 1
        anchor = messages[j] if j >= 0 else None
        if anchor is not None and anchor.get("role") == "assistant" and anchor.get("tool_calls"):
            i += 1
            continue
        messages.pop(i)

    i = start
    while i < len(messages):
        message = messages[i]
        if message.get("role") != "assistant" or not message.get("tool_calls"):
            i += 1
            continue
        expected_ids = {tc.get("id") for tc in message["tool_calls"] if tc.get("id")}
        j = i + 1
        while j < len(messages) and messages[j].get("role") == "tool":
            expected_ids.discard(messages[j].get("tool_call_id"))
            j += 1
        for missing_id in expected_ids:
            messages.insert(
                j,
                {
                    "role": "tool",
                    "tool_call_id": missing_id,
                    "content": '{"error": "结果已丢失，请重新调用相应工具。"}',
                },
            )
            j += 1
        i = j


def _run_sanitizer(sanitizer, source: list[dict], start: int):
    messages = copy.deepcopy(source)
    try:
        sanitizer(messages, start=start)
    except Exception as error:  # match legacy exception behavior as well as successful output
        return ("error", type(error))
    return ("ok", messages)


def test_tool_chain_sanitizer_matches_legacy_on_randomized_histories() -> None:
    rng = random.Random(9137)
    roles = ("system", "user", "assistant", "tool", "other")
    for _ in range(600):
        messages: list[dict] = []
        for _ in range(rng.randrange(0, 22)):
            role = rng.choice(roles)
            message: dict = {"role": role, "content": rng.choice((None, "", "old", "new"))}
            if role == "assistant" and rng.random() < 0.6:
                message["tool_calls"] = [
                    ({"id": f"id{rng.randrange(6)}"} if rng.random() < 0.8 else {})
                    for _ in range(rng.randrange(0, 5))
                ]
            if role == "tool":
                message["tool_call_id"] = rng.choice((None, "", f"id{rng.randrange(6)}"))
            messages.append(message)
        start = rng.randrange(0, len(messages) + 3)
        assert _run_sanitizer(_sanitize_tool_chains, messages, start) == _run_sanitizer(
            _legacy_sanitize_tool_chains, messages, start
        )


def test_tool_chain_sanitizer_inserts_missing_tool_response() -> None:
    messages = [
        {"role": "assistant", "tool_calls": [{"id": "call-present"}, {"id": "call-missing"}]},
        {"role": "tool", "tool_call_id": "call-present", "content": "ok"},
        {"role": "user", "content": "next"},
    ]

    _sanitize_tool_chains(messages, start=0)

    assert messages[1] == {"role": "tool", "tool_call_id": "call-present", "content": "ok"}
    assert messages[2] == {
        "role": "tool",
        "tool_call_id": "call-missing",
        "content": '{"error": "结果已丢失，请重新调用相应工具。"}',
    }
    assert messages[3] == {"role": "user", "content": "next"}


def test_tool_chain_sanitizer_scans_large_parallel_result_block_linearly() -> None:
    class CountingDict(dict):
        gets = 0

        def get(self, key, default=None):
            type(self).gets += 1
            return super().get(key, default)

    result_count = 1000
    calls = [
        {"id": f"call-{index}", "type": "function", "function": {"name": "read", "arguments": "{}"}}
        for index in range(result_count)
    ]
    messages = [CountingDict({"role": "assistant", "tool_calls": calls})]
    messages.extend(
        CountingDict({"role": "tool", "tool_call_id": f"call-{index}", "content": "{}"})
        for index in range(result_count)
    )

    CountingDict.gets = 0
    _sanitize_tool_chains(messages, start=0)

    assert len(messages) == result_count + 1
    assert CountingDict.gets < result_count * 10


def _simple_message_cost(message: dict) -> int:
    cost = len(str(message.get("content") or ""))
    if tool_calls := message.get("tool_calls"):
        cost += len(str(tool_calls))
    return cost


def test_build_messages_preserves_tool_stub_priority_and_oldest_segment_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(context_module, "estimate_message_tokens", _simple_message_cost)
    stub = "[较早的工具输出已折叠；如需细节请重新运行相应工具。]"
    prefix = [
        {"role": "system", "content": "system one"},
        {"role": "system", "content": "system two"},
    ]
    def tool_call(call_id: str) -> list[dict]:
        return [{"id": call_id, "type": "function", "function": {"name": "read", "arguments": "{}"}}]
    recent_chain = [
        {"role": "user", "content": "recent user"},
        {"role": "assistant", "content": "", "reasoning_content": "", "tool_calls": tool_call("recent")},
        {"role": "tool", "content": stub, "tool_call_id": "recent", "name": "read"},
        {"role": "assistant", "content": "recent answer"},
        {"role": "user", "content": "latest"},
    ]
    total_budget = sum(_simple_message_cost(message) for message in prefix + recent_chain)
    old_chain = [
        ChatMessage(role="user", content="old user"),
        ChatMessage(role="assistant", content="", tool_calls=tool_call("old")),
        ChatMessage(role="tool", content="O" * 200, tool_call_id="old", name="read"),
        ChatMessage(role="assistant", content="old answer"),
    ]
    new_chain = [
        ChatMessage(role="user", content="recent user"),
        ChatMessage(role="assistant", content="", tool_calls=tool_call("recent")),
        ChatMessage(role="tool", content="N" * 200, tool_call_id="recent", name="read"),
        ChatMessage(role="assistant", content="recent answer"),
    ]
    session = SessionState(session_id="budget-order", messages=old_chain + new_chain)
    original_session_messages = copy.deepcopy(session.messages)

    manager = ContextManager()
    manager.HISTORY_SOFT_BUDGET_TOKENS = total_budget + 1
    manager.TOKEN_BUDGET_TOTAL = total_budget
    result = manager.build_messages(
        system_prefix=prefix[0]["content"],
        system_suffix=prefix[1]["content"],
        session=session,
        user_message="latest",
    )

    assert result == prefix + recent_chain
    assert session.messages == original_session_messages
    assert [message.get("tool_call_id") for message in result if message.get("role") == "tool"] == ["recent"]


def test_build_messages_soft_fold_keeps_recent_tool_outputs_and_clears_old_reasoning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(context_module, "estimate_message_tokens", _simple_message_cost)
    session_messages: list[ChatMessage] = []
    for index in range(7):
        session_messages.extend(
            [
                ChatMessage(role="user", content=f"question-{index}"),
                ChatMessage(
                    role="assistant",
                    content="",
                    reasoning_content=f"thinking-call-{index}",
                    tool_calls=[{"id": f"call-{index}", "type": "function", "function": {"name": "read", "arguments": "{}"}}],
                ),
                ChatMessage(role="tool", tool_call_id=f"call-{index}", name="read", content=f"details-{index}"),
                ChatMessage(role="assistant", content=f"answer-{index}", reasoning_content=f"reasoning-{index}"),
            ]
        )
    session = SessionState(session_id="soft-fold", messages=session_messages)
    original_session_messages = copy.deepcopy(session.messages)
    manager = ContextManager()
    manager.HISTORY_SOFT_BUDGET_TOKENS = 0
    manager.TOKEN_BUDGET_TOTAL = 100_000

    result = manager.build_messages(
        system_prefix="system-one",
        system_suffix="system-two",
        session=session,
        user_message="continue",
    )

    tool_messages = [message for message in result if message.get("role") == "tool"]
    assert len(tool_messages) == 7
    assert tool_messages[0]["content"] == "[较早的工具输出已折叠；如需细节请重新运行相应工具。]"
    assert [message["content"] for message in tool_messages[1:]] == [f"details-{i}" for i in range(1, 7)]
    first_answer = next(message for message in result if message.get("content") == "answer-0")
    assert first_answer["reasoning_content"] == ""
    assert [message["tool_call_id"] for message in tool_messages] == [f"call-{i}" for i in range(7)]
    assert session.messages == original_session_messages


def test_build_messages_does_not_compact_at_exact_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(context_module, "estimate_message_tokens", _simple_message_cost)
    history = [ChatMessage(role="user", content="old question"), ChatMessage(role="assistant", content="old answer")]
    session = SessionState(session_id="exact-budget", messages=history)
    messages = [
        {"role": "system", "content": "system"},
        {"role": "system", "content": ""},
        {"role": "user", "content": "old question"},
        {"role": "assistant", "content": "old answer"},
        {"role": "user", "content": "latest"},
    ]
    exact_budget = sum(_simple_message_cost(message) for message in messages)
    manager = ContextManager()
    manager.HISTORY_SOFT_BUDGET_TOKENS = exact_budget + 1
    manager.TOKEN_BUDGET_TOTAL = exact_budget

    result = manager.build_messages(
        system_prefix="system", system_suffix="", session=session, user_message="latest"
    )

    assert result == messages
