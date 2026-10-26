"""End-to-end user-journey testing and verification from user perspective."""

from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from solaire.web.platform_db import connect, default_platform_root


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_xlsx(rows: list[dict[str, object]]) -> tuple[str, BytesIO, str]:
    wb = Workbook()
    ws = wb.active
    if rows:
        headers = list(rows[0].keys())
        ws.append(headers)
        for row in rows:
            ws.append([row.get(key) for key in headers])
    stream = BytesIO()
    wb.save(stream)
    stream.seek(0)
    return ("test_upload.xlsx", stream, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def test_complete_school_onboarding_and_lifecycle_journey(web_client: TestClient) -> None:
    """Simulate complete school onboarding: admin creates school, school admin sets up roster,

    imports data, exports slips, and teachers/students log in.
    """
    # 1. Platform Admin logs in
    admin_res = web_client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "super_admin", "password": "superAdmin123", "display_name": "Platform Root"},
    )
    assert admin_res.status_code == 200
    admin_token = admin_res.json()["token"]
    admin_headers = _headers(admin_token)

    # 2. Platform Admin creates Beijing High School
    school_res = web_client.post(
        "/api/schools",
        json={"name": "Beijing No.4 High School"},
        headers=admin_headers,
    )
    assert school_res.status_code == 200
    school_id = school_res.json()["school"]["id"]

    # 3. Platform Admin creates School Admin account
    school_admin_res = web_client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "bj4_admin", "password": "bj4AdminPassword", "display_name": "BJ4 Admin"},
        headers=admin_headers,
    )
    assert school_admin_res.status_code == 200

    # 4. School Admin logs in
    login_res = web_client.post(
        "/api/auth/login",
        json={"username": "bj4_admin", "password": "bj4AdminPassword"},
    )
    assert login_res.status_code == 200
    school_token = login_res.json()["token"]
    school_headers = _headers(school_token)

    # 5. School Admin downloads all 4 templates and verifies template headers
    template_expectations = [
        ("/api/school/classes/template.xlsx", ("name", "grade")),
        ("/api/school/teachers/template.xlsx", ("username", "password", "display_name", "email", "subjects")),
        ("/api/school/students/template.xlsx", ("student_no", "display_name", "email", "class_name")),
        ("/api/school/teacher-class-assignments/template.xlsx", ("teacher_username", "class_name", "subject")),
    ]
    for url, expected_cols in template_expectations:
        resp = web_client.get(url, headers=school_headers)
        assert resp.status_code == 200
        wb = load_workbook(BytesIO(resp.content))
        row0 = list(wb.active.iter_rows(values_only=True))[0]
        assert row0 == expected_cols

    # 6. School Admin imports classes via Excel
    class_upload = _create_xlsx([
        {"name": "Class 101", "grade": "G10"},
        {"name": "Class 102", "grade": "G10"},
        {"name": "Class 201", "grade": "G11"},
    ])
    imp_class_res = web_client.post(
        "/api/school/classes/import-file",
        files={"file": class_upload},
        headers=school_headers,
    )
    assert imp_class_res.status_code == 200
    assert imp_class_res.json()["imported"] == 3

    # 7. School Admin imports teachers via Excel (including Chinese comma in subjects and spaces)
    teacher_upload = _create_xlsx([
        {"username": "t_li_math", "password": "teacherPass123", "display_name": "Teacher Li", "email": "li@bj4.edu", "subjects": "Math，Physics"},
        {"username": "t_wang_eng", "password": "teacherPass123", "display_name": "Teacher Wang", "email": "wang@bj4.edu", "subjects": "English"},
    ])
    imp_teacher_res = web_client.post(
        "/api/school/teachers/import-file",
        files={"file": teacher_upload},
        headers=school_headers,
    )
    assert imp_teacher_res.status_code == 200
    assert imp_teacher_res.json()["imported"] == 2
    # Verify Teacher Li has Math and Physics
    teachers_list = web_client.get("/api/school/teachers?q=Teacher%20Li", headers=school_headers).json()["teachers"]
    assert len(teachers_list) == 1
    assert set(teachers_list[0]["subjects"]) == {"Math", "Physics"}

    # 8. School Admin imports students via Excel, including two same-name students in different classes
    student_upload = _create_xlsx([
        {"student_no": "BJ001", "display_name": "Alice Zhang", "email": "alice1@bj4.edu", "class_name": "Class 101"},
        {"student_no": "BJ002", "display_name": "Bob Wang", "email": "bob@bj4.edu", "class_name": "Class 101"},
        {"student_no": "BJ003", "display_name": "Charlie Li", "email": "charlie@bj4.edu", "class_name": "Class 102"},
        {"student_no": "BJ004", "display_name": "Alice Zhang", "email": "alice2@bj4.edu", "class_name": "Class 201"},
    ])
    imp_stu_res = web_client.post(
        "/api/school/students/import-file",
        files={"file": student_upload},
        headers=school_headers,
    )
    assert imp_stu_res.status_code == 200
    assert imp_stu_res.json()["imported"] == 4
    imported_students = imp_stu_res.json()["students"]

    # Verify both Alice Zhangs have unique usernames and passwords
    alice1 = next(s for s in imported_students if s["student_no"] == "BJ001")
    alice2 = next(s for s in imported_students if s["student_no"] == "BJ004")
    assert alice1["account_username"] != alice2["account_username"]
    assert alice1["id"] != alice2["id"]
    assert alice1["user_id"] != alice2["user_id"]

    # 9. School Admin exports student account slips
    export_res = web_client.get("/api/school/students/export.xlsx", headers=school_headers)
    assert export_res.status_code == 200
    wb_export = load_workbook(BytesIO(export_res.content))
    export_rows = list(wb_export.active.iter_rows(values_only=True))
    assert export_rows[0] == ("student_no", "display_name", "class_name", "account_username", "initial_password")
    assert len(export_rows) == 5  # header + 4 students

    # 10. School Admin assigns teachers to classes
    assign_upload = _create_xlsx([
        {"teacher_username": "t_li_math", "class_name": "Class 101", "subject": "Math"},
        {"teacher_username": "t_li_math", "class_name": "Class 102", "subject": "Math"},
        {"teacher_username": "t_wang_eng", "class_name": "Class 101", "subject": "English"},
    ])
    imp_assign_res = web_client.post(
        "/api/school/teacher-class-assignments/import-file",
        files={"file": assign_upload},
        headers=school_headers,
    )
    assert imp_assign_res.status_code == 200
    assert imp_assign_res.json()["imported"] == 3

    # 11. Query & aggregation checks from Admin UI perspective
    classes_query = web_client.get("/api/school/classes?q=Class%20101", headers=school_headers).json()["classes"]
    assert len(classes_query) == 1
    assert classes_query[0]["student_count"] == 2
    assert classes_query[0]["teacher_count"] == 2

    # Query students in Class 101
    class_101_id = classes_query[0]["id"]
    stus_in_101 = web_client.get(f"/api/school/students?class_id={class_101_id}", headers=school_headers).json()["students"]
    assert len(stus_in_101) == 2
    assert {s["student_no"] for s in stus_in_101} == {"BJ001", "BJ002"}

    # 12. Student login & first-time password change
    stu_login = web_client.post(
        "/api/auth/login",
        json={"username": alice1["account_username"], "password": alice1["initial_password"]},
    )
    assert stu_login.status_code == 200
    assert stu_login.json()["user"]["must_change_password"] is True
    alice_token = stu_login.json()["token"]

    # Student cannot change username before password change
    blocked_username = web_client.patch(
        "/api/student/account",
        json={"username": "alice_custom", "current_password": alice1["initial_password"]},
        headers=_headers(alice_token),
    )
    assert blocked_username.status_code == 400

    # Student changes password
    chg_pw = web_client.patch(
        "/api/student/account",
        json={"current_password": alice1["initial_password"], "new_password": "NewAlicePassword123"},
        headers=_headers(alice_token),
    )
    assert chg_pw.status_code == 200
    assert chg_pw.json()["user"]["must_change_password"] is False

    # Student can now login with new password
    new_login = web_client.post(
        "/api/auth/login",
        json={"username": alice1["account_username"], "password": "NewAlicePassword123"},
    )
    assert new_login.status_code == 200

    # 13. Teacher bulk disable and password reset
    teacher_li_id = teachers_list[0]["id"]
    bulk_dis = web_client.post(
        "/api/school/teachers/bulk-status",
        json={"ids": [teacher_li_id], "status": "disabled"},
        headers=school_headers,
    )
    assert bulk_dis.status_code == 200
    assert bulk_dis.json()["updated"] == 1

    # Disabled teacher cannot login
    assert web_client.post(
        "/api/auth/login",
        json={"username": "t_li_math", "password": "teacherPass123"},
    ).status_code == 401

    # Reset password re-activates teacher
    reset_teacher = web_client.post(
        f"/api/school/teachers/{teacher_li_id}/reset-password",
        json={},
        headers=school_headers,
    )
    assert reset_teacher.status_code == 200
    temp_pass = reset_teacher.json()["password"]

    # Teacher logs in with reset password
    t_login = web_client.post(
        "/api/auth/login",
        json={"username": "t_li_math", "password": temp_pass},
    )
    assert t_login.status_code == 200
    assert t_login.json()["user"]["must_change_password"] is True


