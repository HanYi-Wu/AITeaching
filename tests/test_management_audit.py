from __future__ import annotations

import secrets
import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.responses import Response
from fastapi import HTTPException

from solaire.web.management import access, audit, audit_routes
from solaire.web.platform_db import connect, init_platform_db


@pytest.fixture
def platform_root(tmp_path: Path) -> Path:
    init_platform_db(tmp_path)
    with closing(connect(tmp_path)) as con, con:
        for school_id, name in (("school-a", "学校甲"), ("school-b", "学校乙")):
            con.execute(
                "INSERT INTO schools(id,name,status,ai_enabled,created_at,updated_at) VALUES(?,?, 'active',0,'2026-01-01','2026-01-01')",
                (school_id, name),
            )
        for user_id, school_id, role, username, name in (
            ("admin-1", None, "admin", "admin", "管理员"),
            ("school-user-a", "school-a", "school", "school_a", "学校甲管理员"),
            ("school-user-b", "school-b", "school", "school_b", "学校乙管理员"),
        ):
            con.execute(
                """INSERT INTO users(id,school_id,role,username,password_hash,display_name,status,created_at,updated_at)
                   VALUES(?,?,?,?,? ,?,'active','2026-01-01','2026-01-01')""",
                (user_id, school_id, role, username, "hash-not-used", name),
            )
    return tmp_path


def _request(method: str, route_path: str, *, path_params=None, query: bytes = b"", body: bytes = b"") -> Request:
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": route_path,
            "raw_path": route_path.encode(),
            "query_string": query,
            "root_path": "",
            "headers": [(b"authorization", b"Bearer HEADER_SECRET"), (b"x-solaire-session", b"SESSION_SECRET")],
            "client": ("127.0.0.1", 1234),
            "server": ("127.0.0.1", 8000),
            "path_params": path_params or {},
            "route": SimpleNamespace(path=route_path),
        },
        receive=receive,
    )


def _insert_event(
    root: Path,
    *,
    event_id: str,
    occurred_at: str,
    actor_id: str = "school-user-a",
    actor_role: str = "school",
    actor_name: str = "学校甲管理员",
    actor_school_id: str | None = "school-a",
    school_id: str | None = "school-a",
    action: str = "school.class.create",
    outcome: str = "success",
    route_path: str = "/school/classes",
) -> None:
    with closing(connect(root)) as con, con:
        con.execute(
            """INSERT INTO management_audit_events
               (id,occurred_at,actor_id,actor_role,actor_name,actor_school_id,school_id,action,resource_type,
                resource_id,outcome,affected_count,request_id,http_status,method,route_path)
               VALUES(?,?,?,?,?,?,?,?,?,NULL,?,0,?,200,'POST',?)""",
            (event_id, occurred_at, actor_id, actor_role, actor_name, actor_school_id, school_id,
             action, "class", outcome, f"request-{event_id}", route_path),
        )


def test_request_logging_uses_whitelisted_metadata_and_omits_secrets(platform_root: Path):
    request = _request(
        "POST",
        "/api/school/classes",
        query=b"password=QUERY_SECRET&token=QUERY_TOKEN",
        body=b'{"password":"BODY_SECRET","name":"Class"}',
    )
    request.scope["route"] = SimpleNamespace(path="/api/school/classes")
    user = {"id": "school-user-a", "role": "school", "school_id": "school-a", "display_name": "学校甲管理员"}

    audit.record_request_event(platform_root, request, Response(status_code=201), user)
    # Authentication routes and reads are deliberately outside the whitelist.
    login = _request("POST", "/api/auth/login")
    login.scope["route"] = SimpleNamespace(path="/api/auth/login")
    audit.record_request_event(platform_root, login, Response(status_code=200), user)

    with closing(connect(platform_root)) as con:
        rows = con.execute("SELECT * FROM management_audit_events").fetchall()
    assert len(rows) == 1
    row = dict(rows[0])
    assert row["action"] == "school.class.create"
    assert row["school_id"] == "school-a"
    assert row["route_path"] == "/school/classes"
    assert row["outcome"] == "success"
    assert not any(secret in str(row.values()) for secret in ("HEADER_SECRET", "SESSION_SECRET", "QUERY_SECRET", "QUERY_TOKEN", "BODY_SECRET"))


