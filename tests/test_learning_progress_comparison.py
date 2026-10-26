"""Integration tests for authoritative comparison and source modification rules (C16)."""

from __future__ import annotations

import json
from pathlib import Path

from solaire.web.learning_progress.comparison import get_practice_comparison
from solaire.web.learning_progress.store import insert_frozen_baseline_items, record_practice_source
from solaire.web.learning_progress.sources import compute_batch_snapshot_hash
from solaire.web.platform_db import connect, init_platform_db


def _setup_comparison_db(tmp_path: Path) -> tuple[Path, Path]:
    root = tmp_path / "platform_root"
    root.mkdir()
    project_root = tmp_path / "project_root"
    project_root.mkdir()

    init_platform_db(root)
    with connect(root) as con:
        con.execute(
            """
            INSERT INTO schools (id, name, status, created_at, updated_at)
            VALUES ('sch-1', 'School 1', 'active', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO users (id, school_id, username, password_hash, role, display_name, status, created_at, updated_at)
            VALUES ('u-tea', 'sch-1', 'teacher1', 'hash', 'teacher', 'Teacher', 'active', '2026-10-01', '2026-10-01'),
                   ('u-stu1', 'sch-1', 'stu1', 'hash', 'student', 'Student 1', 'active', '2026-10-01', '2026-10-01'),
                   ('u-stu2', 'sch-1', 'stu2', 'hash', 'student', 'Student 2', 'active', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO classes (id, school_id, name, grade, created_at, updated_at)
            VALUES ('cls-1', 'sch-1', 'Class 1', 'Grade 7', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO students (id, school_id, user_id, student_no, display_name, status, created_at, updated_at)
            VALUES ('stu-1', 'sch-1', 'u-stu1', 'S001', 'Student 1', 'active', '2026-10-01', '2026-10-01'),
                   ('stu-2', 'sch-1', 'u-stu2', 'S002', 'Student 2', 'active', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO class_students (class_id, student_id)
            VALUES ('cls-1', 'stu-1'),
                   ('cls-1', 'stu-2')
            """
        )
        con.execute(
            """
            INSERT INTO paper_records (id, exam_id, title, subject, created_at, updated_at)
            VALUES ('paper-practice', 'practice/exam', 'Unit Practice', 'Math', '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO exam_publications (id, paper_id, teacher_id, title, status, show_results_immediately, created_at, updated_at)
            VALUES ('pub-prac-1', 'paper-practice', 'u-tea', 'Unit Practice Pub', 'closed', 1, '2026-10-01', '2026-10-01')
            """
        )
        con.execute(
            """
            INSERT INTO publication_classes (publication_id, class_id)
            VALUES ('pub-prac-1', 'cls-1')
            """
        )

    return root, project_root


def test_comparison_source_regraded_baseline_frozen_marked_modified(tmp_path: Path) -> None:
    root, project_root = _setup_comparison_db(tmp_path)

    # 1. Record practice source link (diagnostic batch)
    with connect(root) as con:
        record_practice_source(
            con,
            practice_publication_id="pub-prac-1",
            practice_kind="remediation",
            source_type="diagnostic_batch",
            source_exam_id="diag/math",
            source_batch_id="batch-101",
            captured_at="2026-10-26T10:00:00Z",
        )

    # Create dummy diagnostic batch directory on project_root
    batch_dir = project_root / "exams" / "diag" / "math" / "scores" / "batch-101"
    batch_dir.mkdir(parents=True)
    scores_file = batch_dir / "scores.csv"
    scores_file.write_text("姓名,学号,1.1\n学生1,S001,4.0\n", encoding="utf-8")

    # Frozen baseline captured at publication: stu-1 got 2.0 / 4.0 on equations
    b_item = {
        "id": "fb-1",
        "practice_publication_id": "pub-prac-1",
        "student_id": "stu-1",
        "source_type": "diagnostic_batch",
        "source_ref_id": "batch-101",
        "source_attempt_id": None,
        "source_question_id": "diag-q1",
        "knowledge_node_id": "math/equations",
        "effective_score": 2.0,
        "effective_max_score": 4.0,
        "weight": 1.0,
        "raw_score": 2.0,
        "raw_max_score": 4.0,
        "rule_version": "v1_equal_split",
        "source_snapshot_hash": "batch-v1:original_hash_value",
        "captured_at": "2026-10-26T10:00:00Z",
    }
    with connect(root) as con:
        insert_frozen_baseline_items(con, [b_item])

    # Target attempt: stu-1 answered practice and scored 3.0 / 4.0
    payload = json.dumps([{"question_id": "prac-q1", "knowledge_node_id": "math/equations", "score_per_item": 4.0}])
    with connect(root) as con:
        con.execute(
            """
            INSERT INTO student_attempts (id, publication_id, student_id, status, question_payload_json, started_at, submitted_at)
            VALUES ('att-1', 'pub-prac-1', 'stu-1', 'submitted', ?, '2026-10-26T11:00:00Z', '2026-10-26T11:30:00Z')
            """,
            (payload,),
        )
        con.execute(
            """
            INSERT INTO student_answers (id, attempt_id, question_id, score, is_correct, grading_status, answer_payload, responded_at)
            VALUES ('ans-1', 'att-1', 'prac-q1', 3.0, 1, 'graded', '{}', '2026-10-26T11:20:00Z')
            """
        )

    # Notice source snapshot hash in DB does NOT match batch directory current hash (source was modified)
    res = get_practice_comparison(root, project_root, practice_publication_id="pub-prac-1", student_id="stu-1", include_unreleased=True)
    assert res["source_status"]["status"] == "source_modified"
    assert res["source_status"]["is_modified"] is True

    comp = res["comparison"]
    assert comp["is_source_modified"] is True
    assert len(comp["node_comparisons"]) == 1
    node = comp["node_comparisons"][0]
    # Frozen baseline remains strictly unchanged at 2.0 / 4.0 = 50.0%
    assert node["pre_score"] == 2.0
    assert node["pre_rate"] == 0.5
    assert node["pre_percentage"] == 50.0
    # Practice score is 3.0 / 4.0 = 75.0%
    assert node["post_score"] == 3.0
    assert node["post_rate"] == 0.75
    assert node["post_percentage"] == 75.0
    assert node["delta_percentage_points"] == 25.0
    assert node["status"] == "source_modified"


