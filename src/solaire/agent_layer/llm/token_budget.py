"""Rough token counting for context budgeting."""

from __future__ import annotations

import threading
import time
from typing import Any

try:
    import tiktoken
except ImportError:
    tiktoken = None  # type: ignore


_ENCODING_RETRY_COOLDOWN_SECONDS = 60.0
_ENCODING_CACHE: dict[str, Any] = {}
_ENCODING_RETRY_AFTER: dict[str, float] = {}
_ENCODING_LOCK = threading.Lock()


def _encoding_for_model(model_hint: str) -> Any | None:
    """Resolve one cached encoder, cooling down after missing offline tables."""
    if tiktoken is None:
        return None
    cached = _ENCODING_CACHE.get(model_hint)
    if cached is not None:
        return cached
    now = time.monotonic()
    if now < _ENCODING_RETRY_AFTER.get(model_hint, 0.0):
        return None
    with _ENCODING_LOCK:
        cached = _ENCODING_CACHE.get(model_hint)
        if cached is not None:
            return cached
        now = time.monotonic()
        if now < _ENCODING_RETRY_AFTER.get(model_hint, 0.0):
            return None
        try:
            try:
                encoding = tiktoken.encoding_for_model(model_hint)
            except Exception:
                encoding = tiktoken.get_encoding("cl100k_base")
        except Exception:
            # Tables may be absent on offline or cold installs. One failed
            # download must not repeat once per message in a large context.
            _ENCODING_RETRY_AFTER[model_hint] = now + _ENCODING_RETRY_COOLDOWN_SECONDS
            return None
        _ENCODING_CACHE[model_hint] = encoding
        _ENCODING_RETRY_AFTER.pop(model_hint, None)
        return encoding


def estimate_tokens(text: str, *, model_hint: str = "gpt-4o") -> int:
    if not text:
        return 0
    enc = _encoding_for_model(model_hint)
    if enc is None:
        return max(1, len(text) // 4)
    # A literal special-token spelling in user text is still ordinary content
    # for budgeting; don't let tiktoken reject it as a protocol control token.
    return len(enc.encode(text, disallowed_special=()))


def estimate_message_tokens(message: dict[str, Any], *, model_hint: str = "gpt-4o") -> int:
    """Estimate one message without joining fields, matching the request-level count."""
    total = estimate_tokens(str(message.get("content") or ""), model_hint=model_hint)
    if tc := message.get("tool_calls"):
        total += estimate_tokens(str(tc), model_hint=model_hint)
    return total


def estimate_messages_tokens(messages: list[dict[str, Any]], *, model_hint: str = "gpt-4o") -> int:
    return sum(estimate_message_tokens(message, model_hint=model_hint) for message in messages)
