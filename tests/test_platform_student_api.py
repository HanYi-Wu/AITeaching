from __future__ import annotations

from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web.app import ensure_project_layout


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _bootstrap_admin(client: TestClient) -> str:
    r = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert r.status_code == 200
    return str(r.json()["token"])


def _school_headers(client: TestClient, admin_token: str) -> tuple[dict[str, str], str]:
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


def _create_teacher_class_student(client: TestClient, school_headers: dict[str, str]) -> tuple[str, dict[str, str]]:
    teacher = client.post(
        "/api/school/teachers",
        json={"username": "teacher_li", "password": "teacher123", "display_name": "Li", "subjects": ["Math"]},
        headers=school_headers,
    )
    assert teacher.status_code == 200
    teacher_id = str(teacher.json()["teacher"]["id"])
    klass = client.post("/api/school/classes", json={"name": "Class 1", "grade": "G10"}, headers=school_headers)
    assert klass.status_code == 200
    class_id = str(klass.json()["class"]["id"])
    assigned = client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher_id, "class_id": class_id},
        headers=school_headers,
    )
    assert assigned.status_code == 200
    imported = client.post(
        "/api/school/students/import",
        json={
            "class_id": class_id,
            "students": [{"student_no": "S001", "display_name": "Student One"}],
        },
        headers=school_headers,
    )
    assert imported.status_code == 200
    student = imported.json()["students"][0]
    return class_id, {
        "username": student["account_username"],
        "password": student["initial_password"],
    }


def _teacher_headers(client: TestClient) -> dict[str, str]:
    login = client.post("/api/auth/login", json={"username": "teacher_li", "password": "teacher123"})
    assert login.status_code == 200
    return _headers(str(login.json()["token"]))


def _write_online_exam(root: Path) -> str:
    ensure_project_layout(root)
    library = root / "resource" / "math"
    library.mkdir(parents=True, exist_ok=True)
    (library / "q1.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q1",
                "type": "single_choice",
                "content": "1+1=?",
                "options": {"A": "2", "B": "3"},
                "answer": "A",
                "analysis": "1+1=2",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (library / "q2.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q2",
                "type": "single_choice",
                "content": "2+2=?",
                "options": {"A": "3", "B": "4"},
                "answer": "B",
                "analysis": "2+2=4",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    exam_id = "midterm/Math"
    exam_dir = root / "exams" / "midterm" / "Math"
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "Online Midterm", "subject": "Math", "export_label": "midterm"},
        question_libraries=[QuestionLibraryRef(namespace="math", path="../../../resource/math")],
        template_path="templates/test.yaml",
        selected_items=[SelectedSection(section_id="Choice", question_ids=["math/q1", "math/q2"], score_per_item=5.0)],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)
    return exam_id


