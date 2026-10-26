from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from solaire.web.paper_service import (
    find_paper_submissions,
    get_teacher_student_profile,
    list_paper_submissions,
    list_teacher_class_students,
)
from solaire.web.platform_db import connect, default_platform_root
from tests.test_paper_grading_transactions import _submitted_attempt
from tests.test_platform_paper_api import _headers


def test_teacher_queries_keep_stable_order_and_scope(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    school_login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    imported = web_client.post(
        "/api/school/students/import",
        headers=school_headers,
        json={"class_id": context["class_id"], "students": [{"student_no": "S002", "display_name": "Student Two"}]},
    )
    assert imported.status_code == 200
    second_student = imported.json()["students"][0]

    root = default_platform_root()
    with connect(root) as con:
        publication_id = con.execute(
            "SELECT id FROM exam_publications WHERE paper_id = ? ORDER BY created_at LIMIT 1",
            (context["paper_id"],),
        ).fetchone()[0]
    student_login = web_client.post(
        "/api/auth/login",
        json={"username": second_student["account_username"], "password": second_student["initial_password"]},
    )
    student_headers = _headers(str(student_login.json()["token"]))
    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=student_headers)
    assert started.status_code == 200
    second_attempt_id = str(started.json()["attempt"]["id"])
    submitted = web_client.post(
        f"/api/student/attempts/{second_attempt_id}/submit",
        headers=student_headers,
        json={"time_spent_seconds": 0},
    )
    assert submitted.status_code == 200

    same_time = "2026-10-26T12:00:00+00:00"
    with connect(root) as con:
        con.execute(
            "UPDATE student_attempts SET submitted_at = ? WHERE id IN (?, ?)",
            (same_time, context["attempt_id"], second_attempt_id),
        )
        con.execute(
            """
            INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, responded_at)
            VALUES ('second-pending-answer', ?, 'math/q1', '{}', ?)
            """,
            (second_attempt_id, same_time),
        )

    teacher = {"id": context["teacher_id"], "role": "teacher"}
    submissions = list_paper_submissions(
        root,
        tmp_path,
        paper_id=context["paper_id"],
        user=teacher,
    )
    expected_ids = [context["attempt_id"], second_attempt_id]
    assert [item["attempt_id"] for item in submissions] == expected_ids
    assert [item["attempt_id"] for item in find_paper_submissions(
        root,
        paper_id=context["paper_id"],
        user=teacher,
        status="submitted",
    )] == expected_ids
    pending = find_paper_submissions(
        root,
        paper_id=context["paper_id"],
        user=teacher,
        grading_status="pending",
    )
    assert [item["attempt_id"] for item in pending] == [second_attempt_id]

    students = list_teacher_class_students(root, class_id=context["class_id"], user=teacher)
    assert [item["student_no"] for item in students] == ["S001", "S002"]
    profile = get_teacher_student_profile(
        root,
        class_id=context["class_id"],
        user=teacher,
        student_id=context["student_id"],
    )
    assert profile["summary"]["exam_count"] == 1
    assert profile["recent_exams"][0]["attempt_id"] == context["attempt_id"]
