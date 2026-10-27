import asyncio
from pathlib import Path
import pytest

from solaire.agent_layer import orchestrator
from solaire.agent_layer.models import SessionState


def test_idle_stream_heartbeats_without_restarting_turn_and_cancels_on_disconnect(monkeypatch, tmp_path):
    async def check():
        started = []
        stopped = asyncio.Event()

        async def run(*args, **kwargs):
            started.append(True)
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

        monkeypatch.setattr(orchestrator, "run_agent_turn", run)
        monkeypatch.setattr(orchestrator, "SSE_HEARTBEAT_SECONDS", 0.01, raising=False)
        stream = orchestrator.iter_agent_turn_sse(tmp_path, SessionState(session_id="idle-test"))
        try:
            assert await asyncio.wait_for(anext(stream), 0.3) == ": keepalive\n\n"
            assert await asyncio.wait_for(anext(stream), 0.3) == ": keepalive\n\n"
            assert len(started) == 1
        finally:
            await stream.aclose()
        assert stopped.is_set()

    asyncio.run(check())


def test_stream_preserves_events_and_finishes(monkeypatch, tmp_path):
    async def run(*args, emit, **kwargs):
        await emit("done", {"usage": {}})

    async def check():
        monkeypatch.setattr(orchestrator, "run_agent_turn", run)
        return [chunk async for chunk in orchestrator.iter_agent_turn_sse(tmp_path, SessionState(session_id="done-test"))]

    assert asyncio.run(check()) == ['event: done\ndata: {"usage": {}}\n\n']


def test_chat_response_disables_proxy_buffering(web_client, monkeypatch):
    async def run(*args, emit, **kwargs):
        await emit("done", {"usage": {}})

    monkeypatch.setattr(orchestrator, "run_agent_turn", run)
    response = web_client.post("/api/agent/chat", json={"message": "hello"})
    assert response.status_code == 200
    assert response.headers["x-accel-buffering"] == "no"
    assert "no-transform" in response.headers["cache-control"]
    assert "event: done" in response.text


@pytest.mark.parametrize("partial", [False, True])
def test_timeout_does_not_silently_repeat_paid_request(partial):
    from solaire.agent_layer.llm.adapter import ChatChunk

    class Adapter:
        async def chat_stream(self, *args, **kwargs):
            if partial:
                yield ChatChunk(delta_content="partial")
            raise TimeoutError("upstream stalled")

        async def chat(self, *args, **kwargs):
            pytest.fail("Timeout must not cause an implicit second request")

    async def emit(*args):
        pass

    with pytest.raises(TimeoutError):
        asyncio.run(orchestrator._llm_round_call(Adapter(), [], [], temperature=0, emit=emit))