def test_user_error_recovery_and_partial_rollback(web_client: TestClient) -> None:
    """Simulate user mistakes in Excel spreadsheets: dirty data, bad foreign keys, and duplicate uploads."""
    # 1. Setup admin and school
    admin_token = web_client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin2", "password": "adminPassword123", "display_name": "Admin Two"},
    ).json()["token"]
    school = web_client.post(
        "/api/schools",
        json={"name": "Shanghai Experimental School"},
        headers=_headers(admin_token),
    ).json()["school"]
    school_id = school["id"]

    school_user = web_client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "sh_admin", "password": "shAdminPassword", "display_name": "SH Admin"},
        headers=_headers(admin_token),
    ).json()["user"]
    school_token = web_client.post(
        "/api/auth/login",
        json={"username": "sh_admin", "password": "shAdminPassword"},
    ).json()["token"]
    school_headers = _headers(school_token)

    # 2. User uploads classes
    web_client.post(
        "/api/school/classes/import-file",
        files={"file": _create_xlsx([{"name": "SH Class 1", "grade": "G10"}])},
        headers=school_headers,
    )

    # 3. User uploads student excel with an invalid class in row 2
    bad_student_upload = _create_xlsx([
        {"student_no": "SH001", "display_name": "Student Good 1", "class_name": "SH Class 1"},
        {"student_no": "SH002", "display_name": "Student Bad 2", "class_name": "Non Existent Class"},
        {"student_no": "SH003", "display_name": "Student Good 3", "class_name": "SH Class 1"},
    ])
    bad_res = web_client.post(
        "/api/school/students/import-file",
        files={"file": bad_student_upload},
        headers=school_headers,
    )
    # Must fail with 400 and specify row 2
    assert bad_res.status_code == 400
    assert "Row 2" in bad_res.json()["detail"]
    assert "Non Existent Class" in bad_res.json()["detail"]

    # Crucial check: verify that Row 1 was rolled back and NOT partially saved!
    students_in_db = web_client.get("/api/school/students", headers=school_headers).json()
    assert students_in_db["total"] == 0, "Failed import must not leave partial records in database!"

    # 4. User fixes the error and re-uploads
    good_student_upload = _create_xlsx([
        {"student_no": "SH001", "display_name": "Student Good 1", "class_name": "SH Class 1"},
        {"student_no": "SH002", "display_name": "Student Good 2", "class_name": "SH Class 1"},
    ])
    good_res = web_client.post(
        "/api/school/students/import-file",
        files={"file": good_student_upload},
        headers=school_headers,
    )
    assert good_res.status_code == 200
    assert good_res.json()["imported"] == 2

    # 5. User accidentally uploads the exact same spreadsheet again (Idempotency)
    re_upload_res = web_client.post(
        "/api/school/students/import-file",
        files={"file": good_student_upload},
        headers=school_headers,
    )
    assert re_upload_res.status_code == 200
    assert re_upload_res.json()["imported"] == 2

    # Verify student count is still 2 (not 4)
    students_after = web_client.get("/api/school/students", headers=school_headers).json()
    assert students_after["total"] == 2
    assert len(students_after["students"]) == 2


