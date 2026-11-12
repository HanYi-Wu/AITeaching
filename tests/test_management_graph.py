from __future__ import annotations

import json
from contextlib import closing
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from solaire.web import auth_api
from solaire.web.management import access_routes
from solaire.web.management.graph import build_permission_graph
from solaire.web.platform_db import connect, init_platform_db


@pytest.fixture
def platform_root(tmp_path: Path) -> Path:
    init_platform_db(tmp_path)
    with closing(connect(tmp_path)) as con, con:
        for school_id in ("school-a", "school-b"):
            con.execute(
                """INSERT INTO schools(id,name,status,ai_enabled,created_at,updated_at)
                   VALUES(?,?,'active',0,'2026-01-01','2026-01-01')""",
                (school_id, f"学校 {school_id}"),
            )
        for user_id, school_id, username, mode, status in (
            ("full-a", "school-a", "full-a", "full", "active"),
            ("custom-a", "school-a", "custom-a", "custom", "active"),
            ("custom-empty", "school-a", "custom-empty", "custom", "active"),
            ("disabled-a", "school-a", "disabled-a", "custom", "disabled"),
            ("other-school", "school-b", "other-school", "full", "active"),
        ):
            con.execute(
                """INSERT INTO users
                   (id,school_id,role,username,password_hash,display_name,status,
                    school_access_mode,created_at,updated_at)
                   VALUES(?,?,'school',?,'unused',?,?,?,'2026-01-01','2026-01-01')""",
                (user_id, school_id, username, username, status, mode),
            )
    return tmp_path


def _add_role(
    root: Path,
    *,
    role_id: str,
    school_id: str = "school-a",
    permissions: list[str],
    status: str = "active",
) -> None:
    with closing(connect(root)) as con, con:
        con.execute(
            """INSERT INTO management_roles
               (id,school_id,name,description,status,permissions_json,created_at,updated_at)
               VALUES(?,?,?,'',?,?,'2026-01-01','2026-01-01')""",
            (role_id, school_id, role_id, status, json.dumps(permissions)),
        )


def _assign(root: Path, user_id: str, role_id: str) -> None:
    with closing(connect(root)) as con, con:
        con.execute(
            "INSERT INTO management_user_roles(user_id,role_id) VALUES(?,?)",
            (user_id, role_id),
        )


def _client(root: Path, monkeypatch, user: dict) -> TestClient:
    app = FastAPI()
    app.include_router(access_routes.router, prefix="/api")
    app.dependency_overrides[auth_api.current_platform_user] = lambda: user
    monkeypatch.setattr(access_routes, "require_platform_root", lambda: root)
    return TestClient(app)


def test_school_graph_limits_custom_account_to_self_and_keeps_base_access(platform_root: Path, monkeypatch):
    _add_role(platform_root, role_id="teachers", permissions=["school.teachers.read"])
    _assign(platform_root, "custom-a", "teachers")
    client = _client(
        platform_root,
        monkeypatch,
        {"id": "custom-a", "role": "school", "school_id": "school-a"},
    )

    response = client.get("/api/school/management/permission-graph")
    graph = response.json()
    user = graph["users"][0]

    assert response.status_code == 200
    assert graph["self_only"] is True
    assert graph["school"] == {"id": "school-a", "name": "学校 school-a"}
    assert [item["id"] for item in graph["users"]] == ["custom-a"]
    assert graph["summary"]["user_count"] == 1
    assert graph["coverage"]["total_users"] == 1
    assert user["mode"] == "custom"
    assert "school.overview.read" in user["effective_permissions"]
    assert user["role_ids"] == ["teachers"]
    assert {role["id"] for role in graph["roles"]} == {"system:base", "teachers"}
    assert graph["assignments"] == [
        {"user_id": "custom-a", "role_id": "system:base", "active": True, "source": "builtin"},
        {"user_id": "custom-a", "role_id": "teachers", "active": True, "source": "assigned"},
    ]
    # School-wide role counts are intentionally absent from this self-only view.
    assert graph["roles"][0]["user_count"] == 1


