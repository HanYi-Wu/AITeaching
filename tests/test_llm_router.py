"""LLM provider routing and merge (no live API calls)."""

from __future__ import annotations

import types
from pathlib import Path

import pytest

from solaire.agent_layer.llm.anthropic_messages import AnthropicMessagesAdapter
from solaire.agent_layer.llm.llm_overrides import save_overrides_raw
from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter
from solaire.agent_layer.llm.openai_responses import OpenAIResponsesAdapter, _parse_response_output
from solaire.agent_layer.llm.router import LLMSettings, ModelRouter, load_llm_settings
from solaire.agent_layer.llm.user_llm_overrides import save_user_overrides_raw


@pytest.mark.parametrize("adapter_type", [OpenAICompatAdapter, OpenAIResponsesAdapter, AnthropicMessagesAdapter])
def test_model_clients_have_bounded_wait_and_no_hidden_paid_retries(adapter_type):
    import asyncio
    adapter = adapter_type(api_key="test-only", base_url="https://provider.example", model="test")
    try:
        assert adapter._client.max_retries == 0
        assert adapter._client.timeout.connect == 10
        assert adapter._client.timeout.read == 180
    finally:
        asyncio.run(adapter._client.close())


def test_anthropic_timeout_uses_sdk_native_type(monkeypatch):
    from solaire.agent_layer.llm import anthropic_messages
    captured = {}
    class NativeTimeout:
        def __init__(self, value, **options):
            self.value, self.options = value, options
    monkeypatch.setattr(anthropic_messages, 'Timeout', NativeTimeout)
    monkeypatch.setattr(anthropic_messages, 'DefaultAsyncHttpxClient', lambda **kw: object())
    monkeypatch.setattr(anthropic_messages, 'AsyncAnthropic', lambda **kw: captured.update(kw))
    AnthropicMessagesAdapter(api_key='test-only', base_url='https://provider.example', model='test')
    assert isinstance(captured['timeout'], NativeTimeout)
    assert captured['timeout'].options == {'connect': 10, 'write': 30, 'pool': 10}
    assert captured['max_retries'] == 0


def test_load_llm_settings_provider_project_over_user(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "u"))
    save_user_overrides_raw({"provider": "openai_compat"})
    save_overrides_raw(tmp_path, {"provider": "anthropic"})
    s = load_llm_settings(tmp_path)
    assert s.provider == "anthropic"


def test_load_llm_settings_deepseek_fills_default_base(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "u"))
    save_user_overrides_raw({"provider": "deepseek"})
    s = load_llm_settings(None)
    assert s.provider == "deepseek"
    assert s.base_url == "https://api.deepseek.com"


def test_load_llm_settings_leaves_max_tokens_unset_by_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("SOLAIRE_LLM_MAX_TOKENS", raising=False)
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "u"))
    s = load_llm_settings(tmp_path)
    assert s.max_tokens is None


def test_load_llm_settings_max_tokens_override_still_applies(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("SOLAIRE_LLM_MAX_TOKENS", "12345")
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "u"))
    s = load_llm_settings(tmp_path)
    assert s.max_tokens == 12345


def test_openai_responses_parse_usage_cached_tokens() -> None:
    """Responses API：解析 input_tokens_details.cached_tokens。"""
    u = types.SimpleNamespace(
        input_tokens=900,
        output_tokens=40,
        total_tokens=940,
        input_tokens_details=types.SimpleNamespace(cached_tokens=300),
    )
    resp = types.SimpleNamespace(output=[], incomplete_details=None, usage=u)
    _c, _r, _tc, _fr, usage = _parse_response_output(resp)
    assert usage.get("prompt_cache_hit_tokens") == 300
    assert usage.get("prompt_cache_miss_tokens") == 600


def test_model_router_adapter_by_provider() -> None:
    base = LLMSettings(
        api_key="sk-test",
        base_url=None,
        provider="openai",
        main_model="gpt-4o-mini",
        fast_model="gpt-4o-mini",
        max_tokens=1024,
    )
    r = ModelRouter(settings=base)
    assert isinstance(r.main(), OpenAIResponsesAdapter)

    r2 = ModelRouter(
        settings=LLMSettings(
            api_key="sk-test",
            base_url=None,
            provider="anthropic",
            main_model="claude-sonnet-4-20250514",
            fast_model="claude-3-5-haiku-20241022",
            max_tokens=1024,
        )
    )
    assert isinstance(r2.main(), AnthropicMessagesAdapter)

    r3 = ModelRouter(
        settings=LLMSettings(
            api_key="sk-test",
            base_url="https://example.com/v1",
            provider="openai_compat",
            main_model="x",
            fast_model="y",
            max_tokens=1024,
        )
    )
    assert isinstance(r3.main(), OpenAICompatAdapter)
    assert getattr(r3.main(), "_deepseek_compat") is False

    r4 = ModelRouter(
        settings=LLMSettings(
            api_key="sk-test",
            base_url="https://api.deepseek.com",
            provider="deepseek",
            main_model="deepseek-v4-pro",
            fast_model="deepseek-v4-flash",
            max_tokens=1024,
        )
    )
    d_ad = r4.main()
    assert isinstance(d_ad, OpenAICompatAdapter)
    assert getattr(d_ad, "_deepseek_compat") is True

    r5 = ModelRouter(
        settings=LLMSettings(
            api_key="sk-test",
            base_url="https://api.deepseek.com/v1",
            provider="openai_compat",
            main_model="x",
            fast_model="y",
            max_tokens=1024,
        )
    )
    assert getattr(r5.main(), "_deepseek_compat") is True
