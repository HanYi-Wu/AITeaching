from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import sqlite3
from threading import Barrier

import pytest
import yaml
from fastapi.testclient import TestClient

from solaire.web.paper_service import grade_paper_answer
from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_paper_api import (
    _bootstrap_admin,
    _create_school_teacher_class,
    _headers,
    _teacher_token,
    _write_exam,
)


def _submitted_attempt(client: TestClient, project_root: Path) -> dict[str, str]:
    admin_token = _bootstrap_admin(client)
    school_id, teacher_id, class_id = _create_school_teacher_class(client, admin_token)
    school_login = client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    imported = client.post(
        "/api/school/students/import",
        headers=school_headers,
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
    )
    assert imported.status_code == 200
    student = imported.json()["students"][0]
    exam_id = _write_exam(project_root)
    teacher_headers = _headers(_teacher_token(client))
    paper = client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    published = client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        headers=teacher_headers,
        json={"class_ids": [class_id]},
    )
    assert published.status_code == 200
    student_login = client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    student_headers = _headers(str(student_login.json()["token"]))
    publication_id = str(published.json()["publication"]["id"])
    started = client.post(f"/api/student/publications/{publication_id}/start", headers=student_headers)
    assert started.status_code == 200
    attempt_id = str(started.json()["attempt"]["id"])
    submitted = client.post(
        f"/api/student/attempts/{attempt_id}/submit",
        headers=student_headers,
        json={"time_spent_seconds": 0},
    )
    assert submitted.status_code == 200
    return {
        "paper_id": str(paper["paper_id"]),
        "attempt_id": attempt_id,
        "teacher_id": teacher_id,
        "school_id": school_id,
        "class_id": class_id,
        "exam_id": exam_id,
    }


def _grade(
    project_root: Path,
    *,
    paper_id: str,
    attempt_id: str,
    teacher_id: str,
    question_id: str,
    score: float,
) -> dict:
    return grade_paper_answer(
        default_platform_root(),
        project_root,
        paper_id=paper_id,
        attempt_id=attempt_id,
        question_id=question_id,
        user={"id": teacher_id, "role": "teacher"},
        score=score,
    )


