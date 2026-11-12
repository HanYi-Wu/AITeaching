from __future__ import annotations

from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from solaire.web import auth_api
from solaire.web.management import access, access_routes
from solaire.web.platform_db import connect, init_platform_db


@pytest.fixture
def platform_root(tmp_path: Path) -> Path:
    init_platform_db(tmp_path)
    with closing(connect(tmp_path)) as con, con:
        for school_id in ("school-a", "school-b"):
            con.execute(
                "INSERT INTO schools(id,name,status,ai_enabled,created_at,updated_at) VALUES(?,?,'active',0,'2026-01-01','2026-01-01')",
                (school_id, school_id),
            )
        for user_id, school_id, username, mode in (
            ("school-full", "school-a", "school-full", "full"),
            ("school-custom", "school-a", "school-custom", "custom"),
            ("school-export", "school-a", "school-export", "custom"),
            ("school-other", "school-b", "school-other", "full"),
        ):
            con.execute(
                """INSERT INTO users
                   (id,school_id,role,username,password_hash,display_name,status,school_access_mode,created_at,updated_at)
                   VALUES(?,?,'school',?,'unused','学校管理员','active',?,'2026-01-01','2026-01-01')""",
                (user_id, school_id, username, mode),
            )
    return tmp_path


def _add_role(
    root: Path,
    *,
    role_id: str,
    school_id: str,
    permissions: list[str],
    status: str = "active",
) -> None:
    import json

    with closing(connect(root)) as con, con:
        con.execute(
            """INSERT INTO management_roles
               (id,school_id,name,description,status,permissions_json,created_at,updated_at)
               VALUES(?,?,?,'',?,?, '2026-01-01','2026-01-01')""",
            (role_id, school_id, role_id, status, json.dumps(permissions)),
        )


def _assign_role(root: Path, user_id: str, role_id: str) -> None:
    with closing(connect(root)) as con, con:
        con.execute("INSERT INTO management_user_roles(user_id,role_id) VALUES(?,?)", (user_id, role_id))


def _route_request(method: str, path: str, *, route_path: str | None = None) -> Request:
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(
        {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
            "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "",
            "headers": [], "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80),
            "route": SimpleNamespace(path=route_path or path),
        },
        receive=receive,
    )


def test_legacy_school_account_defaults_to_full_access(platform_root: Path):
    from solaire.web.auth_service import _public_user

    with closing(connect(platform_root)) as con:
        row = con.execute("SELECT * FROM users WHERE id='school-full'").fetchone()
    user = _public_user(dict(row))
    access_payload = access.get_management_access(platform_root, user)

    assert user["school_access_mode"] == "full"
    assert access_payload["full_access"] is True
    assert "school.students.manage" in access_payload["effective_permissions"]
    assert "school.roles.manage" in access_payload["effective_permissions"]


def test_auth_user_payload_contains_live_school_access(platform_root: Path):
    payload = auth_api._with_management_permissions(
        platform_root,
        {"id": "school-custom", "role": "school", "school_id": "school-a", "school_access_mode": "full"},
    )

    assert payload["school_access_mode"] == "custom"
    assert payload["management_permissions"] == sorted(access.BASE_PERMISSIONS)


def test_custom_access_fails_closed_and_disabled_role_takes_effect_immediately(platform_root: Path):
    user = {"id": "school-custom", "role": "school", "school_id": "school-a"}
    empty = access.get_management_access(platform_root, user)
    assert empty["effective_permissions"] == sorted(access.BASE_PERMISSIONS)

    _add_role(platform_root, role_id="teachers", school_id="school-a", permissions=["school.teachers.read"])
    _assign_role(platform_root, "school-custom", "teachers")
    with_teacher_read = access.get_management_access(platform_root, user)
    assert "school.teachers.read" in with_teacher_read["effective_permissions"]

    with closing(connect(platform_root)) as con, con:
        con.execute("UPDATE management_roles SET status='disabled' WHERE id='teachers'")
    after_disable = access.get_management_access(platform_root, user)
    assert "school.teachers.read" not in after_disable["effective_permissions"]
    assert after_disable["effective_permissions"] == sorted(access.BASE_PERMISSIONS)


def test_ai_management_also_grants_the_roster_scopes_it_uses(platform_root: Path):
    _add_role(platform_root, role_id="ai", school_id="school-a", permissions=["school.ai.manage"])
    _assign_role(platform_root, "school-custom", "ai")
    effective = set(access.get_management_access(
        platform_root, {"id": "school-custom", "role": "school", "school_id": "school-a"}
    )["effective_permissions"])

    assert {
        "school.ai.read",
        "school.teachers.manage",
        "school.classes.manage",
        "school.students.manage",
        "school.assignments.manage",
        "school.teachers.read",
        "school.classes.read",
    } <= effective


def test_role_routes_reject_system_permissions_and_hide_cross_school_targets(platform_root: Path, monkeypatch):
    app = FastAPI()
    app.include_router(access_routes.router, prefix="/api")
    school_admin = {"id": "school-full", "role": "school", "school_id": "school-a"}
    app.dependency_overrides[auth_api.current_platform_user] = lambda: school_admin
    monkeypatch.setattr(access_routes, "require_platform_root", lambda: platform_root)
    client = TestClient(app)

    invalid = client.post(
        "/api/school/management/roles",
        json={"name": "非法授权", "permissions": ["school.roles.manage"]},
    )
    cross_school = client.get("/api/school/management/users/school-other/access")

    assert invalid.status_code == 400
    assert cross_school.status_code == 404


