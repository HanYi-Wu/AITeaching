from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from solaire.web.auth_api import current_platform_user
from solaire.web.platform_db import init_platform_db
from solaire.web.school.accounts import create_teacher, update_teacher
from solaire.web.school.organization import create_school
from solaire.web.school_routes import accounts as account_routes


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "platform"
    init_platform_db(root)
    school = create_school(root, name="一中")
    user = {
        "id": "school-admin",
        "role": "school",
        "username": "school-admin",
        "status": "active",
        "school_id": school["id"],
    }
    app = FastAPI()
    app.include_router(account_routes.router, prefix="/api")
    app.dependency_overrides[current_platform_user] = lambda: user
    monkeypatch.setattr(account_routes, "require_platform_root", lambda: root)
    return TestClient(app), root, school, user


def _create_teacher(root: Path, school_id: str, *, username: str, name: str, subjects: list[str]):
    return create_teacher(
        root,
        school_id=school_id,
        username=username,
        password="unused-test-password",
        display_name=name,
        email=f"{username}@example.com",
        subjects=subjects,
    )


def test_teacher_list_filters_before_paging_and_includes_subject_matches(api):
    client, root, school, _ = api
    first = _create_teacher(root, school["id"], username="teacher-one", name="数学老师", subjects=["数学"])
    second = _create_teacher(root, school["id"], username="teacher-two", name="物理老师", subjects=["数学", "物理"])
    _create_teacher(root, school["id"], username="teacher-three", name="英语老师", subjects=["英语"])
    update_teacher(root, school_id=school["id"], teacher_id=second["id"], status="disabled")

    first_page = client.get(
        "/api/school/teachers",
        params={"q": "数学", "status": "all", "page": 1, "page_size": 1},
    )
    second_page = client.get(
        "/api/school/teachers",
        params={"q": "数学", "status": "all", "page": 2, "page_size": 1},
    )
    active_only = client.get("/api/school/teachers", params={"q": "数学", "status": "active"})

    assert first_page.status_code == second_page.status_code == active_only.status_code == 200
    assert first_page.json()["total"] == second_page.json()["total"] == 2
    assert {first_page.json()["teachers"][0]["id"], second_page.json()["teachers"][0]["id"]} == {
        first["id"], second["id"]
    }
    assert active_only.json()["total"] == 1
    assert active_only.json()["teachers"][0]["id"] == first["id"]
    assert first_page.json()["teachers"][0]["subjects"] == ["数学", "物理"]


def test_teacher_export_returns_all_matching_rows_as_text_and_is_school_only(api):
    client, root, school, user = api
    _create_teacher(
        root,
        school["id"],
        username="=SUM(1,1)",
        name="公式姓名",
        subjects=["数学"],
    )
    disabled = _create_teacher(root, school["id"], username="teacher-disabled", name="停用教师", subjects=["数学"])
    _create_teacher(root, school["id"], username="teacher-other", name="英语老师", subjects=["英语"])
    update_teacher(root, school_id=school["id"], teacher_id=disabled["id"], status="disabled")

    response = client.get("/api/school/teachers/export.xlsx", params={"q": "数学", "status": "all"})

    assert response.status_code == 200, (response.status_code, response.headers.get("allow"), response.text)
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    workbook = load_workbook(BytesIO(response.content), data_only=False)
    sheet = workbook.active
    assert sheet.max_row == 3
    assert [sheet.cell(row=1, column=column).value for column in range(1, 8)] == [
        "用户名", "姓名", "邮箱", "学科", "状态", "创建时间", "更新时间"
    ]
    assert {sheet.cell(row=row, column=1).value for row in range(2, 4)} == {
        "teacher-disabled", "=SUM(1,1)"
    }
    formula_username = next(
        sheet.cell(row=row, column=1)
        for row in range(2, 4)
        if sheet.cell(row=row, column=1).value == "=SUM(1,1)"
    )
    assert formula_username.data_type == "s"

    user["role"] = "admin"
    forbidden = client.get("/api/school/teachers/export.xlsx")
    assert forbidden.status_code == 403
