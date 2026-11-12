from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from solaire.web.auth_api import current_platform_user
from solaire.web.auth_service import authenticate_user, create_session, get_session_user
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.organization import create_school
from solaire.web.school.accounts import create_school_user, create_user, update_school_user
from solaire.web.school_routes import schools as school_routes


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "platform"
    init_platform_db(root)
    user = {"id": "admin-test", "role": "admin", "username": "admin", "status": "active"}
    app = FastAPI()
    app.include_router(school_routes.router, prefix="/api")
    app.dependency_overrides[current_platform_user] = lambda: user
    monkeypatch.setattr(school_routes, "require_platform_root", lambda: root)
    return TestClient(app), root, user


def _create_account(root: Path, *, school_id: str, username: str = "school-one") -> dict[str, object]:
    return create_school_user(
        root,
        school_id=school_id,
        username=username,
        password="initial-password",
        display_name="学校管理员",
        email="school@example.com",
    )


def test_school_users_list_is_scoped_searchable_paged_and_sanitized(api):
    client, root, _ = api
    school = create_school(root, name="一中")
    other_school = create_school(root, name="二中")
    first = _create_account(root, school_id=school["id"], username="school-one")
    _create_account(root, school_id=school["id"], username="other-school")
    _create_account(root, school_id=other_school["id"], username="school-other")

    response = client.get(f"/api/schools/{school['id']}/school-users", params={"q": "school-one"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["users"][0]["id"] == first["id"]
    assert payload["users"][0]["role"] == "school"
    assert "password_hash" not in payload["users"][0]
    assert "password" not in payload["users"][0]


def test_school_and_school_user_lists_support_status_filters_and_pagination(api):
    client, root, _ = api
    active_school = create_school(root, name="一中")
    disabled_school = create_school(root, name="二中")
    with connect(root) as con:
        con.execute("UPDATE schools SET status = 'disabled' WHERE id = ?", (disabled_school["id"],))

    schools = client.get("/api/schools", params={"q": "二中", "status": "disabled"})
    assert schools.status_code == 200
    assert schools.json()["total"] == 1
    assert schools.json()["schools"][0]["id"] == disabled_school["id"]

    first = _create_account(root, school_id=str(active_school["id"]), username="school-one")
    second = _create_account(root, school_id=str(active_school["id"]), username="school-two")
    third = _create_account(root, school_id=str(active_school["id"]), username="school-three")
    update_school_user(
        root,
        school_id=str(active_school["id"]),
        user_id=str(second["id"]),
        status="disabled",
    )
    disabled_accounts = client.get(
        f"/api/schools/{active_school['id']}/school-users",
        params={"status": "disabled", "page_size": 1},
    )
    assert disabled_accounts.status_code == 200
    assert disabled_accounts.json()["total"] == 1
    assert disabled_accounts.json()["users"][0]["id"] == second["id"]

    first_page = client.get(
        f"/api/schools/{active_school['id']}/school-users",
        params={"page": 1, "page_size": 1},
    ).json()
    second_page = client.get(
        f"/api/schools/{active_school['id']}/school-users",
        params={"page": 2, "page_size": 1},
    ).json()
    third_page = client.get(
        f"/api/schools/{active_school['id']}/school-users",
        params={"page": 3, "page_size": 1},
    ).json()
    assert first_page["total"] == 3
    assert first_page["total_pages"] == 3
    assert second_page["total"] == 3
    assert third_page["total"] == 3
    assert first_page["users"][0]["id"] != second_page["users"][0]["id"]
    assert {first["id"], second["id"], third["id"]} == {
        first_page["users"][0]["id"],
        second_page["users"][0]["id"],
        third_page["users"][0]["id"],
    }


def test_school_user_patch_rejects_wrong_scope_and_revokes_sessions(api):
    client, root, _ = api
    school = create_school(root, name="一中")
    other_school = create_school(root, name="二中")
    account = _create_account(root, school_id=school["id"])
    token = create_session(root, str(account["id"]))

    wrong_scope = client.patch(
        f"/api/schools/{other_school['id']}/school-users/{account['id']}",
        json={"display_name": "不应修改"},
    )
    assert wrong_scope.status_code == 404

    updated = client.patch(
        f"/api/schools/{school['id']}/school-users/{account['id']}",
        json={"username": "school-renamed", "display_name": "新名称", "email": "", "status": "disabled"},
    )
    assert updated.status_code == 200
    assert updated.json()["user"]["username"] == "school-renamed"
    assert updated.json()["user"]["display_name"] == "新名称"
    assert updated.json()["user"]["email"] is None
    assert updated.json()["user"]["status"] == "disabled"
    assert get_session_user(root, token) is None

    reenabled = client.patch(
        f"/api/schools/{school['id']}/school-users/{account['id']}",
        json={"status": "active"},
    )
    assert reenabled.status_code == 200
    assert get_session_user(root, token) is None


def test_status_change_and_password_reset_roll_back_if_session_revocation_fails(api):
    client, root, _ = api
    school = create_school(root, name="一中")
    account = _create_account(root, school_id=str(school["id"]))
    token = create_session(root, str(account["id"]))
    with connect(root) as con:
        old_hash = con.execute("SELECT password_hash FROM users WHERE id = ?", (account["id"],)).fetchone()[0]
        con.execute(
            """
            CREATE TRIGGER fail_school_session_revocation
            BEFORE UPDATE OF revoked_at ON platform_sessions
            WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
            BEGIN
              SELECT RAISE(ABORT, 'session revocation unavailable');
            END
            """
        )

    failed_disable = client.patch(
        f"/api/schools/{school['id']}/school-users/{account['id']}",
        json={"status": "disabled"},
    )
    assert failed_disable.status_code >= 400
    with connect(root) as con:
        status = con.execute("SELECT status FROM users WHERE id = ?", (account["id"],)).fetchone()[0]
        revoked_at = con.execute("SELECT revoked_at FROM platform_sessions WHERE user_id = ?", (account["id"],)).fetchone()[0]
    assert status == "active"
    assert revoked_at is None
    assert get_session_user(root, token) is not None

    failed_reset = client.post(
        f"/api/schools/{school['id']}/school-users/{account['id']}/reset-password",
        json={"password": "replacement-password"},
    )
    assert failed_reset.status_code >= 400
    with connect(root) as con:
        new_hash = con.execute("SELECT password_hash FROM users WHERE id = ?", (account["id"],)).fetchone()[0]
        revoked_at = con.execute("SELECT revoked_at FROM platform_sessions WHERE user_id = ?", (account["id"],)).fetchone()[0]
    assert new_hash == old_hash
    assert revoked_at is None
    assert get_session_user(root, token) is not None


def test_school_user_username_conflicts_are_friendly_and_reset_revokes_sessions(api):
    client, root, _ = api
    school = create_school(root, name="一中")
    first = _create_account(root, school_id=school["id"], username="school-one")
    second = _create_account(root, school_id=school["id"], username="school-two")
    conflict = client.patch(
        f"/api/schools/{school['id']}/school-users/{second['id']}",
        json={"username": "school-one"},
    )
    assert conflict.status_code == 409
    assert "用户名" in conflict.json()["detail"]

    duplicate_create = client.post(
        f"/api/schools/{school['id']}/school-users",
        json={
            "username": "school-one",
            "password": "another-password",
            "display_name": "重复账号",
        },
    )
    assert duplicate_create.status_code == 409
    assert "用户名" in duplicate_create.json()["detail"]

    token = create_session(root, str(first["id"]))
    too_short = client.post(
        f"/api/schools/{school['id']}/school-users/{first['id']}/reset-password",
        json={"password": "short"},
    )
    assert too_short.status_code == 422

    reset = client.post(
        f"/api/schools/{school['id']}/school-users/{first['id']}/reset-password",
        json={"password": "new-password"},
    )
    assert reset.status_code == 200
    assert "password" not in reset.json()["user"]
    assert "password_hash" not in reset.json()["user"]
    assert get_session_user(root, token) is None
    assert authenticate_user(root, username="school-one", password="new-password") is not None

    with connect(root) as con:
        stored_hash = con.execute("SELECT password_hash FROM users WHERE id = ?", (first["id"],)).fetchone()[0]
    assert "new-password" not in stored_hash


def test_missing_school_and_user_return_404_and_admin_role_is_required(api):
    client, root, admin = api
    missing_school = client.get("/api/schools/missing/school-users")
    assert missing_school.status_code == 404
    school = create_school(root, name="一中")
    missing_user = client.post(
        f"/api/schools/{school['id']}/school-users/missing/reset-password",
        json={"password": "new-password"},
    )
    assert missing_user.status_code == 404

    admin["role"] = "school"
    forbidden = client.get(f"/api/schools/{school['id']}/school-users")
    assert forbidden.status_code == 403


def test_school_account_endpoints_never_return_or_change_other_roles(api):
    client, root, _ = api
    school = create_school(root, name="一中")
    teacher = create_user(
        root,
        role="teacher",
        username="teacher-one",
        password="teacher-password",
        display_name="教师账号",
        school_id=str(school["id"]),
    )

    listed = client.get(f"/api/schools/{school['id']}/school-users", params={"q": "teacher-one"})
    assert listed.status_code == 200
    assert listed.json()["total"] == 0

    update = client.patch(
        f"/api/schools/{school['id']}/school-users/{teacher['id']}",
        json={"status": "disabled"},
    )
    reset = client.post(
        f"/api/schools/{school['id']}/school-users/{teacher['id']}/reset-password",
        json={"password": "replacement-password"},
    )
    assert update.status_code == 404
    assert reset.status_code == 404
    assert authenticate_user(root, username="teacher-one", password="teacher-password") is not None
