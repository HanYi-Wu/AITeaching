from __future__ import annotations

from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, SelectedSection
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
        json={"class_ids": [class_id], "title": "Online Midterm", "description": "Answer online"},
        headers=teacher_headers,
    )

    assert published.status_code == 200
    body = published.json()
    assert body["publication"]["status"] == "published"
    assert body["publication"]["paper_id"] == paper["paper_id"]
    assert body["publication"]["class_ids"] == [class_id]


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
        json={"class_ids": [class_id], "title": "Online Midterm"},
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
    assert body["students"][0]["screen_switch_count"] == 2