def test_student_answers_online_paper_and_views_result_analysis(web_client: TestClient, tmp_path: Path) -> None:
    admin_token = _bootstrap_admin(web_client)
    school_headers, _ = _school_headers(web_client, admin_token)
    class_id, student_account = _create_teacher_class_student(web_client, school_headers)
    _write_online_exam(tmp_path)
    teacher_headers = _teacher_headers(web_client)
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={
            "class_ids": [class_id],
            "title": "Online Midterm",
            "show_results_immediately": True,
            "max_screen_switches": 2,
        },
        headers=teacher_headers,
    )
    assert published.status_code == 200
    publication_id = published.json()["publication"]["id"]

    student_login = web_client.post("/api/auth/login", json=student_account)
    assert student_login.status_code == 200
    student_headers = _headers(str(student_login.json()["token"]))

    listed = web_client.get("/api/student/papers", headers=student_headers)
    assert listed.status_code == 200
    assigned = listed.json()["papers"][0]
    assert assigned["publication_id"] == publication_id
    assert assigned["status"] == "not_started"
    assert assigned["question_count"] == 2
    assert assigned["time_limit_minutes"] is None
    assert "screen_switch_count" not in assigned
    assert "screen_switch_limit" not in assigned

    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=student_headers)
    assert started.status_code == 200
    body = started.json()
    attempt_id = body["attempt"]["id"]
    assert body["attempt"]["status"] == "in_progress"
    assert body["questions"][0]["question_id"] == "math/q1"
    assert body["questions"][0]["content"] == "1+1=?"
    assert body["questions"][0]["options"] == {"A": "2", "B": "3"}
    assert "answer" not in body["questions"][0]
    assert "analysis" not in body["questions"][0]

    saved = web_client.post(
        f"/api/student/attempts/{attempt_id}/answers",
        json={"answers": [{"question_id": "math/q1", "answer": "A"}, {"question_id": "math/q2", "answer": "A"}]},
        headers=student_headers,
    )
    assert saved.status_code == 200
    assert saved.json()["answer_count"] == 2

    event = web_client.post(
        f"/api/student/attempts/{attempt_id}/proctor-events",
        json={"event_type": "visibility_hidden", "duration_ms": 1500, "payload": {"reason": "tab-hidden"}},
        headers=student_headers,
    )
    assert event.status_code == 200
    assert event.json()["event"]["event_type"] == "visibility_hidden"

    submitted = web_client.post(
        f"/api/student/attempts/{attempt_id}/submit",
        json={"time_spent_seconds": 300},
        headers=student_headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["attempt"]["status"] == "submitted"
    assert submitted.json()["attempt"]["score"] == 5.0
    assert submitted.json()["attempt"]["max_score"] == 10.0

    results = web_client.get("/api/student/results", headers=student_headers)
    assert results.status_code == 200
    result = results.json()["results"][0]
    assert result["attempt_id"] == attempt_id
    assert result["score"] == 5.0
    assert result["max_score"] == 10.0
    assert result["score_percent"] == 50.0
    assert "screen_switch_count" not in result
    assert "screen_switch_limit" not in result
    assert "screen_switch_exceeded" not in result
    assert result["analysis"]["correct_count"] == 1
    assert result["analysis"]["wrong_count"] == 1
    assert result["answers"][0]["is_correct"] is True
    assert result["answers"][1]["is_correct"] is False


def test_paused_publication_blocks_student_collection_and_exposes_time_limit(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin_token = _bootstrap_admin(web_client)
    school_headers, _ = _school_headers(web_client, admin_token)
    class_id, student_account = _create_teacher_class_student(web_client, school_headers)
    _write_online_exam(tmp_path)
    teacher_headers = _teacher_headers(web_client)
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]

    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Timed Midterm", "time_limit_minutes": 45},
        headers=teacher_headers,
    )
    assert published.status_code == 200
    assert published.json()["publication"]["time_limit_minutes"] == 45
    publication_id = published.json()["publication"]["id"]

    student_login = web_client.post("/api/auth/login", json=student_account)
    assert student_login.status_code == 200
    student_headers = _headers(str(student_login.json()["token"]))

    listed = web_client.get("/api/student/papers", headers=student_headers)
    assert listed.status_code == 200
    assigned = listed.json()["papers"][0]
    assert assigned["time_limit_minutes"] == 45
    assert assigned["can_answer"] is True

    paused = web_client.patch(
        f"/api/papers/{paper['paper_id']}/publications/{publication_id}",
        json={"status": "paused"},
        headers=teacher_headers,
    )
    assert paused.status_code == 200
    assert paused.json()["publication"]["status"] == "paused"

    relisted = web_client.get("/api/student/papers", headers=student_headers)
    assert relisted.status_code == 200
    paused_paper = relisted.json()["papers"][0]
    assert paused_paper["publication_status"] == "paused"
    assert paused_paper["can_answer"] is False

    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=student_headers)
    assert started.status_code == 400
    assert "not open" in started.json()["detail"]
