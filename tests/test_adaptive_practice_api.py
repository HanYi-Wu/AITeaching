from __future__ import annotations

import json
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import yaml
import pytest
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web.app import ensure_project_layout
from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, default_platform_root, init_platform_db
from solaire.web.adaptive_practice_service import (
    _extract_generated_payload,
    _publish_personalized,
    _source_questions_for_student,
    _validate_generated_questions,
)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _setup(client: TestClient, root: Path) -> dict[str, object]:
    admin = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    ).json()
    school = client.post("/api/schools", json={"name": "No.1 School"}, headers=_headers(admin["token"])).json()["school"]
    client.post(
        f"/api/schools/{school['id']}/school-users",
        json={"username": "school_a", "password": "secret123", "display_name": "School"},
        headers=_headers(admin["token"]),
    )
    school_token = client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    school_headers = _headers(school_token)
    teacher = client.post(
        "/api/school/teachers",
        json={"username": "teacher_li", "password": "teacher123", "display_name": "Li", "subjects": ["Math"]},
        headers=school_headers,
    ).json()["teacher"]
    klass = client.post(
        "/api/school/classes",
        json={"name": "Class 1", "grade": "G10", "subject_hint": "Math"},
        headers=school_headers,
    ).json()["class"]
    client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher["id"], "class_id": klass["id"], "subject": "Math"},
        headers=school_headers,
    )
    imported = client.post(
        "/api/school/students/import",
        json={
            "class_id": klass["id"],
            "students": [
                {"student_no": "S001", "display_name": "Student One"},
                {"student_no": "S002", "display_name": "Student Two"},
            ],
        },
        headers=school_headers,
    ).json()["students"]

    ensure_project_layout(root)
    library = root / "resource" / "math"
    library.mkdir(parents=True, exist_ok=True)
    for qid, content, answer in (("q1", "1+1=?", "A"), ("q2", "2+2=?", "B")):
        (library / f"{qid}.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": qid,
                    "type": "single_choice",
                    "content": content,
                    "options": {"A": "2", "B": "4"},
                    "answer": answer,
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
    exam_id = "source/Math"
    exam_dir = root / "exams" / "source" / "Math"
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "Source", "subject": "Math", "export_label": "source"},
        question_libraries=[QuestionLibraryRef(namespace="math", path="../../../resource/math")],
        template_path="templates/test.yaml",
        selected_items=[SelectedSection(section_id="Choice", question_ids=["math/q1", "math/q2"], score_per_item=5)],
    )
    (exam_dir / "exam.yaml").write_text(
        yaml.safe_dump(exam.model_dump(mode="json"), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    teacher_token = client.post("/api/auth/login", json={"username": "teacher_li", "password": "teacher123"}).json()["token"]
    teacher_headers = _headers(teacher_token)
    paper = client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    publication = client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [klass["id"]], "title": "Source"},
        headers=teacher_headers,
    ).json()["publication"]
    for index, student in enumerate(imported):
        login = client.post(
            "/api/auth/login",
            json={"username": student["account_username"], "password": student["initial_password"]},
        ).json()
        headers = _headers(login["token"])
        attempt = client.post(f"/api/student/publications/{publication['id']}/start", headers=headers).json()["attempt"]
        answers = [
            {"question_id": "math/q1", "answer": "B" if index == 0 else "A"},
            {"question_id": "math/q2", "answer": "B"},
        ]
        client.post(f"/api/student/attempts/{attempt['id']}/answers", json={"answers": answers}, headers=headers)
        client.post(f"/api/student/attempts/{attempt['id']}/submit", json={}, headers=headers)
        student["headers"] = headers
    return {
        "class": klass,
        "teacher": teacher,
        "teacher_headers": teacher_headers,
        "students": imported,
        "source_publication": publication,
    }


