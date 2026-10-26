"""Tests for stable practice source relations (C13).

Verifies linkage from diagnostic batches and online publications to practice drafts and publications.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, SelectedSection
from solaire.web.exam_workspace_service import load_exam_workspace
from solaire.web.learning_progress.store import get_practice_sources
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
                "score_per_item": 5,
            }
        ],
    }
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)


def _setup_remediation_env(web_client: TestClient, root: Path) -> tuple[str, str]:
    _write_template(root / "templates" / "test.yaml")
    source_qid = "数学/补题/source_choice"
    q1 = "数学/补题/remedial_choice_1"
    _write_question(root / "resource" / "数学" / "补题" / "source_choice.yaml", "source_choice")
    _write_question(root / "resource" / "数学" / "补题" / "remedial_choice_1.yaml", "remedial_choice_1")

    exam_id = "期中/数学"
    export_label, subject = exam_id.split("/", 1)
    exam_dir = root / "exams" / export_label / subject
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="test_template",
        template_path="templates/test.yaml",
        metadata={"title": "期中", "subject": "数学", "export_label": "期中"},
        question_libraries=[],
        selected_items=[
            SelectedSection(section_id="选择题", question_ids=[source_qid], score_per_item=5)
        ],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)

    csv_text = "姓名,学号,1.1\n甲,202601,2\n"
    files = {"file": ("scores.csv", csv_text.encode("utf-8"), "text/csv")}
    r_import = web_client.post(f"/api/exams/{exam_id}/scores", files=files)
    assert r_import.status_code == 200
    batch_id = r_import.json()["batch_id"]

    node_id = "math/remediation/node"
    assert web_client.post(
        "/api/graph/nodes",
        json={"id": node_id, "canonical_name": "薄弱点", "subject": "数学", "aliases": []},
    ).status_code == 200

    for q in (source_qid, q1):
        assert web_client.post(
            "/api/graph/bindings",
            json={"question_qualified_id": q, "node_id": node_id},
        ).status_code == 200

    assert web_client.post(f"/api/exams/{exam_id}/scores/{batch_id}/recompute", json={}).status_code == 200
    return exam_id, batch_id


def test_remediation_draft_persists_source_metadata_without_required_fields(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id, batch_id = _setup_remediation_env(web_client, tmp_path)

    # Calling without optional source_batch_id
    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 2,
            "exclude_source_exam_questions": True,
            "export_label": "期中补练",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_exam_id"] == exam_id
    assert body["batch_id"] == batch_id
    assert body["source_batch_id"] == batch_id

    doc = load_exam_workspace(tmp_path, body["exam_id"])
    assert doc.get("source_exam_id") == exam_id
    assert doc.get("source_batch_id") == batch_id


def test_publish_remediation_records_stable_practice_sources(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    exam_id, batch_id = _setup_remediation_env(web_client, tmp_path)
    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 2,
            "exclude_source_exam_questions": True,
            "export_label": "期中补练2",
        },
    )
    assert r.status_code == 200, r.text
    draft_exam_id = r.json()["exam_id"]

    init_platform_db(tmp_path)
    with connect(tmp_path) as con:
        con.execute(
            "INSERT INTO schools (id, name, created_at, updated_at) VALUES ('sch1', '实验中学', datetime('now'), datetime('now'))"
        )
        con.execute(
            "INSERT INTO users (id, school_id, role, username, password_hash, display_name, created_at, updated_at) "
            "VALUES ('t1', 'sch1', 'teacher', 'teacher1', 'hash', '数学老师', datetime('now'), datetime('now'))"
        )
        con.execute(
            "INSERT INTO classes (id, school_id, name, created_at, updated_at) VALUES ('c1', 'sch1', '高一1班', datetime('now'), datetime('now'))"
        )
        con.execute(
            "INSERT INTO teacher_class_assignments (teacher_id, class_id, subject) VALUES ('t1', 'c1', '数学')"
        )
        con.execute(
            "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES ('ts1', 't1', '数学')"
        )
        con.execute(
            "INSERT INTO students (id, school_id, student_no, display_name, created_at, updated_at) "
            "VALUES ('s1', 'sch1', '202601', '甲', datetime('now'), datetime('now'))"
        )
        con.execute(
            "INSERT INTO class_students (class_id, student_id) VALUES ('c1', 's1')"
        )
        con.execute(
            "INSERT INTO paper_records (id, exam_id, title, subject, owner_teacher_id, school_id, created_at, updated_at) "
            "VALUES ('paper-draft-1', ?, '补练试卷', '数学', 't1', 'sch1', datetime('now'), datetime('now'))",
            (draft_exam_id,),
        )

    user = {"id": "t1", "role": "teacher", "school_id": "sch1"}
    publication = publish_online_paper(
        tmp_path,
        paper_id="paper-draft-1",
        user=user,
        class_ids=["c1"],
        project_root=tmp_path,
        title="单元巩固练习",
        subject="数学",
    )

    pub_id = publication["id"]
    sources = get_practice_sources(tmp_path, pub_id)
    assert len(sources) == 1
    src = sources[0]
    assert src.practice_publication_id == pub_id
    assert src.source_type == "diagnostic_batch"
    assert src.source_exam_id == exam_id
    assert src.source_batch_id == batch_id
    assert src.practice_kind == "remediation"
