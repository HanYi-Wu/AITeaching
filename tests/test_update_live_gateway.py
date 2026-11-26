"""Loopback exercise of live gateways and backends without a systemd dependency."""

import socket
import threading
import time
from contextlib import contextmanager

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from solaire.web import offline_frontend
from tools.release_verify.backend_activation import activate_backend, rollback_backend


@contextmanager
def serving(app):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="error"))
        runner = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        runner.start()
        try:
            deadline = time.monotonic() + 5
            while not server.started and runner.is_alive() and time.monotonic() < deadline:
                time.sleep(0.015)
            assert server.started
            yield port
        finally:
            server.should_exit = True
            runner.join(timeout=5)
            assert not runner.is_alive()


def test_gateway_live_mixed_release_changes_api_and_index_without_restart(monkeypatch, tmp_path):
    def make_backend(version):
        async def health(_):
            return JSONResponse({"status": "ok", "version": version})
        return Starlette(routes=[Route("/api/health", health)])

    orig = tmp_path / "original"
    orig.mkdir()
    (orig / "index.html").write_text("old index")
    releases = tmp_path / "releases"
    candidate_id = "a" * 32
    published = releases / candidate_id
    published.mkdir(parents=True)
    (published / "index.html").write_text("new index")
    monkeypatch.setattr(offline_frontend, "ROOT", orig)
    monkeypatch.setattr(offline_frontend, "FRONTEND_RELEASE_STORE", releases)
    monkeypatch.setattr(offline_frontend, "BACKEND_RELEASE_STORE", releases)
    with serving(make_backend("1.7.4")) as old, serving(make_backend("1.7.5")) as new:
        monkeypatch.setattr(offline_frontend, "BACKEND", f"http://127.0.0.1:{old}")
        monkeypatch.setattr(offline_frontend, "BACKEND_STANDBY", f"http://127.0.0.1:{new}")
        with serving(offline_frontend.app) as gateway, httpx.Client(base_url=f"http://127.0.0.1:{gateway}", trust_env=False) as browser:
            assert browser.get("/api/health").json()["version"] == "1.7.4"
            assert browser.get("/").text == "old index"
            duration = activate_backend(releases, expected_slot="primary", next_slot="standby", next_version="1.7.5",
                next_port=new, gateway_port=gateway, schema_unchanged=True,
                previous_version="1.7.4", package_id=candidate_id,
                frontend={"package_id": candidate_id, "version": "1.7.5", "previous": None})
            assert duration < 60
            assert browser.get("/api/health").json()["version"] == "1.7.5"
            assert browser.get("/").text == "new index"
            assert httpx.get(f"http://127.0.0.1:{old}/api/health", trust_env=False).status_code == 200
            rollback_backend(releases, package_id=candidate_id, primary_port=old, standby_port=new, gateway_port=gateway)
            assert browser.get("/api/health").json()["version"] == "1.7.4"
            assert browser.get("/").text == "old index"
