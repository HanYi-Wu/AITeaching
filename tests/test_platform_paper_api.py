from __future__ import annotations

from io import BytesIO
from pathlib import Path

import yaml
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web import recent_projects, state
from solaire.web.app import ensure_project_layout
from solaire.web.platform_db import connect, default_platform_root


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _bootstrap_admin(client: TestClient) -> str:
    r = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert r.status_code == 200
    return str(r.json()["token"])


def _create_school_teacher_class(client: TestClient, admin_token: str) -> tuple[str, str, str]:
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
    school_headers = _headers(str(login.json()["token"]))

    teacher = client.post(
        "/api/school/teachers",
        json={
            "username": "teacher_li",
            "password": "teacher123",
            "display_name": "Li",
            "subjects": ["Math"],
        },
        headers=school_headers,
    )
    assert teacher.status_code == 200
    teacher_id = str(teacher.json()["teacher"]["id"])
    klass = client.post(
        "/api/school/classes",
        json={"name": "Class 1", "grade": "G10", "subject_hint": "Math"},
        headers=school_headers,
    )
    assert klass.status_code == 200
    class_id = str(klass.json()["class"]["id"])
    assigned = client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher_id, "class_id": class_id, "subject": "Math"},
        headers=school_headers,
    )
    assert assigned.status_code == 200
    return school_id, teacher_id, class_id


def _teacher_token(client: TestClient) -> str:
    r = client.post("/api/auth/login", json={"username": "teacher_li", "password": "teacher123"})
    assert r.status_code == 200
    return str(r.json()["token"])


def _write_exam(root: Path, label: str = "midterm", subject: str = "Math") -> str:
    ensure_project_layout(root)
    exam_id = f"{label}/{subject}"
    exam_dir = root / "exams" / label / subject
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "Midterm", "subject": subject, "export_label": label},
        question_libraries=[],
        template_path="templates/test.yaml",
        selected_items=[
            SelectedSection(section_id="Choice", question_ids=["math/q1", "math/q2"], score_per_item=5.0)
        ],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)
    return exam_id


def _write_empty_exam(root: Path, label: str = "empty", subject: str = "Math") -> str:
    ensure_project_layout(root)
    exam_id = f"{label}/{subject}"
    exam_dir = root / "exams" / label / subject
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "Empty Paper", "subject": subject, "export_label": label},
        question_libraries=[],
        template_path="templates/test.yaml",
        selected_items=[SelectedSection(section_id="Choice", question_ids=[], score_per_item=5.0)],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)
    return exam_id


def _write_legacy_exported_exam_with_bad_resource_path(root: Path) -> str:
    ensure_project_layout(root)
    library = root / "resource" / "math" / "quadratic"
    library.mkdir(parents=True, exist_ok=True)
    (library / "q01.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q01",
                "type": "single_choice",
                "content": "Discriminant of ax^2+bx+c=0?",
                "options": {"A": "b^2-4ac", "B": "b^2+4ac"},
                "answer": "A",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    exam_id = "quadratic-discriminant/math"
    exam_dir = root / "exams" / "quadratic-discriminant" / "math"
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "Quadratic Legacy", "subject": "math", "export_label": "quadratic-discriminant"},
        question_libraries=[
            QuestionLibraryRef(namespace="math/quadratic", path="../resource/math/quadratic"),
        ],
        template_path="../templates/test.yaml",
        selected_items=[
            SelectedSection(section_id="mcq", question_ids=["math/quadratic/q01"], score_per_item=5.0),
        ],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)
    return exam_id


