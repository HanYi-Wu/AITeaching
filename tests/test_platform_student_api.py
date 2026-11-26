from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
import json

import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web.app import ensure_project_layout
from solaire.web.platform_db import connect, default_platform_root, init_platform_db


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_teacher_workbench_counts_only_owned_released_work(web_client: TestClient, tmp_path: Path):
    school_headers, _ = _school_headers(web_client, _bootstrap_admin(web_client))
    class_id, account = _create_teacher_class_student(web_client, school_headers)
    _write_online_exam(tmp_path)
    teacher = _teacher_headers(web_client)
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    publication = web_client.post(f"/api/papers/{paper['paper_id']}/publish", json={"class_ids": [class_id]}, headers=teacher).json()["publication"]
    url = "/api/teacher/workbench"
    assert web_client.get(url, headers=teacher).json()["outstanding_attempts"] == 1
    student = _headers(web_client.post("/api/auth/login", json=account).json()["token"])
    assert web_client.get(url, headers=student).status_code == 403
    attempt = web_client.post(f"/api/student/publications/{publication['id']}/start", headers=student).json()["attempt"]
    # Mixed exam submission: grading has not been released yet.
    with connect(default_platform_root()) as db:
        db.execute("UPDATE student_attempts SET status='submitted', submitted_at=? WHERE id=?", (datetime.now(UTC).isoformat(), attempt["id"]))
    result = web_client.get(url, headers=teacher).json()
    assert result["pending_total"] == 1 and result["outstanding_attempts"] == 0
    assert result["queue"][0]["paper_id"] == paper["paper_id"] and result["queue"][0]["attempt_id"] == attempt["id"]
    other = {"username": "teacher_other", "password": "teacher321"}
    assert web_client.post("/api/school/teachers", json={**other, "display_name": "Other", "subjects": ["Math"]}, headers=school_headers).status_code == 200
    other_token = _headers(web_client.post("/api/auth/login", json=other).json()["token"])
    assert web_client.get(url, headers=other_token).json()["queue"] == []
    assert web_client.get("/api/papers", params={"paper_id": paper["paper_id"]}, headers=other_token).json()["papers"] == []


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


