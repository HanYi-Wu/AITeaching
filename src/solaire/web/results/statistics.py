"""Statistical and fuzzy mastery analysis for score batches."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

from solaire.knowledge_forge import load_graph
from solaire.web.exam_service import _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.results.models import (
    _flatten_questions,
    _now_utc,
    _safe_float,
)
from solaire.web.security import assert_within_project


def compute_statistics(
    project_root: Path,
    exam_id: str,
    batch_id: str,
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

    with scores_csv.open(encoding="utf-8") as f:
        raw_text = f.read()

    reader = csv.reader(io.StringIO(raw_text))
    rows = list(reader)
    header = [h.strip() for h in rows[0]]
    data_rows = rows[1:]

    header_lower = [h.strip().lower() for h in header]
    col_name = header_lower.index("姓名") if "姓名" in header_lower else -1
    col_id = header_lower.index("学号") if "学号" in header_lower else -1

    # Primary: exact header match
    header_to_idx = {h: i for i, h in enumerate(header) if h not in ("姓名", "学号")}

    # Fallback: position-based mapping for score columns
    score_col_indices: list[int] = [i for i, h in enumerate(header) if h not in ("姓名", "学号")]

    students: list[dict[str, Any]] = []
    column_warnings: list[str] = []
    for ri, row in enumerate(data_rows):
        if not row or all(not c.strip() for c in row):
            continue
        name = row[col_name].strip() if col_name >= 0 else f"学生{ri+1}"
        student_id = row[col_id].strip() if col_id >= 0 else ""
        scores: list[float | None] = []
        matched_by_position = False
        for qi, q in enumerate(questions):
            raw = None
            if q.csv_header() in header_to_idx:
                idx = header_to_idx[q.csv_header()]
                raw = row[idx].strip() if idx < len(row) else None
            elif qi < len(score_col_indices):
                idx = score_col_indices[qi]
                raw = row[idx].strip() if idx < len(row) else None
                matched_by_position = True
            scores.append(_safe_float(raw))
        if matched_by_position and not column_warnings:
            column_warnings.append(
                "部分列头与模板不完全匹配，已按顺序位置映射。如得分异常请检查列顺序是否与模板一致。"
            )
        students.append({"name": name, "student_id": student_id, "scores": scores})

    if not students:
        raise ValueError("No student data found")

    # Per-question statistics
    question_stats: list[dict[str, Any]] = []
    for qi, q in enumerate(questions):
        answered = [s["scores"][qi] for s in students if s["scores"][qi] is not None]
        # Diagnostic: first student's raw CSV value for this question
        first_raw = students[0]["scores"][qi] if students and qi < len(students[0]["scores"]) else None
        if not answered:
            err_rate = None
            avg_score = None
            fuzzy_score = None
        else:
            avg_score = sum(answered) / len(answered)
            # Score ratio (fuzzy membership: 0=wrong, 1=full correct)
            fuzzy_scores = [min(max(s / q.score_per_item, 0.0), 1.0) for s in answered]
            fuzzy_score = sum(fuzzy_scores) / len(fuzzy_scores)
            correct_count = sum(1 for s in answered if s >= q.score_per_item * 0.5)
            err_rate = 1.0 - correct_count / len(answered)
        question_stats.append({
            "question_id": q.question_id,
            "header": q.csv_header(),
            "section_id": q.section_id,
            "score_per_item": q.score_per_item,
            "answered_count": len(answered),
            "error_rate": err_rate,
            "avg_score_ratio": fuzzy_score,  # fuzzy membership 0~1
            "avg_raw_score": avg_score,
            "first_csv_raw": first_raw,
        })

    # Per-student statistics
    total_score = sum(q.score_per_item for q in questions)
    student_stats: list[dict[str, Any]] = []
    raw_totals: list[tuple[int, float]] = []  # (index, total)
    for si, st in enumerate(students):
        valid_scores = [(q, st["scores"][qi] or 0.0) for qi, q in enumerate(questions)]
        raw_total = sum(s for _, s in valid_scores)
        score_ratio = raw_total / total_score if total_score > 0 else 0.0
        # Fuzzy total score: use weighted average of question fuzzy memberships
        fuzzy_total = 0.0
        if questions:
            fuzzy_total = sum(
                min(max((st["scores"][qi] or 0.0) / q.score_per_item, 0.0), 1.0)
                for qi, q in enumerate(questions)
                if q.score_per_item > 0
            ) / len(questions)
        student_stats.append({
            "name": st["name"],
            "student_id": st["student_id"],
            "raw_total": round(raw_total, 2),
            "score_ratio": round(score_ratio, 4),
            "fuzzy_score": round(fuzzy_total, 4),  # fuzzy aggregation 0~1
        })
        raw_totals.append((si, raw_total))

    # Rank students by score_ratio descending
    ranked = sorted(raw_totals, key=lambda x: x[1], reverse=True)
    rank_map: dict[int, int] = {idx: rank + 1 for rank, (idx, _) in enumerate(ranked)}
    for si, st in enumerate(student_stats):
        st["rank"] = rank_map.get(si, 0)
        st["class_rank"] = st["rank"]
        st["total_in_class"] = len(students)

    # Per-knowledge-node statistics (fuzzy)
    node_question_map: dict[str, list[str]] = {}
    try:
        state = load_graph(project_root)
        exam_qids = {q.question_id for q in questions}
        for binding in state.bindings:
            qid = binding.question_qualified_id
            if qid in exam_qids:
                node_question_map.setdefault(binding.node_id, []).append(qid)
    except Exception:
        pass

    # Compute node-level fuzzy error rate
    node_stats: list[dict[str, Any]] = []
    for node_id, bound_qids in node_question_map.items():
        if not bound_qids:
            continue
        min_fuzzy = 1.0
        for qid in bound_qids:
            for qi, q in enumerate(questions):
                if q.question_id == qid:
                    answered = [s["scores"][qi] for s in students if s["scores"][qi] is not None]
                    if answered:
                        fuzzy_ratios = [min(max(s / q.score_per_item, 0.0), 1.0) for s in answered]
                        avg_fuzzy = sum(fuzzy_ratios) / len(fuzzy_ratios)
                        min_fuzzy = min(min_fuzzy, avg_fuzzy)
                    break
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
    bound_qids_flat: set[str] = set()
    try:
        state = load_graph(project_root)
        exam_qids = {q.question_id for q in questions}
        for b in state.bindings:
            if b.question_qualified_id in exam_qids:
                bound_qids_flat.add(b.question_qualified_id)
    except Exception:
        pass

    for q in questions:
        if q.question_id not in bound_qids_flat:
            unbound_warnings.append({
                "question_id": q.question_id,
                "header": q.csv_header(),
                "section_id": q.section_id,
                "message": f"第{q.csv_header()}题（{q.question_id}）未绑定知识点节点，请在知识图谱页面绑定后再查看节点统计",
            })

    # Save computed analysis
    analysis_path = dir_path / "scores" / batch_id / "analysis.json"
    student_mastery_rows: list[dict[str, Any]] = []
    for st in students:
        ratios: list[float | None] = []
        for qi, q in enumerate(questions):
            raw_s = st["scores"][qi] if qi < len(st["scores"]) else None
            if raw_s is None:
                ratios.append(None)
            elif q.score_per_item and q.score_per_item > 0:
                ratios.append(round(min(max(raw_s / q.score_per_item, 0.0), 1.0), 4))
            else:
                ratios.append(None)
        student_mastery_rows.append(
            {"name": st["name"], "student_id": st["student_id"], "ratios": ratios},
        )
    analysis_data = {
        "batch_id": batch_id,
        "exam_id": exam_id,
        "student_count": len(students),
        "question_count": len(questions),
        "imported_at": _now_utc().isoformat(),
        "warnings": unbound_warnings,
        "question_order": [q.question_id for q in questions],
        "student_mastery_rows": student_mastery_rows,
        "question_stats": question_stats,
        "node_stats": node_stats,
        "student_stats": student_stats,
        "class_avg_ratio": round(sum(s["score_ratio"] for s in student_stats) / len(student_stats), 4) if student_stats else 0,
        "class_avg_fuzzy": round(sum(s["fuzzy_score"] for s in student_stats) / len(student_stats), 4) if student_stats else 0,
    }
    with analysis_path.open("w", encoding="utf-8") as f:
        json.dump(analysis_data, f, ensure_ascii=False, indent=2)

    return analysis_data


def get_score_analysis(project_root: Path, exam_id: str, batch_id: str) -> dict[str, Any]:
    """Return cached analysis for a score batch (recompute if stale)."""
    dir_path = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, dir_path)
    analysis_path = dir_path / "scores" / batch_id / "analysis.json"
    if not analysis_path.is_file():
        return compute_statistics(project_root, exam_id, batch_id)
    with analysis_path.open(encoding="utf-8") as f:
        data = json.load(f)
    # If cache missing fields needed for 学情诊断视图，重算
    if "warnings" not in data or "student_mastery_rows" not in data or "question_order" not in data:
        return compute_statistics(project_root, exam_id, batch_id)
    return data
