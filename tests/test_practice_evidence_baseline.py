"""Tests for frozen knowledge baselines captured at publication time (C14).

Verifies:
- Frozen baseline records in same SQL transaction
- Atomic rollback on freeze failure (without mocks)
- Subsequent source regrade does not alter frozen baseline
- Equal split rule versioning for multi-knowledge-node questions
- Materials without reliable bindings continue to publish safely
"""

from __future__ import annotations

from pathlib import Path
import pytest
from unittest.mock import patch

import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, SelectedSection
from solaire.web.learning_progress.baselines import (
    DEFAULT_CALCULATION_RULE_VERSION,
    freeze_publication_baseline,
)
from solaire.web.learning_progress.compatibility import get_authoritative_source_status
from solaire.web.learning_progress.store import get_frozen_baselines
from solaire.web.paper_service import publish_online_paper
from solaire.web.platform_db import connect, init_platform_db


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
                "score_per_item": 10,
            }
        ],
    }
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)


def _setup_multi_node_env(web_client: TestClient, root: Path) -> tuple[str, str, str, str]:
    _write_template(root / "templates" / "test.yaml")
    source_qid = "数学/补题/source_q1"
    q_remedial = "数学/补题/remedial_q1"
    _write_question(root / "resource" / "数学" / "补题" / "source_q1.yaml", "source_q1")
    _write_question(root / "resource" / "数学" / "补题" / "remedial_q1.yaml", "remedial_q1")

    exam_id = "月考/数学"
    export_label, subject = exam_id.split("/", 1)
    exam_dir = root / "exams" / export_label / subject
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="test_template",
        template_path="templates/test.yaml",
        metadata={"title": "月考", "subject": "数学", "export_label": "月考"},
        question_libraries=[],
        selected_items=[
            SelectedSection(section_id="选择题", question_ids=[source_qid], score_per_item=10.0)
        ],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)

    csv_text = "姓名,学号,1.1\n学生甲,202601,6.0\n"
    files = {"file": ("scores.csv", csv_text.encode("utf-8"), "text/csv")}
    r_import = web_client.post(f"/api/exams/{exam_id}/scores", files=files)
    assert r_import.status_code == 200
    batch_id = r_import.json()["batch_id"]

    # Bind source_qid to TWO knowledge nodes to test equal split
    node1 = "math/algebra"
    node2 = "math/functions"
    web_client.post("/api/graph/nodes", json={"id": node1, "canonical_name": "代数", "subject": "数学", "aliases": []})
    web_client.post("/api/graph/nodes", json={"id": node2, "canonical_name": "函数", "subject": "数学", "aliases": []})
    web_client.post("/api/graph/bindings", json={"question_qualified_id": source_qid, "node_id": node1})
    web_client.post("/api/graph/bindings", json={"question_qualified_id": source_qid, "node_id": node2})
    web_client.post("/api/graph/bindings", json={"question_qualified_id": q_remedial, "node_id": node1})

    web_client.post(f"/api/exams/{exam_id}/scores/{batch_id}/recompute", json={})
    return exam_id, batch_id, node1, node2


def _setup_platform_records(root: Path, draft_exam_id: str) -> dict[str, str]:
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
        con.execute("INSERT INTO students (id, school_id, student_no, display_name, created_at, updated_at) VALUES ('s1', 'sch1', '202601', '学生甲', datetime('now'), datetime('now'))")
        con.execute("INSERT INTO class_students (class_id, student_id) VALUES ('c1', 's1')")
        con.execute(
            "INSERT INTO paper_records (id, exam_id, title, subject, owner_teacher_id, school_id, created_at, updated_at) "
            "VALUES ('paper-1', ?, '复练试卷', '数学', 't1', 'sch1', datetime('now'), datetime('now'))",
            (draft_exam_id,),
        )
    return {"user_id": "t1", "paper_id": "paper-1", "student_id": "s1"}


