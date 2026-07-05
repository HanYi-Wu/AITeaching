"""API tests for school-side platform management."""

from __future__ import annotations

from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_token(client: TestClient) -> str:
    r = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert r.status_code == 200
    return str(r.json()["token"])


def _school_headers(client: TestClient) -> tuple[dict[str, str], str]:
    admin_token = _admin_token(client)
    school = client.post("/api/schools", json={"name": "No.1 School"}, headers=_headers(admin_token))
    assert school.status_code == 200
    school_id = str(school.json()["school"]["id"])
    account = client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "school_a", "password": "secret123", "display_name": "School Admin"},
        headers=_headers(admin_token),
    )
    assert account.status_code == 200
    login = client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    assert login.status_code == 200
    return _headers(str(login.json()["token"])), school_id


def _xlsx_upload(rows: list[dict[str, object]]) -> tuple[str, BytesIO, str]:
    wb = Workbook()
    ws = wb.active
    headers = list(rows[0].keys())
    ws.append(headers)
    for row in rows:
        ws.append([row.get(key) for key in headers])
    stream = BytesIO()
    wb.save(stream)
    stream.seek(0)
    return ("import.xlsx", stream, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def test_admin_creates_school_and_school_account(web_client: TestClient) -> None:
    token = _admin_token(web_client)
    headers = _headers(token)

    school = web_client.post("/api/schools", json={"name": "No.1 School"}, headers=headers)
    assert school.status_code == 200
    school_id = school.json()["school"]["id"]

    account = web_client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "school_a", "password": "secret123", "display_name": "School Admin"},
        headers=headers,
    )
    assert account.status_code == 200
    assert account.json()["user"]["role"] == "school"

    listed = web_client.get("/api/schools", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["schools"][0]["name"] == "No.1 School"


def test_school_assigns_teacher_to_class_without_subject(web_client: TestClient) -> None:
    school_headers, _ = _school_headers(web_client)

    teacher = web_client.post(
        "/api/school/teachers",
        json={"username": "teacher_li", "password": "teacher123", "display_name": "Li", "subjects": ["Math"]},
        headers=school_headers,
    )
    assert teacher.status_code == 200
    teacher_id = teacher.json()["teacher"]["id"]

    klass = web_client.post(
        "/api/school/classes",
        json={"name": "Class 1", "grade": "G10"},
        headers=school_headers,
    )
    assert klass.status_code == 200
    assert klass.json()["class"]["subject_hint"] is None
    class_id = klass.json()["class"]["id"]

    assigned = web_client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher_id, "class_id": class_id},
        headers=school_headers,
    )
    assert assigned.status_code == 200
    assert assigned.json()["assignment"] == {"teacher_id": teacher_id, "class_id": class_id}


def test_school_imports_teachers_classes_and_students_from_json(web_client: TestClient) -> None:
    school_headers, _ = _school_headers(web_client)

    teacher_import = web_client.post(
        "/api/school/teachers/import",
        json={
            "teachers": [
                {"username": "teacher_json", "password": "teacher123", "display_name": "Teacher Json"},
            ]
        },
        headers=school_headers,
    )
    assert teacher_import.status_code == 200
    assert teacher_import.json()["imported"] == 1

    class_import = web_client.post(
        "/api/school/classes/import",
        json={"classes": [{"name": "Json Class", "grade": "G10"}]},
        headers=school_headers,
    )
    assert class_import.status_code == 200
    class_id = class_import.json()["classes"][0]["id"]

    student_import = web_client.post(
        "/api/school/students/import",
        json={
            "class_id": class_id,
            "students": [{"student_no": "S001", "display_name": "Student One"}],
        },
        headers=school_headers,
    )
    assert student_import.status_code == 200
    body = student_import.json()
    assert body["imported"] == 1
    student = body["students"][0]
    assert student["student_no"] == "S001"
    assert student["account_username"].startswith("stu_")
    assert len(student["initial_password"]) >= 8

    login = web_client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "student"


def test_school_imports_teachers_classes_and_students_from_excel(web_client: TestClient) -> None:
    school_headers, _ = _school_headers(web_client)

    teachers = web_client.post(
        "/api/school/teachers/import-file",
        files={"file": _xlsx_upload([{"username": "teacher_xlsx", "password": "teacher123", "display_name": "Teacher Xlsx"}])},
        headers=school_headers,
    )
    assert teachers.status_code == 200
    assert teachers.json()["imported"] == 1

    classes = web_client.post(
        "/api/school/classes/import-file",
        files={"file": _xlsx_upload([{"name": "Excel Class", "grade": "G11"}])},
        headers=school_headers,
    )
    assert classes.status_code == 200
    class_id = classes.json()["classes"][0]["id"]

    students = web_client.post(
        "/api/school/students/import-file",
        data={"class_id": class_id},
        files={"file": _xlsx_upload([{"student_no": "S100", "display_name": "Student Xlsx"}])},
        headers=school_headers,
    )
    assert students.status_code == 200
    assert students.json()["students"][0]["account_username"].startswith("stu_")