def test_manual_grade_total_failure_rolls_back_answer_and_completion_invalidation(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        con.execute(
            "UPDATE student_attempts SET score = 1, max_score = 10, grading_completed_at = ?, grading_completed_by = ? WHERE id = ?",
            ("2026-01-01T00:00:00+00:00", context["teacher_id"], context["attempt_id"]),
        )
        con.execute(
            """
            CREATE TRIGGER inject_grading_total_failure
            BEFORE UPDATE OF score ON student_attempts
            BEGIN SELECT RAISE(ABORT, 'injected grading total failure'); END
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="injected grading total failure"):
        _grade(
            tmp_path,
            paper_id=context["paper_id"],
            attempt_id=context["attempt_id"],
            teacher_id=context["teacher_id"],
            question_id="math/q1",
            score=3,
        )

    with connect(root) as con:
        assert con.execute(
            "SELECT COUNT(*) FROM student_answers WHERE attempt_id = ? AND question_id = 'math/q1'",
            (context["attempt_id"],),
        ).fetchone()[0] == 0
        attempt = con.execute(
            "SELECT score, max_score, grading_completed_at, grading_completed_by FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    assert attempt["score"] == 1
    assert attempt["max_score"] == 10
    assert attempt["grading_completed_at"] == "2026-01-01T00:00:00+00:00"
    assert attempt["grading_completed_by"] == context["teacher_id"]


def test_concurrent_grades_for_different_questions_leave_consistent_total(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        con.execute(
            "UPDATE student_attempts SET score = 0, max_score = 10, grading_completed_at = ?, grading_completed_by = ? WHERE id = ?",
            ("2026-01-01T00:00:00+00:00", context["teacher_id"], context["attempt_id"]),
        )

    barrier = Barrier(2)

    def grade_one(question_id: str, score: float) -> dict:
        barrier.wait(timeout=10)
        return _grade(
            tmp_path,
            paper_id=context["paper_id"],
            attempt_id=context["attempt_id"],
            teacher_id=context["teacher_id"],
            question_id=question_id,
            score=score,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda item: grade_one(*item), [("math/q1", 3), ("math/q2", 4)]))
    assert {str(item["question_id"]) for item in results} == {"math/q1", "math/q2"}

    with connect(root) as con:
        answers = con.execute(
            "SELECT question_id, score FROM student_answers WHERE attempt_id = ? ORDER BY question_id",
            (context["attempt_id"],),
        ).fetchall()
        attempt = con.execute(
            "SELECT score, max_score, grading_completed_at, grading_completed_by FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    assert [(row["question_id"], row["score"]) for row in answers] == [("math/q1", 3), ("math/q2", 4)]
    assert attempt["score"] == 7
    assert attempt["max_score"] == 10
    assert attempt["grading_completed_at"] is None
    assert attempt["grading_completed_by"] is None


def test_zero_maximum_snapshot_keeps_legacy_manual_score_fallback(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        attempt = con.execute(
            "SELECT question_payload_json FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
        questions = json.loads(attempt["question_payload_json"])
        for question in questions:
            question["score_per_item"] = 0
        con.execute(
            "UPDATE student_attempts SET question_payload_json = ?, max_score = 0 WHERE id = ?",
            (json.dumps(questions, ensure_ascii=False), context["attempt_id"]),
        )

    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q1",
        score=1,
    )
    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q2",
        score=2,
    )
    with connect(root) as con:
        attempt = con.execute(
            "SELECT score, max_score FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    assert attempt["score"] == 3
    assert attempt["max_score"] == 0


def test_grading_persists_legacy_snapshot_repair_before_future_source_edits(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        attempt = con.execute(
            "SELECT question_payload_json FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
        questions = json.loads(attempt["question_payload_json"])
        for question in questions:
            question["score_per_item"] = 1
        con.execute(
            "UPDATE student_attempts SET question_payload_json = ?, question_payload_version = 1, max_score = 2 WHERE id = ?",
            (json.dumps(questions, ensure_ascii=False), context["attempt_id"]),
        )

    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q1",
        score=3,
    )

    with connect(root) as con:
        repaired = con.execute(
            "SELECT question_payload_json, question_payload_version, max_score FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    repaired_questions = json.loads(repaired["question_payload_json"])
    assert repaired["question_payload_version"] == 3
    assert [question["score_per_item"] for question in repaired_questions] == [5.0, 5.0]
    assert repaired["max_score"] == 10

    exam_path = tmp_path / "exams" / context["exam_id"] / "exam.yaml"
    exam_payload = yaml.safe_load(exam_path.read_text(encoding="utf-8"))
    exam_payload["selected_items"][0]["score_per_item"] = 9
    exam_path.write_text(
        yaml.safe_dump(exam_payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q2",
        score=4,
    )

    with connect(root) as con:
        final_attempt = con.execute(
            "SELECT question_payload_json, question_payload_version, score, max_score FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    final_questions = json.loads(final_attempt["question_payload_json"])
    assert final_attempt["question_payload_version"] == 3
    assert [question["score_per_item"] for question in final_questions] == [5.0, 5.0]
    assert final_attempt["score"] == 7
    assert final_attempt["max_score"] == 10


@pytest.mark.parametrize("permission_change", ["paper_owner", "publication_owner"])
def test_manual_grade_rechecks_current_paper_and_attempt_permission(
    web_client: TestClient,
    tmp_path: Path,
    permission_change: str,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    school_login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    outsider = web_client.post(
        "/api/school/teachers",
        headers=school_headers,
        json={"username": "teacher_other", "password": "secret123", "display_name": "Other", "subjects": ["Math"]},
    )
    assert outsider.status_code == 200
    outsider_id = str(outsider.json()["teacher"]["id"])
    root = default_platform_root()
    with connect(root) as con:
        if permission_change == "paper_owner":
            con.execute(
                "UPDATE paper_records SET owner_teacher_id = ? WHERE id = ?",
                (outsider_id, context["paper_id"]),
            )
            expected_error = "No permission for this paper"
        else:
            con.execute(
                "UPDATE exam_publications SET teacher_id = ? WHERE paper_id = ?",
                (outsider_id, context["paper_id"]),
            )
            expected_error = "attempt not found for this paper"

    error_type = PermissionError if permission_change == "paper_owner" else ValueError
    with pytest.raises(error_type, match=expected_error):
        _grade(
            tmp_path,
            paper_id=context["paper_id"],
            attempt_id=context["attempt_id"],
            teacher_id=context["teacher_id"],
            question_id="math/q1",
            score=3,
        )

    with connect(root) as con:
        assert con.execute(
            "SELECT COUNT(*) FROM student_answers WHERE attempt_id = ?",
            (context["attempt_id"],),
        ).fetchone()[0] == 0


def test_manual_grade_rechecks_current_attempt_submission_status(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        con.execute(
            "UPDATE student_attempts SET status = 'in_progress', submitted_at = NULL WHERE id = ?",
            (context["attempt_id"],),
        )

    with pytest.raises(ValueError, match="只能批改已提交的答卷"):
        _grade(
            tmp_path,
            paper_id=context["paper_id"],
            attempt_id=context["attempt_id"],
            teacher_id=context["teacher_id"],
            question_id="math/q1",
            score=3,
        )

    with connect(root) as con:
        assert con.execute(
            "SELECT COUNT(*) FROM student_answers WHERE attempt_id = ?",
            (context["attempt_id"],),
        ).fetchone()[0] == 0
