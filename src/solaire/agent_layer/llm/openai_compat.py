"""OpenAI-compatible chat (async), tools + streaming for orchestrator."""

from __future__ import annotations

import copy
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from openai import AsyncOpenAI, DefaultAsyncHttpxClient
from solaire.common.network import ai_http_options, ai_sdk_options

from solaire.agent_layer.llm.adapter import ChatChunk, ChatResponse
from solaire.agent_layer.llm.providers import ReasoningEffort


def _wire_to_canonical_tool_names() -> dict[str, str]:
    """实时从注册表构建 wire→canonical 映射，避免 lru_cache 在焦点切换后过期。"""
    from solaire.agent_layer.registry import _TOOL_BY_NAME

    return {name.replace(".", "_"): name for name in _TOOL_BY_NAME}


def _tool_name_wire_outbound(canonical: str) -> str:
    return canonical.replace(".", "_")


def _tool_name_wire_inbound(wire: str, mapping: dict[str, str] | None = None) -> str:
    if "." not in wire and "_" in wire:
        if mapping is None:
            mapping = _wire_to_canonical_tool_names()
        return mapping.get(wire, wire)
    return wire


def _apply_tool_names_wire_outbound_messages(messages: list[dict[str, Any]]) -> None:
    for m in messages:
        if m.get("role") == "tool":
            nm = m.get("name")
            if isinstance(nm, str) and "." in nm:
                m["name"] = _tool_name_wire_outbound(nm)
            continue
        if m.get("role") != "assistant":
            continue
        tcs = m.get("tool_calls")
        if not tcs:
            continue
        for tc in tcs:
            fn = tc.get("function")
            if isinstance(fn, dict):
                nm = fn.get("name")
                if isinstance(nm, str) and "." in nm:
                    fn["name"] = _tool_name_wire_outbound(nm)


def _apply_tool_names_wire_outbound_tools(tools: list[dict[str, Any]]) -> None:
    for t in tools:
        fn = t.get("function")
        if not isinstance(fn, dict):
            continue
        nm = fn.get("name")
        if isinstance(nm, str) and "." in nm:
            fn["name"] = _tool_name_wire_outbound(nm)


def _map_raw_tool_calls_inbound(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    mapping: dict[str, str] | None = None
    for tc in raw:
        fn = tc.get("function")
        if isinstance(fn, dict):
            nm = fn.get("name")
            if isinstance(nm, str):
                if "." not in nm and "_" in nm:
                    if mapping is None:
                        mapping = _wire_to_canonical_tool_names()
                    canonical = mapping.get(nm, nm)
                    if canonical != nm:
                        fn = {**fn, "name": canonical}
                        tc = {**tc, "function": fn}
        out.append(tc)
    return out


def _prepare_compat_request_payload(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None]:
    """转换工具名；只复制会被出站准备修改的容器，保留输入历史。"""
    def project_function(item: dict[str, Any]) -> dict[str, Any]:
        function = item.get("function")
        if isinstance(function, dict):
            name = function.get("name")
            if isinstance(name, str) and "." in name:
                return {**item, "function": {**function, "name": _tool_name_wire_outbound(name)}}
        return item

    projected_messages: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        if role == "tool":
            name = message.get("name")
            if isinstance(name, str) and "." in name:
                projected_messages.append({**message, "name": _tool_name_wire_outbound(name)})
            else:
                projected_messages.append(message)
        elif role == "assistant" and message.get("tool_calls"):
            calls = message["tool_calls"]
            projected_calls: list[dict[str, Any]] | None = None
            for index, call in enumerate(calls):
                projected = project_function(call)
                if projected is not call:
                    if projected_calls is None:
                        projected_calls = list(calls)
                    projected_calls[index] = projected
            reasoning = message.get("reasoning_content")
            needs_reasoning_copy = reasoning is None or not isinstance(reasoning, str)
            if projected_calls is not None:
                projected_messages.append({**message, "tool_calls": projected_calls})
            elif needs_reasoning_copy:
                # The following helper fills/normalizes this top-level field.
                # Copy that message here so request preparation stays read-only.
                projected_messages.append(dict(message))
            else:
                projected_messages.append(message)
        else:
            projected_messages.append(message)
    projected_tools = [project_function(tool) for tool in tools] if tools else None
    return projected_messages, projected_tools


@dataclass(slots=True)
class _ToolCallStreamState:
    """Collect fragmented OpenAI tool-call fields without repeated string copies."""

    call_id: str = ""
    name_parts: list[str] = field(default_factory=list)
    argument_parts: list[str] = field(default_factory=list)


def _build_compat_request(
    *,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    temperature: float,
    max_tokens: int | None,
    stream: bool = False,
) -> dict[str, Any]:
    """Compose the shared chat-completion payload used by both adapter modes."""
    req: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature}
    if stream:
        req["stream"] = True
    if max_tokens is not None:
        req["max_tokens"] = max_tokens
    if tools:
        req["tools"] = tools
        req["tool_choice"] = "auto"
    return req


