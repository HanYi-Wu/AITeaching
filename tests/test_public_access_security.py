"""Regression tests for the FRP/public deployment boundary."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from solaire.web import recent_projects
from solaire.web.app import app
from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.registry import invoke_registered_tool
from solaire.web.public_access import school_request_allowed, student_request_allowed


def _public_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SOLAIRE_PUBLIC_MODE", "1")
    monkeypatch.setenv("SOLAIRE_CONTROL_TOKEN", "test-control-token")
    monkeypatch.setattr(recent_projects, "app_data_dir", lambda: tmp_path / "appdata")
    from solaire.web import public_access

    public_access.reset_login_rate_limiter()
    # Production preview proxies API traffic to FastAPI over loopback.
    return TestClient(app, client=("127.0.0.1", 50000))


def _bootstrap_admin(client: TestClient) -> str:
    response = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Admin"},
    )
    assert response.status_code == 200
    return str(response.json()["token"])


def test_cors_does_not_mirror_untrusted_origin() -> None:
    client = TestClient(app)
    response = client.options(
        "/api/project/open",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.headers.get("access-control-allow-origin") != "https://attacker.example"
    assert response.headers.get("access-control-allow-credentials") != "true"


def test_public_mode_requires_session_for_core_api(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _public_client(tmp_path, monkeypatch)

    assert client.get("/api/health").status_code == 200
    platform_status = client.get("/api/platform/status")
    assert platform_status.status_code == 200
    assert platform_status.json()["public_mode"] is True
    assert client.get("/api/project/info").status_code == 401

    token = _bootstrap_admin(client)
    response = client.get(
        "/api/project/info",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200


def test_public_mode_host_control_requires_admin_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _public_client(tmp_path, monkeypatch)
    token = _bootstrap_admin(client)
    headers = {"Authorization": f"Bearer {token}"}
    monkeypatch.setattr(
        "solaire.web.system_tools.tex_install_miktex_via_winget",
        lambda: {"ok": True},
    )

    denied = client.post("/api/system/tex-install", headers=headers)
    assert denied.status_code == 403

    allowed = client.post(
        "/api/system/tex-install",
        headers={**headers, "X-Solaire-Control-Token": "test-control-token"},
    )
    assert allowed.status_code == 200


def test_public_mode_admin_configuration_uses_admin_session_without_host_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from solaire.web import state

    client = _public_client(tmp_path, monkeypatch)
    token = _bootstrap_admin(client)
    monkeypatch.setattr(state, "get_root", lambda: tmp_path / "project")

    ai_settings = client.put(
        "/api/agent/llm-settings",
        headers={"Authorization": f"Bearer {token}"},
        json={"provider": "openai", "main_model": "gpt-4.1"},
    )
    assert ai_settings.status_code == 200

    extension_preferences = client.delete(
        "/api/system/extensions/not-a-real-id/manual-path",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert extension_preferences.status_code == 400
    assert "Local control token required" not in extension_preferences.text


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/api/agent/llm-settings", "PUT"),
        ("/api/agent/safety-mode", "PUT"),
        ("/api/system/extensions/latex/manual-path", "DELETE"),
    ],
)
def test_public_mode_teacher_cannot_change_admin_configuration(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    method: str,
) -> None:
    from solaire.web import public_access

    client = _public_client(tmp_path, monkeypatch)
    monkeypatch.setattr(
        public_access,
        "_authenticated_user",
        lambda _request: {"id": "teacher-1", "role": "teacher"},
    )

    response = client.request(method, path)
    assert response.status_code == 403
    assert response.json()["detail"] == "Administrator role required"


def test_public_login_is_rate_limited(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SOLAIRE_LOGIN_RATE_LIMIT", "2")
    client = _public_client(tmp_path, monkeypatch)

    for _ in range(2):
        response = client.post(
            "/api/auth/login",
            json={"username": "missing", "password": "wrong-password"},
        )
        assert response.status_code == 401

    blocked = client.post(
        "/api/auth/login",
        json={"username": "missing", "password": "wrong-password"},
    )
    assert blocked.status_code == 429

    other_account = client.post(
        "/api/auth/login",
        json={"username": "another-user", "password": "wrong-password"},
    )
    assert other_account.status_code == 401

    other_forwarded_client = client.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "203.0.113.25"},
        json={"username": "missing", "password": "wrong-password"},
    )
    assert other_forwarded_client.status_code == 401


def test_student_public_allowlist_keeps_session_and_exam_assets_working() -> None:
    assert student_request_allowed("/api/auth/me", "GET")
    assert student_request_allowed("/api/auth/logout", "POST")
    assert student_request_allowed("/api/student/papers", "GET")
    assert student_request_allowed("/api/resource/math/image.svg", "GET")
    assert student_request_allowed("/api/resource/math/image.png", "GET")
    assert not student_request_allowed("/api/resource/math/question.yaml", "GET")
    assert not student_request_allowed("/api/resource/math/notes.txt", "GET")
    assert not student_request_allowed("/api/bank/items", "GET")
    assert not student_request_allowed("/api/system/extensions", "GET")


def test_student_cannot_download_question_yaml(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from solaire.web import public_access, state

    resource = tmp_path / "resource" / "math"
    resource.mkdir(parents=True)
    (resource / "question.yaml").write_text("answer: SECRET_ANSWER\n", encoding="utf-8")
    (resource / "image.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    monkeypatch.setattr(state, "get_content_root", lambda: tmp_path)
    monkeypatch.setattr(
        public_access,
        "_authenticated_user",
        lambda _request: {"id": "student-1", "role": "student"},
    )
    client = _public_client(tmp_path, monkeypatch)

    denied = client.get("/api/resource/math/question.yaml")
    assert denied.status_code == 403
    assert "SECRET_ANSWER" not in denied.text

    svg = client.get("/api/resource/math/image.svg")
    assert svg.status_code == 200
    assert "sandbox" in svg.headers["content-security-policy"]


def test_school_public_allowlist_is_separate_from_teacher_workspace() -> None:
    assert school_request_allowed("/api/auth/me", "GET")
    assert school_request_allowed("/api/auth/logout", "POST")
    assert school_request_allowed("/api/school/teachers", "GET")
    assert school_request_allowed("/api/papers", "GET")
    assert school_request_allowed("/api/papers/p1/analysis", "GET")
    assert not school_request_allowed("/api/papers/p1/publish", "POST")
    assert not school_request_allowed("/api/project/info", "GET")
    assert not school_request_allowed("/api/agent/chat", "POST")


def test_public_agent_cannot_invoke_analysis_scripts_without_host_control(tmp_path: Path) -> None:
    ctx = InvocationContext(
        project_root=tmp_path,
        session_id="public-session",
        public_mode=True,
        host_control_authorized=False,
    )

    result = invoke_registered_tool(
        "analysis.save_script",
        {"name": "unsafe", "language": "python", "code": "print('ran')"},
        ctx,
    )

    assert result.status == "failed"
    assert result.error_code == "host_control_required"