def test_teacher_lists_exported_papers_with_default_offline_mode(web_client: TestClient, tmp_path: Path) -> None:
    admin_token = _bootstrap_admin(web_client)
    _create_school_teacher_class(web_client, admin_token)
    exam_id = _write_exam(tmp_path)
    teacher_headers = _headers(_teacher_token(web_client))

    listed = web_client.get("/api/papers", headers=teacher_headers)
    assert listed.status_code == 200
    papers = listed.json()["papers"]
    assert len(papers) == 1
    assert papers[0]["exam_id"] == exam_id
    assert papers[0]["title"] == "Midterm"
    assert papers[0]["delivery_mode"] == "offline"
    assert papers[0]["question_count"] == 2

    updated = web_client.patch(
        f"/api/papers/{papers[0]['paper_id']}",
        json={"delivery_mode": "online"},
        headers=teacher_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["paper"]["delivery_mode"] == "online"

    relisted = web_client.get("/api/papers", headers=teacher_headers)
    assert relisted.json()["papers"][0]["delivery_mode"] == "online"


def test_teacher_publishes_online_paper_to_assigned_classes(web_client: TestClient, tmp_path: Path) -> None:
    admin_token = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin_token)
    _write_exam(tmp_path)
    teacher_headers = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]

    web_client.patch(
        f"/api/papers/{paper['paper_id']}",
        json={"delivery_mode": "online"},
        headers=teacher_headers,
    )
    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={
            "class_ids": [class_id],
            "title": "Online Midterm",
            "description": "Answer online",
            "max_screen_switches": 2,
        },
        headers=teacher_headers,
    )

    assert published.status_code == 200
    body = published.json()
    assert body["publication"]["status"] == "published"
    assert body["publication"]["paper_id"] == paper["paper_id"]
    assert body["publication"]["class_ids"] == [class_id]
    assert body["publication"]["max_screen_switches"] == 2


def test_teacher_publishes_legacy_exported_paper_with_resource_path(web_client: TestClient, tmp_path: Path) -> None:
    admin_token = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin_token)
    _write_legacy_exported_exam_with_bad_resource_path(tmp_path)
    teacher_headers = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers?q=Quadratic", headers=teacher_headers).json()["papers"][0]

    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Quadratic Online"},
        headers=teacher_headers,
    )

    assert published.status_code == 200
    assert published.json()["publication"]["paper_id"] == paper["paper_id"]


def test_teacher_cannot_publish_empty_paper_and_can_choose_image_submission(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin_token = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin_token)
    _write_empty_exam(tmp_path)
    teacher_headers = _headers(_teacher_token(web_client))
    empty_paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]

    blocked = web_client.post(
        f"/api/papers/{empty_paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Empty Online"},
        headers=teacher_headers,
    )
    assert blocked.status_code == 400
    assert "at least one question" in blocked.json()["detail"]

    _write_exam(tmp_path, label="image-midterm", subject="Math")
    ready_paper = web_client.get("/api/papers?q=image", headers=teacher_headers).json()["papers"][0]
    published = web_client.post(
        f"/api/papers/{ready_paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Image Midterm", "submission_mode": "image_ai"},
        headers=teacher_headers,
    )
    assert published.status_code == 200
    assert published.json()["publication"]["submission_mode"] == "image_ai"

    duplicate = web_client.post(
        f"/api/papers/{ready_paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Duplicate Image Midterm", "submission_mode": "image_ai"},
        headers=teacher_headers,
    )
    assert duplicate.status_code == 400
    assert "already published" in duplicate.json()["detail"]


def test_teacher_syncs_paper_from_exam_id_for_compose_direct_publish(web_client: TestClient, tmp_path: Path) -> None:
    admin_token = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin_token)
    exam_id = _write_exam(tmp_path)
    teacher_headers = _headers(_teacher_token(web_client))

    synced = web_client.post("/api/papers/from-exam", json={"exam_id": exam_id}, headers=teacher_headers)
    assert synced.status_code == 200
    paper = synced.json()["paper"]
    assert paper["exam_id"] == exam_id
    assert paper["delivery_mode"] == "offline"

    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Compose Online"},
        headers=teacher_headers,
    )
    assert published.status_code == 200
    assert published.json()["publication"]["paper_id"] == paper["paper_id"]


