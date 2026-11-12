"""Streaming CSV score parsing and aggregation for exam analysis."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Any, Sequence


@dataclass
class ScoreMatrixResult:
    """Computed score outputs ready for graph and cache integration."""

    question_csv_headers: list[str]
    question_stats: list[dict[str, Any]]
    student_stats: list[dict[str, Any]]
    student_mastery_rows: list[dict[str, Any]]
    class_avg_ratio: float
    class_avg_fuzzy: float


def _safe_score(raw: str | None) -> float | None:
    if raw is None:
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


def compute_score_matrix(raw_text: str, questions: Sequence[Any]) -> ScoreMatrixResult:
    """Parse one score CSV and calculate question and student statistics.

    The only per-cell matrix starts as raw scores and is changed in place into
    unrounded mastery ratios during the question pass. Student totals are
    accumulated before that conversion, so neither a CSV row matrix nor a
    second score/ratio matrix is needed.
    """
    reader = csv.reader(io.StringIO(raw_text))
    header_row = next(reader, None)
    if header_row is None:
        # Preserve the IndexError raised by the former ``rows[0]`` access.
        raise IndexError("list index out of range")
    header = [value.strip().lstrip("\ufeff") for value in header_row]

    header_lower = [value.strip().lower() for value in header]
    col_name = header_lower.index("姓名") if "姓名" in header_lower else -1
    col_id = header_lower.index("学号") if "学号" in header_lower else -1

    # Primary: exact header match. Duplicate headers intentionally keep the
    # last index, matching the previous dict-comprehension behavior.
    header_to_idx = {value: index for index, value in enumerate(header)
                     if value not in ("姓名", "学号")}
    question_csv_headers = [question.csv_header() for question in questions]

    score_col_indices = [index for index, value in enumerate(header)
                         if value not in ("姓名", "学号")]
    question_score_columns: list[int | None] = []
    for qi, question_header in enumerate(question_csv_headers):
        if question_header in header_to_idx:
            question_score_columns.append(header_to_idx[question_header])
        elif qi < len(score_col_indices):
            question_score_columns.append(score_col_indices[qi])
        else:
            question_score_columns.append(None)

    student_names: list[str] = []
    student_ids: list[str] = []
    scores_by_student: list[list[float | None]] = []
    raw_totals: list[float] = []
    processing_error: Exception | None = None

    # The former list(csv.reader(...)) parsed the complete CSV before touching
    # any row. Defer the first row-processing error until iteration completes
    # so a later CSV syntax error retains the same precedence.
    for ri, row in enumerate(reader):
        if processing_error is not None:
            continue
        try:
            if not row or all(not cell.strip() for cell in row):
                continue
            name = row[col_name].strip() if col_name >= 0 else f"学生{ri + 1}"
            student_id = row[col_id].strip() if col_id >= 0 else ""
            scores: list[float | None] = []
            for idx in question_score_columns:
                raw = row[idx].strip() if idx is not None and idx < len(row) else None
                scores.append(_safe_score(raw))
            student_names.append(name)
            student_ids.append(student_id)
            scores_by_student.append(scores)
            raw_totals.append(sum(score or 0.0 for score in scores))
        except Exception as exc:
            processing_error = exc

    if processing_error is not None:
        raise processing_error
    if not student_names:
        raise ValueError("No student data found")

    question_stats: list[dict[str, Any]] = []
    score_per_items = [question.score_per_item for question in questions]
    positive_question_indices = [
        qi for qi, score_per_item in enumerate(score_per_items)
        if score_per_item > 0
    ]
    for qi, question in enumerate(questions):
        score_per_item = score_per_items[qi]
        answered = [row[qi] for row in scores_by_student if row[qi] is not None]
        first_raw = scores_by_student[0][qi] if qi < len(scores_by_student[0]) else None
        if not answered:
            error_rate = None
            avg_score = None
            fuzzy_score = None
        else:
            avg_score = sum(answered) / len(answered)
            if score_per_item and score_per_item > 0:
                fuzzy_scores: list[float] = []
                for row in scores_by_student:
                    raw_score = row[qi]
                    if raw_score is None:
                        continue
                    ratio = min(max(raw_score / score_per_item, 0.0), 1.0)
                    fuzzy_scores.append(ratio)
                    row[qi] = ratio
                fuzzy_score = sum(fuzzy_scores) / len(fuzzy_scores)
                correct_count = sum(
                    1 for raw_score in answered
                    if raw_score >= score_per_item * 0.5
                )
                error_rate = 1.0 - correct_count / len(answered)
            else:
                fuzzy_score = 0.0
                error_rate = None
                for row in scores_by_student:
                    row[qi] = None
        question_stats.append({
            "question_id": question.question_id,
            "header": question_csv_headers[qi],
            "section_id": question.section_id,
            "score_per_item": question.score_per_item,
            "answered_count": len(answered),
            "error_rate": error_rate,
            "avg_score_ratio": fuzzy_score,
            "avg_raw_score": avg_score,
            "first_csv_raw": first_raw,
        })

    total_score = sum(score_per_items)
    student_stats: list[dict[str, Any]] = []
    ranked_totals: list[tuple[int, float]] = []
    for si, raw_total in enumerate(raw_totals):
        row = scores_by_student[si]
        score_ratio = raw_total / total_score if total_score > 0 else 0.0
        fuzzy_total = 0.0
        if questions:
            fuzzy_total = sum(
                row[qi] or 0.0 for qi in positive_question_indices
            ) / len(questions)
        student_stats.append({
            "name": student_names[si],
            "student_id": student_ids[si],
            "raw_total": round(raw_total, 2),
            "score_ratio": round(score_ratio, 4),
            "fuzzy_score": round(fuzzy_total, 4),
        })
        ranked_totals.append((si, raw_total))

    ranked = sorted(ranked_totals, key=lambda item: item[1], reverse=True)
    rank_map = {index: rank + 1 for rank, (index, _) in enumerate(ranked)}
    for si, student in enumerate(student_stats):
        student["rank"] = rank_map.get(si, 0)
        student["class_rank"] = student["rank"]
        student["total_in_class"] = len(student_names)

    student_mastery_rows: list[dict[str, Any]] = []
    for si, row in enumerate(scores_by_student):
        for qi, question in enumerate(questions):
            value = row[qi]
            if value is not None:
                row[qi] = round(value, 4)
            else:
                row[qi] = None
        student_mastery_rows.append({
            "name": student_names[si],
            "student_id": student_ids[si],
            "ratios": row,
        })

    return ScoreMatrixResult(
        question_csv_headers=question_csv_headers,
        question_stats=question_stats,
        student_stats=student_stats,
        student_mastery_rows=student_mastery_rows,
        class_avg_ratio=(
            round(sum(student["score_ratio"] for student in student_stats) / len(student_stats), 4)
            if student_stats else 0
        ),
        class_avg_fuzzy=(
            round(sum(student["fuzzy_score"] for student in student_stats) / len(student_stats), 4)
            if student_stats else 0
        ),
    )
