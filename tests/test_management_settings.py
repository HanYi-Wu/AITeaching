from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from solaire.web.auth_api import current_platform_user
from solaire.web.auth_service import bootstrap_admin
from solaire.web.management import settings, settings_routes
from solaire.web.platform_db import SCHEMA_SQL, SCHEMA_VERSION, connect, init_platform_db
from solaire.web.school.accounts import create_school_user
from solaire.web.school.organization import create_school


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "platform"
    init_platform_db(root)
    first = create_school(root, name="学校一")
    second = create_school(root, name="学校二")
    admin = bootstrap_admin(root, username="admin-settings", password="test-password", display_name="管理员")
    account = create_school_user(root, school_id=first["id"], username="school-settings", password="test-password", display_name="校管理员")
    actor = dict(admin)
    app = FastAPI()
    app.include_router(settings_routes.router, prefix="/api")
    app.dependency_overrides[current_platform_user] = lambda: actor
    monkeypatch.setattr(settings_routes, "require_platform_root", lambda: root)
    return TestClient(app), root, first, second, actor, account


def test_settings_are_validated_inherited_and_can_restore_inheritance(api):
    client, root, first, second, actor, account = api
    default = client.get("/api/admin/management/settings").json()
    assert default["settings"] == {"default_page_size": 10, "activity_default_days": 30}
    assert default["inherited_settings"] == {"default_page_size": 10, "activity_default_days": 30}
    response = client.patch("/api/admin/management/settings", json={"default_page_size": 20, "activity_default_days": 7})
    assert response.status_code == 200
    assert response.json()["inherited_settings"] == {"default_page_size": 10, "activity_default_days": 30}
    assert settings.get_settings(root, school_id=first["id"])["settings"]["default_page_size"] == 20

    actor.clear()
    actor.update(account)
    response = client.patch("/api/school/management/settings", json={"default_page_size": 50})
    assert response.status_code == 200
    assert response.json()["settings"] == {"default_page_size": 50, "activity_default_days": 7}
    assert response.json()["inherited_settings"] == {"default_page_size": 20, "activity_default_days": 7}
    assert response.json()["sources"] == {"default_page_size": "school", "activity_default_days": "platform"}
    assert settings.get_settings(root, school_id=second["id"])["settings"]["default_page_size"] == 20
    reset = client.patch("/api/school/management/settings", json={"default_page_size": None})
    assert reset.json()["settings"]["default_page_size"] == 20
    assert reset.json()["overrides"]["default_page_size"] is None
    assert client.patch("/api/school/management/settings", json={"default_page_size": 500}).status_code == 422
    assert client.patch("/api/school/management/settings", json={"activity_default_days": 3}).status_code == 422
    assert client.patch("/api/school/management/settings", json={"secret": "not-a-setting"}).status_code == 422


def test_platform_defaults_restore_independently_of_school_overrides(api):
    client, root, first, _, _, _ = api
    client.patch("/api/admin/management/settings", json={"default_page_size": 20, "activity_default_days": 7})
    settings.update_settings(root, school_id=first["id"], changes={"default_page_size": 50})

    reset = client.patch("/api/admin/management/settings", json={"default_page_size": None, "activity_default_days": None})
    assert reset.status_code == 200
    assert reset.json()["settings"] == reset.json()["inherited_settings"] == {
        "default_page_size": 10, "activity_default_days": 30,
    }
    assert reset.json()["overrides"] == {"default_page_size": None, "activity_default_days": None}
    local = settings.get_settings(root, school_id=first["id"])
    assert local["settings"] == {"default_page_size": 50, "activity_default_days": 30}
    assert local["inherited_settings"] == {"default_page_size": 10, "activity_default_days": 30}


