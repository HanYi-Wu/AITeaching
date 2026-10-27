from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path


_SRC = Path(__file__).resolve().parents[1] / "src"


def _run_python(code: str) -> dict[str, object]:
    env = os.environ.copy()
    old_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = os.pathsep.join(part for part in (str(_SRC), old_pythonpath) if part)
    for key in ("SOLAIRE_LLM_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"):
        env.pop(key, None)
    env.pop("EH_CONFIG_FILE", None)
    env.pop("SOLAIRE_PROJECT_ROOT", None)
    env["SOLAIRE_BIND_PROJECT_FROM_ENV"] = "0"
    env["SOLAIRE_PUBLIC_MODE"] = "0"
    with tempfile.TemporaryDirectory(prefix="solaire-startup-") as state_root:
        env["EH_DATA_ROOT"] = state_root
        result = subprocess.run(
            [sys.executable, "-c", textwrap.dedent(code)],
            cwd=_SRC.parent,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    assert result.returncode == 0, result.stderr
    output = next((line for line in reversed(result.stdout.splitlines()) if line.strip()), "{}")
    return json.loads(output)


def test_app_health_does_not_load_agent_or_provider_implementations() -> None:
    result = _run_python(
        """
        import json
        import sys
        from fastapi.testclient import TestClient
        from solaire.web.app import app

        cold = {
            "orchestrator": "solaire.agent_layer.orchestrator" in sys.modules,
            "registry": "solaire.agent_layer.registry" in sys.modules,
            "context_meter": "solaire.agent_layer.context_meter" in sys.modules,
            "openai": "openai" in sys.modules,
            "anthropic": "anthropic" in sys.modules,
        }
        with TestClient(app) as client:
            response = client.get("/api/health")
            config_response = client.get("/api/agent/config")
        after_config = {
            "orchestrator": "solaire.agent_layer.orchestrator" in sys.modules,
            "registry": "solaire.agent_layer.registry" in sys.modules,
            "openai": "openai" in sys.modules,
            "anthropic": "anthropic" in sys.modules,
        }
        print(json.dumps({
            "status": response.status_code,
            "cold": cold,
            "config_status": config_response.status_code,
            "after_config": after_config,
        }))
        """
    )

    assert result == {
        "status": 200,
        "cold": {
            "orchestrator": False,
            "registry": False,
            "context_meter": False,
            "openai": False,
            "anthropic": False,
        },
        "config_status": 200,
        "after_config": {
            "orchestrator": False,
            "registry": False,
            "openai": False,
            "anthropic": False,
        },
    }


def test_guardrails_imports_without_loading_registry_until_policy_lookup() -> None:
    result = _run_python(
        """
        import json
        import sys
        import solaire.agent_layer.guardrails as guardrails

        before_policy = "solaire.agent_layer.registry" in sys.modules
        mode = guardrails.load_safety_mode(None)
        policy = guardrails.policy_for("memory.read_index")
        print(json.dumps({
            "before_policy": before_policy,
            "mode": mode,
            "policy_risk": policy.risk.value,
            "registry_after_policy": "solaire.agent_layer.registry" in sys.modules,
        }))
        """
    )

    assert result["before_policy"] is False
    assert result["mode"] in {"allegro", "moderato", "vivace", "prestissimo"}
    assert result["policy_risk"] == "read"
    assert result["registry_after_policy"] is True


def test_first_agent_turn_uses_patchable_entrypoint_without_vendor_sdk() -> None:
    result = _run_python(
        """
        import json
        import sys
        import tempfile
        from pathlib import Path
        from fastapi.testclient import TestClient
        from solaire.web.app import app, ensure_project_layout
        from solaire.web import agent_api, state
        import solaire.agent_layer.llm.router as llm_router
        from solaire.agent_layer.llm.adapter import ChatChunk

        class StubAdapter:
            async def chat_stream(self, *args, **kwargs):
                yield ChatChunk(delta_content="stub response")
                yield ChatChunk(finish_reason="stop", usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2})

        settings = llm_router.LLMSettings(
            api_key="stub-only", base_url=None, provider="openai", main_model="stub", fast_model="stub"
        )
        llm_router.load_llm_settings = lambda *_args, **_kwargs: settings
        llm_router.ModelRouter.main = lambda self: StubAdapter()
        llm_router.ModelRouter.fast = lambda self: StubAdapter()
        stream_calls = []
        original_stream = agent_api.iter_agent_turn_sse

        def patchable_stream(*args, **kwargs):
            stream_calls.append(True)
            return original_stream(*args, **kwargs)

        agent_api.iter_agent_turn_sse = patchable_stream
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ensure_project_layout(root)
            state.set_root(root)
            agent_api.require_platform_root = lambda: root
            with TestClient(app) as client:
                response = client.post("/api/agent/chat", json={"message": "hello"})

        after_turn = {
            "orchestrator": "solaire.agent_layer.orchestrator" in sys.modules,
            "registry": "solaire.agent_layer.registry" in sys.modules,
            "openai": "openai" in sys.modules,
            "anthropic": "anthropic" in sys.modules,
        }
        print(json.dumps({
            "status": response.status_code,
            "stub_reply": "stub response" in response.text,
            "done": "event: done" in response.text,
            "entrypoint_calls": len(stream_calls),
            "after_turn": after_turn,
        }))
        """
    )

    assert result == {
        "status": 200,
        "stub_reply": True,
        "done": True,
        "entrypoint_calls": 1,
        "after_turn": {
            "orchestrator": True,
            "registry": True,
            "openai": False,
            "anthropic": False,
        },
    }


def test_package_exports_keep_attribute_and_star_imports() -> None:
    result = _run_python(
        """
        import json
        import solaire.agent_layer as agent_layer
        import solaire.agent_layer.llm as llm

        assert set(agent_layer.__all__).issubset(dir(agent_layer))
        assert set(llm.__all__).issubset(dir(llm))
        assert callable(agent_layer.invoke_registered_tool)
        assert callable(agent_layer.create_session)
        assert llm.ModelRouter.__name__ == "ModelRouter"
        agent_exports = {}
        llm_exports = {}
        exec("from solaire.agent_layer import *", agent_exports)
        exec("from solaire.agent_layer.llm import *", llm_exports)
        print(json.dumps({
            "agent_star_exports": sorted(k for k in agent_exports if not k.startswith("_")),
            "llm_star_exports": sorted(k for k in llm_exports if not k.startswith("_")),
        }))
        """
    )

    assert "invoke_registered_tool" in result["agent_star_exports"]
    assert "create_session" in result["agent_star_exports"]
    assert "AnthropicMessagesAdapter" in result["llm_star_exports"]
    assert "OpenAICompatAdapter" in result["llm_star_exports"]
    assert "ModelRouter" in result["llm_star_exports"]


def test_router_loads_only_the_selected_provider_sdk() -> None:
    for provider, expected, unexpected in (
        ("openai", "openai", "anthropic"),
        ("anthropic", "anthropic", "openai"),
    ):
        result = _run_python(
            f"""
            import asyncio
            import json
            import sys
            from solaire.agent_layer.llm import router

            assert "openai" not in sys.modules and "anthropic" not in sys.modules
            adapter = router._build_adapter(
                api_key="stub-only",
                base_url="https://provider.invalid",
                model="stub-model",
                provider={provider!r},
                reasoning_effort="high",
            )
            asyncio.run(adapter._client.close())
            print(json.dumps({{"openai": "openai" in sys.modules, "anthropic": "anthropic" in sys.modules}}))
            """
        )
        assert result[expected] is True
        assert result[unexpected] is False
