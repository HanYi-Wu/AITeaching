"""Regression: POST /api/exams 落盘为 exams/<试卷说明>/<学科>/，而非单层随机目录。"""

from __future__ import annotations

import json

import pytest
import solaire.web.state as st
from fastapi.testclient import TestClient
from solaire.web.exam_workspace_service import _fill_identity_from_exam_path_fields, _norm_template_path_rel


def test_norm_template_path_rel_strips_parent_segments() -> None:
    """exam.yaml 中相对考试目录的 ``../templates/…`` 应规范为与模板列表一致的 ``templates/…``。"""
    assert _norm_template_path_rel("../templates/gaokao2024.yaml") == "templates/gaokao2024.yaml"
    assert _norm_template_path_rel("templates/x.yaml") == "templates/x.yaml"


def test_new_exam_auto_names_but_existing_exam_conflicts_still_reject(web_client, tmp_path):
    payload = {"export_label": "期中", "subject": "数学", "template_ref": "t1", "template_path": "templates/t1.yaml", "selected_items": []}
    first = web_client.post("/api/exams", json=payload)
    assert first.status_code == 200
    original = (tmp_path / "exams/期中/数学/exam.yaml").read_bytes()
    assert web_client.post("/api/exams", json=payload).status_code == 400
    created = []
    for _ in range(2):
        response = web_client.post("/api/exams", json={**payload, "auto_rename": True})
        assert response.status_code == 200, response.text
        created.append(response.json()["exam"])
    assert [exam["export_label"] for exam in created] == ["期中 (2)", "期中 (3)"]
    conflict = web_client.put(f"/api/exams/{created[0]['exam_id']}", json=payload)
    assert conflict.status_code == 400
    assert (tmp_path / "exams/期中/数学/exam.yaml").read_bytes() == original


def test_fill_identity_from_exam_path_fields() -> None:
    d = {"export_label": "", "subject": ""}
    _fill_identity_from_exam_path_fields(d, "高考数学/数学")
    assert d["export_label"] == "高考数学"
    assert d["subject"] == "数学"
    d2 = {"export_label": "期中", "subject": "物理"}
    _fill_identity_from_exam_path_fields(d2, "高考数学/数学")
    assert d2["export_label"] == "期中"
    assert d2["subject"] == "物理"


def test_post_exams_creates_nested_exams_dir(web_client: TestClient) -> None:
    root = st.get_root()

    r = web_client.post(
        "/api/exams",
        json={
            "name": None,
            "export_label": "期中测验",
            "subject": "数学",
            "template_ref": "t1",
            "template_path": "templates/minimal.yaml",
            "selected_items": [{"section_id": "s1", "question_ids": []}],
        },
    )
    assert r.status_code == 200, r.text
    exam = r.json()["exam"]
    assert exam["exam_id"] == "期中测验/数学"

    exam_dir = root / "exams" / "期中测验" / "数学"
    assert exam_dir.is_dir()
    assert (exam_dir / "exam.yaml").is_file()
    assert (exam_dir / "config.json").is_file()


def test_get_exams_returns_canonical_exam_id_despite_stale_yaml(web_client: TestClient) -> None:
    """历史 exam.yaml 内若仍为单段旧 id，GET 仍应返回路径上的双段 exam_id。"""
    root = st.get_root()
    r0 = web_client.post(
        "/api/exams",
        json={
            "name": None,
            "export_label": "期中",
            "subject": "物理",
            "template_ref": "t1",
            "template_path": "templates/minimal.yaml",
            "selected_items": [{"section_id": "s1", "question_ids": []}],
        },
    )
    assert r0.status_code == 200, r0.text
    yp = root / "exams" / "期中" / "物理" / "exam.yaml"
    assert yp.is_file()
    raw = yp.read_text(encoding="utf-8")
    yp.write_text(raw.replace("exam_id: 期中/物理", "exam_id: deadbeefdeadbeefdeadbeefdeadbeef"), encoding="utf-8")

    r1 = web_client.get("/api/exams/%E6%9C%9F%E4%B8%AD%2F%E7%89%A9%E7%90%86")
    assert r1.status_code == 200, r1.text
    assert r1.json()["exam"]["exam_id"] == "期中/物理"


