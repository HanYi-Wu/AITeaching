from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from solaire.web import analysis_folders


def test_analysis_folder_crud_and_batch_assignment_are_annotation_only(tmp_path: Path) -> None:
    root = tmp_path / "project"
    state = analysis_folders.read(root, owner_id="teacher-a")
    assert state == {"version": 1, "folders": [], "items": {}}

    created = analysis_folders.mutate(
        root,
        owner_id="teacher-a",
        action="create",
        name="阶段复习",
    )
    folder_id = created["folders"][0]["id"]
    assigned = analysis_folders.mutate(
        root,
        owner_id="teacher-a",
        action="assign",
        folder_id=folder_id,
        ids=["paper:online-1", "exam:期末/数学"],
        visible_item_ids={"paper:online-1", "exam:期末/数学"},
    )
    assert assigned["items"] == {
        "paper:online-1": folder_id,
        "exam:期末/数学": folder_id,
    }

    renamed = analysis_folders.mutate(
        root,
        owner_id="teacher-a",
        action="rename",
        folder_id=folder_id,
        name="考前复习",
    )
    assert renamed["folders"] == [{"id": folder_id, "name": "考前复习"}]

    removed = analysis_folders.mutate(
        root,
        owner_id="teacher-a",
        action="delete",
        folder_id=folder_id,
    )
    assert removed["folders"] == []
    assert removed["items"] == {}
    assert not (root / "exams").exists()


def test_analysis_folder_assignment_is_all_or_nothing_and_limited(tmp_path: Path) -> None:
    root = tmp_path / "project"
    created = analysis_folders.mutate(root, owner_id="teacher-a", action="create", name="Folder")
    folder_id = created["folders"][0]["id"]

    with pytest.raises(ValueError, match="不属于当前教师与项目"):
        analysis_folders.mutate(
            root,
            owner_id="teacher-a",
            action="assign",
            folder_id=folder_id,
            ids=["paper:owned", "exam:other-teacher"],
            visible_item_ids={"paper:owned"},
        )
    assert analysis_folders.read(root, owner_id="teacher-a")["items"] == {}

    with pytest.raises(ValueError, match="1 至 200"):
        analysis_folders.mutate(
            root,
            owner_id="teacher-a",
            action="assign",
            folder_id=folder_id,
            ids=[f"paper:{index}" for index in range(201)],
            visible_item_ids={f"paper:{index}" for index in range(201)},
        )
    with pytest.raises(ValueError, match="文件夹名称"):
        analysis_folders.mutate(root, owner_id="teacher-a", action="create", name="../outside")
    with pytest.raises(ValueError, match="分析记录编号"):
        analysis_folders.mutate(
            root,
            owner_id="teacher-a",
            action="assign",
            folder_id=folder_id,
            ids=["paper:../outside"],
            visible_item_ids={"paper:../outside"},
        )


def test_analysis_folder_limits_prevent_excess_folders_and_assignments(tmp_path: Path) -> None:
    root = tmp_path / "project"
    path = analysis_folders._storage_paths(root, "teacher-a")[1]
    path.parent.mkdir(parents=True)
    folders = [
        {"id": f"{index:032x}", "name": f"folder-{index}"}
        for index in range(analysis_folders.MAX_FOLDERS)
    ]
    folder_id = folders[0]["id"]
    path.write_text(json.dumps({"version": 1, "folders": folders, "items": {}}), encoding="utf-8")
    with pytest.raises(ValueError, match="文件夹数量已达上限"):
        analysis_folders.mutate(root, owner_id="teacher-a", action="create", name="one-too-many")

    items = {f"paper:p{index}": folder_id for index in range(analysis_folders.MAX_ITEMS)}
    path.write_text(json.dumps({"version": 1, "folders": folders, "items": items}), encoding="utf-8")
    with pytest.raises(ValueError, match="归类记录数量已达上限"):
        analysis_folders.mutate(
            root,
            owner_id="teacher-a",
            action="assign",
            folder_id=folder_id,
            ids=["paper:new"],
            visible_item_ids={"paper:new"},
        )
    assert analysis_folders.read(root, owner_id="teacher-a")["items"] == items


def test_analysis_folder_files_are_isolated_by_teacher_and_project(tmp_path: Path) -> None:
    first_project = tmp_path / "first"
    second_project = tmp_path / "second"
    first = analysis_folders.mutate(first_project, owner_id="teacher-a", action="create", name="A")

    assert analysis_folders.read(first_project, owner_id="teacher-b")["folders"] == []
    assert analysis_folders.read(second_project, owner_id="teacher-a")["folders"] == []
    path = first_project / ".solaire" / "analysis-folders" / (
        hashlib.sha256(b"teacher-a").hexdigest() + ".json"
    )
    assert path.is_file()
    assert first["folders"][0]["name"] == "A"