def test_teacher_filters_papers_and_manages_publication_history(web_client: TestClient, tmp_path: Path) -> None:
    admin_token = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin_token)
    _write_exam(tmp_path, label="midterm", subject="Math")
    _write_exam(tmp_path, label="final", subject="English")
    teacher_headers = _headers(_teacher_token(web_client))

    listed = web_client.get("/api/papers?page=1&page_size=1&q=term", headers=teacher_headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 2
    assert len(listed.json()["papers"]) == 1

    filtered = web_client.get("/api/papers?subject=English", headers=teacher_headers)
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1
    assert filtered.json()["papers"][0]["subject"] == "English"

    paper = web_client.get("/api/papers?subject=Math", headers=teacher_headers).json()["papers"][0]
    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Managed Publication"},
        headers=teacher_headers,
    )
    assert published.status_code == 200
    publication_id = published.json()["publication"]["id"]

    publications = web_client.get(f"/api/papers/{paper['paper_id']}/publications", headers=teacher_headers)
    assert publications.status_code == 200
    assert publications.json()["publications"][0]["title"] == "Managed Publication"
    assert publications.json()["publications"][0]["class_names"] == ["Class 1"]

    paused = web_client.patch(
        f"/api/papers/{paper['paper_id']}/publications/{publication_id}",
        json={"status": "paused", "time_limit_minutes": 60},
        headers=teacher_headers,
    )
    assert paused.status_code == 200
    assert paused.json()["publication"]["status"] == "paused"
    assert paused.json()["publication"]["time_limit_minutes"] == 60

    resumed = web_client.patch(
        f"/api/papers/{paper['paper_id']}/publications/{publication_id}",
        json={"status": "published"},
        headers=teacher_headers,
    )
    assert resumed.status_code == 200
    assert resumed.json()["publication"]["status"] == "published"

    closed = web_client.patch(
        f"/api/papers/{paper['paper_id']}/publications/{publication_id}",
        json={"status": "closed", "show_results_immediately": True},
        headers=teacher_headers,
    )
    assert closed.status_code == 200
    assert closed.json()["publication"]["status"] == "closed"
    assert closed.json()["publication"]["show_results_immediately"] is True

    revoked = web_client.delete(
        f"/api/papers/{paper['paper_id']}/publications/{publication_id}",
        headers=teacher_headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["publication"]["status"] == "revoked"
    refreshed = web_client.get("/api/papers?subject=Math", headers=teacher_headers).json()["papers"][0]
    assert refreshed["publication_count"] == 0


def test_teacher_paper_workspace_works_without_opening_project(tmp_path: Path, monkeypatch) -> None:
    state.clear_root()
    monkeypatch.setattr(recent_projects, "app_data_dir", lambda: tmp_path / "appdata")
    client = TestClient(__import__("solaire.web.app", fromlist=["app"]).app)
    admin_token = _bootstrap_admin(client)
    _create_school_teacher_class(client, admin_token)
    teacher_headers = _headers(_teacher_token(client))

    info = client.get("/api/project/info")
    assert info.status_code == 200
    assert info.json()["bound"] is True
    assert "workspace" in str(info.json()["root"])

    listed = client.get("/api/papers", headers=teacher_headers)
    assert listed.status_code == 200
    assert listed.json()["papers"] == []


def test_paper_analysis_includes_publicq_summary_and_screen_switch_risk(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin_token = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin_token)
    _write_exam(tmp_path)

    school_login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    imported = web_client.post(
        "/api/school/students/import",
        json={
            "class_id": class_id,
            "students": [
                {"student_no": "S001", "display_name": "Student One"},
                {"student_no": "S002", "display_name": "Student Two"},
            ],
        },
        headers=school_headers,
    )
    assert imported.status_code == 200

    teacher_headers = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Online Midterm", "max_screen_switches": 1},
        headers=teacher_headers,
    )
    assert published.status_code == 200
    publication_id = published.json()["publication"]["id"]

    platform_root = default_platform_root()
    with connect(platform_root) as con:
        attempts = con.execute(
            "SELECT id, student_id FROM student_attempts WHERE publication_id = ? ORDER BY student_id",
            (publication_id,),
        ).fetchall()
        con.execute(
            """
            UPDATE student_attempts
            SET status = 'submitted', score = 80, max_score = 100,
                started_at = '2026-07-04T08:00:00+00:00',
                submitted_at = '2026-07-04T08:30:00+00:00',
                time_spent_seconds = 1800
            WHERE id = ?
            """,
            (str(attempts[0]["id"]),),
        )
        con.execute(
            """
            UPDATE student_attempts
            SET status = 'in_progress',
                started_at = '2026-07-04T08:10:00+00:00',
                time_spent_seconds = 600
            WHERE id = ?
            """,
            (str(attempts[1]["id"]),),
        )
        con.executemany(
            """
            INSERT INTO proctor_events (
              id, attempt_id, student_id, publication_id, event_type, occurred_at, duration_ms, payload_json
            )
            VALUES (?, ?, ?, ?, 'visibility_hidden', '2026-07-04T08:15:00+00:00', ?, '{}')
            """,
            [
                ("event1", str(attempts[0]["id"]), str(attempts[0]["student_id"]), publication_id, 1200),
                ("event2", str(attempts[0]["id"]), str(attempts[0]["student_id"]), publication_id, 800),
            ],
        )

        con.executemany(
            """
            INSERT INTO student_answers (
              id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'auto', '2026-07-04T08:20:00+00:00')
            """,
            [
                ("ans1", str(attempts[0]["id"]), "math/q1", '{"answer":"A"}', 1, 5.0),
                ("ans2", str(attempts[0]["id"]), "math/q2", '{"answer":"B"}', 0, 0.0),
            ],
        )

    history_paper = web_client.get("/api/papers?delivery_mode=online", headers=teacher_headers).json()["papers"][0]
    assert history_paper["total_student_count"] == 2
    assert history_paper["submitted_student_count"] == 1
    assert history_paper["in_progress_student_count"] == 1

    analysis = web_client.get(f"/api/papers/{paper['paper_id']}/analysis", headers=teacher_headers)
    assert analysis.status_code == 200
    body = analysis.json()["analysis"]
    assert body["summary"]["total_students"] == 2
    assert body["summary"]["completed_students"] == 1
    assert body["summary"]["in_progress_students"] == 1
    assert body["summary"]["completion_rate"] == 50
    assert body["summary"]["average_score"] == 80
    assert body["proctoring"]["screen_switch_count"] == 2
    assert body["proctoring"]["flagged_student_count"] == 1
    assert body["proctoring"]["exceeded_student_count"] == 1
    assert body["students"][0]["screen_switch_count"] == 2
    assert body["students"][0]["screen_switch_limit"] == 1
    assert body["students"][0]["screen_switch_exceeded"] is True
    assert body["modules"][0]["module_id"] == "Choice"
    assert body["modules"][0]["question_count"] == 2
    assert body["modules"][0]["student_count"] == 2
    assert 0 <= body["modules"][0]["average_score_percent"] <= 100
    assert body["classes"][0]["class_name"] == "Class 1"
    assert body["classes"][0]["student_count"] == 2
    assert body["classes"][0]["completed_count"] == 1
    assert body["classes"][0]["completion_rate"] == 50
    questions = {item["question_id"]: item for item in body["questions"]}
    assert questions["math/q1"]["answered_count"] == 1
    assert questions["math/q1"]["accuracy_rate"] == 100
    assert questions["math/q2"]["accuracy_rate"] == 0
    assert {axis["id"] for axis in body["radar"]} == {
        "completion",
        "score",
        "time_efficiency",
        "proctoring",
        "module_mastery",
    }
    assert {axis["label"] for axis in body["radar"]} == {
        "完成率",
        "得分率",
        "时间效率",
        "监考诚信",
        "模块掌握度",
    }

    xlsx_report = web_client.get(f"/api/papers/{paper['paper_id']}/analysis.xlsx", headers=teacher_headers)
    assert xlsx_report.status_code == 200
    assert xlsx_report.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    workbook = load_workbook(BytesIO(xlsx_report.content), data_only=True)
    assert {"summary", "students", "classes", "questions", "modules", "radar"}.issubset(set(workbook.sheetnames))
    assert workbook["summary"]["A1"].value == "metric"
    assert workbook["students"]["A1"].value == "student_no"
    student_names = [row[1] for row in workbook["students"].iter_rows(min_row=2, values_only=True)]
    assert "Student One" in student_names

    pdf_report = web_client.get(f"/api/papers/{paper['paper_id']}/analysis.pdf", headers=teacher_headers)
    assert pdf_report.status_code == 200
    assert pdf_report.headers["content-type"].startswith("application/pdf")
    assert pdf_report.content.startswith(b"%PDF")


