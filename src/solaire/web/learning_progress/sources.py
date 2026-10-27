"""Source resolution and authoritative digest calculation for diagnostic batches and online exams."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solaire.knowledge_forge import load_graph
from solaire.web.exam_service import _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.platform_db import connect, row_to_dict
from solaire.web.results.models import _flatten_questions, _safe_float
from solaire.web.results.statistics import get_score_analysis
from solaire.web.security import assert_within_project


def compute_batch_snapshot_hash(project_root: Path, exam_id: str, batch_id: str) -> str:
    """Compute deterministic SHA-256 digest of an imported diagnostic score batch."""
    dir_path = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, dir_path)
    scores_csv = dir_path / "scores" / batch_id / "scores.csv"
    assert_within_project(dir_path / "scores", scores_csv)
    if not scores_csv.is_file():
        raise FileNotFoundError(f"Score batch file not found: {batch_id}")
    content = scores_csv.read_bytes()
    return "batch-v1:" + hashlib.sha256(content).hexdigest()


def compute_online_source_snapshot_hash(
    con_or_root: sqlite3.Connection | Path,
    publication_id: str,
    student_id: str | None = None,
) -> str:
    """Compute deterministic SHA-256 digest of submitted scores in an online publication."""
    query = """
        SELECT sa.id as attempt_id, sa.student_id, ans.question_id, ans.score, ans.is_correct
        FROM student_attempts sa
        JOIN student_answers ans ON ans.attempt_id = sa.id
        WHERE sa.publication_id = ? AND sa.status = 'submitted'
    """
    params: list[Any] = [publication_id]
    if student_id:
        query += " AND sa.student_id = ?"
        params.append(student_id)
    query += " ORDER BY sa.student_id ASC, ans.question_id ASC"

    if isinstance(con_or_root, sqlite3.Connection):
        rows = con_or_root.execute(query, tuple(params)).fetchall()
    else:
        with connect(con_or_root) as con:
            rows = con.execute(query, tuple(params)).fetchall()

    return _online_source_snapshot_hash_from_rows(rows)


def _online_source_snapshot_hash_from_rows(rows: Any) -> str:
    """Hash the exact ordered answer projection used by the online source contract."""
    payload = [
        {
            "attempt_id": str(r["attempt_id"]),
            "student_id": str(r["student_id"]),
            "question_id": str(r["question_id"]),
            "score": float(r["score"]) if r["score"] is not None else None,
            "is_correct": int(r["is_correct"]) if r["is_correct"] is not None else None,
        }
        for r in rows
    ]
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "online-v1:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class GraphQuestionBindingSnapshot:
    graph_root: Path
    node_ids_by_question: dict[str, list[str]]
    names_by_node_id: dict[str, str]


def load_graph_question_binding_snapshot(project_root: Path) -> GraphQuestionBindingSnapshot:
    """Load actor-scoped question bindings and node names once for one publication."""
    graph_root = _evidence_graph_root(project_root).resolve()
    state = load_graph(graph_root)
    mapping: dict[str, list[str]] = {}
    for binding in state.bindings:
        qid = binding.question_qualified_id
        nid = binding.node_id
        if nid not in mapping.setdefault(qid, []):
            mapping[qid].append(nid)
    names = {node.id: node.canonical_name for node in state.nodes}
    return GraphQuestionBindingSnapshot(graph_root, mapping, names)


def get_graph_question_node_bindings(project_root: Path) -> dict[str, list[str]]:
    """Return mapping from question_qualified_id -> list of bound knowledge node_ids."""
    mapping: dict[str, list[str]] = {}
    try:
        state = load_graph(_evidence_graph_root(project_root))
        for binding in state.bindings:
            qid = binding.question_qualified_id
            nid = binding.node_id
            if nid not in mapping.setdefault(qid, []):
                mapping[qid].append(nid)
    except Exception:
        pass
    return mapping


def question_node_ids(question: dict[str, Any], bindings: dict[str, list[str]]) -> list[str]:
    """Prefer the publication snapshot; consult current bindings only for old records."""
    if "knowledge_node_ids" in question:
        return list(dict.fromkeys(str(node) for node in question["knowledge_node_ids"] if node))
    embedded = question.get("knowledge_node_id") or question.get("node_id")
    if embedded:
        return [str(embedded)]
    return list(dict.fromkeys(bindings.get(str(question.get("question_id")), [])))


def freeze_question_bindings(
    project_root: Path | None,
    questions: list[dict[str, Any]],
    *,
    graph_snapshot: GraphQuestionBindingSnapshot | None = None,
) -> list[dict[str, Any]]:
    if project_root:
        graph_root = _evidence_graph_root(project_root).resolve()
        if graph_snapshot is None or graph_snapshot.graph_root != graph_root:
            graph_snapshot = load_graph_question_binding_snapshot(project_root)
        bindings = graph_snapshot.node_ids_by_question
        names = graph_snapshot.names_by_node_id
    else:
        bindings = {}
        names = {}
    frozen = []
    for question in questions:
        node_ids = question_node_ids(question, bindings)
        frozen.append({**question, "knowledge_node_ids": node_ids,
                       "knowledge_node_names": {node_id: names[node_id] for node_id in node_ids if node_id in names}})
    return frozen


def _evidence_graph_root(project_root: Path) -> Path:
    from solaire.common.actor_context import actor
    from solaire.web.actor_scope import teacher_graph_root

    return teacher_graph_root(project_root, actor.get())


def resolve_batch_student_scores(
    project_root: Path,
    exam_id: str,
    batch_id: str,
) -> list[dict[str, Any]]:
    """Load per-student scores from a diagnostic batch.

    Returns:
        list of {
            "student_no": str,
            "name": str,
            "scores": {question_id: float | None},
            "raw_max_scores": {question_id: float},
        }
    """
    dir_path = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, dir_path)

    exam_yaml = dir_path / "exam.yaml"
    if not exam_yaml.is_file():
        raise FileNotFoundError(f"exam.yaml not found for: {exam_id}")

    exam = _load_exam_config(exam_yaml)
    questions = _flatten_questions(exam)
    max_scores = {q.question_id: q.score_per_item for q in questions}

    scores_csv = dir_path / "scores" / batch_id / "scores.csv"
    assert_within_project(dir_path / "scores", scores_csv)
    if not scores_csv.is_file():
        raise FileNotFoundError(f"Score batch not found: {batch_id}")

    with scores_csv.open(encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        return []

    header = [h.strip() for h in rows[0]]
    col_name = header.index("姓名") if "姓名" in header else -1
    col_id = header.index("学号") if "学号" in header else -1
    header_to_idx = {h: i for i, h in enumerate(header) if h not in ("姓名", "学号")}
    score_col_indices = [i for i, h in enumerate(header) if h not in ("姓名", "学号")]

    students: list[dict[str, Any]] = []
    for row in rows[1:]:
        if not row or all(not c.strip() for c in row):
            continue
        name = row[col_name].strip() if col_name >= 0 and col_name < len(row) else ""
        student_no = row[col_id].strip() if col_id >= 0 and col_id < len(row) else ""

        q_scores: dict[str, float | None] = {}
        for qi, q in enumerate(questions):
            raw_val = None
            if q.csv_header() in header_to_idx:
                idx = header_to_idx[q.csv_header()]
                raw_val = row[idx].strip() if idx < len(row) else None
            elif qi < len(score_col_indices):
                idx = score_col_indices[qi]
                raw_val = row[idx].strip() if idx < len(row) else None
            q_scores[q.question_id] = _safe_float(raw_val)

        students.append({
            "name": name,
            "student_no": student_no,
            "scores": q_scores,
            "raw_max_scores": max_scores,
        })
    return students
