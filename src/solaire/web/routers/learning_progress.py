"""Authorized, read-only comparisons of frozen sources and practice answers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.learning_progress.comparison import get_practice_comparison
from solaire.web.papers.student_sessions import _student_for_user
from solaire.web.platform_db import connect

router = APIRouter(prefix="/learning-progress", tags=["learning_progress"])


def _content_root() -> Path | None:
    from solaire.web import state

    root = state.get_content_root()
    return root if root and root.is_dir() else None


def _teacher_scope(con: Any, publication_id: str, user: dict[str, Any], class_id: str | None = None) -> set[str]:
    role = str(user.get("role") or "")
    if role not in {"teacher", "school", "admin"}:
        raise HTTPException(status_code=403, detail="Teacher or administrator access required")
    publication = con.execute(
        """SELECT ep.teacher_id, COALESCE(pr.school_id, u.school_id) AS school_id
           FROM exam_publications ep JOIN paper_records pr ON pr.id = ep.paper_id
           LEFT JOIN users u ON u.id = ep.teacher_id WHERE ep.id = ?""", (publication_id,),
    ).fetchone()
    if publication is None:
        raise HTTPException(status_code=404, detail="Practice publication not found")
    if role != "admin" and (not user.get("school_id") or user["school_id"] != publication["school_id"]):
        raise HTTPException(status_code=403, detail="Publication is outside the current school")
    owner = role != "teacher" or publication["teacher_id"] == user["id"]
    if not owner:
        assigned = con.execute(
            """SELECT 1 FROM publication_classes pc JOIN teacher_class_assignments tca ON tca.class_id = pc.class_id
               WHERE pc.publication_id = ? AND tca.teacher_id = ?""", (publication_id, user["id"]),
        ).fetchone()
        if assigned is None:
            raise HTTPException(status_code=403, detail="Teacher is not assigned to this publication")
    params: list[Any] = [publication_id]
    where = ""
    if not owner:
        where += """ AND EXISTS (SELECT 1 FROM class_students cs JOIN teacher_class_assignments tca ON tca.class_id = cs.class_id
                    JOIN publication_classes pc ON pc.class_id = cs.class_id AND pc.publication_id = sa.publication_id
                    WHERE cs.student_id = sa.student_id AND tca.teacher_id = ?)"""
        params.append(user["id"])
    if class_id:
        where += " AND EXISTS (SELECT 1 FROM class_students cs WHERE cs.student_id = sa.student_id AND cs.class_id = ?)"
        params.append(class_id)
        if con.execute("SELECT 1 FROM publication_classes WHERE publication_id = ? AND class_id = ?", (publication_id, class_id)).fetchone() is None:
            raise HTTPException(status_code=403, detail="Class is not included in this publication")
        if role == "teacher" and con.execute("SELECT 1 FROM teacher_class_assignments WHERE teacher_id = ? AND class_id = ?", (user["id"], class_id)).fetchone() is None:
            raise HTTPException(status_code=403, detail="Teacher is not assigned to this class")
    rows = con.execute(f"SELECT sa.student_id FROM student_attempts sa WHERE sa.publication_id = ? {where}", tuple(params)).fetchall()
    return {str(row["student_id"]) for row in rows}


def _display_names(root: Path, publication_id: str, student_ids: set[str]) -> dict[str, Any]:
    if not student_ids:
        return {"student_names": {}, "knowledge_names": {}}
    placeholders = ",".join("?" for _ in student_ids)
    with connect(root) as con:
        students = con.execute(f"SELECT id, display_name FROM students WHERE id IN ({placeholders})", tuple(student_ids)).fetchall()
        attempts = con.execute(f"SELECT question_payload_json FROM student_attempts WHERE publication_id = ? AND student_id IN ({placeholders})", (publication_id, *student_ids)).fetchall()
    names = {str(row["id"]): str(row["display_name"]) for row in students}
    knowledge_names: dict[str, str] = {}
    for attempt in attempts:
        try:
            questions = json.loads(attempt["question_payload_json"] or "[]")
        except json.JSONDecodeError:
            continue
        for question in questions:
            knowledge_names.update(question.get("knowledge_node_names") or {})
    return {"student_names": names, "knowledge_names": knowledge_names}


@router.get("/teacher/publications")
def teacher_practice_publications(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    source_exam_id: str | None = None,
    source_batch_id: str | None = None,
) -> dict[str, Any]:
    if user.get("role") not in {"teacher", "school", "admin"}:
        raise HTTPException(status_code=403, detail="Teacher or administrator access required")
    root = require_platform_root()
    params: list[Any] = []
    where = ""
    if source_exam_id:
        where += " AND ps.source_exam_id = ?"
        params.append(source_exam_id)
    if source_batch_id:
        where += " AND ps.source_batch_id = ?"
        params.append(source_batch_id)
    if user["role"] != "admin":
        where += " AND COALESCE(pr.school_id, owner.school_id) = ?"
        params.append(user.get("school_id"))
    if user["role"] == "teacher":
        where += """ AND (ep.teacher_id = ? OR EXISTS (
            SELECT 1 FROM publication_classes pc JOIN teacher_class_assignments tca ON tca.class_id = pc.class_id
            WHERE pc.publication_id = ep.id AND tca.teacher_id = ?))"""
        params.extend([user["id"], user["id"]])
    with connect(root) as con:
        rows = con.execute(
            f"""SELECT DISTINCT ep.id, ep.title, ep.created_at FROM exam_publications ep
                JOIN practice_sources ps ON ps.practice_publication_id = ep.id
                JOIN paper_records pr ON pr.id = ep.paper_id LEFT JOIN users owner ON owner.id = ep.teacher_id
                WHERE ep.status != 'revoked' {where} ORDER BY ep.created_at DESC, ep.id DESC LIMIT 100""", tuple(params),
        ).fetchall()
    return {"publications": [dict(row) for row in rows]}


@router.get("/teacher/comparison")
def teacher_learning_progress_comparison(
    practice_publication_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    class_id: str | None = None,
    student_id: str | None = None,
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = _content_root()
    with connect(root) as con:
        allowed_ids = _teacher_scope(con, practice_publication_id, user, class_id)
    if student_id and student_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="Student is outside the authorized publication recipients")
    result = get_practice_comparison(
        root, project_root, practice_publication_id=practice_publication_id, student_id=student_id,
        class_id=class_id, allowed_student_ids=allowed_ids, include_unreleased=True,
    )
    return {**result, **_display_names(root, practice_publication_id, {student_id} if student_id else allowed_ids)}


@router.get("/student/comparison")
def student_learning_progress_comparison(
    practice_publication_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    student_id: str | None = None,
) -> dict[str, Any]:
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student role required")
    root = require_platform_root()
    try:
        actual_id = str(_student_for_user(root, user)["id"])
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if student_id and student_id != actual_id:
        raise HTTPException(status_code=403, detail="Students can only read their own progress comparison")
    with connect(root) as con:
        assigned = con.execute(
            """SELECT 1 FROM student_attempts sa JOIN exam_publications ep ON ep.id = sa.publication_id
               WHERE sa.publication_id = ? AND sa.student_id = ? AND ep.status != 'revoked'""", (practice_publication_id, actual_id),
        ).fetchone()
        if assigned is None:
            raise HTTPException(status_code=403, detail="Student is not a recipient of this practice publication")
    project_root = _content_root()
    result = get_practice_comparison(root, project_root, practice_publication_id=practice_publication_id, student_id=actual_id)
    return {**result, **_display_names(root, practice_publication_id, {actual_id})}