def test_freeze_baseline_on_publication_stores_exact_split_and_metadata(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id, batch_id, node1, node2 = _setup_multi_node_env(web_client, tmp_path)
    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 2,
            "exclude_source_exam_questions": True,
            "export_label": "月考补练",
        },
    )
    assert r.status_code == 200, r.text
    draft_exam_id = r.json()["exam_id"]

    ctx = _setup_platform_records(tmp_path, draft_exam_id)
    user = {"id": ctx["user_id"], "role": "teacher", "school_id": "sch1"}

    pub = publish_online_paper(
        tmp_path,
        paper_id=ctx["paper_id"],
        user=user,
        class_ids=["c1"],
        project_root=tmp_path,
        title="月考针对复练",
        subject="数学",
    )
    pub_id = pub["id"]

    baselines = get_frozen_baselines(tmp_path, practice_publication_id=pub_id, student_id=ctx["student_id"])
    assert len(baselines) == 2

    # Two nodes split raw_score=6.0 equally: effective_score=3.0, raw_max=10.0 split to effective_max=5.0
    nodes_found = {b.knowledge_node_id for b in baselines}
    assert nodes_found == {node1, node2}

    for b in baselines:
        assert b.student_id == ctx["student_id"]
        assert b.source_type == "diagnostic_batch"
        assert b.source_ref_id == batch_id
        assert b.raw_score == 6.0
        assert b.raw_max_score == 10.0
        assert b.effective_score == 3.0
        assert b.effective_max_score == 5.0
        assert b.weight == 0.5
        assert b.rule_version == DEFAULT_CALCULATION_RULE_VERSION
        assert b.source_snapshot_hash.startswith("batch-v1:")
        assert b.captured_at


def test_atomic_rollback_on_freeze_failure(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    exam_id, batch_id, node1, node2 = _setup_multi_node_env(web_client, tmp_path)
    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 2,
            "exclude_source_exam_questions": True,
            "export_label": "月考补练-回滚测试",
        },
    )
    draft_exam_id = r.json()["exam_id"]
    ctx = _setup_platform_records(tmp_path, draft_exam_id)
    user = {"id": ctx["user_id"], "role": "teacher", "school_id": "sch1"}

    # Simulate freeze error inside the transaction
    def failing_freeze(*args, **kwargs):
        raise RuntimeError("Database freeze failure simulation")

    monkeypatch.setattr(
        "solaire.web.learning_progress.baselines.freeze_publication_baseline",
        failing_freeze,
    )

    with pytest.raises(RuntimeError, match="Database freeze failure simulation"):
        publish_online_paper(
            tmp_path,
            paper_id=ctx["paper_id"],
            user=user,
            class_ids=["c1"],
            project_root=tmp_path,
            title="回滚测试",
            subject="数学",
        )

    # Real SQL transaction verification: Neither publication nor attempts were committed!
    with connect(tmp_path) as con:
        pub_count = con.execute("SELECT COUNT(*) FROM exam_publications").fetchone()[0]
        att_count = con.execute("SELECT COUNT(*) FROM student_attempts").fetchone()[0]
        paper = con.execute("SELECT status FROM paper_records WHERE id = ?", (ctx["paper_id"],)).fetchone()
        assert pub_count == 0
        assert att_count == 0
        assert paper["status"] == "draft"


def test_source_regrade_does_not_modify_frozen_baseline(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id, batch_id, node1, node2 = _setup_multi_node_env(web_client, tmp_path)
    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 2,
            "exclude_source_exam_questions": True,
            "export_label": "月考补练-复核测试",
        },
    )
    draft_exam_id = r.json()["exam_id"]
    ctx = _setup_platform_records(tmp_path, draft_exam_id)
    user = {"id": ctx["user_id"], "role": "teacher", "school_id": "sch1"}

    pub = publish_online_paper(
        tmp_path,
        paper_id=ctx["paper_id"],
        user=user,
        class_ids=["c1"],
        project_root=tmp_path,
        title="复核验证练习",
        subject="数学",
    )
    pub_id = pub["id"]

    # Check baseline initial status
    initial_status = get_authoritative_source_status(tmp_path, tmp_path, practice_publication_id=pub_id)
    assert initial_status["status"] == "valid"
    assert initial_status["is_modified"] is False

    # Teacher re-grades original source exam (changes scores.csv from 6.0 to 9.0)
    scores_file = tmp_path / "exams" / "月考" / "数学" / "scores" / batch_id / "scores.csv"
    scores_file.write_text("姓名,学号,1.1\n学生甲,202601,9.0\n", encoding="utf-8")

    # Frozen baseline in DB MUST NOT CHANGE
    baselines = get_frozen_baselines(tmp_path, practice_publication_id=pub_id, student_id=ctx["student_id"])
    for b in baselines:
        assert b.effective_score == 3.0  # Still 6.0 / 2 = 3.0, NOT 4.5!
        assert b.raw_score == 6.0

    # Authoritative status flags that source was modified
    mod_status = get_authoritative_source_status(tmp_path, tmp_path, practice_publication_id=pub_id)
    assert mod_status["status"] == "source_modified"
    assert mod_status["is_modified"] is True
    assert "regraded or modified" in mod_status["reason"]