def test_dictionary_override_is_local_and_disabled_values_disappear_from_real_options(api):
    client, root, first, second, actor, account = api
    global_item = client.post("/api/admin/management/dictionaries", json={
        "category": "subjects", "value": "Math", "label": "数学（英文标识）", "sort_order": 0,
    }).json()["item"]
    actor.clear()
    actor.update(account)
    inherited = client.get("/api/school/management/dictionaries", params={"category": "subjects"}).json()
    assert any(item["value"] == "Math" and item["source"] == "platform" for item in inherited["items"])
    local = client.patch(f"/api/school/management/dictionaries/{global_item['id']}", json={"status": "disabled"})
    assert local.status_code == 200
    assert local.json()["item"]["school_id"] == first["id"]
    assert all(item["value"] != "Math" for item in client.get("/api/school/management/options").json()["subjects"])
    assert any(item["value"] == "Math" for item in settings.get_options(root, school_id=second["id"])["subjects"])
    assert any(item["value"] == "Math" for item in settings.get_options(root)["subjects"])

    other_item = settings.create_dictionary_item(root, school_id=second["id"], values={
        "category": "grades", "value": "G1", "label": "高一", "sort_order": 1,
    })
    forbidden = client.patch(f"/api/school/management/dictionaries/{other_item['id']}", json={"label": "越权"})
    assert forbidden.status_code == 404
    assert client.get("/api/admin/management/dictionaries").status_code == 403


def test_builtin_override_does_not_change_global_codes_or_existing_data(api):
    client, root, first, _, actor, account = api
    actor.clear()
    actor.update(account)
    builtin = settings.list_dictionary(root, category="grades")["items"][0]
    changed = client.patch(f"/api/school/management/dictionaries/{builtin['id']}", json={"label": "本校年级名称"})
    assert changed.status_code == 200
    assert changed.json()["item"]["value"] == builtin["value"]
    assert next(item for item in settings.list_dictionary(root, category="grades")["items"] if item["value"] == builtin["value"])["label"] == builtin["label"]
    other_builtin = settings.list_dictionary(root, category="grades")["items"][1]
    assert client.patch(f"/api/school/management/dictionaries/{other_builtin['id']}", json={"value": "another-code"}).status_code == 400
    assert client.post("/api/school/management/dictionaries", json={
        "category": "grades", "value": builtin["value"], "label": "重复",
    }).status_code == 409
    options = client.get("/api/school/management/options", params={"school_id": "some-other-school"}).json()
    assert any(item["label"] == "本校年级名称" for item in options["grades"])
    assert settings.get_options(root, school_id=first["id"])["grades"] == options["grades"]


def test_custom_account_cannot_change_settings_but_can_read_safe_options(api):
    client, root, _, _, actor, account = api
    with connect(root) as con:
        con.execute("UPDATE users SET school_access_mode='custom' WHERE id=?", (account["id"],))
    actor.clear()
    actor.update(account)
    actor["school_access_mode"] = "custom"
    assert client.get("/api/school/management/settings").status_code == 403
    assert client.patch("/api/school/management/settings", json={"default_page_size": 20}).status_code == 403
    assert client.get("/api/school/management/options").status_code == 200


def test_upgrade_keeps_existing_school_accounts_full_and_is_idempotent(tmp_path: Path):
    root = tmp_path / "legacy"
    legacy_schema = SCHEMA_SQL.replace(
        "  school_access_mode TEXT NOT NULL DEFAULT 'full' CHECK(school_access_mode IN ('full', 'custom')),\n", ""
    )
    with connect(root) as con:
        con.executescript(legacy_schema)
        con.execute("INSERT INTO schools(id,name,created_at,updated_at) VALUES ('school','旧学校','2026-01-01','2026-01-01')")
        con.execute(
            """INSERT INTO users(id,school_id,role,username,password_hash,display_name,created_at,updated_at)
               VALUES ('old-user','school','school','old-school','stored-hash','旧管理员','2026-01-01','2026-01-01')"""
        )
        con.execute("PRAGMA user_version = 17")
    init_platform_db(root)
    init_platform_db(root)
    with connect(root) as con:
        row = con.execute("SELECT school_access_mode,password_hash FROM users WHERE id='old-user'").fetchone()
        assert tuple(row) == ("full", "stored-hash")
        assert con.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert con.execute("SELECT COUNT(*) FROM management_roles").fetchone()[0] == 0