def test_school_exports_student_initial_accounts(web_client: TestClient) -> None:
    school_headers, _ = _school_headers(web_client)
    klass = web_client.post("/api/school/classes", json={"name": "Class Export"}, headers=school_headers)
    class_id = str(klass.json()["class"]["id"])
    imported = web_client.post(
        "/api/school/students/import",
        json={"class_id": class_id, "students": [{"student_no": "S900", "display_name": "Student Export"}]},
        headers=school_headers,
    )
    student = imported.json()["students"][0]

    listed = web_client.get("/api/school/students", headers=school_headers)
    assert listed.status_code == 200
    assert listed.json()["students"][0]["account_username"] == student["account_username"]
    assert listed.json()["students"][0]["initial_password"] == student["initial_password"]

    exported = web_client.get("/api/school/students/export.xlsx", headers=school_headers)
    assert exported.status_code == 200
    wb = load_workbook(BytesIO(exported.content))
    rows = list(wb.active.iter_rows(values_only=True))
    assert rows[0] == ("student_no", "display_name", "class_name", "account_username", "initial_password")
    assert rows[1][0] == "S900"
    assert rows[1][3] == student["account_username"]
    assert rows[1][4] == student["initial_password"]


def test_school_updates_teachers_classes_and_students(web_client: TestClient) -> None:
    school_headers, _ = _school_headers(web_client)
    teacher = web_client.post(
        "/api/school/teachers",
        json={"username": "teacher_manage", "password": "teacher123", "display_name": "Old Teacher", "subjects": ["Math"]},
        headers=school_headers,
    ).json()["teacher"]
    klass = web_client.post(
        "/api/school/classes",
        json={"name": "Old Class", "grade": "G10"},
        headers=school_headers,
    ).json()["class"]
    student = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "M001", "display_name": "Old Student"}]},
        headers=school_headers,
    ).json()["students"][0]

    updated_teacher = web_client.patch(
        f"/api/school/teachers/{teacher['id']}",
        json={"display_name": "New Teacher", "subjects": ["Physics"]},
        headers=school_headers,
    )
    assert updated_teacher.status_code == 200
    assert updated_teacher.json()["teacher"]["display_name"] == "New Teacher"
    assert updated_teacher.json()["teacher"]["subjects"] == ["Physics"]

    updated_class = web_client.patch(
        f"/api/school/classes/{klass['id']}",
        json={"name": "New Class", "grade": "G11"},
        headers=school_headers,
    )
    assert updated_class.status_code == 200
    assert updated_class.json()["class"]["name"] == "New Class"
    assert updated_class.json()["class"]["grade"] == "G11"

    updated_student = web_client.patch(
        f"/api/school/students/{student['id']}",
        json={"student_no": "M002", "display_name": "New Student", "email": "new@example.com"},
        headers=school_headers,
    )
    assert updated_student.status_code == 200
    assert updated_student.json()["student"]["student_no"] == "M002"
    assert updated_student.json()["student"]["display_name"] == "New Student"
    assert updated_student.json()["student"]["account_username"] == student["account_username"]


def test_same_student_number_can_exist_in_different_schools(web_client: TestClient) -> None:
    first_headers, _ = _school_headers(web_client)
    first = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "SAME", "display_name": "First School Student"}]},
        headers=first_headers,
    )
    assert first.status_code == 200

    admin_login = web_client.post("/api/auth/login", json={"username": "admin", "password": "secret123"})
    admin_headers = _headers(str(admin_login.json()["token"]))
    second_school = web_client.post("/api/schools", json={"name": "No.2 School"}, headers=admin_headers)
    second_school_id = str(second_school.json()["school"]["id"])
    web_client.post(
        f"/api/schools/{second_school_id}/school-users",
        json={"username": "school_b", "password": "secret123", "display_name": "School B"},
        headers=admin_headers,
    )
    second_login = web_client.post("/api/auth/login", json={"username": "school_b", "password": "secret123"})
    second_headers = _headers(str(second_login.json()["token"]))
    second = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "SAME", "display_name": "Second School Student"}]},
        headers=second_headers,
    )

    assert second.status_code == 200
    assert first.json()["students"][0]["account_username"] != second.json()["students"][0]["account_username"]


def test_student_can_change_generated_username_and_password(web_client: TestClient) -> None:
    school_headers, _ = _school_headers(web_client)
    imported = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "C001", "display_name": "Change Me"}]},
        headers=school_headers,
    )
    student = imported.json()["students"][0]
    login = web_client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    student_headers = _headers(str(login.json()["token"]))

    changed = web_client.patch(
        "/api/student/account",
        json={
            "username": "student_custom_001",
            "current_password": student["initial_password"],
            "new_password": "changed123",
        },
        headers=student_headers,
    )
    assert changed.status_code == 200
    assert changed.json()["user"]["username"] == "student_custom_001"

    old_login = web_client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    assert old_login.status_code == 401
    new_login = web_client.post("/api/auth/login", json={"username": "student_custom_001", "password": "changed123"})
    assert new_login.status_code == 200