def test_full_school_graph_uses_virtual_role_and_ignores_stale_links(platform_root: Path, monkeypatch):
    _add_role(platform_root, role_id="stale", permissions=["school.students.read"])
    _assign(platform_root, "full-a", "stale")
    client = _client(
        platform_root,
        monkeypatch,
        {"id": "full-a", "role": "school", "school_id": "school-a"},
    )

    response = client.get("/api/school/management/permission-graph?page=1&page_size=2")
    graph = response.json()
    full_user = next(item for item in graph["users"] if item["id"] == "full-a")
    roles_by_id = {role["id"]: role for role in graph["roles"]}

    assert response.status_code == 200
    assert graph["self_only"] is False
    assert graph["summary"]["user_count"] == 4
    assert full_user["mode"] == "full"
    assert full_user["role_ids"] == []
    assert full_user["effective_permissions"] == sorted(
        item["key"] for item in graph["catalog"]
    )
    assert roles_by_id["system:full"]["builtin"] is True
    assert roles_by_id["system:full"]["kind"] == "full"
    assert "stale" not in [edge["role_id"] for edge in graph["assignments"]]

    self_snapshot = build_permission_graph(
        platform_root, "school-a", self_user_id="full-a"
    )
    assert self_snapshot["self_only"] is True
    assert [role["id"] for role in self_snapshot["roles"]] == ["system:full"]
    assert self_snapshot["summary"]["unassigned_users"] == 0


def test_admin_graph_is_school_scoped_and_requires_admin(platform_root: Path, monkeypatch):
    wrong_role_client = _client(
        platform_root,
        monkeypatch,
        {"id": "school-user", "role": "school", "school_id": "school-a"},
    )
    forbidden = wrong_role_client.get(
        "/api/admin/schools/school-a/management/permission-graph"
    )
    assert forbidden.status_code == 403

    admin_client = _client(
        platform_root,
        monkeypatch,
        {"id": "admin", "role": "admin", "school_id": None},
    )
    response = admin_client.get(
        "/api/admin/schools/school-a/management/permission-graph?q=custom&page=2&page_size=1"
    )
    graph = response.json()
    assert response.status_code == 200
    assert graph["school"]["id"] == "school-a"
    assert graph["page"] == 2
    assert graph["page_size"] == 1
    assert graph["total"] == 2
    assert graph["total_pages"] == 2
    assert len(graph["users"]) == 1
    assert graph["users"][0]["id"] == "custom-a"
    assert graph["summary"]["user_count"] == 4
    assert graph["coverage"]["total_users"] == 4
    assert all(user["id"] != "other-school" for user in graph["users"])

    missing_school = admin_client.get(
        "/api/admin/schools/no-such-school/management/permission-graph"
    )
    assert missing_school.status_code == 404


def test_disabled_roles_accounts_and_implications_are_explicit(platform_root: Path, monkeypatch):
    _add_role(platform_root, role_id="ai", permissions=["school.ai.manage"])
    _add_role(
        platform_root,
        role_id="disabled-role",
        permissions=["school.students.read"],
        status="disabled",
    )
    _add_role(
        platform_root,
        role_id="invalid-role",
        permissions=["school.roles.manage", "school.students.read"],
    )
    _assign(platform_root, "custom-a", "ai")
    _assign(platform_root, "custom-a", "disabled-role")
    _assign(platform_root, "custom-empty", "invalid-role")
    _assign(platform_root, "disabled-a", "ai")
    client = _client(
        platform_root,
        monkeypatch,
        {"id": "full-a", "role": "school", "school_id": "school-a"},
    )

    graph = client.get("/api/school/management/permission-graph").json()
    users = {user["id"]: user for user in graph["users"]}
    roles = {role["id"]: role for role in graph["roles"]}
    assignments = {
        (edge["user_id"], edge["role_id"]): edge for edge in graph["assignments"]
    }

    assert "school.students.manage" in users["custom-a"]["effective_permissions"]
    assert "school.roles.manage" not in users["custom-empty"]["effective_permissions"]
    assert users["disabled-a"]["role_ids"] == ["ai"]
    assert users["disabled-a"]["effective_permissions"] == []
    assert roles["disabled-role"]["effective_permissions"] == []
    assert assignments[("custom-a", "disabled-role")]["active"] is False
    assert assignments[("disabled-a", "ai")]["active"] is False
    assert {"source": "school.ai.manage", "target": "school.teachers.manage"} in graph["implications"]
    assert graph["summary"]["unassigned_users"] == 1