def test_denied_admin_cross_school_request_is_not_attributed_to_target(platform_root: Path):
    request = _request(
        "PATCH",
        "/api/schools/school-b/school-users/user-b",
        path_params={"school_id": "school-b", "user_id": "victim-id"},
    )
    request.scope["route"] = SimpleNamespace(path="/api/schools/{school_id}/school-users/{user_id}")
    user = {"id": "admin-1", "role": "admin", "school_id": None, "display_name": "管理员"}

    audit.record_request_event(platform_root, request, Response(status_code=403), user)
    with closing(connect(platform_root)) as con:
        row = con.execute("SELECT school_id, actor_school_id, resource_id, outcome FROM management_audit_events").fetchone()
    assert tuple(row) == (None, None, None, "denied")


@pytest.mark.parametrize(("status", "outcome"), [(403, "denied"), (404, "failure")])
def test_failed_or_denied_path_token_is_not_saved_as_resource_id(
    platform_root: Path, status: int, outcome: str,
):
    token = secrets.token_urlsafe(32)
    assert audit._safe_id(token) == token
    request = _request(
        "POST",
        f"/api/school/teachers/{token}/reset-password",
        path_params={"teacher_id": token},
    )
    request.scope["route"] = SimpleNamespace(path="/api/school/teachers/{teacher_id}/reset-password")
    user = {"id": "school-user-a", "role": "school", "school_id": "school-a", "display_name": "学校甲管理员"}

    audit.record_request_event(platform_root, request, Response(status_code=status), user)

    with closing(connect(platform_root)) as con:
        row = con.execute("SELECT resource_id, outcome FROM management_audit_events").fetchone()
    assert tuple(row) == (None, outcome)
    assert token not in str(tuple(row))


def test_successful_delete_keeps_verified_target_id_traceable(platform_root: Path):
    request = _request(
        "DELETE",
        "/api/school/classes/class-123",
        path_params={"class_id": "class-123"},
    )
    request.scope["route"] = SimpleNamespace(path="/api/school/classes/{class_id}")
    user = {"id": "school-user-a", "role": "school", "school_id": "school-a", "display_name": "学校甲管理员"}

    audit.record_request_event(platform_root, request, Response(status_code=204), user)

    with closing(connect(platform_root)) as con:
        row = con.execute("SELECT resource_id, outcome FROM management_audit_events").fetchone()
    assert tuple(row) == ("class-123", "success")


def test_audit_filter_is_school_scoped_and_searches_only_safe_fields(platform_root: Path):
    _insert_event(platform_root, event_id="a1", occurred_at="2026-07-02T02:00:00.000Z")
    _insert_event(
        platform_root, event_id="b1", occurred_at="2026-07-02T03:00:00.000Z",
        actor_id="school-user-b", actor_name="学校乙管理员", actor_school_id="school-b", school_id="school-b",
    )
    result = audit.list_audit_events(platform_root, school_id="school-a", q="学校甲", page=1, page_size=10)
    assert result["total"] == 1
    assert [event["id"] for event in result["events"]] == ["a1"]
    assert result["events"][0]["action_label"] == "创建班级"
    assert result["events"][0]["school_name"] == "学校甲"


def test_school_audit_route_derives_scope_from_session_and_rejects_forged_school(platform_root: Path, monkeypatch: pytest.MonkeyPatch):
    _insert_event(platform_root, event_id="a1", occurred_at="2026-07-02T02:00:00.000Z")
    _insert_event(
        platform_root, event_id="b1", occurred_at="2026-07-02T03:00:00.000Z",
        actor_id="school-user-b", actor_name="学校乙管理员", actor_school_id="school-b", school_id="school-b",
    )
    monkeypatch.setattr(audit_routes, "require_platform_root", lambda: platform_root)
    permissions: list[tuple[str, str]] = []

    def require_permission(user, permission, root=None):
        permissions.append((str(user["id"]), permission))

    monkeypatch.setattr(access, "require_permission", require_permission)
    user = {"id": "school-user-a", "role": "school", "school_id": "school-a", "display_name": "学校甲管理员"}
    result = audit_routes.school_audit_events(user=user)
    assert [event["id"] for event in result["events"]] == ["a1"]
    assert permissions == [("school-user-a", "school.audit.read")]

    with pytest.raises(HTTPException) as error:
        audit_routes.school_audit_events(user=user, school_id="school-b")
    assert error.value.status_code == 403

    activity = audit_routes.school_management_activity(user=user, days=7)
    assert [row["school_id"] for row in activity["schools"]] == ["school-a"]
    assert permissions[-1] == ("school-user-a", "school.activity.read")
    with pytest.raises(HTTPException) as activity_error:
        audit_routes.school_management_activity(user=user, days=7, school_id="school-b")
    assert activity_error.value.status_code == 403