@pytest.fixture
def other_teacher_exam(web_client, tmp_path, monkeypatch):
    from solaire.web.public_access import reset_login_rate_limiter
    from tests.test_platform_paper_api import (
        _bootstrap_admin,
        _create_school_teacher_class,
        _headers,
        _teacher_token,
        _write_exam,
    )

    monkeypatch.setenv("SOLAIRE_PUBLIC_MODE", "1")
    reset_login_rate_limiter()
    admin = _bootstrap_admin(web_client)
    _create_school_teacher_class(web_client, admin)
    exam_id = _write_exam(tmp_path)
    response = web_client.get("/api/papers", headers=_headers(_teacher_token(web_client)))
    assert response.status_code == 200, response.text
    assert response.json()["papers"][0]["exam_id"] == exam_id

    school_login = web_client.post(
        "/api/auth/login", json={"username": "school_a", "password": "secret123"}
    )
    second = web_client.post(
        "/api/school/teachers",
        headers=_headers(school_login.json()["token"]),
        json={"username": "teacher_two", "password": "secret123", "display_name": "Second", "subjects": []},
    )
    assert second.status_code == 200, second.text
    login = web_client.post(
        "/api/auth/login", json={"username": "teacher_two", "password": "secret123"}
    )
    assert login.status_code == 200, login.text
    return exam_id, _headers(login.json()["token"]), second.json()["teacher"]["id"]


