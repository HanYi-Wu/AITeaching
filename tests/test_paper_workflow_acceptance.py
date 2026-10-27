"""Publication-to-results acceptance through the existing public endpoints."""

from tests.test_platform_paper_api import _write_exam
from tests.test_platform_student_api import (
    _bootstrap_admin, _create_teacher_class_student, _headers, _school_headers, _teacher_headers,
)


def test_conditional_grading_is_allowed_for_desktop_origins(web_client):
    response = web_client.options(
        "/api/papers/paper/attempts/attempt/answers/question/grade",
        headers={
            "Origin": "tauri://localhost",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type,if-match",
        },
    )
    assert response.status_code == 200
    assert "if-match" in response.headers["access-control-allow-headers"].lower()


def test_saved_answers_resume_and_confirmed_grades_keep_attempt_identity(web_client, tmp_path):
    client = web_client
    admin = _bootstrap_admin(client)
    school, _ = _school_headers(client, admin)
    class_id, account = _create_teacher_class_student(client, school)
    _write_exam(tmp_path)
    teacher = _teacher_headers(client)
    paper_id = client.get("/api/papers", headers=teacher).json()["papers"][0]["paper_id"]
    publication = client.post(f"/api/papers/{paper_id}/publish", headers=teacher,
                              json={"class_ids": [class_id]})
    assert publication.status_code == 200
    publication_id = publication.json()["publication"]["id"]
    frozen_question_path = tmp_path / "resource" / "math" / "q1.yaml"
    frozen_question_path.write_text(
        frozen_question_path.read_text(encoding="utf-8").replace("1+1=?", "source changed after publication"),
        encoding="utf-8",
    )
    assert client.post(f"/api/papers/{paper_id}/publish", headers=teacher,
                       json={"class_ids": [class_id]}).status_code == 400
    token = client.post("/api/auth/login", json=account).json()["token"]
    student = _headers(token)
    start_url = f"/api/student/publications/{publication_id}/start"
    started = client.post(start_url, headers=student)
    assert started.status_code == 200
    assert started.json()["questions"][0]["content"] == "1+1=?"
    attempt_id = started.json()["attempt"]["id"]
    original_snapshot = started.json()["attempt"]["snapshot_version"]
    payload = {"answers": [
        {"question_id": "math/q1", "answer": "student working"},
        {"question_id": "math/q2", "answer": "second working"},
    ]}
    saved = client.post(f"/api/student/attempts/{attempt_id}/answers", headers=student, json=payload)
    assert saved.status_code == 200
    resumed = client.post(start_url, headers=student).json()
    assert resumed["attempt"]["id"] == attempt_id
    assert resumed["attempt"]["snapshot_version"] == original_snapshot
    assert resumed["saved_answers"][0]["answer"] == "student working"
    submitted = client.post(f"/api/student/attempts/{attempt_id}/submit", headers=student, json=payload)
    assert submitted.status_code == 200
    assert submitted.json()["attempt"]["submitted_answers_accepted"] is True
    repeated = client.post(f"/api/student/attempts/{attempt_id}/submit", headers=student,
                           json={"answers": [{"question_id": "math/q1", "answer": "late answer"}]})
    assert repeated.status_code == 200
    assert repeated.json()["attempt"]["submitted_answers_accepted"] is False
    hidden = client.get("/api/student/results", headers=student).json()["results"][0]
    assert hidden["score"] is None
    assert client.get(f"/api/papers/{paper_id}/submissions", headers=student).status_code == 403

    submissions = client.get(f"/api/papers/{paper_id}/submissions", headers=teacher).json()["submissions"]
    submission = next(row for row in submissions if row["attempt_id"] == attempt_id)
    assert submission["answers"][0]["answer"] == "student working"
    assert submission["answers"][0]["content"] == "1+1=?"
    for answer, score in zip(submission["answers"], (3, 4), strict=True):
        grade_url = f"/api/papers/{paper_id}/attempts/{attempt_id}/answers/{answer['question_id']}/grade"
        version = answer["grading_version"]
        graded = client.patch(grade_url, headers={**teacher, "If-Match": version},
                              json={"score": score, "feedback": "confirmed"})
        assert graded.status_code == 200
        assert client.patch(grade_url, headers={**teacher, "If-Match": version},
                            json={"score": 1}).status_code == 409
    complete_url = f"/api/papers/{paper_id}/attempts/{attempt_id}/complete-grading"
    completed = client.post(complete_url, headers=teacher).json()["attempt"]
    assert client.post(complete_url, headers=teacher).json()["attempt"]["grading_completed_at"] == completed["grading_completed_at"]
    result = client.get("/api/student/results", headers=student).json()["results"][0]
    assert (result["attempt_id"], result["score"], result["max_score"]) == (attempt_id, 7, 10)
    assert [answer["feedback"] for answer in result["answers"]] == ["confirmed", "confirmed"]
    assert result["answers"][0]["content"] == "1+1=?"

    refreshed_submission = next(
        row
        for row in client.get(f"/api/papers/{paper_id}/submissions", headers=teacher).json()["submissions"]
        if row["attempt_id"] == attempt_id
    )
    analysis = client.get(
        f"/api/papers/{paper_id}/analysis?publication_id={publication_id}",
        headers=teacher,
    ).json()["analysis"]
    analysis_student = analysis["students"][0]
    assert (refreshed_submission["score"], refreshed_submission["max_score"]) == (result["score"], result["max_score"])
    assert analysis_student["score_percent"] == result["score_percent"] == 70
    assert analysis["summary"]["average_score"] == 70
