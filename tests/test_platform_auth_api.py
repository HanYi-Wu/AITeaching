"""API tests for platform bootstrap and session authentication."""

from __future__ import annotations

from fastapi.testclient import TestClient

from solaire.web import recent_projects, state
from solaire.web.app import app


def test_platform_auth_works_without_project_binding(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(state, "get_root", lambda: None)
    monkeypatch.setattr(recent_projects, "app_data_dir", lambda: tmp_path / "appdata")
    client = TestClient(app)

    r = client.get("/api/platform/status")
    assert r.status_code == 200
    assert r.json()["project_bound"] is False
    assert r.json()["admin_exists"] is False

    created = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert created.status_code == 200
    token = created.json()["token"]
    assert token

    client.post("/api/project/close")

    login = client.post("/api/auth/login", json={"username": "admin", "password": "secret123"})
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "admin"


def test_platform_status_and_admin_bootstrap(web_client: TestClient) -> None:
    r = web_client.get("/api/platform/status")
    assert r.status_code == 200
    assert r.json()["admin_exists"] is False

    created = web_client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["user"]["role"] == "admin"
    assert body["token"]
    assert web_client.get("/api/platform/status").json()["admin_exists"] is True


def test_login_me_and_logout(web_client: TestClient) -> None:
    web_client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    login = web_client.post("/api/auth/login", json={"username": "admin", "password": "secret123"})
    assert login.status_code == 200
    token = login.json()["token"]

    me = web_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["role"] == "admin"

    logout = web_client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout.status_code == 200
    assert web_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