def test_catalog_has_exact_route_pairs_and_page_limits(platform_root: Path, monkeypatch):
    client = _client(
        platform_root,
        monkeypatch,
        {"id": "admin", "role": "admin", "school_id": None},
    )
    graph = client.get(
        "/api/admin/schools/school-a/management/permission-graph?page=99&page_size=100"
    ).json()
    catalog = {item["key"]: item for item in graph["catalog"]}
    teacher_manage_routes = {
        (route["method"], route["path"])
        for route in catalog["school.teachers.manage"]["routes"]
    }
    setting_manage_routes = {
        (route["method"], route["path"])
        for route in catalog["school.settings.manage"]["routes"]
    }

    assert ("GET", "/api/school/teachers/template.xlsx") in teacher_manage_routes
    assert ("POST", "/api/school/teachers/import-file") in teacher_manage_routes
    assert ("GET", "/api/school/teachers/import-file") not in teacher_manage_routes
    assert ("PATCH", "/api/school/management/settings") in setting_manage_routes
    assert ("GET", "/api/school/management/settings") not in setting_manage_routes
    assert [menu["section"] for menu in graph["menus"]] == [
        "overview", "teachers", "classes", "students", "assignments",
        "ai", "audit", "access", "settings", "activity",
    ]
    assert graph["users"] == []
    assert graph["total"] == 4
    assert graph["coverage"]["returned_users"] == 0

    too_many = client.get(
        "/api/admin/schools/school-a/management/permission-graph?page_size=101"
    )
    assert too_many.status_code == 422


def test_role_matrix_caps_rows_and_reports_incomplete_coverage(platform_root: Path, monkeypatch):
    with closing(connect(platform_root)) as con, con:
        con.executemany(
            """INSERT INTO management_roles
               (id,school_id,name,description,status,permissions_json,created_at,updated_at)
               VALUES(?, 'school-a', ?, '', 'active', '[]', '2026-01-01','2026-01-01')""",
            [(f"role-{index:03d}", f"role-{index:03d}") for index in range(501)],
        )
    client = _client(
        platform_root,
        monkeypatch,
        {"id": "admin", "role": "admin", "school_id": None},
    )

    graph = client.get(
        "/api/admin/schools/school-a/management/permission-graph"
    ).json()

    assert graph["coverage"]["roles_truncated"] is True
    assert graph["summary"]["role_count"] == 503
    assert sum(not role["builtin"] for role in graph["roles"]) == 500


def test_schoolwide_menu_summary_counts_no_reachability_without_active_accounts(platform_root: Path, monkeypatch):
    with closing(connect(platform_root)) as con, con:
        con.execute(
            "UPDATE users SET status = 'disabled' WHERE school_id = 'school-a'"
        )
    client = _client(
        platform_root,
        monkeypatch,
        {"id": "admin", "role": "admin", "school_id": None},
    )

    graph = client.get(
        "/api/admin/schools/school-a/management/permission-graph"
    ).json()

    assert graph["summary"]["user_count"] == 4
    assert graph["summary"]["unreachable_menus"] == len(graph["menus"]) == 10
    assert all(user["effective_permissions"] == [] for user in graph["users"])


def test_graph_can_locate_a_help_link_account_by_id_without_expanding_school_scope(platform_root: Path, monkeypatch):
    with closing(connect(platform_root)) as con, con:
        con.execute("UPDATE users SET username='roster-reader', display_name='名册查看员' WHERE id='custom-a'")
    client = _client(platform_root, monkeypatch, {"id": "admin", "role": "admin", "school_id": None})
    found = client.get("/api/admin/schools/school-a/management/permission-graph", params={"q": "custom-a"})
    assert found.status_code == 200
    assert [(user["id"], user["username"]) for user in found.json()["users"]] == [("custom-a", "roster-reader")]
    assert found.json()["total"] == 1
    foreign = client.get("/api/admin/schools/school-a/management/permission-graph", params={"q": "other-school"})
    assert foreign.json()["users"] == []
