"""Tests for teacher and student read-only learning progress endpoints (C17)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from solaire.web.learning_progress.store import insert_frozen_baseline_items, record_practice_source
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.routers.learning_progress import router as lp_router


def _create_test_app(platform_root: Path) -> TestClient:
    app = FastAPI()
    # Mock require_platform_root via app state or monkeypatch in test
    app.include_router(lp_router, prefix="/api")
    return TestClient(app)


def _setup_api_db(tmp_path: Path) -> Path:
    root = tmp_path / "platform_root"
    root.mkdir()
    init_platform_db(root)

    with connect(root) as con:
        con.execute(
            """
            INSERT INTO schools (id, name, status, created_at, updated_at)
            VALUES ('sch-1', 'School 1', 'active', '2026-10-01', '2026-10-01'),
                   ('sch-2', 'School 2', 'active', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO users (id, school_id, username, password_hash, role, display_name, status, created_at, updated_at)
            VALUES ('u-tea-1', 'sch-1', 'tea1', 'hash', 'teacher', 'Teacher 1', 'active', '2026-10-01', '2026-10-01'),
                   ('u-tea-2', 'sch-1', 'tea2', 'hash', 'teacher', 'Teacher 2', 'active', '2026-10-01', '2026-10-01'),
                   ('u-stu-1', 'sch-1', 'stu1', 'hash', 'student', 'Student 1', 'active', '2026-10-01', '2026-10-01'),
                   ('u-stu-2', 'sch-1', 'stu2', 'hash', 'student', 'Student 2', 'active', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO classes (id, school_id, name, grade, created_at, updated_at)
            VALUES ('cls-1', 'sch-1', 'Class 1', 'Grade 7', '2026-10-01', '2026-10-01'),
                   ('cls-2', 'sch-1', 'Class 2', 'Grade 7', '2026-10-01', '2026-10-01')
            """
        )
        # tea1 teaches cls-1; tea2 teaches cls-2
        con.execute(
            """
            INSERT INTO teacher_class_assignments (teacher_id, class_id, subject)
            VALUES ('u-tea-1', 'cls-1', 'Math'),
                   ('u-tea-2', 'cls-2', 'Math')
            """
        )
        # stu-1 in cls-1; stu-2 in cls-2
        con.execute(
            """
            INSERT INTO students (id, school_id, user_id, student_no, display_name, status, created_at, updated_at)
            VALUES ('stu-1', 'sch-1', 'u-stu-1', 'S001', 'Student 1', 'active', '2026-10-01', '2026-10-01'),
                   ('stu-2', 'sch-1', 'u-stu-2', 'S002', 'Student 2', 'active', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO class_students (class_id, student_id)
            VALUES ('cls-1', 'stu-1'),
                   ('cls-2', 'stu-2')
            """
        )
        con.execute(
            """
            INSERT INTO paper_records (id, exam_id, title, subject, created_at, updated_at, school_id)
            VALUES ('paper-1', 'math/exam', 'Math Practice 1', 'Math', '2026-10-01', '2026-10-01', 'sch-1'),
                   ('paper-2', 'math/exam2', 'Math Practice 2', 'Math', '2026-10-01', '2026-10-01', 'sch-1')
            """
        )
        # Released publication for cls-1 by tea1
        con.execute(
            """
            INSERT INTO exam_publications (id, paper_id, teacher_id, title, status, show_results_immediately, created_at, updated_at)
            VALUES ('pub-released', 'paper-1', 'u-tea-1', 'Released Pub', 'closed', 1, '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO publication_classes (publication_id, class_id)
            VALUES ('pub-released', 'cls-1')
            """
        )
        # Unreleased publication for cls-1 by tea1
        con.execute(
            """
            INSERT INTO exam_publications (id, paper_id, teacher_id, title, status, show_results_immediately, created_at, updated_at)
            VALUES ('pub-unreleased', 'paper-2', 'u-tea-1', 'Unreleased Pub', 'published', 0, '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO publication_classes (publication_id, class_id)
            VALUES ('pub-unreleased', 'cls-1')
            """
        )

        # Baseline and answers for stu-1 on both publications
        for pub_id in ('pub-released', 'pub-unreleased'):
            record_practice_source(
                con,
                practice_publication_id=pub_id,
                practice_kind="remediation",
                source_type="diagnostic_batch",
                source_exam_id="math/exam",
                source_batch_id="b1",
                captured_at="2026-10-26T10:00:00Z",
            )
            insert_frozen_baseline_items(
                con,
                [
                    {
                        "id": f"fb-{pub_id}",
                        "practice_publication_id": pub_id,
                        "student_id": "stu-1",
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
                        "source_snapshot_hash": "batch-v1:hash",
                        "captured_at": "2026-10-26T10:00:00Z",
                    }
                ],
            )
            payload = json.dumps([{"question_id": "prac-q1", "knowledge_node_id": "math/algebra", "score_per_item": 4.0}])
            att_id = f"att-{pub_id}"
            con.execute(
                """
                INSERT INTO student_attempts (id, publication_id, student_id, status, question_payload_json, started_at, submitted_at)
                VALUES (?, ?, 'stu-1', 'submitted', ?, '2026-10-26T11:00:00Z', '2026-10-26T11:30:00Z')
                """,
                (att_id, pub_id, payload),
            )
            con.execute(
                """
                INSERT INTO student_answers (id, attempt_id, question_id, score, is_correct, grading_status, answer_payload, responded_at)
                VALUES (?, ?, 'prac-q1', 3.0, 1, 'graded', '{}', '2026-10-26T11:20:00Z')
                """,
                (f"ans-{pub_id}", att_id),
            )

    return root


def test_teacher_authorized_and_unauthorized_access(tmp_path: Path, monkeypatch: Any) -> None:
    root = _setup_api_db(tmp_path)
    monkeypatch.setattr("solaire.web.routers.learning_progress.require_platform_root", lambda: root)
    monkeypatch.setattr("solaire.web.routers.learning_progress._content_root", lambda: None)

    # 1. Teacher 1 accesses their own publication -> 200 OK
    app = FastAPI()
    current_user_holder = {"user": {"id": "u-tea-1", "role": "teacher", "school_id": "sch-1"}}
    app.dependency_overrides = {
        "solaire.web.auth_api.current_platform_user": lambda: current_user_holder["user"]
    }
    from solaire.web.auth_api import current_platform_user
    app.dependency_overrides[current_platform_user] = lambda: current_user_holder["user"]
    app.include_router(lp_router, prefix="/api")
    client = TestClient(app)

    resp = client.get("/api/learning-progress/teacher/comparison?practice_publication_id=pub-released")
    assert resp.status_code == 200
    data = resp.json()
    assert data["practice_publication_id"] == "pub-released"
    assert len(data["class_comparison"]["node_summaries"]) == 1

    # 2. Teacher 2 (assigned to cls-2 only) attempts to access Teacher 1's publication -> 403 Forbidden
    current_user_holder["user"] = {"id": "u-tea-2", "role": "teacher", "school_id": "sch-1"}
    resp_unauth = client.get("/api/learning-progress/teacher/comparison?practice_publication_id=pub-released")
    assert resp_unauth.status_code == 403

    # 3. Teacher 1 tries to access student 2 (in cls-2) -> 403 Forbidden
    current_user_holder["user"] = {"id": "u-tea-1", "role": "teacher", "school_id": "sch-1"}
    resp_bad_stu = client.get("/api/learning-progress/teacher/comparison?practice_publication_id=pub-released&student_id=stu-2")
    assert resp_bad_stu.status_code == 403


def test_student_self_access_and_rejection_of_others(tmp_path: Path, monkeypatch: Any) -> None:
    root = _setup_api_db(tmp_path)
    monkeypatch.setattr("solaire.web.routers.learning_progress.require_platform_root", lambda: root)
    monkeypatch.setattr("solaire.web.routers.learning_progress._content_root", lambda: None)

    app = FastAPI()
    current_user_holder = {"user": {"id": "u-stu-1", "role": "student", "school_id": "sch-1"}}
    from solaire.web.auth_api import current_platform_user
    app.dependency_overrides[current_platform_user] = lambda: current_user_holder["user"]
    app.include_router(lp_router, prefix="/api")
    client = TestClient(app)

    # 1. Student 1 queries own progress -> 200 OK with comparison
    resp = client.get("/api/learning-progress/student/comparison?practice_publication_id=pub-released")
    assert resp.status_code == 200
    data = resp.json()
    node = data["comparison"]["node_comparisons"][0]
    assert node["pre_percentage"] == 50.0
    assert node["post_percentage"] == 75.0
    assert node["delta_percentage_points"] == 25.0

    # 2. Student 1 passes someone else's student_id in query parameter -> 403 Forbidden
    resp_fraud = client.get("/api/learning-progress/student/comparison?practice_publication_id=pub-released&student_id=stu-2")
    assert resp_fraud.status_code == 403
    assert "Students can only read their own" in resp_fraud.json()["detail"]


def test_student_unreleased_scores_are_not_leaked(tmp_path: Path, monkeypatch: Any) -> None:
    root = _setup_api_db(tmp_path)
    monkeypatch.setattr("solaire.web.routers.learning_progress.require_platform_root", lambda: root)
    monkeypatch.setattr("solaire.web.routers.learning_progress._content_root", lambda: None)

    app = FastAPI()
    current_user_holder = {"user": {"id": "u-stu-1", "role": "student", "school_id": "sch-1"}}
    from solaire.web.auth_api import current_platform_user
    app.dependency_overrides[current_platform_user] = lambda: current_user_holder["user"]
    app.include_router(lp_router, prefix="/api")
    client = TestClient(app)

    # Student 1 queries pub-unreleased (show_results_immediately=0, status=published)
    resp = client.get("/api/learning-progress/student/comparison?practice_publication_id=pub-unreleased")
    assert resp.status_code == 200
    data = resp.json()

    assert data["comparison"]["status"] == "target_unreleased"
    node = data["comparison"]["node_comparisons"][0]
    assert node["status"] == "target_unreleased"
    # Post numerical score and percentage MUST NOT BE LEAKED
    assert node["post_score"] is None
    assert node["post_rate"] is None
    assert node["post_percentage"] is None
    assert node["delta_percentage_points"] is None
    assert node["incomparable_reason"] == "复练成绩尚未发布"