def _seed_more_histories(context: dict[str, object], additional_count: int) -> list[str]:
    root = default_platform_root()
    init_platform_db(root)
    klass = context["class"]
    teacher = context["teacher"]
    students = context["students"]
    assert isinstance(klass, dict) and isinstance(teacher, dict) and isinstance(students, list)
    ids: list[str] = [str(context["source_publication"]["id"])]  # type: ignore[index]
    now = utc_now()
    with connect(root) as con:
        for index in range(additional_count):
            paper_id = uuid.uuid4().hex
            publication_id = uuid.uuid4().hex
            con.execute(
                """
                INSERT INTO paper_records
                  (id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at)
                VALUES (?, ?, ?, 'Math', 'online', ?, ?, 'published', ?, ?)
                """,
                (paper_id, f"seed-{index}/Math", f"History {index + 2}", teacher["id"], teacher["school_id"], now, now),
            )
            con.execute(
                """
                INSERT INTO exam_publications
                  (id, paper_id, teacher_id, title, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'published', ?, ?)
                """,
                (publication_id, paper_id, teacher["id"], f"History {index + 2}", now, now),
            )
            con.execute(
                "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
                (publication_id, klass["id"]),
            )
            for student_index, student in enumerate(students):
                attempt_id = uuid.uuid4().hex
                qid = f"seed/{index}/q1"
                questions = [
                    {
                        "question_id": qid,
                        "header": f"History {index + 2}",
                        "section_id": "practice",
                        "score_per_item": 5,
                        "type": "single_choice",
                        "content": f"{index + 3}+1=?",
                        "options": {"A": str(index + 3), "B": str(index + 4)},
                    }
                ]
                con.execute(
                    """
                    INSERT INTO student_attempts
                      (id, publication_id, student_id, status, submitted_at, score, max_score,
                       question_payload_json, answer_key_json)
                    VALUES (?, ?, ?, 'submitted', ?, ?, 5, ?, ?)
                    """,
                    (
                        attempt_id,
                        publication_id,
                        student["id"],
                        now,
                        0 if student_index == 0 else 5,
                        json.dumps(questions, ensure_ascii=False),
                        json.dumps({qid: "B"}),
                    ),
                )
                con.execute(
                    """
                    INSERT INTO student_answers
                      (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'auto_scored', ?)
                    """,
                    (
                        uuid.uuid4().hex,
                        attempt_id,
                        qid,
                        json.dumps({"answer": "A" if student_index == 0 else "B"}),
                        0 if student_index == 0 else 1,
                        0 if student_index == 0 else 5,
                        now,
                    ),
                )
            ids.append(publication_id)
    return ids