def test_comparison_source_deleted_marked_missing(tmp_path: Path) -> None:
    root, project_root = _setup_comparison_db(tmp_path)

    b_item = {
        "id": "fb-del",
        "practice_publication_id": "pub-prac-1",
        "student_id": "stu-1",
        "source_type": "diagnostic_batch",
        "source_ref_id": "batch-deleted",
        "source_attempt_id": None,
        "source_question_id": "diag-q1",
        "knowledge_node_id": "math/equations",
        "effective_score": 2.0,
        "effective_max_score": 4.0,
        "weight": 1.0,
        "raw_score": 2.0,
        "raw_max_score": 4.0,
        "rule_version": "v1_equal_split",
        "source_snapshot_hash": "batch-v1:hash",
        "captured_at": "2026-10-26T10:00:00Z",
    }
    with connect(root) as con:
        record_practice_source(
            con,
            practice_publication_id="pub-prac-1",
            practice_kind="remediation",
            source_type="diagnostic_batch",
            source_exam_id="deleted/exam",
            source_batch_id="batch-deleted",
            captured_at="2026-10-26T10:00:00Z",
        )
        insert_frozen_baseline_items(con, [b_item])

    # Do not create batch-deleted on disk (it was deleted)
    res = get_practice_comparison(root, project_root, practice_publication_id="pub-prac-1", student_id="stu-1")
    assert res["source_status"]["status"] == "source_missing"
    assert res["source_status"]["is_missing"] is True
    node = res["comparison"]["node_comparisons"][0]
    assert node["status"] == "source_missing"
    assert node["delta_percentage_points"] is None


def test_comparison_target_regrading_deduplication(tmp_path: Path) -> None:
    root, project_root = _setup_comparison_db(tmp_path)
    batch = project_root / "exams" / "math" / "fractions" / "scores" / "b1"
    batch.mkdir(parents=True)
    (batch / "scores.csv").write_text("姓名,学号,1.1\nStudent 1,S001,1\n", encoding="utf-8")

    b_item = {
        "id": "fb-dedup",
        "practice_publication_id": "pub-prac-1",
        "student_id": "stu-1",
        "source_type": "diagnostic_batch",
        "source_ref_id": "b1",
        "source_attempt_id": None,
        "source_question_id": "q1",
        "knowledge_node_id": "math/fractions",
        "effective_score": 1.0,
        "effective_max_score": 2.0,
        "weight": 1.0,
        "raw_score": 1.0,
        "raw_max_score": 2.0,
        "rule_version": "v1_equal_split",
        "source_snapshot_hash": compute_batch_snapshot_hash(project_root, "math/fractions", "b1"),
        "captured_at": "2026-10-26T10:00:00Z",
    }
    with connect(root) as con:
        record_practice_source(
            con,
            practice_publication_id="pub-prac-1",
            practice_kind="remediation",
            source_type="diagnostic_batch",
            source_exam_id="math/fractions",
            source_batch_id="b1",
            captured_at="2026-10-26T10:00:00Z",
        )
        insert_frozen_baseline_items(con, [b_item])

    payload = json.dumps([{"question_id": "prac-q1", "knowledge_node_id": "math/fractions", "score_per_item": 2.0}])
    with connect(root) as con:
        con.execute(
            """
            INSERT INTO student_attempts (id, publication_id, student_id, status, question_payload_json, started_at, submitted_at)
            VALUES ('att-dedup', 'pub-prac-1', 'stu-1', 'submitted', ?, '2026-10-26T11:00:00Z', '2026-10-26T11:30:00Z')
            """,
            (payload,),
        )
        # Regrading created an updated answer record
        con.execute(
            """
            INSERT INTO student_answers (id, attempt_id, question_id, score, is_correct, grading_status, answer_payload, responded_at)
            VALUES ('ans-dedup', 'att-dedup', 'prac-q1', 2.0, 1, 'graded', '{}', '2026-10-26T11:20:00Z')
            """
        )

    # Class comparison should have exactly 1 student, 1 node, and not double-counted
    res = get_practice_comparison(root, project_root, practice_publication_id="pub-prac-1", class_id="cls-1", include_unreleased=True)
    cls_comp = res["class_comparison"]
    assert len(cls_comp["node_summaries"]) == 1
    summary = cls_comp["node_summaries"][0]
    assert summary["matched_student_count"] == 1
    assert summary["pre_score_rate"] == 0.5
    assert summary["post_score_rate"] == 1.0
    assert summary["delta_percentage_points"] == 50.0
