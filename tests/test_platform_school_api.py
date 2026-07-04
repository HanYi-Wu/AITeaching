"""API tests for school-side platform management."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _admin_token(client: TestClient) -> str:
    r = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    return str(r.json()["token"])


def test_admin_creates_school_and_school_account(web_client: TestClient) -> None:
    token = _admin_token(web_client)
    headers = {"Authorization": f"Bearer {token}"}

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


def test_school_manages_teachers_classes_students_and_assignments(web_client: TestClient) -> None:
    admin_token = _admin_token(web_client)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    school_id = web_client.post("/api/schools", json={"name": "No.1 School"}, headers=admin_headers).json()["school"][
        "id"
    ]
    web_client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "school_a", "password": "secret123", "display_name": "School Admin"},
        headers=admin_headers,
    )
    login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    teacher = web_client.post(
        "/api/school/teachers",
        json={"username": "teacher_li", "password": "teacher123", "display_name": "Li", "subjects": ["数学"]},
        headers=school_headers,
    )
    assert teacher.status_code == 200
    teacher_id = teacher.json()["teacher"]["id"]

    klass = web_client.post(
        "/api/school/classes",
        json={"name": "高一1班", "grade": "高一", "subject_hint": "数学"},
        headers=school_headers,
    )
    assert klass.status_code == 200
    class_id = klass.json()["class"]["id"]

    students = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "S001", "display_name": "Student One"}], "class_id": class_id},
        headers=school_headers,
    )
    assert students.status_code == 200
    assert students.json()["imported"] == 1

    assigned = web_client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher_id, "class_id": class_id, "subject": "数学"},
        headers=school_headers,
    )
    assert assigned.status_code == 200