def test_teacher_publishes_historical_wrong_questions_per_student(web_client: TestClient, tmp_path: Path) -> None:
    context = _setup(web_client, tmp_path)
    (tmp_path / "resource" / "math" / "q1.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q1",
                "type": "single_choice",
                "content": "CHANGED AFTER PUBLICATION",
                "options": {"A": "2", "B": "4"},
                "answer": "B",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    class_id = context["class"]["id"]  # type: ignore[index]
    teacher_headers = context["teacher_headers"]
    history = web_client.get(f"/api/teacher/classes/{class_id}/practice-history", headers=teacher_headers)
    assert history.status_code == 200
    assert history.json()["eligible_for_reinforcement"] is False
    assert len(history.json()["publications"]) == 1

    published = web_client.post(
        "/api/teacher/practice-publications/wrong-questions",
        json={
            "class_id": class_id,
            "source_publication_id": context["source_publication"]["id"],  # type: ignore[index]
            "title": "历史错题巩固",
            "show_results_immediately": True,
        },
        headers=teacher_headers,
    )
    assert published.status_code == 200
    assert published.json()["publication"]["practice_kind"] == "wrong_questions"
    assert published.json()["assigned_student_count"] == 1
    assert published.json()["skipped_student_count"] == 1

    teacher_papers = web_client.get("/api/papers", headers=teacher_headers).json()["papers"]
    adaptive_paper = next(
        item for item in teacher_papers if item["paper_id"] == published.json()["publication"]["paper_id"]
    )
    assert adaptive_paper["question_count"] == 1
    assert adaptive_paper["publication_count"] == 1

    students = context["students"]
    student_one_papers = web_client.get("/api/student/papers", headers=students[0]["headers"]).json()["papers"]  # type: ignore[index]
    student_two_papers = web_client.get("/api/student/papers", headers=students[1]["headers"]).json()["papers"]  # type: ignore[index]
    practice = next(item for item in student_one_papers if item.get("practice_metadata", {}).get("kind") == "wrong_questions")
    assert not any(item.get("practice_metadata", {}).get("kind") == "wrong_questions" for item in student_two_papers)
    started = web_client.post(
        f"/api/student/publications/{practice['publication_id']}/start",
        headers=students[0]["headers"],  # type: ignore[index]
    ).json()
    assert [item["question_id"] for item in started["questions"]] == ["math/q1"]
    assert started["questions"][0]["content"] == "1+1=?"
    attempt_id = started["attempt"]["id"]
    submitted = web_client.post(
        f"/api/student/attempts/{attempt_id}/submit",
        json={"answers": [{"question_id": "math/q1", "answer": "B"}]},
        headers=students[0]["headers"],  # type: ignore[index]
    )
    assert submitted.status_code == 200
    assert submitted.json()["attempt"]["score"] == 0.0
    assert submitted.json()["attempt"]["grading_completed_at"]

    adaptive_paper_id = published.json()["publication"]["paper_id"]
    submissions = web_client.get(f"/api/papers/{adaptive_paper_id}/submissions", headers=teacher_headers)
    assert submissions.status_code == 200
    answer = submissions.json()["submissions"][0]["answers"][0]
    assert answer["content"] == "1+1=?"
    graded = web_client.patch(
        f"/api/papers/{adaptive_paper_id}/attempts/{attempt_id}/answers/math%2Fq1/grade",
        json={"score": 4, "feedback": "reviewed"},
        headers=teacher_headers,
    )
    assert graded.status_code == 200
    assert graded.json()["answer"]["score"] == 4


def test_wrong_question_practice_limits_each_students_question_count(web_client: TestClient, tmp_path: Path) -> None:
    context = _setup(web_client, tmp_path)
    first_student = context["students"][0]  # type: ignore[index]
    with connect(default_platform_root()) as con:
        attempt = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (context["source_publication"]["id"], first_student["id"]),  # type: ignore[index]
        ).fetchone()
        assert attempt is not None
        con.execute(
            "UPDATE student_answers SET is_correct = 0, score = 0 WHERE attempt_id = ? AND question_id = 'math/q2'",
            (attempt["id"],),
        )

    published = web_client.post(
        "/api/teacher/practice-publications/wrong-questions",
        json={
            "class_id": context["class"]["id"],  # type: ignore[index]
            "source_publication_id": context["source_publication"]["id"],  # type: ignore[index]
            "title": "限量错题卷",
            "max_questions_per_student": 1,
        },
        headers=context["teacher_headers"],
    )

    assert published.status_code == 200
    papers = web_client.get("/api/student/papers", headers=first_student["headers"]).json()["papers"]
    practice = next(item for item in papers if item.get("practice_metadata", {}).get("kind") == "wrong_questions")
    started = web_client.post(
        f"/api/student/publications/{practice['publication_id']}/start",
        headers=first_student["headers"],
    ).json()
    assert len(started["questions"]) == 1


