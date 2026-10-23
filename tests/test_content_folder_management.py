"""Folder organization must preserve teaching files, ownership and submissions."""

from pathlib import Path

import pytest

from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class, _headers, _teacher_token


@pytest.fixture
def teacher(web_client):
    _create_school_teacher_class(web_client, _bootstrap_admin(web_client))
    return _headers(_teacher_token(web_client))


def create(client, headers, name="练习", scope="compose", parent=None, kind="category"):
    response = client.post("/api/organizer/folders", headers=headers,
                           json={"scope": scope, "name": name, "parent_id": parent, "kind": kind})
    assert response.status_code == 200, response.text
    return response.json()["folder"]


@pytest.mark.parametrize("scope", ["template", "compose", "paper"])
def test_new_folder_names_and_manual_collisions(web_client, teacher, scope):
    first = create(web_client, teacher, scope=scope)
    second = create(web_client, teacher, scope=scope)
    third = create(web_client, teacher, scope=scope)
    assert [first["name"], second["name"], third["name"]] == ["练习", "练习 (2)", "练习 (3)"]
    renamed = web_client.patch(f"/api/organizer/folders/{second['id']}", headers=teacher, json={"name": "练习"})
    assert renamed.status_code == 400
    parent = create(web_client, teacher, "其他目录", scope=scope)
    nested = create(web_client, teacher, scope=scope, parent=parent["id"])
    moved = web_client.patch(f"/api/organizer/folders/{nested['id']}", headers=teacher, json={"parent_id": None, "move": True})
    assert moved.status_code == 400
    listed = web_client.get(f"/api/organizer/folders?scope={scope}", headers=teacher).json()["folders"]
    assert next(folder for folder in listed if folder["id"] == nested["id"])["parent_id"] == parent["id"]


@pytest.mark.parametrize("scope,item", [("template", "templates/我的模板.yaml"), ("compose", "练习/数学")])
def test_delete_folder_promotes_contents_without_deleting_files(web_client, teacher, tmp_path: Path, scope, item):
    parent = create(web_client, teacher, "上级", scope)
    folder = create(web_client, teacher, "待删除", scope, parent["id"])
    child = create(web_client, teacher, "子文件夹", scope, folder["id"])
    source = tmp_path / (item if scope == "template" else f"exams/{item}/exam.yaml")
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("preserve my original content", encoding="utf-8")
    assigned = web_client.put("/api/organizer/folder-items", headers=teacher,
                             json={"scope": scope, "item_id": item, "folder_id": folder["id"]})
    assert assigned.status_code == 200
    response = web_client.delete(f"/api/organizer/folders/{folder['id']}", headers=teacher)
    assert response.status_code == 200, response.text
    assert response.json()["items"][item] == parent["id"]
    assert next(row for row in response.json()["folders"] if row["id"] == child["id"])["parent_id"] == parent["id"]
    root_deleted = web_client.delete(f"/api/organizer/folders/{parent['id']}", headers=teacher)
    assert root_deleted.status_code == 200
    assert item not in root_deleted.json()["items"]
    assert next(row for row in root_deleted.json()["folders"] if row["id"] == child["id"])["parent_id"] is None
    assert source.read_text(encoding="utf-8") == "preserve my original content"


def test_delete_rolls_back_if_promoting_child_would_create_duplicate(web_client, teacher):
    root_child = create(web_client, teacher, "子目录")
    parent = create(web_client, teacher, "上级")
    child = create(web_client, teacher, "子目录", parent=parent["id"])
    response = web_client.delete(f"/api/organizer/folders/{parent['id']}", headers=teacher)
    assert response.status_code == 400
    folders = web_client.get("/api/organizer/folders?scope=compose", headers=teacher).json()["folders"]
    assert {parent["id"], child["id"], root_child["id"]} <= {row["id"] for row in folders}
    assert next(row for row in folders if row["id"] == child["id"])["parent_id"] == parent["id"]


def test_root_category_with_paper_child_is_protected(web_client, teacher):
    parent = create(web_client, teacher, "考试", "paper")
    child = create(web_client, teacher, "练习", "paper", parent["id"], "paper")
    assert web_client.delete(f"/api/organizer/folders/{parent['id']}", headers=teacher).status_code == 400
    assert web_client.delete(f"/api/organizer/folders/{child['id']}", headers=teacher).status_code == 200
    assert web_client.delete(f"/api/organizer/folders/{parent['id']}", headers=teacher).status_code == 200


def test_folder_deletion_does_not_allow_another_owner(web_client, teacher, tmp_path):
    from solaire.web.content_organizer import delete_folder
    from solaire.web.platform_db import default_platform_root

    folder = create(web_client, teacher)
    with pytest.raises(ValueError, match="不存在或无权访问"):
        delete_folder(default_platform_root(), {"id": "another-teacher", "role": "teacher"}, folder["id"])
    folders = web_client.get("/api/organizer/folders?scope=compose", headers=teacher).json()["folders"]
    assert folder["id"] in {row["id"] for row in folders}