def test_activity_http_routes_parse_7_30_90_query_values_for_both_scopes(platform_root: Path, monkeypatch: pytest.MonkeyPatch):
    from solaire.web.auth_api import current_platform_user

    monkeypatch.setattr(audit_routes, "require_platform_root", lambda: platform_root)
    monkeypatch.setattr(access, "require_permission", lambda user, permission, root=None: None)
    session = {"user": {"id": "admin-1", "role": "admin", "school_id": None, "display_name": "管理员"}}
    app = FastAPI()
    app.include_router(audit_routes.router, prefix="/api")
    app.dependency_overrides[current_platform_user] = lambda: session["user"]
    client = TestClient(app)

    for scope, user in (
        ("admin", {"id": "admin-1", "role": "admin", "school_id": None, "display_name": "管理员"}),
        ("school", {"id": "school-user-a", "role": "school", "school_id": "school-a", "display_name": "学校甲管理员"}),
    ):
        session["user"] = user
        for days in (7, 30, 90):
            response = client.get(f"/api/{scope}/management/activity", params={"days": days})
            assert response.status_code == 200, response.text
            assert len(response.json()["days"]) == days

    session["user"] = {"id": "admin-1", "role": "admin", "school_id": None, "display_name": "管理员"}
    assert client.get("/api/admin/management/activity", params={"days": 14}).status_code == 422


def test_activity_counts_successful_whitelisted_operations_only_and_uses_shanghai_days(platform_root: Path):
    _insert_event(platform_root, event_id="boundary", occurred_at="2026-07-01T16:30:00.000Z")
    _insert_event(platform_root, event_id="failed", occurred_at="2026-07-02T01:00:00.000Z", outcome="failure")
    _insert_event(platform_root, event_id="login", occurred_at="2026-07-02T02:00:00.000Z", action="auth.login")
    _insert_event(platform_root, event_id="read", occurred_at="2026-07-02T03:00:00.000Z", action="school.teacher.list")

    result = audit.get_management_activity(platform_root, days=7, school_id="school-a", today=date(2026, 7, 2))
    assert result["timezone"] == "Asia/Shanghai"
    assert result["summary"] == {"operation_count": 1, "active_accounts": 1, "active_schools": 1}
    assert result["days"][-1] == {"date": "2026-07-02", "operation_count": 1, "active_accounts": 1}
    assert result["heatmap"]["columns"] == ["2026-06-26", "2026-06-27", "2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]
    assert result["heatmap"]["matrix"] == [[0, 0, 0, 0, 0, 0, 1]]


def test_audit_date_filter_uses_local_calendar_boundaries(platform_root: Path):
    _insert_event(platform_root, event_id="included", occurred_at="2026-07-01T16:30:00.000Z")
    _insert_event(platform_root, event_id="excluded", occurred_at="2026-07-02T16:30:00.000Z")

    result = audit.list_audit_events(platform_root, date_from="2026-07-02", date_to="2026-07-02")
    assert [event["id"] for event in result["events"]] == ["included"]


def test_activity_fills_zero_days_and_schools_and_reports_empty_coverage(platform_root: Path):
    result = audit.get_management_activity(platform_root, days=7, today=date(2026, 7, 2))
    assert len(result["days"]) == 7
    assert all(item["operation_count"] == 0 and item["active_accounts"] == 0 for item in result["days"])
    assert {row["school_id"] for row in result["heatmap"]["rows"]} == {"school-a", "school-b"}
    assert result["heatmap"]["matrix"] == [[0] * 7, [0] * 7]
    assert result["coverage"]["started_at"] is None
    assert "历史数据未纳入" in result["coverage"]["description"]


def test_audit_write_failure_does_not_escape_to_business_request(platform_root: Path, monkeypatch: pytest.MonkeyPatch):
    request = _request("POST", "/api/school/classes")
    request.scope["route"] = SimpleNamespace(path="/api/school/classes")

    def fail_connect(_root):
        raise sqlite3.OperationalError("temporary write failure")

    monkeypatch.setattr(audit, "connect", fail_connect)
    audit.record_request_event(
        platform_root,
        request,
        Response(status_code=201),
        {"id": "school-user-a", "role": "school", "school_id": "school-a", "display_name": "学校甲管理员"},
    )