def _write_online_exam_without_library_refs(root: Path) -> str:
    """Mirror workspaces created by the compose page: qualified IDs but no question_libraries."""
    ensure_project_layout(root)
    library = root / "resource" / "math" / "sequence-review"
    library.mkdir(parents=True, exist_ok=True)
    (library / "choice_01.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "choice_01",
                "type": "single_choice",
                "content": "等差数列 2, 5, 8 的下一项是？",
                "options": {"A": "10", "B": "11", "C": "12"},
                "answer": "B",
                "analysis": "公差为 3。",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (library / "short_01.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "short_01",
                "type": "short_answer",
                "content": "写出该数列的公差。",
                "answer": "3",
                "analysis": "相邻两项之差为 3。",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (root / "templates" / "test.yaml").write_text(
        yaml.safe_dump(
            {
                "template_id": "test",
                "layout": "single_column",
                "latex_base": "exam-zh-base.tex.j2",
                "sections": [
                    {"section_id": "选择题", "type": "single_choice", "required_count": 1, "score_per_item": 5},
                    {"section_id": "解答题", "type": "short_answer", "required_count": 1, "score_per_item": 10},
                ],
                "metadata_defaults": {},
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    exam_id = "summer/Math"
    exam_dir = root / "exams" / "summer" / "Math"
    exam_dir.mkdir(parents=True, exist_ok=True)
    (exam_dir / "exam.yaml").write_text(
        yaml.safe_dump(
            {
                "exam_id": exam_id,
                "name": "暑假测试",
                "subject": "Math",
                "export_label": "summer",
                "template_ref": "default",
                "template_path": "templates/test.yaml",
                "selected_items": [
                    {
                        "section_id": "选择题",
                        "question_ids": ["math/sequence-review/choice_01"],
                        "score_per_item": 5,
                    },
                    {
                        "section_id": "解答题",
                        "question_ids": ["math/sequence-review/short_01"],
                    },
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return exam_id


def _publish_exam_for_student(
    client: TestClient,
    tmp_path: Path,
    *,
    exam_id: str,
) -> tuple[dict[str, str], str, str]:
    admin_token = _bootstrap_admin(client)
    school_headers, _ = _school_headers(client, admin_token)
    class_id, student_account = _create_teacher_class_student(client, school_headers)
    teacher_headers = _teacher_headers(client)
    # Fixtures are authored by this teacher, not unattributed shared legacy files.
    from solaire.common.actor_context import actor
    from solaire.web.teacher_bank import bank_resource_root
    import shutil
    with connect(default_platform_root()) as con:
        teacher_id = con.execute("SELECT id FROM users WHERE username='teacher_li'").fetchone()['id']
    token = actor.set({'id': teacher_id, 'role': 'teacher'})
    try:
        shutil.copytree(tmp_path / 'resource' / 'math', bank_resource_root(tmp_path) / 'math', dirs_exist_ok=True)
    finally:
        actor.reset(token)
    paper = next(
        item for item in client.get("/api/papers", headers=teacher_headers).json()["papers"] if item["exam_id"] == exam_id
    )
    published = client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "暑假测试", "show_results_immediately": True},
        headers=teacher_headers,
    )
    assert published.status_code == 200
    login = client.post("/api/auth/login", json=student_account)
    assert login.status_code == 200
    return _headers(str(login.json()["token"])), str(published.json()["publication"]["id"]), str(paper["paper_id"])


def test_exam_without_library_refs_loads_real_question_content_and_scores(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id = _write_online_exam_without_library_refs(tmp_path)
    student_headers, publication_id, _paper_id = _publish_exam_for_student(
        web_client,
        tmp_path,
        exam_id=exam_id,
    )

    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=student_headers)
    assert started.status_code == 200
    question = started.json()["questions"][0]
    assert question["type"] == "single_choice"
    assert question["content"] == "等差数列 2, 5, 8 的下一项是？"
    assert question["options"] == {"A": "10", "B": "11", "C": "12"}
    assert question["content"] != question["question_id"]

    submitted = web_client.post(
        f"/api/student/attempts/{started.json()['attempt']['id']}/submit",
        json={"answers": [{"question_id": question["question_id"], "answer": "B"}]},
        headers=student_headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["attempt"]["score"] is None
    assert submitted.json()["attempt"]["max_score"] is None

    teacher_headers = _teacher_headers(web_client)
    pending_paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    assert pending_paper["submitted_student_count"] == 1
    assert pending_paper["published_student_count"] == 0
    assert submitted.json()["attempt"]["results_released"] is False


def test_legacy_placeholder_snapshot_is_repaired_and_frozen_before_answering(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id = _write_online_exam_without_library_refs(tmp_path)
    student_headers, publication_id, _paper_id = _publish_exam_for_student(
        web_client,
        tmp_path,
        exam_id=exam_id,
    )
    platform_root = default_platform_root()
    with connect(platform_root) as con:
        attempt = con.execute(
            "SELECT id, question_payload_json FROM student_attempts WHERE publication_id = ?",
            (publication_id,),
        ).fetchone()
        assert attempt is not None
        original = json.loads(str(attempt["question_payload_json"]))
        placeholder = [
            {
                **item,
                "score_per_item": 5,
                "type": "unknown",
                "content": item["question_id"],
                "options": None,
            }
            for item in original
        ]
        con.execute(
            "UPDATE student_attempts SET question_payload_json = ?, answer_key_json = '{}' WHERE id = ?",
            (json.dumps(placeholder, ensure_ascii=False), str(attempt["id"])),
        )

    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=student_headers)
    assert started.status_code == 200
    assert started.json()["questions"][0]["content"] == "等差数列 2, 5, 8 的下一项是？"
    with connect(platform_root) as con:
        repaired = con.execute(
            "SELECT question_payload_json, answer_key_json FROM student_attempts WHERE id = ?",
            (str(attempt["id"]),),
        ).fetchone()
    assert repaired is not None
    repaired_questions = json.loads(str(repaired["question_payload_json"]))
    assert repaired_questions[0]["type"] == "single_choice"
    assert [item["score_per_item"] for item in repaired_questions] == [5.0, 10.0]
    assert json.loads(str(repaired["answer_key_json"])) == {
        "math/sequence-review/choice_01": "B",
        "math/sequence-review/short_01": "3",
    }


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
    assert assigned["paper_max_score"] == 10.0
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
    assert submitted.json()["attempt"]["grading_completed_at"]

    immediate_results = web_client.get("/api/student/results", headers=student_headers)
    assert immediate_results.status_code == 200
    assert immediate_results.json()["results"][0]["score"] == 5.0
    assert len(immediate_results.json()["results"][0]["answers"]) == 2

    completed = web_client.post(
        f"/api/papers/{paper['paper_id']}/attempts/{attempt_id}/complete-grading",
        headers=teacher_headers,
    )
    assert completed.status_code == 200
    assert completed.json()["attempt"]["grading_completed_at"]

    published_paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    assert published_paper["submitted_student_count"] == 1
    assert published_paper["published_student_count"] == 1

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
    assert result["answers"][0]["correct_answer"] == "A"
    assert result["answers"][0]["analysis"] == "1+1=2"


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


def test_student_resumes_saved_answers_and_personalized_questions_are_scored(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin_token = _bootstrap_admin(web_client)
    school_headers, _ = _school_headers(web_client, admin_token)
    class_id, student_account = _create_teacher_class_student(web_client, school_headers)
    _write_online_exam(tmp_path)
    teacher_headers = _teacher_headers(web_client)
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "title": "Personalized", "time_limit_minutes": 1},
        headers=teacher_headers,
    ).json()["publication"]

    platform_root = default_platform_root()
    init_platform_db(platform_root)
    frozen_questions = [
        {
            "question_id": "adaptive/student/q1",
            "header": "专项题 1",
            "section_id": "practice",
            "score_per_item": 6,
            "type": "single_choice",
            "content": "3+4=?",
            "options": {"A": "6", "B": "7"},
        }
    ]
    with connect(platform_root) as con:
        attempt_id = str(
            con.execute(
                "SELECT id FROM student_attempts WHERE publication_id = ?",
                (publication["id"],),
            ).fetchone()["id"]
        )
        con.execute(
            """
            UPDATE student_attempts
            SET question_payload_json = ?, answer_key_json = ?, practice_metadata_json = ?
            WHERE id = ?
            """,
            (
                json.dumps(frozen_questions, ensure_ascii=False),
                json.dumps({"adaptive/student/q1": "B"}),
                json.dumps({"kind": "reinforcement"}),
                attempt_id,
            ),
        )

    student_login = web_client.post("/api/auth/login", json=student_account)
    student_headers = _headers(str(student_login.json()["token"]))
    started = web_client.post(
        f"/api/student/publications/{publication['id']}/start",
        headers=student_headers,
    )
    assert started.status_code == 200
    assert started.json()["questions"] == frozen_questions
    assert started.json()["attempt"]["practice_metadata"] == {"kind": "reinforcement"}
    assert 0 < started.json()["attempt"]["remaining_seconds"] <= 60

    invalid_question = web_client.post(
        f"/api/student/attempts/{attempt_id}/answers",
        json={"answers": [{"question_id": "not-in-this-attempt", "answer": "B"}]},
        headers=student_headers,
    )
    assert invalid_question.status_code == 400
    assert "does not belong" in invalid_question.json()["detail"]

    saved = web_client.post(
        f"/api/student/attempts/{attempt_id}/answers",
        json={"answers": [{"question_id": "adaptive/student/q1", "answer": "B"}]},
        headers=student_headers,
    )
    assert saved.status_code == 200
    resumed = web_client.post(
        f"/api/student/publications/{publication['id']}/start",
        headers=student_headers,
    )
    assert resumed.status_code == 200
    assert resumed.json()["saved_answers"] == [
        {"question_id": "adaptive/student/q1", "answer": "B", "images": []}
    ]
    assert 0 < resumed.json()["attempt"]["remaining_seconds"] <= started.json()["attempt"]["remaining_seconds"]

    server_started_at = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
    with connect(default_platform_root()) as con:
        con.execute(
            "UPDATE student_attempts SET started_at = ? WHERE id = ?",
            (server_started_at, attempt_id),
        )
        con.execute("DELETE FROM student_answers WHERE attempt_id = ?", (attempt_id,))

    expired_listing = web_client.get("/api/student/papers", headers=student_headers)
    assert expired_listing.status_code == 200
    expired_paper = next(item for item in expired_listing.json()["papers"] if item["attempt_id"] == attempt_id)
    assert expired_paper["status"] == "in_progress"
    assert expired_paper["can_answer"] is True
    assert expired_paper["remaining_seconds"] == 0

    expired_resume = web_client.post(
        f"/api/student/publications/{publication['id']}/start",
        headers=student_headers,
    )
    assert expired_resume.status_code == 200
    assert expired_resume.json()["attempt"]["remaining_seconds"] == 0

    submitted = web_client.post(
        f"/api/student/attempts/{attempt_id}/submit",
        json={
            "time_spent_seconds": 12,
            "answers": [{"question_id": "adaptive/student/q1", "answer": "B"}],
        },
        headers=student_headers,
    )
    assert submitted.status_code == 200
    assert submitted.json()["attempt"]["score"] == 6.0
    assert submitted.json()["attempt"]["max_score"] == 6.0
    assert submitted.json()["attempt"]["time_spent_seconds"] == 60

    late_save = web_client.post(
        f"/api/student/attempts/{attempt_id}/answers",
        json={"answers": [{"question_id": "adaptive/student/q1", "answer": "A"}]},
        headers=student_headers,
    )
    assert late_save.status_code == 400
    result = web_client.get("/api/student/results", headers=student_headers).json()["results"][0]
    assert result["score"] == 6.0


def test_proctor_events_are_validated_deduplicated_and_only_visibility_counts_as_switch(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin_token = _bootstrap_admin(web_client)
    school_headers, _ = _school_headers(web_client, admin_token)
    class_id, student_account = _create_teacher_class_student(web_client, school_headers)
    _write_online_exam(tmp_path)
    teacher_headers = _teacher_headers(web_client)
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [class_id], "max_screen_switches": 1},
        headers=teacher_headers,
    ).json()["publication"]
    student_login = web_client.post("/api/auth/login", json=student_account)
    student_headers = _headers(str(student_login.json()["token"]))
    attempt_id = web_client.post(
        f"/api/student/publications/{publication['id']}/start",
        headers=student_headers,
    ).json()["attempt"]["id"]

    invalid = web_client.post(
        f"/api/student/attempts/{attempt_id}/proctor-events",
        json={"event_type": "camera_snapshot", "payload": {}},
        headers=student_headers,
    )
    assert invalid.status_code == 400

    for event_type in ("window_blur", "copy", "paste", "fullscreen_exit", "visibility_hidden"):
        first = web_client.post(
            f"/api/student/attempts/{attempt_id}/proctor-events",
            json={"event_type": event_type, "duration_ms": 500, "payload": {"source": "test"}},
            headers=student_headers,
        )
        assert first.status_code == 200
        duplicate = web_client.post(
            f"/api/student/attempts/{attempt_id}/proctor-events",
            json={"event_type": event_type, "duration_ms": 500, "payload": {"source": "test"}},
            headers=student_headers,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["event"]["deduplicated"] is True

    analysis_url = f"/api/papers/{paper['paper_id']}/analysis"
    baseline = web_client.get(analysis_url, headers=teacher_headers).json()["analysis"]["students"][0]
    event_url = f"/api/student/attempts/{attempt_id}/proctor-events"
    rhythm = {"idle_seconds": 52, "burst_seconds": 5, "changed_questions": 3, "context_signal": "paste"}
    rejected = web_client.post(event_url, headers=student_headers,
        json={"event_type": "answer_resume_burst", "payload": {**rhythm, "text": "do not retain"}})
    assert rejected.status_code == 400
    captured = web_client.post(event_url, headers=student_headers, json={"event_type": "answer_resume_burst", "payload": rhythm})
    assert captured.json()["event"]["recorded"] is True
    duplicate = web_client.post(event_url, headers=student_headers, json={"event_type": "answer_resume_burst", "payload": rhythm})
    assert duplicate.json()["event"]["recorded"] is False
    analysis = web_client.get(analysis_url, headers=teacher_headers)
    assert analysis.status_code == 200
    integrity = analysis.json()["analysis"]["proctoring"]
    assert integrity["screen_switch_count"] == 1
    assert integrity["event_count"] == 5
    assert integrity["event_type_counts"] == {
        "copy": 1,
        "fullscreen_exit": 1,
        "paste": 1,
        "visibility_hidden": 1,
        "window_blur": 1,
    }
    student = analysis.json()["analysis"]["students"][0]
    assert student["screen_switch_count"] == 1
    assert student["screen_switch_exceeded"] is False
    assert student["integrity_risk_score"] > 0
    assert student["integrity_risk_score"] == baseline["integrity_risk_score"]
    assert student["score"] == baseline["score"]
    assert student["answer_rhythm_review"] == [{**rhythm, "occurred_at": captured.json()["event"]["occurred_at"]}]