def test_full_school_admin_cannot_remove_own_full_access(platform_root: Path, monkeypatch):
    app = FastAPI()
    app.include_router(access_routes.router, prefix="/api")
    school_admin = {"id": "school-full", "role": "school", "school_id": "school-a"}
    app.dependency_overrides[auth_api.current_platform_user] = lambda: school_admin
    monkeypatch.setattr(access_routes, "require_platform_root", lambda: platform_root)
    client = TestClient(app)

    response = client.patch(
        "/api/school/management/users/school-full/access",
        json={"mode": "custom", "role_ids": []},
    )

    assert response.status_code == 400
    with closing(connect(platform_root)) as con:
        mode = con.execute("SELECT school_access_mode FROM users WHERE id='school-full'").fetchone()[0]
    assert mode == "full"


def test_school_admin_can_assign_only_same_school_custom_roles(platform_root: Path, monkeypatch):
    app = FastAPI()
    app.include_router(access_routes.router, prefix="/api")
    school_admin = {"id": "school-full", "role": "school", "school_id": "school-a"}
    app.dependency_overrides[auth_api.current_platform_user] = lambda: school_admin
    monkeypatch.setattr(access_routes, "require_platform_root", lambda: platform_root)
    client = TestClient(app)

    created = client.post(
        "/api/school/management/roles",
        json={"name": "教师浏览", "permissions": ["school.teachers.read"]},
    )
    role_id = created.json()["role"]["id"]
    assigned = client.patch(
        "/api/school/management/users/school-custom/access",
        json={"mode": "custom", "role_ids": [role_id]},
    )

    assert created.status_code == 201
    assert assigned.status_code == 200
    assert assigned.json()["access"]["full_access"] is False
    assert "school.teachers.read" in assigned.json()["access"]["effective_permissions"]


def test_legacy_school_route_guard_blocks_custom_and_allows_full(platform_root: Path, monkeypatch):
    from solaire.web import school_api
    from solaire.web.school_routes import accounts

    app = FastAPI()
    app.include_router(school_api.router, prefix="/api")
    user = {"id": "school-custom", "role": "school", "school_id": "school-a"}
    app.dependency_overrides[auth_api.current_platform_user] = lambda: user
    monkeypatch.setattr(auth_api, "require_platform_root", lambda: platform_root)
    monkeypatch.setattr(accounts, "require_platform_root", lambda: platform_root)
    client = TestClient(app)

    denied = client.get("/api/school/teachers")
    user.update({"id": "school-full"})
    allowed = client.get("/api/school/teachers")

    assert denied.status_code == 403
    assert allowed.status_code == 200


def test_readonly_student_list_hides_password_but_full_and_export_access_keep_it(platform_root: Path, monkeypatch):
    from solaire.web import school_api
    from solaire.web.school_routes import accounts

    with closing(connect(platform_root)) as con, con:
        con.execute(
            """INSERT INTO students
               (id,school_id,user_id,student_no,display_name,email,initial_password,status,created_at,updated_at)
               VALUES('student-a','school-a',NULL,'S-001','学生甲',NULL,'known-initial-password','active','2026-01-01','2026-01-01')"""
        )
    _add_role(platform_root, role_id="student-read", school_id="school-a", permissions=["school.students.read"])
    _assign_role(platform_root, "school-custom", "student-read")
    _add_role(platform_root, role_id="student-export", school_id="school-a", permissions=["school.students.export"])
    _assign_role(platform_root, "school-export", "student-export")

    app = FastAPI()
    app.include_router(school_api.router, prefix="/api")
    user = {"id": "school-custom", "role": "school", "school_id": "school-a"}
    app.dependency_overrides[auth_api.current_platform_user] = lambda: user
    monkeypatch.setattr(auth_api, "require_platform_root", lambda: platform_root)
    monkeypatch.setattr(accounts, "require_platform_root", lambda: platform_root)
    client = TestClient(app)

    readonly = client.get("/api/school/students")
    user.update({"id": "school-full"})
    full = client.get("/api/school/students")
    user.update({"id": "school-export"})
    export_only = client.get("/api/school/students")

    assert readonly.status_code == 200
    assert readonly.json()["students"][0]["initial_password"] is None
    assert full.status_code == 200
    assert full.json()["students"][0]["initial_password"] == "known-initial-password"
    assert export_only.status_code == 200
    assert export_only.json()["students"][0]["initial_password"] == "known-initial-password"


def test_ai_chat_needs_roster_capable_ai_permission(platform_root: Path, monkeypatch):
    monkeypatch.setattr(auth_api, "require_platform_root", lambda: platform_root)
    _add_role(platform_root, role_id="ai-read", school_id="school-a", permissions=["school.ai.read"])
    _assign_role(platform_root, "school-custom", "ai-read")
    user = {"id": "school-custom", "role": "school", "school_id": "school-a"}

    with pytest.raises(HTTPException) as error:
        access.management_route_guard(_route_request("POST", "/api/school/ai/chat"), user)

    assert error.value.status_code == 403


def test_report_exports_require_export_permission(platform_root: Path, monkeypatch):
    monkeypatch.setattr(auth_api, "require_platform_root", lambda: platform_root)
    _add_role(platform_root, role_id="reports", school_id="school-a", permissions=["school.reports.read"])
    _assign_role(platform_root, "school-custom", "reports")
    user = {"id": "school-custom", "role": "school", "school_id": "school-a"}

    access.management_route_guard(
        _route_request("GET", "/api/papers/paper-1/analysis", route_path="/api/papers/{paper_id}/analysis"), user
    )
    with pytest.raises(HTTPException) as error:
        access.management_route_guard(
            _route_request("GET", "/api/papers/paper-1/analysis.xlsx", route_path="/api/papers/{paper_id}/analysis.xlsx"),
            user,
        )

    assert error.value.status_code == 403