def test_personal_wrong_question_practice_does_not_enter_class_history_or_analysis(
    web_client: TestClient, tmp_path: Path
) -> None:
    context = _setup(web_client, tmp_path)
    class_id = context["class"]["id"]
    teacher = context["teacher_headers"]
    target, classmate = context["students"]
    source_id = context["source_publication"]["id"]
    path = "/api/teacher/practice-publications/wrong-questions"
    body = {"class_id": class_id, "source_publication_id": source_id, "title": "个人错题练习"}
    profile = web_client.get(f"/api/teacher/classes/{class_id}/students/{target['id']}/profile", headers=teacher)
    assert profile.status_code == 200
    assert profile.json()["profile"]["recent_exams"][0]["can_assign_wrong_question_practice"] == 1
    assert web_client.post(path, json={**body, "student_id": "invalid"}, headers=teacher).status_code == 403
    assert web_client.post(path, json={**body, "student_id": classmate["id"]}, headers=teacher).status_code == 400

    response = web_client.post(path, json={**body, "student_id": target["id"]}, headers=teacher)
    assert response.status_code == 200, response.text
    publication = response.json()["publication"]
    assert publication["recipient_scope"] == "student"
    assert response.json()["assigned_student_count"] == 1
    history = web_client.get(f"/api/teacher/classes/{class_id}/practice-history", headers=teacher).json()
    assert [item["id"] for item in history["publications"]] == [source_id]
    papers = web_client.get("/api/student/papers", headers=classmate["headers"]).json()["papers"]
    assert publication["id"] not in {item["publication_id"] for item in papers}
    start = f"/api/student/publications/{publication['id']}/start"
    assert web_client.post(start, headers=classmate["headers"]).status_code in {403, 404}
    attempt = web_client.post(start, headers=target["headers"])
    assert attempt.status_code == 200
    assert [item["question_id"] for item in attempt.json()["questions"]] == ["math/q1"]
    analysis_url = f"/api/papers/{publication['paper_id']}/analysis"
    analysis = web_client.get(analysis_url, headers=teacher, params={"class_id": class_id})
    assert analysis.status_code == 403
    personal_profile = web_client.get(f"/api/teacher/classes/{class_id}/students/{target['id']}/profile", headers=teacher)
    assert publication["id"] in {exam["publication_id"] for exam in personal_profile.json()["profile"]["recent_exams"]}


def test_all_correct_reinforcement_source_requires_every_selected_exam_to_be_fully_graded(
    web_client: TestClient, tmp_path: Path
) -> None:
    context = _setup(web_client, tmp_path)
    source_ids = _seed_more_histories(context, 2)
    student = context["students"][1]  # type: ignore[index]
    student_id = str(student["id"])
    root = default_platform_root()

    assert _source_questions_for_student(
        root,
        tmp_path,
        student_id=student_id,
        source_publication_ids=source_ids,
    )

    with connect(root) as con:
        attempt = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (source_ids[0], student_id),
        ).fetchone()
        assert attempt is not None
        con.execute("UPDATE student_attempts SET status = 'in_progress' WHERE id = ?", (attempt["id"],))
    assert _source_questions_for_student(
        root, tmp_path, student_id=student_id, source_publication_ids=source_ids
    ) == []

    with connect(root) as con:
        con.execute("UPDATE student_attempts SET status = 'submitted' WHERE id = ?", (attempt["id"],))
        con.execute("UPDATE student_answers SET is_correct = NULL WHERE attempt_id = ?", (attempt["id"],))
    assert _source_questions_for_student(
        root, tmp_path, student_id=student_id, source_publication_ids=source_ids
    ) == []

    with connect(root) as con:
        con.execute("DELETE FROM student_answers WHERE attempt_id = ?", (attempt["id"],))
    assert _source_questions_for_student(
        root, tmp_path, student_id=student_id, source_publication_ids=source_ids
    ) == []


