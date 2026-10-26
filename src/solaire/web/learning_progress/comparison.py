"""Authoritative comparison calculation between baseline and practice attempts (C16)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.learning_progress.aggregation import (
    calculate_class_comparison,
    calculate_student_comparison,
)
from solaire.web.learning_progress.compatibility import (
    get_authoritative_source_status,
    get_authoritative_target_evidence,
    get_frozen_baseline,
)
from solaire.web.platform_db import connect


def _class_student_ids(root: Path, class_id: str) -> set[str]:
    """Return all active student IDs belonging to the given class."""
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT cs.student_id FROM class_students cs
            JOIN students s ON s.id = cs.student_id
            WHERE cs.class_id = ? AND s.status = 'active'
            """,
            (class_id,),
        ).fetchall()
    return {str(r["student_id"]) for r in rows}


def _deduplicate_target_evidence(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ensure student target answers are not accumulated repeatedly.

    If multiple answer records exist for the same student, attempt, question and knowledge node,
    keep the latest valid graded entry.
    """
    deduped: dict[tuple[str, str, str, str | None], dict[str, Any]] = {}
    for item in items:
        key = (
            str(item.get("student_id")),
            str(item.get("attempt_id")),
            str(item.get("question_id")),
            item.get("knowledge_node_id"),
        )
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = item
        else:
            # Prefer graded over pending
            if existing.get("grading_status") != "graded" and item.get("grading_status") == "graded":
                deduped[key] = item
    return list(deduped.values())


def get_practice_comparison(
    root: Path,
    project_root: Path | None,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
    class_id: str | None = None,
) -> dict[str, Any]:
    """Compute on-demand authoritative comparison for a practice publication.

    Reads frozen baselines and live target answers via authoritative G6 functions,
    detects modified or deleted sources, and computes mastery comparison.
    """
    # 1. Authoritative source status
    source_status = get_authoritative_source_status(
        root,
        project_root,
        practice_publication_id=practice_publication_id,
        student_id=student_id,
    )

    # 2. Frozen baseline
    baseline_items = get_frozen_baseline(
        root,
        practice_publication_id=practice_publication_id,
        student_id=student_id,
    )

    # 3. Target evidence
    target_raw_items = get_authoritative_target_evidence(
        root,
        project_root,
        practice_publication_id=practice_publication_id,
        student_id=student_id,
    )
    target_items = _deduplicate_target_evidence(target_raw_items)

    # 4. Optional class scope filtering
    if class_id:
        allowed_sids = _class_student_ids(root, class_id)
        baseline_items = [it for it in baseline_items if str(it.get("student_id")) in allowed_sids]
        target_items = [it for it in target_items if str(it.get("student_id")) in allowed_sids]

    # 5. Compute student-level or class-level comparison
    if student_id:
        student_comp = calculate_student_comparison(
            baseline_items,
            target_items,
            source_status=source_status,
        )
        return {
            "practice_publication_id": practice_publication_id,
            "student_id": student_id,
            "source_status": source_status,
            "comparison": student_comp,
        }

    # Class-level aggregation
    baselines_by_student: dict[str, list[dict[str, Any]]] = {}
    for it in baseline_items:
        sid = str(it.get("student_id"))
        baselines_by_student.setdefault(sid, []).append(it)

    targets_by_student: dict[str, list[dict[str, Any]]] = {}
    for it in target_items:
        sid = str(it.get("student_id"))
        targets_by_student.setdefault(sid, []).append(it)

    class_comp = calculate_class_comparison(
        baselines_by_student,
        targets_by_student,
        source_status=source_status,
    )

    all_sids = sorted(set(baselines_by_student.keys()) | set(targets_by_student.keys()))
    student_comparisons: dict[str, Any] = {}
    for sid in all_sids:
        student_comparisons[sid] = calculate_student_comparison(
            baselines_by_student.get(sid, []),
            targets_by_student.get(sid, []),
            source_status=source_status,
        )

    return {
        "practice_publication_id": practice_publication_id,
        "class_id": class_id,
        "source_status": source_status,
        "class_comparison": class_comp,
        "student_comparisons": student_comparisons,
    }
