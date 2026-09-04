"""Tests for GET/PUT /api/agent/llm-settings (provider contract, persistence, masking)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from solaire.agent_layer.llm.llm_overrides import overrides_file
from solaire.agent_layer.llm.router import LLMSettings
from solaire.agent_layer.llm.adapter import ChatChunk


def test_llm_settings_get_includes_provider_and_options(web_client: TestClient) -> None:
    r = web_client.get("/api/agent/llm-settings")
    assert r.status_code == 200
    data = r.json()
    assert "provider" in data
    assert data["provider"] in {"openai", "anthropic", "openai_compat", "deepseek"}
    assert data.get("reasoning_effort") in ("high", "max")
    opts = data.get("provider_options")
    assert isinstance(opts, list)
    ids = {o["id"] for o in opts}
    assert ids == {"openai", "anthropic", "openai_compat", "deepseek"}
    assert "api_key" not in data


def test_llm_settings_put_reasoning_effort_persists(web_client: TestClient, tmp_path: Path) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"reasoning_effort": "max"})
    assert r.status_code == 200
    path = overrides_file(tmp_path)
    assert path.is_file()
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["reasoning_effort"] == "max"
    r2 = web_client.get("/api/agent/llm-settings")
    assert r2.status_code == 200
    assert r2.json().get("reasoning_effort") == "max"


def test_llm_settings_put_invalid_reasoning_effort_400(web_client: TestClient) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"reasoning_effort": "bogus"})
    assert r.status_code == 400


def test_llm_settings_put_provider_persists_to_project(web_client: TestClient, tmp_path: Path) -> None:
    r = web_client.put(
        "/api/agent/llm-settings",
        json={"provider": "deepseek", "main_model": "deepseek-v4-pro", "fast_model": "deepseek-v4-flash"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    path = overrides_file(tmp_path)
    assert path.is_file()
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["provider"] == "deepseek"
    assert raw["main_model"] == "deepseek-v4-pro"
    assert raw["fast_model"] == "deepseek-v4-flash"

    r2 = web_client.get("/api/agent/llm-settings")
    assert r2.status_code == 200
    assert r2.json()["provider"] == "deepseek"
    assert r2.json()["main_model"] == "deepseek-v4-pro"


def test_llm_settings_put_api_key_masked_in_get(web_client: TestClient) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"api_key": "sk-test-key-abcdef"})
    assert r.status_code == 200
    r2 = web_client.get("/api/agent/llm-settings")
    assert r2.status_code == 200
    body = r2.json()
    assert body["llm_configured"] is True
    assert body.get("api_key_masked") == "********cdef"
    assert "api_key" not in body


def test_llm_settings_put_invalid_provider_400(web_client: TestClient) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"provider": "not-a-provider"})
    assert r.status_code == 400


def test_agent_config_includes_provider(web_client: TestClient) -> None:
    web_client.put("/api/agent/llm-settings", json={"provider": "openai", "reasoning_effort": "max"})
    r = web_client.get("/api/agent/config")
    assert r.status_code == 200
    body = r.json()
    assert body.get("provider") == "openai"
    assert body.get("reasoning_effort") == "max"


def test_llm_settings_connection_test_reports_effective_model(
    web_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = LLMSettings(
        api_key="sk-test-secret",
        base_url="https://provider.example/v1",
        provider="openai_compat",
        main_model="main-model",
        fast_model="fast-model",
    )

    class FakeAdapter:
        async def chat_stream(self, *_args: object, **_kwargs: object):
            yield ChatChunk(delta_reasoning="thinking")
            raise AssertionError("Connection test must stop after the first model response")

    monkeypatch.setattr("solaire.web.agent_api.load_llm_settings", lambda _root: settings)
    monkeypatch.setattr("solaire.agent_layer.llm.router.ModelRouter.fast", lambda _self: FakeAdapter())

    response = web_client.post("/api/agent/llm-settings/test")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["provider"] == "openai_compat"
    assert response.json()["model"] == "fast-model"
    assert response.json()["latency_ms"] >= 0


def test_llm_settings_connection_test_rejects_missing_key(
    web_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = LLMSettings(
        api_key=None,
        base_url=None,
        provider="openai",
        main_model="main-model",
        fast_model="fast-model",
    )
    monkeypatch.setattr("solaire.web.agent_api.load_llm_settings", lambda _root: settings)

    response = web_client.post("/api/agent/llm-settings/test")

    assert response.status_code == 400
    assert "API 密钥" in response.json()["detail"]


def test_llm_settings_connection_test_sanitizes_provider_failure(
    web_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = LLMSettings(
        api_key="sk-do-not-leak",
        base_url="https://provider.example/v1",
        provider="deepseek",
        main_model="main-model",
        fast_model="fast-model",
    )

    class FailingAdapter:
        async def chat_stream(self, *_args: object, **_kwargs: object):
            raise RuntimeError("401 invalid sk-do-not-leak")
            yield  # pragma: no cover

    monkeypatch.setattr("solaire.web.agent_api.load_llm_settings", lambda _root: settings)
    monkeypatch.setattr("solaire.agent_layer.llm.router.ModelRouter.fast", lambda _self: FailingAdapter())

    response = web_client.post("/api/agent/llm-settings/test")

    assert response.status_code == 502
    assert "密钥" in response.json()["detail"]
    assert "sk-do-not-leak" not in response.text


def test_connection_timeout_has_actionable_safe_message():
    from solaire.web.agent_api import _llm_connection_error_message
    message = _llm_connection_error_message(TimeoutError())
    assert "超时" in message
    assert "服务器" in message


def test_connection_probe_closes_stream_and_client(monkeypatch):
    import asyncio
    from solaire.web import agent_api

    closed = []

    class Client:
        async def close(self):
            closed.append("client")

    class Adapter:
        _client = Client()

        async def chat_stream(self, *args, **kwargs):
            try:
                yield ChatChunk(delta_content="OK")
                await asyncio.sleep(60)
            finally:
                closed.append("stream")

    monkeypatch.setattr(agent_api.ModelRouter, "fast", lambda self: Adapter())
    monkeypatch.setattr(agent_api, "load_llm_settings", lambda root: LLMSettings(
        api_key="test-only", base_url=None, provider="deepseek", main_model="m", fast_model="f"))
    asyncio.run(agent_api.agent_llm_settings_test())
    assert closed == ["stream", "client"]
