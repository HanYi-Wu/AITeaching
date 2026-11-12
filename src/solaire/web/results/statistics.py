"""Statistical and fuzzy mastery analysis for score batches."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from solaire.knowledge_forge import load_graph
from solaire.edu_analysis.score_matrix import compute_score_matrix
from solaire.web.exam_service import _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.results.analysis_cache import (
    compute_source_fingerprint,
    is_cache_valid,
    save_analysis_cache_atomic,
    strip_cache_metadata,
)
from solaire.web.results.models import (
    _flatten_questions,
    _now_utc,
)
from solaire.web.security import assert_within_project


def compute_statistics(
    project_root: Path,
    exam_id: str,
    batch_id: str,
    *,
    graph_state: Any = None,
) -> dict[str, Any]:
    """
    Load scores for a batch, compute per-question / per-student / per-node stats.
    Fuzzy scoring: score_ratio = actual / score_per_item (0~1 float).
    Node error rate = 1 - fuzzy_AND(score_ratios of bound questions).
    """
    dir_path = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, dir_path)

    exam_yaml = dir_path / "exam.yaml"
    if not exam_yaml.is_file():
        raise FileNotFoundError(f"exam.yaml not found for: {exam_id}")

    # Load exam structure
    exam = _load_exam_config(exam_yaml)
    questions = _flatten_questions(exam)

    # Load scores
    scores_csv = dir_path / "scores" / batch_id / "scores.csv"
    if not scores_csv.is_file():
        raise FileNotFoundError(f"Scores not found: {batch_id}")

    scores_bytes = scores_csv.read_bytes()
    try:
        raw_text = scores_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raw_text = scores_bytes.decode("gbk", errors="replace")

    matrix = compute_score_matrix(raw_text, questions)
    question_csv_headers = matrix.question_csv_headers
    question_stats = matrix.question_stats
    student_stats = matrix.student_stats

    # Read-only graph state loaded once for both node stats and unbound warnings
    if graph_state is None:
        try:
            graph_state = load_graph(project_root)
        except Exception:
            graph_state = None

    exam_qids = {q.question_id for q in questions}
    question_index_by_id: dict[str, int] = {}
    for qi, question in enumerate(questions):
        question_index_by_id.setdefault(question.question_id, qi)

    node_question_map: dict[str, list[str]] = {}
    bound_qids_flat: set[str] = set()
    matching_bindings: list[tuple[str, str]] = []
    if graph_state is not None:
        try:
            for binding in getattr(graph_state, "bindings", []):
                qid = binding.question_qualified_id
                if qid in exam_qids:
                    node_question_map.setdefault(binding.node_id, []).append(qid)
                    bound_qids_flat.add(qid)
                    matching_bindings.append((qid, binding.node_id))
        except Exception:
            pass

    # Compute node-level fuzzy error rate
    node_stats: list[dict[str, Any]] = []
    for node_id, bound_qids in node_question_map.items():
        if not bound_qids:
            continue
        min_fuzzy = 1.0
        for qid in bound_qids:
            qi = question_index_by_id.get(qid)
            if qi is None:
                continue
            question = questions[qi]
            # Preserve the existing rule: zero or invalid question maxima do not
            # contribute to node mastery, even though question_stats may show 0.
            if question.score_per_item and question.score_per_item > 0:
                avg_fuzzy = question_stats[qi]["avg_score_ratio"]
                if avg_fuzzy is not None:
                    min_fuzzy = min(min_fuzzy, avg_fuzzy)
        mastery = min_fuzzy if min_fuzzy < 1.0 else 1.0
        error_rate = 1.0 - mastery
        node_stats.append({
            "node_id": node_id,
            "bound_question_count": len(bound_qids),
            "bound_questions": bound_qids,
            "mastery_fuzzy": round(mastery, 4),
            "error_rate": round(error_rate, 4),
        })

    # Warn about unbound questions
    unbound_warnings: list[dict[str, str]] = []
    for qi, q in enumerate(questions):
        if q.question_id not in bound_qids_flat:
            unbound_warnings.append({
                "question_id": q.question_id,
                "header": question_csv_headers[qi],
                "section_id": q.section_id,
                "message": f"第{question_csv_headers[qi]}题（{q.question_id}）未绑定知识点节点，请在知识图谱页面绑定后再查看节点统计",
            })

    # Save computed analysis atomically with source fingerprint
    analysis_path = dir_path / "scores" / batch_id / "analysis.json"
    analysis_data = {
        "batch_id": batch_id,
        "exam_id": exam_id,
        "student_count": len(student_stats),
        "question_count": len(questions),
        "imported_at": _now_utc().isoformat(),
        "warnings": unbound_warnings,
        "question_order": [q.question_id for q in questions],
        "student_mastery_rows": matrix.student_mastery_rows,
        "question_stats": question_stats,
        "node_stats": node_stats,
        "student_stats": student_stats,
        "class_avg_ratio": matrix.class_avg_ratio,
        "class_avg_fuzzy": matrix.class_avg_fuzzy,
    }

    fingerprint = compute_source_fingerprint(
        exam_id=exam_id,
        batch_id=batch_id,
        questions=questions,
        scores_bytes=scores_bytes,
        bindings=matching_bindings,
    )
    save_analysis_cache_atomic(analysis_path, analysis_data, fingerprint)

    return analysis_data


def get_score_analysis(project_root: Path, exam_id: str, batch_id: str) -> dict[str, Any]:
    """Return cached analysis for a score batch (recompute if stale or inputs changed)."""
    dir_path = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, dir_path)
    analysis_path = dir_path / "scores" / batch_id / "analysis.json"
    if not analysis_path.is_file():
        return compute_statistics(project_root, exam_id, batch_id)

    exam_yaml = dir_path / "exam.yaml"
    scores_csv = dir_path / "scores" / batch_id / "scores.csv"
    if not exam_yaml.is_file() or not scores_csv.is_file():
        return compute_statistics(project_root, exam_id, batch_id)

    try:
        with analysis_path.open(encoding="utf-8") as f:
            cached_data = json.load(f)
    except Exception:
        return compute_statistics(project_root, exam_id, batch_id)

    if not isinstance(cached_data, dict) or "_fingerprint" not in cached_data:
        return compute_statistics(project_root, exam_id, batch_id)

    try:
        exam = _load_exam_config(exam_yaml)
        questions = _flatten_questions(exam)
        scores_bytes = scores_csv.read_bytes()
    except Exception:
        return compute_statistics(project_root, exam_id, batch_id)

    graph_state: Any = None
    try:
        graph_state = load_graph(project_root)
    except Exception:
        graph_state = None

    exam_qids = {q.question_id for q in questions}
    matching_bindings: list[tuple[str, str]] = []
    if graph_state is not None:
        try:
            for b in getattr(graph_state, "bindings", []):
                if b.question_qualified_id in exam_qids:
                    matching_bindings.append((b.question_qualified_id, b.node_id))
        except Exception:
            pass

    expected_fp = compute_source_fingerprint(
        exam_id=exam_id,
        batch_id=batch_id,
        questions=questions,
        scores_bytes=scores_bytes,
        bindings=matching_bindings,
    )

    if not is_cache_valid(cached_data, expected_fp):
        return compute_statistics(project_root, exam_id, batch_id, graph_state=graph_state)

    return strip_cache_metadata(cached_data)
