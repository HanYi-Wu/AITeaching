import asyncio

import httpx
import pytest

from solaire.web import offline_frontend
from solaire.web.backend_release import backend_slot
from solaire.web.frontend_release import frontend_snapshot
from tools.release_verify import backend_activation


@pytest.mark.parametrize("compatible, gateway_healthy", [(True, True), (True, False), (False, True)])
def test_activation_gates_switch_and_restores_pointer_on_gateway_failure(monkeypatch, tmp_path, compatible, gateway_healthy):
    attempts = []

    def health(port, version, deadline):
        attempts.append((port, backend_slot(tmp_path)))
        assert version == "1.7.5"
        if port == 8002 and not gateway_healthy:
            raise ValueError("gateway health failed")

    monkeypatch.setattr(backend_activation, "_check_api", health)
    kwargs = dict(expected_slot="primary", next_slot="standby", next_version="1.7.5",
                  next_port=8001, gateway_port=8002, schema_unchanged=compatible)
    if compatible and gateway_healthy:
        assert backend_activation.activate_backend(tmp_path, **kwargs) < 60
        assert backend_slot(tmp_path) == "standby"
    else:
        with pytest.raises(ValueError):
            backend_activation.activate_backend(tmp_path, **kwargs)
        assert backend_slot(tmp_path) == "primary"
    assert attempts == ([(8001, "primary"), (8002, "standby")] if compatible else [])


def test_gateway_switch_keeps_inflight_request_on_previous_backend(monkeypatch, tmp_path):
    monkeypatch.setattr(offline_frontend, "BACKEND_RELEASE_STORE", tmp_path)
    monkeypatch.setattr(offline_frontend, "BACKEND", "http://127.0.0.1:8000")
    monkeypatch.setattr(offline_frontend, "BACKEND_STANDBY", "http://127.0.0.1:8001")
    monkeypatch.setattr(offline_frontend, "_DRAIN_TOKEN", "test-private-drain-token")

    class Body(httpx.AsyncByteStream):
        def __init__(self, value):
            self.value = value

        async def __aiter__(self):
            yield self.value

    async def exercise():
        entered, finish = asyncio.Event(), asyncio.Event()

        async def upstream(request):
            if request.url.path == "/api/slow":
                entered.set()
                await finish.wait()
            return httpx.Response(200, stream=Body(str(request.url.port).encode()))

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as backend:
            monkeypatch.setattr(offline_frontend.app.state, "client", backend, raising=False)
            transport = httpx.ASGITransport(app=offline_frontend.app, client=("127.0.0.1", 4321))
            async with httpx.AsyncClient(transport=transport, base_url="http://local") as client:
                old = asyncio.create_task(client.get("/api/slow"))
                await asyncio.wait_for(entered.wait(), timeout=2)
                try:
                    backend_activation._set_slot(tmp_path, "standby")
                    assert (await client.get("/api/fast")).text == "8001"
                    assert (await client.get("/_eh_backend_drain")).status_code == 404
                    state = await client.get("/_eh_backend_drain", headers={"X-EH-Drain-Token": "test-private-drain-token"})
                    assert state.json() == {"active_slot": "standby", "inflight": {"primary": 1, "standby": 0}}
                finally:
                    finish.set()
                assert (await old).text == "8000"
                state = await client.get("/_eh_backend_drain", headers={"X-EH-Drain-Token": "test-private-drain-token"})
                assert state.json()["inflight"]["primary"] == 0

    asyncio.run(exercise())


@pytest.mark.parametrize("frontend_healthy", [True, False])
def test_combined_update_publishes_and_restores_both_routes(monkeypatch, tmp_path, frontend_healthy):
    old, new = "a" * 32, "b" * 32
    for identity in (old, new):
        release = tmp_path / identity
        release.mkdir()
        (release / "index.html").write_text(identity)
    before = {"package_id": old, "version": "1.7.4", "backend_slot": "primary"}
    backend_activation._write_pointer(tmp_path, before)
    next_metadata = {"package_id": new, "version": "1.7.5", "previous": {"package_id": old, "version": "1.7.4"}}

    def check_api(port, *_):
        live, _ = frontend_snapshot(tmp_path)
        assert (backend_slot(tmp_path), live[1]) == (("primary", old) if port == 8001 else ("standby", new))

    def check_frontend(*_):
        if not frontend_healthy:
            raise ValueError("frontend identity mismatch")

    monkeypatch.setattr(backend_activation, "_check_api", check_api)
    monkeypatch.setattr(backend_activation, "_check_frontend", check_frontend)
    args = dict(expected_slot="primary", next_slot="standby", next_version="1.7.5", next_port=8001,
                gateway_port=8080, schema_unchanged=True, frontend=next_metadata)
    if frontend_healthy:
        backend_activation.activate_backend(tmp_path, **args)
        assert backend_slot(tmp_path) == "standby"
        assert frontend_snapshot(tmp_path)[0][1] == new
    else:
        with pytest.raises(ValueError, match="frontend identity"):
            backend_activation.activate_backend(tmp_path, **args)
        active, fallback = frontend_snapshot(tmp_path)
        assert backend_slot(tmp_path) == "primary"
        assert active[1] == old and fallback[1] == new