@pytest.mark.parametrize("has_config", [False, True])
def test_teacher_can_create_rename_and_copy_exam_with_other_teacher_workspaces(
    web_client, tmp_path, other_teacher_exam, has_config
):
    """Unrelated private exams must not make the global duplicate check fail."""
    from solaire.common.actor_context import actor
    from solaire.web.exam_workspace_service import load_exam_workspace

    other_id, headers, teacher_id = other_teacher_exam
    other_dir = tmp_path / "exams" / other_id
    if has_config:
        (other_dir / "config.json").write_text(
            json.dumps({"exam_label": "midterm", "subject": "Math"}), encoding="utf-8"
        )
    original = (other_dir / "exam.yaml").read_bytes()
    body = {
        "export_label": "期末测验",
        "subject": "数学",
        "template_ref": "t1",
        "template_path": "templates/minimal.yaml",
        "selected_items": [{"section_id": "s1", "question_ids": []}],
    }
    created = web_client.post("/api/exams", headers=headers, json=body)
    assert created.status_code == 200, created.text
    assert created.json()["exam"]["exam_id"] == "期末测验/数学"

    renamed = web_client.put(
        "/api/exams/期末测验/数学", headers=headers, json={**body, "export_label": "期末测验修订"}
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["exam"]["exam_id"] == "期末测验修订/数学"
    copied = web_client.post(
        "/api/exams/from-exam/期末测验修订/数学", headers=headers, json={"export_label": "期末测验副本"}
    )
    assert copied.status_code == 200, copied.text
    assert copied.json()["exam"]["exam_id"] == "期末测验副本/数学"
    assert (tmp_path / "exams" / "期末测验副本" / "数学" / "exam.yaml").is_file()
    assert (other_dir / "exam.yaml").read_bytes() == original

    token = actor.set({"id": teacher_id, "role": "teacher"})
    try:
        with pytest.raises(PermissionError):
            load_exam_workspace(tmp_path, other_id)
    finally:
        actor.reset(token)


def test_teacher_duplicate_name_conflict_does_not_overwrite_private_exam(
    web_client, tmp_path, other_teacher_exam
):
    other_id, headers, _ = other_teacher_exam
    source = tmp_path / "exams" / other_id / "exam.yaml"
    original = source.read_bytes()
    response = web_client.post(
        "/api/exams",
        headers=headers,
        json={"export_label": "midterm", "subject": "Math", "template_path": "templates/minimal.yaml"},
    )
    assert response.status_code == 400, response.text
    assert "已存在" in response.json()["detail"]
    assert source.read_bytes() == original


def test_unsynced_workspace_uses_creator_identity_for_all_access_paths(
    web_client, tmp_path, other_teacher_exam
):
    from tests.test_platform_paper_api import _headers, _teacher_token
    from solaire.web.platform_db import connect, default_platform_root

    _, other_headers, _ = other_teacher_exam
    creator_headers = _headers(_teacher_token(web_client))
    payload = {"export_label": "尚未发布", "subject": "数学", "template_path": "templates/minimal.yaml", "selected_items": []}
    response = web_client.post("/api/exams", headers=creator_headers, json=payload)
    assert response.status_code == 200, response.text
    document = response.json()["exam"]
    exam_id = document["exam_id"]
    directory = tmp_path / "exams" / exam_id
    (directory / "尚未发布-数学-教师版.pdf").write_bytes(b"private teacher answers")
    (directory / "尚未发布-数学-教师版.docx").write_bytes(b"private teacher answers")
    original = (directory / "exam.yaml").read_bytes()
    assert document["metadata"]["owner_teacher_id"]
    with connect(default_platform_root()) as con:
        assert con.execute("SELECT id FROM paper_records WHERE exam_id=?", (exam_id,)).fetchone() is None

    url = "/api/exams/" + exam_id
    for method, suffix, options in [
        ("get", "", {}), ("get", "/pdf-file?variant=teacher", {}),
        ("get", "/docx-file?variant=teacher", {}), ("get", "/scores", {}),
        ("put", "", {"json": payload}), ("delete", "", {}),
    ]:
        result = getattr(web_client, method)(url + suffix, headers=other_headers, **options)
        assert result.status_code == 403, (method, suffix, result.text)
        assert (directory / "exam.yaml").read_bytes() == original
    summaries = web_client.get("/api/exams", headers=other_headers)
    assert summaries.status_code == 200, summaries.text
    assert all(item["exam_id"] != exam_id for item in summaries.json()["exams"])
    assert web_client.get(url, headers=creator_headers).status_code == 200
    assert web_client.get(url + "/pdf-file?variant=teacher", headers=creator_headers).content == b"private teacher answers"


def test_rename_does_not_move_a_workspace_inside_an_existing_destination(tmp_path, monkeypatch):
    from solaire.web import exam_workspace_service as service

    body = {"name": None, "subject": "Math", "template_ref": "t1", "template_path": "templates/t1.yaml", "selected_items": []}
    created = service.save_exam_workspace(tmp_path, exam_id=None, export_label="Original", **body)
    original = tmp_path / "exams" / created["exam_id"]
    contents = (original / "exam.yaml").read_bytes()
    target = tmp_path / "exams" / "Occupied" / "Math"

    def occupy(*args, **kwargs):
        target.mkdir(parents=True, exist_ok=True)
        (target / "existing.txt").write_text("another workspace", encoding="utf-8")

    monkeypatch.setattr(service, "assert_unique_exam_identity", occupy)
    with pytest.raises(ValueError, match="目录已存在"):
        service.save_exam_workspace(tmp_path, exam_id=created["exam_id"], export_label="Occupied", **body)
    assert (original / "exam.yaml").read_bytes() == contents
    assert not (target / "Math").exists()
    assert (target / "existing.txt").read_text(encoding="utf-8") == "another workspace"


def test_workspace_write_failure_preserves_previous_document(tmp_path, monkeypatch):
    from solaire.web import exam_workspace_service as service
    from solaire.common import atomic_files

    body = {"name": None, "subject": "Math", "template_ref": "t1", "template_path": "templates/t1.yaml", "selected_items": [], "export_label": "Original"}
    created = service.save_exam_workspace(tmp_path, exam_id=None, **body)
    document = tmp_path / "exams" / created["exam_id"] / "exam.yaml"
    original = document.read_bytes()

    def fail_replace(*args):
        raise OSError("write failed")

    monkeypatch.setattr(atomic_files.os, "replace", fail_replace)
    with pytest.raises(OSError, match="write failed"):
        service.save_exam_workspace(tmp_path, exam_id=created["exam_id"], **{**body, "name": "Changed"})
    assert document.read_bytes() == original
    assert list(document.parent.glob("*.tmp")) == []