def test_teacher_reviews_image_submission_with_manual_and_ai_grade_suggestions(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin_token = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin_token)
    school_login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    imported = web_client.post(
        "/api/school/students/import",
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
        headers=school_headers,
    )
    assert imported.status_code == 200
    student_account = {
        "username": imported.json()["students"][0]["account_username"],
        "password": imported.json()["students"][0]["initial_password"],
    }
    _write_exam(tmp_path)
    teacher_headers = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    published = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Image Midterm", "submission_mode": "image_ai"},
        headers=teacher_headers,
    )
    assert published.status_code == 200
    publication_id = published.json()["publication"]["id"]

    student_login = web_client.post("/api/auth/login", json=student_account)
    student_headers = _headers(str(student_login.json()["token"]))
    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=student_headers)
    assert started.status_code == 200
    attempt_id = started.json()["attempt"]["id"]
    saved = web_client.post(
        f"/api/student/attempts/{attempt_id}/answers",
        json={
            "answers": [
                {
                    "question_id": "math/q1",
                    "images": [
                        {
                            "name": "answer.png",
                            "mime_type": "image/png",
                            "data_url": "data:image/png;base64,ZmFrZQ==",
                        }
                    ],
                }
            ]
        },
        headers=student_headers,
    )
    assert saved.status_code == 200
    submitted = web_client.post(
        f"/api/student/attempts/{attempt_id}/submit",
        json={"time_spent_seconds": 120},
        headers=student_headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["attempt"]["score"] is None

    submissions = web_client.get(f"/api/papers/{paper['paper_id']}/submissions", headers=teacher_headers)
    assert submissions.status_code == 200
    first_answer = submissions.json()["submissions"][0]["answers"][0]
    assert first_answer["question_id"] == "math/q1"
    assert first_answer["images"][0]["name"] == "answer.png"
    assert first_answer["grading_status"] == "pending"

    suggested = web_client.post(
        f"/api/papers/{paper['paper_id']}/attempts/{attempt_id}/ai-grade",
        json={"question_ids": ["math/q1"]},
        headers=teacher_headers,
    )
    assert suggested.status_code == 200
    suggestion = suggested.json()["suggestions"][0]
    assert suggestion["question_id"] == "math/q1"
    assert suggestion["status"] == "needs_review"

    graded = web_client.patch(
        f"/api/papers/{paper['paper_id']}/attempts/{attempt_id}/answers/math%2Fq1/grade",
        json={"score": 4, "feedback": "Readable enough", "is_correct": True},
        headers=teacher_headers,
    )
    assert graded.status_code == 200
    assert graded.json()["answer"]["score"] == 4
    refreshed = web_client.get(f"/api/papers/{paper['paper_id']}/analysis", headers=teacher_headers).json()["analysis"]
    assert refreshed["summary"]["average_score"] == 80