def test_cross_school_boundary_and_scope_isolation(web_client: TestClient) -> None:
    """Ensure two independent schools are strictly isolated from each other across all operations."""
    admin_token = web_client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "super_admin3", "password": "superAdmin123", "display_name": "Platform Root"},
    ).json()["token"]
    admin_headers = _headers(admin_token)

    # School Alpha
    school_a = web_client.post("/api/schools", json={"name": "School Alpha"}, headers=admin_headers).json()["school"]
    web_client.post(
        f"/api/schools/{school_a['id']}/school-users",
        json={"username": "admin_alpha", "password": "alphaPassword123", "display_name": "Admin Alpha"},
        headers=admin_headers,
    )
    token_a = web_client.post("/api/auth/login", json={"username": "admin_alpha", "password": "alphaPassword123"}).json()["token"]
    headers_a = _headers(token_a)

    # School Beta
    school_b = web_client.post("/api/schools", json={"name": "School Beta"}, headers=admin_headers).json()["school"]
    web_client.post(
        f"/api/schools/{school_b['id']}/school-users",
        json={"username": "admin_beta", "password": "betaPassword123", "display_name": "Admin Beta"},
        headers=admin_headers,
    )
    token_b = web_client.post("/api/auth/login", json={"username": "admin_beta", "password": "betaPassword123"}).json()["token"]
    headers_b = _headers(token_b)

    # School Alpha sets up Class A and Teacher A
    class_a = web_client.post("/api/school/classes", json={"name": "Alpha Class 1", "grade": "G10"}, headers=headers_a).json()["class"]
    teacher_a = web_client.post(
        "/api/school/teachers",
        json={"username": "t_alpha_1", "password": "teacherPass123", "display_name": "Teacher Alpha 1", "subjects": ["Math"]},
        headers=headers_a,
    ).json()["teacher"]
    student_a = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "COMMON_NO", "display_name": "Alpha Student", "class_name": "Alpha Class 1"}]},
        headers=headers_a,
    ).json()["students"][0]

    # School Beta sets up Class B and Student B with the SAME student_no ("COMMON_NO")
    class_b = web_client.post("/api/school/classes", json={"name": "Beta Class 1", "grade": "G10"}, headers=headers_b).json()["class"]
    student_b = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "COMMON_NO", "display_name": "Beta Student", "class_name": "Beta Class 1"}]},
        headers=headers_b,
    ).json()["students"][0]

    # 1. Independent accounts for same student number in different schools
    assert student_a["account_username"] != student_b["account_username"]
    assert student_a["id"] != student_b["id"]

    # 2. School Beta cannot view School Alpha's classes
    classes_b = web_client.get("/api/school/classes", headers=headers_b).json()["classes"]
    assert len(classes_b) == 1
    assert classes_b[0]["id"] == class_b["id"]

    # 3. School Beta cannot view School Alpha's students even by passing class_a ID
    stus_b = web_client.get(f"/api/school/students?class_id={class_a['id']}", headers=headers_b).json()["students"]
    assert len(stus_b) == 0

    # 4. School Beta cannot update School Alpha's class
    update_class_res = web_client.patch(
        f"/api/school/classes/{class_a['id']}",
        json={"name": "Hijacked Class"},
        headers=headers_b,
    )
    assert update_class_res.status_code == 400

    # 5. School Beta cannot assign School Alpha's teacher
    assign_cross = web_client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher_a["id"], "class_id": class_b["id"]},
        headers=headers_b,
    )
    assert assign_cross.status_code == 400

    # 6. School Beta cannot reset password of School Alpha's student
    reset_cross = web_client.post(
        f"/api/school/students/{student_a['id']}/reset-password",
        json={},
        headers=headers_b,
    )
    assert reset_cross.status_code == 400

    # 7. School Beta cannot delete School Alpha's class
    del_cross = web_client.delete(f"/api/school/classes/{class_a['id']}", headers=headers_b)
    assert del_cross.status_code == 400
