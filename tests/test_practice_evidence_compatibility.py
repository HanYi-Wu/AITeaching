"""Tests for legacy compatibility and missing-source handling (C22).

Verifies:
- Deleting source batch does not delete frozen baseline or fake a 0 score
- Authoritative source status correctly identifies deleted source batches
- Legacy publications without frozen baselines return safe missing states
- Target practice attempts distinguish unsubmitted, ungraded, unreleased, and missing knowledge nodes
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, SelectedSection
from solaire.web.learning_progress.compatibility import (
    get_authoritative_source_status,
    get_authoritative_target_evidence,
    get_frozen_baseline,
)
from solaire.web.learning_progress.store import get_frozen_baselines
from solaire.web.paper_service import publish_online_paper
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.results.batches import delete_score_batch


def _write_question(path: Path, qid: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = {
        "id": qid,
        "type": "single_choice",
        "content": f"{qid} 题干",
        "options": {"A": "1", "B": "2"},
        "answer": "A",
        "analysis": "",
    }
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)


def _write_template(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = {
        "template_id": "test_template",
        "layout": "single_column",
        "latex_base": "exam-zh-base.tex.j2",
        "sections": [
            {
                "section_id": "选择题",
                "type": "single_choice",
                "required_count": 1,
                "score_per_item": 5,
            }
        ],
    }
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)


def _setup_compat_env(web_client: TestClient, root: Path) -> tuple[str, str, str]:
    _write_template(root / "templates" / "test.yaml")
    source_qid = "数学/补题/source_c1"
    q_remedial = "数学/补题/remedial_c1"
    _write_question(root / "resource" / "数学" / "补题" / "source_c1.yaml", "source_c1")
    _write_question(root / "resource" / "数学" / "补题" / "remedial_c1.yaml", "remedial_c1")

    exam_id = "单元测/数学"
    export_label, subject = exam_id.split("/", 1)
    exam_dir = root / "exams" / export_label / subject
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="test_template",
        template_path="templates/test.yaml",
        metadata={"title": "单元测", "subject": "数学", "export_label": "单元测"},
        question_libraries=[],
        selected_items=[
            SelectedSection(section_id="选择题", question_ids=[source_qid], score_per_item=5.0)
        ],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)

    csv_text = "姓名,学号,1.1\n学生乙,202602,4.0\n"
    files = {"file": ("scores.csv", csv_text.encode("utf-8"), "text/csv")}
    r_import = web_client.post(f"/api/exams/{exam_id}/scores", files=files)
    batch_id = r_import.json()["batch_id"]

    node1 = "math/algebra/c1"
    web_client.post("/api/graph/nodes", json={"id": node1, "canonical_name": "代数基础", "subject": "数学", "aliases": []})
    web_client.post("/api/graph/bindings", json={"question_qualified_id": source_qid, "node_id": node1})
    web_client.post("/api/graph/bindings", json={"question_qualified_id": q_remedial, "node_id": node1})
    web_client.post(f"/api/exams/{exam_id}/scores/{batch_id}/recompute", json={})
    return exam_id, batch_id, node1


def _setup_platform_base(root: Path, draft_exam_id: str) -> dict[str, str]:
    init_platform_db(root)
    with connect(root) as con:
        con.execute("INSERT INTO schools (id, name, created_at, updated_at) VALUES ('sch1', '实验中学', datetime('now'), datetime('now'))")
        con.execute(
            "INSERT INTO users (id, school_id, role, username, password_hash, display_name, created_at, updated_at) "
            "VALUES ('t1', 'sch1', 'teacher', 'teacher1', 'hash', '数学老师', datetime('now'), datetime('now'))"
        )
        con.execute("INSERT INTO classes (id, school_id, name, created_at, updated_at) VALUES ('c1', 'sch1', '高一1班', datetime('now'), datetime('now'))")
        con.execute("INSERT INTO teacher_class_assignments (teacher_id, class_id, subject) VALUES ('t1', 'c1', '数学')")
        con.execute("INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES ('ts1', 't1', '数学')")
        con.execute("INSERT INTO students (id, school_id, student_no, display_name, created_at, updated_at) VALUES ('s2', 'sch1', '202602', '学生乙', datetime('now'), datetime('now'))")
        con.execute("INSERT INTO class_students (class_id, student_id) VALUES ('c1', 's2')")
        con.execute(
            "INSERT INTO paper_records (id, exam_id, title, subject, owner_teacher_id, school_id, created_at, updated_at) "
            "VALUES ('paper-c1', ?, '针对复练', '数学', 't1', 'sch1', datetime('now'), datetime('now'))",
            (draft_exam_id,),
        )
    return {"user_id": "t1", "paper_id": "paper-c1", "student_id": "s2"}


def test_deleted_source_batch_marks_incomparable_without_falsifying_zero(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id, batch_id, node1 = _setup_compat_env(web_client, tmp_path)
    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 2,
            "exclude_source_exam_questions": True,
            "export_label": "单元测补练",
        },
    )
    draft_exam_id = r.json()["exam_id"]
    ctx = _setup_platform_base(tmp_path, draft_exam_id)
    user = {"id": ctx["user_id"], "role": "teacher", "school_id": "sch1"}

    pub = publish_online_paper(
        tmp_path,
        paper_id=ctx["paper_id"],
        user=user,
        class_ids=["c1"],
        project_root=tmp_path,
        title="单元测补练发布",
        subject="数学",
    )
    pub_id = pub["id"]

    # Delete source score batch directory
    delete_score_batch(tmp_path, exam_id, batch_id)

    # 1. Baseline items in DB are NOT deleted, not converted to 0
    baselines = get_frozen_baselines(tmp_path, practice_publication_id=pub_id, student_id=ctx["student_id"])
    assert len(baselines) == 1
    assert baselines[0].effective_score == 4.0
    assert baselines[0].effective_score != 0.0

    # 2. Source status reports source_missing, cannot fabricate false progress
    source_status = get_authoritative_source_status(tmp_path, tmp_path, practice_publication_id=pub_id)
    assert source_status["status"] == "source_missing"
    assert source_status["is_missing"] is True
    assert "deleted" in source_status["reason"]


def test_legacy_publication_without_baseline_returns_clean_missing_state(
    tmp_path: Path,
) -> None:
    init_platform_db(tmp_path)
    with connect(tmp_path) as con:
        con.execute(
            "INSERT INTO schools (id, name, created_at, updated_at) VALUES ('sch1', '老学校', datetime('now'), datetime('now'))"
        )
        con.execute(
            "INSERT INTO users (id, school_id, role, username, password_hash, display_name, created_at, updated_at) "
            "VALUES ('t1', 'sch1', 'teacher', 'teacher1', 'hash', '老师', datetime('now'), datetime('now'))"
        )
        con.execute(
            "INSERT INTO paper_records (id, exam_id, title, subject, created_at, updated_at) "
            "VALUES ('old-p', 'old-exam', '旧试卷', '数学', datetime('now'), datetime('now'))"
        )
        con.execute(
            "INSERT INTO exam_publications (id, paper_id, teacher_id, title, status, created_at, updated_at) "
            "VALUES ('legacy-pub-1', 'old-p', 't1', '老发布', 'published', datetime('now'), datetime('now'))"
        )

    # Calling get_frozen_baseline on legacy publication returns empty list safely
    baselines = get_frozen_baseline(tmp_path, practice_publication_id="legacy-pub-1")
    assert baselines == []

    # Calling get_authoritative_source_status safely identifies missing source without error
    status = get_authoritative_source_status(tmp_path, tmp_path, practice_publication_id="legacy-pub-1")
    assert status["status"] == "source_missing"
    assert status["is_missing"] is True


def test_unsubmitted_ungraded_and_unreleased_states_in_target_evidence(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id, batch_id, node1 = _setup_compat_env(web_client, tmp_path)
    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 2,
            "exclude_source_exam_questions": True,
            "export_label": "单元测状态测试",
        },
    )
    draft_exam_id = r.json()["exam_id"]
    ctx = _setup_platform_base(tmp_path, draft_exam_id)
    user = {"id": ctx["user_id"], "role": "teacher", "school_id": "sch1"}

    # Publish with show_results_immediately=False
    pub = publish_online_paper(
        tmp_path,
        paper_id=ctx["paper_id"],
        user=user,
        class_ids=["c1"],
        project_root=tmp_path,
        title="状态测试练习",
        subject="数学",
        show_results_immediately=False,
    )
    pub_id = pub["id"]

    # 1. Student has not submitted -> target_unsubmitted
    evidence1 = get_authoritative_target_evidence(tmp_path, tmp_path, practice_publication_id=pub_id, student_id=ctx["student_id"])
    assert len(evidence1) == 1
    assert evidence1[0]["status"] == "target_unsubmitted"

    # 2. Student submitted, but grading pending -> target_ungraded
    with connect(tmp_path) as con:
        att = con.execute("SELECT id FROM student_attempts WHERE publication_id = ?", (pub_id,)).fetchone()
        att_id = str(att["id"])
        con.execute("UPDATE student_attempts SET status = 'submitted' WHERE id = ?", (att_id,))
        con.execute(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) "
            "VALUES ('ans1', ?, '数学/补题/remedial_c1', 'A', NULL, NULL, 'pending', datetime('now'))",
            (att_id,),
        )

    evidence2 = get_authoritative_target_evidence(tmp_path, tmp_path, practice_publication_id=pub_id, student_id=ctx["student_id"])
    assert len(evidence2) == 1
    assert evidence2[0]["status"] == "target_ungraded"

    # 3. Graded, but publication results not released yet -> target_unreleased
    with connect(tmp_path) as con:
        con.execute(
            "UPDATE student_answers SET grading_status = 'graded', is_correct = 1, score = 5.0 WHERE id = 'ans1'"
        )

    evidence3 = get_authoritative_target_evidence(tmp_path, tmp_path, practice_publication_id=pub_id, student_id=ctx["student_id"])
    assert len(evidence3) == 1
    assert evidence3[0]["status"] == "target_unreleased"

    # Publication display settings alone do not publish a teacher's draft grade.
    with connect(tmp_path) as con:
        con.execute("UPDATE exam_publications SET show_results_immediately = 1 WHERE id = ?", (pub_id,))
    assert get_authoritative_target_evidence(tmp_path, tmp_path, practice_publication_id=pub_id)[0]["status"] == "target_unreleased"

    # 4. Explicitly finish grading using the existing release marker.
    with connect(tmp_path) as con:
        con.execute("UPDATE student_attempts SET grading_completed_at = datetime('now') WHERE id = ?", (att_id,))

    evidence4 = get_authoritative_target_evidence(tmp_path, tmp_path, practice_publication_id=pub_id, student_id=ctx["student_id"])
    assert len(evidence4) == 1
    assert evidence4[0]["status"] == "valid"
    assert evidence4[0]["score"] == 5.0
    assert evidence4[0]["knowledge_node_id"] == node1