from solaire.agent_layer.llm.message_utils import ensure_assistant_tool_calls_have_reasoning as _ensure_assistant_tool_calls_have_reasoning  # noqa: E501


class OpenAICompatAdapter:
    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str | None,
        model: str,
        deepseek_compat: bool = False,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> None:
        self.model = model
        self._deepseek_compat = deepseek_compat
        self._reasoning_effort: ReasoningEffort | None = reasoning_effort
        kwargs: dict[str, Any] = {}
        if api_key:
            kwargs["api_key"] = api_key
        effective_url = base_url or os.environ.get('OPENAI_BASE_URL') or 'https://api.openai.com/v1'
        kwargs['base_url'] = effective_url
        kwargs['http_client'] = DefaultAsyncHttpxClient(**ai_http_options(effective_url))
        self._client = AsyncOpenAI(**kwargs, **ai_sdk_options())

    def _apply_deepseek_openai_extensions(self, req: dict[str, Any]) -> None:
        """DeepSeek：思考模式 + 含工具调用的助手轮次须原样回传 `reasoning_content`。

        OpenAI Python SDK 在 `maybe_transform` 中按官方 TypedDict 裁剪 `messages`，会丢弃
        `reasoning_content`；请求体合并时 `extra_body`（extra_json）覆盖同名键，故在此放入
        完整 messages 副本。参见 DeepSeek 思考模式与工具调用说明。

        KV Cache 不影响 reasoning 回传：reasoning 在会话历史中按原样重放，是确定性的
        （存储时为定值），不破坏前缀匹配。详见 https://api-docs.deepseek.com/guides/kv_cache
        """
        if not self._deepseek_compat:
            return
        eb = dict(req.get("extra_body") or {})
        if "thinking" not in eb:
            eb["thinking"] = {"type": "enabled"}
        eb["messages"] = copy.deepcopy(req.get("messages") or [])
        req["extra_body"] = eb
        req.setdefault("reasoning_effort", self._reasoning_effort or "high")

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        max_tokens: int | None = None,
        stream: bool = False,
    ) -> ChatResponse:
        if stream:
            raise NotImplementedError("use chat_stream")
        messages_req, tools_req = _prepare_compat_request_payload(messages, tools)
        _ensure_assistant_tool_calls_have_reasoning(messages_req)
        req = _build_compat_request(
            model=self.model,
            messages=messages_req,
            tools=tools_req,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if tools_req:
            if not self._deepseek_compat:
                req["parallel_tool_calls"] = True
        self._apply_deepseek_openai_extensions(req)
        try:
            resp = await self._client.chat.completions.create(**req)
        except TypeError:
            if self._deepseek_compat and "reasoning_effort" in req:
                req = {k: v for k, v in req.items() if k != "reasoning_effort"}
                resp = await self._client.chat.completions.create(**req)
            else:
                raise
        choice = resp.choices[0]
        msg = choice.message
        tool_calls: list[dict[str, Any]] = []
        if msg.tool_calls:
            name_map: dict[str, str] | None = None
            for tc in msg.tool_calls:
                wire_name = tc.function.name
                if isinstance(wire_name, str) and "." not in wire_name and "_" in wire_name:
                    if name_map is None:
                        name_map = _wire_to_canonical_tool_names()
                    wire_name = name_map.get(wire_name, wire_name)
                tool_calls.append(
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": wire_name,
                            "arguments": tc.function.arguments or "{}",
                        },
                    }
                )
        usage: dict[str, int] = {}
        if resp.usage:
            usage = {
                "prompt_tokens": resp.usage.prompt_tokens or 0,
                "completion_tokens": resp.usage.completion_tokens or 0,
                "total_tokens": resp.usage.total_tokens or 0,
            }
            cache_hit = getattr(resp.usage, "prompt_cache_hit_tokens", None)
            if cache_hit is not None:
                usage["prompt_cache_hit_tokens"] = int(cache_hit or 0)
            cache_miss = getattr(resp.usage, "prompt_cache_miss_tokens", None)
            if cache_miss is not None:
                usage["prompt_cache_miss_tokens"] = int(cache_miss or 0)
        reasoning: str | None = None
        if msg is not None:
            raw_r = getattr(msg, "reasoning_content", None)
            if raw_r is None:
                raw_r = getattr(msg, "reasoning", None)
            if raw_r is not None:
                reasoning = str(raw_r)
        if tool_calls and reasoning is None:
            reasoning = ""
        return ChatResponse(
            content=msg.content,
            reasoning_content=reasoning,
            tool_calls=tool_calls,
            finish_reason=choice.finish_reason,
            usage=usage,
        )

    async def chat_stream_text(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.3,
    ):
        """Yield text deltas only (final assistant message without tools)."""
        stream = await self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            stream=True,
        )
        async for event in stream:
            if not event.choices:
                continue
            delta = event.choices[0].delta
            if delta.content:
                yield delta.content

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        max_tokens: int | None = None,
    ) -> AsyncIterator[ChatChunk]:
        """Stream completion; yields text chunks then one terminal chunk with finish_reason / tool_calls / usage."""
        messages_req, tools_req = _prepare_compat_request_payload(messages, tools)
        _ensure_assistant_tool_calls_have_reasoning(messages_req)
        req = _build_compat_request(
            model=self.model,
            messages=messages_req,
            tools=tools_req,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        if tools_req:
            if not self._deepseek_compat:
                req["parallel_tool_calls"] = True
        self._apply_deepseek_openai_extensions(req)
        try:
            if not self._deepseek_compat:
                req["stream_options"] = {"include_usage": True}
            stream = await self._client.chat.completions.create(**req)
        except TypeError:
            req.pop("stream_options", None)
            try:
                stream = await self._client.chat.completions.create(**req)
            except TypeError:
                if self._deepseek_compat and "reasoning_effort" in req:
                    req.pop("reasoning_effort", None)
                    stream = await self._client.chat.completions.create(**req)
                else:
                    raise

        tc_parts: dict[int, _ToolCallStreamState] = {}
        finish_reason: str | None = None
        usage: dict[str, int] | None = None
        reasoning_parts: list[str] = []

        async for event in stream:
            if getattr(event, "usage", None) is not None and event.usage is not None:
                u = event.usage
                usage = {
                    "prompt_tokens": getattr(u, "prompt_tokens", None) or 0,
                    "completion_tokens": getattr(u, "completion_tokens", None) or 0,
                    "total_tokens": getattr(u, "total_tokens", None) or 0,
                }
                cache_hit = getattr(u, "prompt_cache_hit_tokens", None)
                if cache_hit is not None:
                    usage["prompt_cache_hit_tokens"] = int(cache_hit or 0)
                cache_miss = getattr(u, "prompt_cache_miss_tokens", None)
                if cache_miss is not None:
                    usage["prompt_cache_miss_tokens"] = int(cache_miss or 0)
            if not event.choices:
                continue
            ch0 = event.choices[0]
            delta = ch0.delta
            if delta.content:
                yield ChatChunk(delta_content=delta.content)
            dr = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
            if dr:
                piece = str(dr)
                reasoning_parts.append(piece)
                yield ChatChunk(delta_reasoning=piece)
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = int(tc.index)
                    if idx not in tc_parts:
                        tc_parts[idx] = _ToolCallStreamState()
                    state = tc_parts[idx]
                    if getattr(tc, "id", None):
                        state.call_id = tc.id or state.call_id
                    fn = tc.function
                    if fn is not None:
                        name_fragment = getattr(fn, "name", None)
                        if name_fragment:
                            if not isinstance(name_fragment, str):
                                raise TypeError(
                                    f'can only concatenate str (not "{type(name_fragment).__name__}") to str'
                                )
                            state.name_parts.append(name_fragment)
                        if getattr(fn, "arguments", None):
                            argument_fragment = fn.arguments or ""
                            if not isinstance(argument_fragment, str):
                                raise TypeError("tool call argument fragment must be a string")
                            state.argument_parts.append(argument_fragment)
            if ch0.finish_reason:
                finish_reason = ch0.finish_reason

        assembled: list[dict[str, Any]] = []
        for idx in sorted(tc_parts.keys()):
            state = tc_parts[idx]
            arguments = "".join(state.argument_parts) or "{}"
            assembled.append(
                {
                    "id": state.call_id or f"call_{idx}",
                    "type": "function",
                    "function": {
                        "name": "".join(state.name_parts),
                        "arguments": arguments,
                    },
                }
            )

        assembled = _map_raw_tool_calls_inbound(assembled)

        raw_finish = finish_reason
        if assembled:
            fr = raw_finish or "tool_calls"
        else:
            fr = raw_finish or "stop"

        # 部分流式网关末包未带 finish_reason；若 usage 显示已达本次 max_tokens，按截断处理以便编排层续写
        if raw_finish is None and max_tokens and usage is not None:
            ct = int(usage.get("completion_tokens") or 0)
            if ct >= max_tokens:
                fr = "length"

        reasoning = "".join(reasoning_parts)
        out_reasoning = reasoning if reasoning else ("" if assembled else None)

        yield ChatChunk(
            finish_reason=fr,
            raw_tool_calls=assembled,
            usage=usage,
            accumulated_reasoning=out_reasoning,
        )