def test_reinforcement_requires_three_histories_and_generates_for_students_without_wrong_answers(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    context = _setup(web_client, tmp_path)
    class_id = context["class"]["id"]  # type: ignore[index]
    teacher_headers = context["teacher_headers"]
    source_id = context["source_publication"]["id"]  # type: ignore[index]
    blocked = web_client.post(
        "/api/teacher/practice-publications/reinforcement",
        json={"class_id": class_id, "source_publication_ids": [source_id], "title": "专项巩固"},
        headers=teacher_headers,
    )
    assert blocked.status_code == 400
    assert "3" in blocked.json()["detail"]

    source_ids = _seed_more_histories(context, 2)

    async def fake_generate(*, student, wrong_questions, **_kwargs):
        assert len(wrong_questions) >= 3
        return {
            "questions": [
                {
                    "question_id": f"reinforcement/{student['id']}/q1",
                    "header": "举一反三 1",
                    "section_id": "practice",
                    "score_per_item": 5,
                    "type": "single_choice",
                    "content": "8+5=?",
                    "options": {"A": "12", "B": "13"},
                    "answer": "B",
                }
            ],
            "provider": "deepseek-test",
            "model": "deepseek-chat",
            "usage": {"total_tokens": 321},
        }

    monkeypatch.setattr("solaire.web.adaptive_practice_service.generate_reinforcement_questions", fake_generate)
    published = web_client.post(
        "/api/teacher/practice-publications/reinforcement",
        json={
            "class_id": class_id,
            "source_publication_ids": source_ids,
            "title": "三卷专项巩固",
            "questions_per_student": 1,
        },
        headers=teacher_headers,
    )
    assert published.status_code == 200
    body = published.json()
    assert body["publication"]["practice_kind"] == "reinforcement"
    assert body["assigned_student_count"] == 2
    assert body["skipped_student_count"] == 0
    assert body["generation"]["total_tokens"] == 642
    for student in context["students"]:  # type: ignore[assignment]
        started = web_client.post(
            f"/api/student/publications/{body['publication']['id']}/start",
            headers=student["headers"],
        ).json()
        assert started["questions"][0]["content"] == "8+5=?"
        assert "answer" not in started["questions"][0]
        assert started["attempt"]["practice_metadata"]["source_count"] == 3


def test_personalized_publish_rejects_invalid_submission_mode(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="submission_mode"):
        _publish_personalized(
            tmp_path,
            class_id="class-1",
            user={"id": "teacher-1", "school_id": "school-1"},
            title="Practice",
            subject="Math",
            practice_kind="wrong_questions",
            source_publication_ids=["publication-1"],
            assignments=[{"student_id": "student-1", "questions": [], "answer_keys": {}}],
            start_at=None,
            end_at=None,
            show_results_immediately=False,
            submission_mode="execute_script",
            max_screen_switches=0,
            time_limit_minutes=None,
        )


def test_adaptive_practice_service_imports_in_a_fresh_process() -> None:
    completed = subprocess.run(
        [sys.executable, "-c", "from solaire.web.adaptive_practice_service import generate_reinforcement_questions"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr


def test_generated_payload_accepts_tool_call_and_common_wrapper_alias() -> None:
    tool_response = SimpleNamespace(
        tool_calls=[
            {
                "function": {
                    "name": "submit_reinforcement_questions",
                    "arguments": json.dumps({"questions": [{"content": "variant"}]}),
                }
            }
        ],
        content=None,
    )
    assert _extract_generated_payload(tool_response) == {"questions": [{"content": "variant"}]}

    text_response = SimpleNamespace(
        tool_calls=[],
        content='```json\n{"wrong_questions":[{"content":"variant"}]}\n```',
    )
    assert _extract_generated_payload(text_response) == {"questions": [{"content": "variant"}]}


def test_generated_choice_answer_must_exist_in_options() -> None:
    with pytest.raises(ValueError, match="answer"):
        _validate_generated_questions(
            {
                "questions": [
                    {
                        "type": "single_choice",
                        "content": "2+2=?",
                        "options": {"A": "3", "B": "4"},
                        "answer": "C",
                    }
                ]
            },
            student_id="student-1",
            requested_count=1,
        )


def test_generated_questions_require_exact_count_supported_type_and_finite_score() -> None:
    valid = {
        "type": "short_answer",
        "content": "Explain the method.",
        "answer": "A valid explanation",
        "score_per_item": 5,
    }
    with pytest.raises(ValueError, match="exactly 2"):
        _validate_generated_questions({"questions": [valid]}, student_id="student-1", requested_count=2)
    with pytest.raises(ValueError, match="unsupported"):
        _validate_generated_questions(
            {"questions": [{**valid, "type": "execute_code"}]}, student_id="student-1", requested_count=1
        )
    with pytest.raises(ValueError, match="score"):
        _validate_generated_questions(
            {"questions": [{**valid, "score_per_item": float("inf")}]}, student_id="student-1", requested_count=1
        )
