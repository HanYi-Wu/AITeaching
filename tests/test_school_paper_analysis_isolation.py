from __future__ import annotations

from contextlib import closing
from io import BytesIO

from openpyxl import load_workbook

from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_paper_api import (
    _bootstrap_admin,
    _create_school_teacher_class,
    _headers,
    _teacher_token,
    _write_exam,
)


def _school_token(client, username: str) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"username": username, "password": "secret123"})
    assert response.status_code == 200
    return _headers(response.json()["token"])


def test_mixed_school_publication_analysis_and_xlsx_are_school_class_scoped(web_client, tmp_path):
    admin_headers = _headers(_bootstrap_admin(web_client))
    school_a_id, teacher_id, class_a_id = _create_school_teacher_class(web_client, admin_headers["Authorization"][7:])
    school_a_headers = _school_token(web_client, "school_a")

    school_a_import = web_client.post(
        "/api/school/students/import",
        headers=school_a_headers,
        json={"class_id": class_a_id, "students": [{"student_no": "A01", "display_name": "Student A"}]},
    )
    assert school_a_import.status_code == 200
    student_a = school_a_import.json()["students"][0]

    school_b_response = web_client.post(
        "/api/schools", headers=admin_headers, json={"name": "Outside School"}
    )
    assert school_b_response.status_code == 200
    school_b_id = school_b_response.json()["school"]["id"]
    account_b = web_client.post(
        f"/api/schools/{school_b_id}/school-users",
        headers=admin_headers,
        json={"username": "school_b", "password": "secret123", "display_name": "School B"},
    )
    assert account_b.status_code == 200
    school_b_headers = _school_token(web_client, "school_b")
    class_b_response = web_client.post(
        "/api/school/classes", headers=school_b_headers, json={"name": "Class B", "grade": "G9"}
    )
    assert class_b_response.status_code == 200
    class_b_id = class_b_response.json()["class"]["id"]
    school_b_import = web_client.post(
        "/api/school/students/import",
        headers=school_b_headers,
        json={"class_id": class_b_id, "students": [{"student_no": "B01", "display_name": "Student B"}]},
    )
    assert school_b_import.status_code == 200
    student_b = school_b_import.json()["students"][0]

    exam_id = _write_exam(tmp_path, label="mixed-school", subject="Math")
    teacher_headers = _headers(_teacher_token(web_client))
    papers = web_client.get("/api/papers", headers=teacher_headers)
    assert papers.status_code == 200
    paper = next(item for item in papers.json()["papers"] if item["exam_id"] == exam_id)
    assert paper["school_id"] == school_a_id

    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        headers=admin_headers,
        json={"class_ids": [class_a_id, class_b_id], "title": "Cross-school publication"},
    )
    assert published.status_code == 200
    publication_id = published.json()["publication"]["id"]

    platform_root = default_platform_root()
    with closing(connect(platform_root)) as con, con:
        attempts = {
            str(row["student_id"]): str(row["id"])
            for row in con.execute(
                "SELECT id, student_id FROM student_attempts WHERE publication_id=?",
                (publication_id,),
            )
        }
        assert set(attempts) == {student_a["id"], student_b["id"]}
        for student_id, score, event_count, suffix in (
            (student_a["id"], 8, 1, "a"),
            (student_b["id"], 2, 3, "b"),
        ):
            attempt_id = attempts[student_id]
            con.execute(
                "UPDATE student_attempts SET status='submitted',started_at='start',submitted_at='submit',"
                "score=?,max_score=10,time_spent_seconds=120 WHERE id=?",
                (score, attempt_id),
            )
            con.execute(
                "INSERT INTO student_answers "
                "(id,attempt_id,question_id,answer_payload,is_correct,score,grading_status,responded_at) "
                "VALUES (?,?, 'math/q1', '{\"answer\":\"2\"}', ?, ?, 'graded', 'now')",
                (f"answer-{suffix}", attempt_id, int(score == 8), score),
            )
            for event_number in range(event_count):
                con.execute(
                    "INSERT INTO proctor_events "
                    "(id,attempt_id,student_id,publication_id,event_type,occurred_at,duration_ms,payload_json) "
                    "VALUES (?,?,?,?, 'visibility_hidden', ?, 50, '{}')",
                    (
                        f"event-{suffix}-{event_number}",
                        attempt_id,
                        student_id,
                        publication_id,
                        f"2026-10-01T10:0{event_number}:00Z",
                    ),
                )
        # Simulate a legacy attempt carrying multiple frozen memberships. School A
        # may report its own snapshot class but must not expose the foreign one.
        con.execute(
            "INSERT INTO attempt_class_snapshots "
            "(attempt_id,class_id,class_name,class_grade,captured_at,source) "
            "VALUES (?,?, 'Class B', 'G9', 'legacy', 'migration')",
            (attempts[student_a["id"]], class_b_id),
        )

    base = f"/api/papers/{paper['paper_id']}"
    school_a_result = web_client.get(
        f"{base}/analysis", headers=school_a_headers, params={"publication_id": publication_id}
    )
    assert school_a_result.status_code == 200
    analysis_a = school_a_result.json()["analysis"]
    assert analysis_a["summary"]["total_students"] == 1
    assert [row["student_no"] for row in analysis_a["students"]] == ["A01"]
    assert analysis_a["students"][0]["class_names"] == ["Class 1"]
    assert [item["id"] for item in analysis_a["available_classes"]] == [class_a_id]
    assert [(item["class_id"], item["student_count"]) for item in analysis_a["classes"]] == [(class_a_id, 1)]
    assert analysis_a["proctoring"]["event_count"] == 1
    assert next(item for item in analysis_a["questions"] if item["question_id"] == "math/q1")["answered_count"] == 1

    selected_a = web_client.get(
        f"{base}/analysis", headers=school_a_headers,
        params={"publication_id": publication_id, "class_id": class_a_id},
    )
    assert selected_a.status_code == 200
    assert selected_a.json()["analysis"]["summary"]["total_students"] == 1
    assert selected_a.json()["analysis"]["students"][0]["class_names"] == ["Class 1"]

    denied_analysis = web_client.get(
        f"{base}/analysis", headers=school_a_headers,
        params={"publication_id": publication_id, "class_id": class_b_id},
    )
    denied_xlsx = web_client.get(
        f"{base}/analysis.xlsx", headers=school_a_headers,
        params={"publication_id": publication_id, "class_id": class_b_id},
    )
    assert denied_analysis.status_code == 403
    assert denied_xlsx.status_code == 403

    xlsx_response = web_client.get(
        f"{base}/analysis.xlsx", headers=school_a_headers, params={"publication_id": publication_id}
    )
    assert xlsx_response.status_code == 200
    workbook = load_workbook(BytesIO(xlsx_response.content), data_only=True)
    values = [cell.value for sheet in workbook.worksheets for row in sheet.iter_rows() for cell in row]
    assert "Student A" in values and "A01" in values
    assert "Student B" not in values and "B01" not in values and "Class B" not in values
    exported_classes = list(workbook["classes"].iter_rows(min_row=2, values_only=True))
    assert [row[0] for row in exported_classes] == ["Class 1"]
    exported_students = list(workbook["students"].iter_rows(min_row=2, values_only=True))
    assert [row[0] for row in exported_students] == ["A01"]

    # A school still cannot analyze a paper owned by another school merely because
    # one publication was shared with its class.
    school_b_result = web_client.get(
        f"{base}/analysis", headers=school_b_headers, params={"publication_id": publication_id}
    )
    assert school_b_result.status_code == 403

    admin_result = web_client.get(
        f"{base}/analysis", headers=admin_headers, params={"publication_id": publication_id}
    )
    assert admin_result.status_code == 200
    analysis_admin = admin_result.json()["analysis"]
    assert analysis_admin["summary"]["total_students"] == 2
    assert {row["student_no"] for row in analysis_admin["students"]} == {"A01", "B01"}
    assert {item["id"] for item in analysis_admin["available_classes"]} == {class_a_id, class_b_id}

    # Reassignment changes the student's current school/class, but the attempt's
    # frozen class snapshot continues to identify the class that owned the attempt.
    with closing(connect(platform_root)) as con, con:
        con.execute("DELETE FROM class_students WHERE student_id=?", (student_a["id"],))
        con.execute("UPDATE students SET school_id=? WHERE id=?", (school_b_id, student_a["id"]))
        con.execute("INSERT INTO class_students (class_id,student_id) VALUES (?,?)", (class_b_id, student_a["id"]))
    after_transfer = web_client.get(
        f"{base}/analysis", headers=school_a_headers, params={"publication_id": publication_id}
    )
    assert after_transfer.status_code == 200
    transferred_analysis = after_transfer.json()["analysis"]
    assert [row["student_no"] for row in transferred_analysis["students"]] == ["A01"]
    assert transferred_analysis["students"][0]["class_names"] == ["Class 1"]
