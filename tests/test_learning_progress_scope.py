"""Recipient-scoped authorization for teacher learning-progress comparisons."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from solaire.web.learning_progress.store import insert_frozen_baseline_items
from solaire.web.platform_db import connect
from solaire.web.public_access import school_request_allowed, student_request_allowed
from solaire.web.routers.learning_progress import router as learning_progress_router
from tests.test_learning_progress_api import _setup_api_db


def _real_router_client(
    root: Path,
    user: dict[str, str],
    monkeypatch: Any,
) -> tuple[TestClient, dict[str, dict[str, str]]]:
    monkeypatch.setattr("solaire.web.routers.learning_progress.require_platform_root", lambda: root)
    monkeypatch.setattr("solaire.web.routers.learning_progress._content_root", lambda: root)
    current = {"user": user}
    app = FastAPI()
    from solaire.web.auth_api import current_platform_user

    app.dependency_overrides[current_platform_user] = lambda: current["user"]
    app.include_router(learning_progress_router, prefix="/api")
    return TestClient(app), current


def _add_second_class_recipient_and_unassigned_member(root: Path) -> None:
    with connect(root) as con:
        con.execute(
            "INSERT INTO publication_classes (publication_id, class_id) VALUES ('pub-released', 'cls-2')"
        )
        source_hash = str(
            con.execute(
                "SELECT source_snapshot_hash FROM practice_frozen_baselines "
                "WHERE practice_publication_id='pub-released' AND student_id='stu-1' LIMIT 1"
            ).fetchone()[0]
        )
        insert_frozen_baseline_items(
            con,
            [
                {
                    "id": "fb-pub-released-stu-2",
                    "practice_publication_id": "pub-released",
                    "student_id": "stu-2",
                    "source_type": "diagnostic_batch",
                    "source_ref_id": "b1",
                    "source_attempt_id": None,
                    "source_question_id": "q1",
                    "knowledge_node_id": "math/algebra",
                    "effective_score": 2.0,
                    "effective_max_score": 4.0,
                    "weight": 1.0,
                    "raw_score": 2.0,
                    "raw_max_score": 4.0,
                    "rule_version": "v1_equal_split",
                    "source_snapshot_hash": source_hash,
                    "captured_at": "2026-10-26T10:00:00Z",
                }
            ],
        )
        con.execute(
            """
            INSERT INTO student_attempts
              (id, publication_id, student_id, status, question_payload_json, started_at, submitted_at, grading_completed_at)
            VALUES ('att-pub-released-stu-2', 'pub-released', 'stu-2', 'submitted', ?,
                    '2026-10-26T11:00:00Z', '2026-10-26T11:30:00Z', '2026-10-26T12:00:00Z')
            """,
            (json.dumps([{"question_id": "prac-q1", "knowledge_node_id": "math/algebra", "score_per_item": 4.0}]),),
        )
        con.execute(
            """
            INSERT INTO student_answers
              (id, attempt_id, question_id, score, is_correct, grading_status, answer_payload, responded_at)
            VALUES ('ans-pub-released-stu-2', 'att-pub-released-stu-2', 'prac-q1', 3.0, 1, 'graded', '{}',
                    '2026-10-26T11:20:00Z')
            """
        )
        # Stu-3 is added to the current roster after publication, with no attempt snapshot.
        con.execute(
            """
            INSERT INTO users (id, school_id, username, password_hash, role, display_name, status, created_at, updated_at)
            VALUES ('u-stu-3', 'sch-1', 'stu3', 'hash', 'student', 'Student 3', 'active', '2026-10-27', '2026-10-27')
            """
        )
        con.execute(
            """
            INSERT INTO students (id, school_id, user_id, student_no, display_name, status, created_at, updated_at)
            VALUES ('stu-3', 'sch-1', 'u-stu-3', 'S003', 'Student 3', 'active', '2026-10-27', '2026-10-27')
            """
        )
        con.execute("INSERT INTO class_students (class_id, student_id) VALUES ('cls-2', 'stu-3')")


def test_teacher_comparison_is_limited_to_published_students_in_assigned_classes(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    root = _setup_api_db(tmp_path)
    _add_second_class_recipient_and_unassigned_member(root)
    client, current = _real_router_client(
        root,
        {"id": "u-tea-2", "role": "teacher", "school_id": "sch-1"},
        monkeypatch,
    )

    response = client.get("/api/learning-progress/teacher/comparison?practice_publication_id=pub-released")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["class_comparison"]["total_student_count"] == 1
    assert set(result["student_comparisons"]) == {"stu-2"}
    assert set(result["student_names"]) == {"stu-2"}
    assert "stu-1" not in result["student_comparisons"]
    assert "stu-1" not in result["student_names"]
    summary = result["class_comparison"]["node_summaries"][0]
    assert summary["matched_student_count"] == 1
    assert summary["pre_percentage"] == 50.0
    assert summary["post_percentage"] == 75.0

    denied_class = client.get(
        "/api/learning-progress/teacher/comparison?practice_publication_id=pub-released&class_id=cls-1"
    )
    assert denied_class.status_code == 403
    denied_student = client.get(
        "/api/learning-progress/teacher/comparison?practice_publication_id=pub-released&student_id=stu-1"
    )
    assert denied_student.status_code == 403

    current["user"] = {"id": "u-stu-3", "role": "student", "school_id": "sch-1"}
    unassigned_student = client.get(
        "/api/learning-progress/student/comparison?practice_publication_id=pub-released"
    )
    assert unassigned_student.status_code == 403


def test_public_mode_allows_only_intended_learning_progress_reads() -> None:
    assert student_request_allowed("/api/learning-progress/student/comparison", "GET") is True
    assert student_request_allowed("/api/learning-progress/teacher/comparison", "GET") is False
    assert student_request_allowed("/api/learning-progress/student/comparison", "POST") is False

    assert school_request_allowed("/api/learning-progress/teacher/comparison", "GET") is True
    assert school_request_allowed("/api/learning-progress/teacher/publications", "GET") is True
    assert school_request_allowed("/api/learning-progress/teacher/comparison", "POST") is False
    assert school_request_allowed("/api/learning-progress/teacher/publications", "DELETE") is False
