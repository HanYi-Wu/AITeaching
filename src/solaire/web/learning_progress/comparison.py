"""Authoritative comparison calculation between baseline and practice attempts (C16)."""

from __future__ import annotations

from contextlib import closing
from pathlib import Path
from typing import Any

from solaire.web.learning_progress.aggregation import (
    calculate_class_comparison,
    calculate_student_comparison,
)
from solaire.web.learning_progress.compatibility import (
    get_authoritative_source_status,
    get_authoritative_target_evidence,
)
from solaire.web.learning_progress.store import get_frozen_baselines
from solaire.web.platform_db import connect


def _class_student_ids(root: Path, class_id: str) -> set[str]:
    """Return all active student IDs belonging to the given class."""
    with closing(connect(root)) as con, con:
        rows = con.execute(
            """
            SELECT cs.student_id FROM class_students cs
            JOIN students s ON s.id = cs.student_id
            WHERE cs.class_id = ? AND s.status = 'active'
            """,
            (class_id,),
        ).fetchall()
    return {str(r["student_id"]) for r in rows}


def get_practice_comparison(
    root: Path,
    project_root: Path | None,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
    class_id: str | None = None,
    allowed_student_ids: set[str] | None = None,
    include_unreleased: bool = False,
) -> dict[str, Any]:
    """Compute on-demand authoritative comparison for a practice publication.

    Reads frozen baselines and live target answers via authoritative storage readers,
    detects modified or deleted sources, and computes mastery comparison.
    """
    frozen_baselines = get_frozen_baselines(
        root, practice_publication_id=practice_publication_id, student_id=student_id,
    )
    # Source checks and mastery calculations share the same historical evidence.
    source_status = get_authoritative_source_status(
        root,
        project_root,
        practice_publication_id=practice_publication_id,
        student_id=student_id,
        allowed_student_ids=allowed_student_ids,
        frozen_baselines=frozen_baselines,
    )

    # 2. Frozen baseline
    baseline_items = [item.to_dict() for item in frozen_baselines]

    # 3. Target evidence
    target_items = get_authoritative_target_evidence(
        root,
        project_root,
        practice_publication_id=practice_publication_id,
        student_id=student_id,
        include_unreleased=include_unreleased,
    )

    if allowed_student_ids is not None:
        baseline_items = [it for it in baseline_items if str(it.get("student_id")) in allowed_student_ids]
        target_items = [it for it in target_items if str(it.get("student_id")) in allowed_student_ids]

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
