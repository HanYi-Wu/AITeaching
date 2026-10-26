"""Read-only FastAPI router for learning progress and mastery evidence comparison (C17)."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.learning_progress.comparison import get_practice_comparison
from solaire.web.papers.student_sessions import _student_for_user
from solaire.web.platform_db import connect, row_to_dict

router = APIRouter(prefix="/learning-progress", tags=["learning_progress"])


def _content_root() -> Path | None:
    try:
        from solaire.web import state
        from solaire.web.project_layout import ensure_project_layout

        root = state.get_content_root()
        if root and root.exists():
            ensure_project_layout(root)
            return root
    except Exception:
        pass
    return None


@router.get("/teacher/comparison")
def teacher_learning_progress_comparison(
    practice_publication_id: Annotated[str, Query(..., description="ID of the practice publication")],
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    class_id: Annotated[str | None, Query(description="Optional class ID filter")] = None,
    student_id: Annotated[str | None, Query(description="Optional student ID filter")] = None,
) -> dict[str, Any]:
    """Teacher/Admin read-only endpoint for learning progress comparisons.

    Validates teaching assignment, class enrollment, and student scope on server.
    """
    role = str(user.get("role") or "")
    if role not in {"teacher", "admin", "school"}:
        raise HTTPException(status_code=403, detail="Teacher or administrator access required")

    root = require_platform_root()
    project_root = _content_root()

    with connect(root) as con:
        pub_row = con.execute(
            "SELECT ep.*, pr.school_id FROM exam_publications ep JOIN paper_records pr ON pr.id = ep.paper_id WHERE ep.id = ?",
            (practice_publication_id,),
        ).fetchone()
        if pub_row is None:
            raise HTTPException(status_code=404, detail=f"Practice publication not found: {practice_publication_id}")
        pub = row_to_dict(pub_row) or {}

        if role == "teacher":
            teacher_id = str(user["id"])
            is_owner = str(pub.get("teacher_id")) == teacher_id
            if not is_owner:
                assigned = con.execute(
                    """
                    SELECT 1 FROM publication_classes pc
                    JOIN teacher_class_assignments tca ON tca.class_id = pc.class_id
                    WHERE pc.publication_id = ? AND tca.teacher_id = ?
                    """,
                    (practice_publication_id, teacher_id),
                ).fetchone()
                if not assigned:
                    raise HTTPException(status_code=403, detail="Teacher is not assigned to this publication or its classes")

            if class_id:
                tca_row = con.execute(
                    "SELECT 1 FROM teacher_class_assignments WHERE teacher_id = ? AND class_id = ?",
                    (teacher_id, class_id),
                ).fetchone()
                if not tca_row:
                    raise HTTPException(status_code=403, detail=f"Teacher is not assigned to class: {class_id}")

            if student_id:
                cs_row = con.execute(
                    """
                    SELECT 1 FROM class_students cs
                    JOIN teacher_class_assignments tca ON tca.class_id = cs.class_id
                    WHERE tca.teacher_id = ? AND cs.student_id = ?
                    """,
                    (teacher_id, student_id),
                ).fetchone()
                if not cs_row:
                    raise HTTPException(status_code=403, detail=f"Student {student_id} is not in teacher's assigned classes")

        elif role == "school":
            user_school_id = str(user.get("school_id") or "")
            pub_school_id = str(pub.get("school_id") or "")
            if not user_school_id or user_school_id != pub_school_id:
                raise HTTPException(status_code=403, detail="Publication does not belong to user's school")

    return get_practice_comparison(
        root,
        project_root,
        practice_publication_id=practice_publication_id,
        student_id=student_id,
        class_id=class_id,
    )


@router.get("/student/comparison")
def student_learning_progress_comparison(
    practice_publication_id: Annotated[str, Query(..., description="ID of the practice publication")],
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    student_id: Annotated[str | None, Query(description="Optional student ID; must match authenticated user")] = None,
) -> dict[str, Any]:
    """Student read-only endpoint for learning progress comparisons.

    Enforces that student can only read their own evidence. Unreleased grades are redacted.
    """
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student role required")

    root = require_platform_root()
    project_root = _content_root()

    try:
        student = _student_for_user(root, user)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e

    actual_student_id = str(student["id"])
    if student_id and str(student_id).strip() != actual_student_id:
        raise HTTPException(status_code=403, detail="Students can only read their own progress comparison")

    with connect(root) as con:
        pub_row = con.execute(
            """
            SELECT ep.* FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN class_students cs ON cs.class_id = pc.class_id
            WHERE ep.id = ? AND cs.student_id = ?
            """,
            (practice_publication_id, actual_student_id),
        ).fetchone()
        if pub_row is None:
            # Check if publication exists at all
            exists = con.execute("SELECT 1 FROM exam_publications WHERE id = ?", (practice_publication_id,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Practice publication not found")
            raise HTTPException(status_code=403, detail="Student is not assigned to this practice publication")
        pub = row_to_dict(pub_row) or {}

    is_released = bool(pub.get("show_results_immediately")) or pub.get("status") == "closed"

    comp_result = get_practice_comparison(
        root,
        project_root,
        practice_publication_id=practice_publication_id,
        student_id=actual_student_id,
    )

    if not is_released:
        # Redact unreleased target scores
        node_comps = comp_result.get("comparison", {}).get("node_comparisons", [])
        redacted_nodes: list[dict[str, Any]] = []
        for node in node_comps:
            redacted_nodes.append({
                **node,
                "status": "target_unreleased",
                "post_score": None,
                "post_rate": None,
                "post_percentage": None,
                "delta_percentage_points": None,
                "incomparable_reason": "复练成绩尚未发布",
            })
        comp_result["comparison"]["node_comparisons"] = redacted_nodes
        comp_result["comparison"]["status"] = "target_unreleased"

    return comp_result