def test_bad_analysis_folder_file_is_not_reset_or_overwritten(tmp_path: Path) -> None:
    root = tmp_path / "project"
    path = analysis_folders._storage_paths(root, "teacher-a")[1]
    path.parent.mkdir(parents=True)
    path.write_text("{broken", encoding="utf-8")

    with pytest.raises(analysis_folders.AnalysisFoldersCorruptError):
        analysis_folders.read(root, owner_id="teacher-a")
    assert path.read_text(encoding="utf-8") == "{broken"

    path.write_text("{}" * (analysis_folders.MAX_FILE_BYTES // 2 + 1), encoding="utf-8")
    with pytest.raises(analysis_folders.AnalysisFoldersCorruptError, match="大小限制"):
        analysis_folders.read(root, owner_id="teacher-a")


def test_atomic_write_failure_preserves_previous_analysis_folder_state(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "project"
    before = analysis_folders.mutate(root, owner_id="teacher-a", action="create", name="Keep")

    def fail_write(_path: Path, _text: str) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(analysis_folders, "write_text_atomic", fail_write)
    with pytest.raises(OSError, match="disk full"):
        analysis_folders.mutate(root, owner_id="teacher-a", action="create", name="Discard")
    assert analysis_folders.read(root, owner_id="teacher-a") == before


def test_analysis_folder_storage_rejects_symlinked_directory(tmp_path: Path) -> None:
    root = tmp_path / "project"
    outside = tmp_path / "outside"
    outside.mkdir()
    storage = root / ".solaire" / "analysis-folders"
    storage.parent.mkdir(parents=True)
    try:
        storage.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("directory symlinks are unavailable")

    with pytest.raises(ValueError, match="存储路径无效"):
        analysis_folders.read(root, owner_id="teacher-a")


def test_analysis_folder_api_requires_teacher_and_isolates_teacher_annotations(web_client, monkeypatch, tmp_path: Path) -> None:
    from solaire.web.auth_api import current_platform_user
    from solaire.web.routers import analysis as analysis_router

    unauthorized = web_client.get("/api/analysis/folders")
    assert unauthorized.status_code == 401

    current_user = {"id": "teacher-a", "role": "teacher"}
    monkeypatch.setitem(web_client.app.dependency_overrides, current_platform_user, lambda: current_user)
    project_root = tmp_path / "active-project"
    platform_root = tmp_path / "platform"
    monkeypatch.setattr(analysis_router, "require_content_project_root", lambda: project_root)
    monkeypatch.setattr(analysis_router, "require_platform_root", lambda: platform_root)
    monkeypatch.setattr(
        analysis_router,
        "visible_analysis_item_ids",
        lambda _project, _platform, *, owner_id: {"paper:owned-a"} if owner_id == "teacher-a" else {"paper:owned-b"},
    )

    created_a = web_client.post(
        "/api/analysis/folders",
        json={"action": "create", "name": "Private"},
    )
    assert created_a.status_code == 200
    folder_a = created_a.json()["folders"][0]["id"]
    assigned_a = web_client.post(
        "/api/analysis/folders",
        json={"action": "assign", "folder_id": folder_a, "ids": ["paper:owned-a"]},
    )
    assert assigned_a.status_code == 200
    assert assigned_a.json()["items"] == {"paper:owned-a": folder_a}

    current_user = {"id": "teacher-b", "role": "teacher"}
    listed_b = web_client.get("/api/analysis/folders")
    assert listed_b.status_code == 200
    assert listed_b.json()["folders"] == []
    created_b = web_client.post(
        "/api/analysis/folders",
        json={"action": "create", "name": "Own"},
    )
    assert created_b.status_code == 200
    folder_b = created_b.json()["folders"][0]["id"]
    rejected = web_client.post(
        "/api/analysis/folders",
        json={"action": "assign", "folder_id": folder_b, "ids": ["paper:owned-a"]},
    )
    assert rejected.status_code == 400
    assert "未应用变更" in rejected.json()["detail"]
    assert analysis_folders.read(project_root, owner_id="teacher-a")["items"] == {"paper:owned-a": folder_a}
    assert analysis_folders.read(project_root, owner_id="teacher-b")["items"] == {}


def test_analysis_folder_api_rejects_non_teacher(web_client, monkeypatch) -> None:
    from solaire.web.auth_api import current_platform_user

    monkeypatch.setitem(
        web_client.app.dependency_overrides,
        current_platform_user,
        lambda: {"id": "admin-a", "role": "admin"},
    )
    response = web_client.get("/api/analysis/folders")
    assert response.status_code == 403


def test_visible_item_ids_are_restricted_to_owned_records_in_active_project(tmp_path: Path, monkeypatch) -> None:
    from solaire.web.platform_db import connect, init_platform_db

    platform_root = tmp_path / "platform"
    project_root = tmp_path / "project"
    init_platform_db(platform_root)
    with connect(platform_root) as con:
        for teacher_id in ("teacher-a", "teacher-b"):
            con.execute(
                "INSERT INTO users (id, role, username, password_hash, display_name, created_at, updated_at) "
                "VALUES (?, 'teacher', ?, 'x', ?, 'now', 'now')",
                (teacher_id, teacher_id, teacher_id),
            )
        for paper_id, exam_id, owner_id in (
            ("paper-owned", "owned-exam", "teacher-a"),
            ("paper-other", "other-exam", "teacher-b"),
            ("paper-adaptive", "adaptive/set-1", "teacher-a"),
            ("paper-other-project", "other-project-exam", "teacher-a"),
        ):
            con.execute(
                "INSERT INTO paper_records (id, exam_id, title, subject, owner_teacher_id, created_at, updated_at) "
                "VALUES (?, ?, ?, '数学', ?, 'now', 'now')",
                (paper_id, exam_id, paper_id, owner_id),
            )
        con.execute(
            "INSERT INTO exam_publications (id, paper_id, teacher_id, title, created_at, updated_at) "
            "VALUES ('publication-other-teacher', 'paper-owned', 'teacher-b', 'Other teacher', 'now', 'now')"
        )

    monkeypatch.setattr(
        analysis_folders,
        "list_exam_results",
        lambda _root: [
            {"exam_id": "owned-exam", "owner_teacher_id": None},
            {"exam_id": "other-exam", "owner_teacher_id": None},
            {"exam_id": "legacy-owned", "owner_teacher_id": "teacher-a"},
        ],
    )

    visible = analysis_folders.visible_item_ids(
        project_root,
        platform_root,
        owner_id="teacher-a",
    )
    assert visible == {
        "paper:paper-owned",
        "paper:paper-adaptive",
        "exam:owned-exam",
        "exam:legacy-owned",
    }
    assert "paper:paper-other-project" not in visible
