"""Eligibility rules, authorization, and historical practice queries for adaptive practice."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from solaire.web.platform_db import connect, init_platform_db, row_to_dict

MIN_REINFORCEMENT_HISTORY = 3
PRACTICE_KINDS = {"wrong_questions", "reinforcement"}
SUBMISSION_MODES = {"online", "image_manual", "image_ai"}


def _new_id() -> str:
    return uuid.uuid4().hex


def _ensure_teacher(user: dict[str, Any]) -> None:
    if user.get("role") not in {"teacher", "admin"}:
        raise PermissionError("Only teachers and admins can publish adaptive practice")


def _ensure_class_access(root: Path, user: dict[str, Any], class_id: str) -> dict[str, Any]:
    _ensure_teacher(user)
    with connect(root) as con:
        if user.get("role") == "teacher":
            row = con.execute(
                """
                SELECT c.* FROM classes c
                JOIN teacher_class_assignments tca ON tca.class_id = c.id
                WHERE c.id = ? AND tca.teacher_id = ?
                LIMIT 1
                """,
                (class_id, str(user["id"])),
            ).fetchone()
        else:
            row = con.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
    klass = row_to_dict(row)
    if klass is None:
        raise PermissionError("Teacher is not assigned to this class")
    return klass


def list_practice_history(root: Path, *, class_id: str, user: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    _ensure_class_access(root, user, class_id)
    params: list[Any] = [class_id]
    teacher_clause = ""
    if user.get("role") == "teacher":
        teacher_clause = "AND ep.teacher_id = ?"
        params.append(str(user["id"]))
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT ep.id, ep.paper_id, ep.title, ep.created_at, ep.status, ep.practice_kind,
                   pr.subject,
                   COUNT(DISTINCT CASE WHEN sa.status = 'submitted' THEN sa.student_id END) AS submitted_student_count,
                   SUM(CASE WHEN ans.is_correct = 0 THEN 1 ELSE 0 END) AS wrong_answer_count
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN paper_records pr ON pr.id = ep.paper_id
            LEFT JOIN student_attempts sa ON sa.publication_id = ep.id
            LEFT JOIN student_answers ans ON ans.attempt_id = sa.id
            WHERE pc.class_id = ? AND ep.status IN ('published', 'closed') {teacher_clause}
            GROUP BY ep.id, ep.paper_id, ep.title, ep.created_at, ep.status, ep.practice_kind, pr.subject
            ORDER BY ep.created_at DESC, ep.id DESC
            """,
            tuple(params),
        ).fetchall()
    publications = [
        {
            **(row_to_dict(row) or {}),
            "submitted_student_count": int(row["submitted_student_count"] or 0),
            "wrong_answer_count": int(row["wrong_answer_count"] or 0),
        }
        for row in rows
    ]
    return {
        "class_id": class_id,
        "publication_count": len(publications),
        "minimum_reinforcement_history": MIN_REINFORCEMENT_HISTORY,
        "eligible_for_reinforcement": len(publications) >= MIN_REINFORCEMENT_HISTORY,
        "publications": publications,
    }


def _validate_sources(
    root: Path,
    *,
    class_id: str,
    source_publication_ids: list[str],
    user: dict[str, Any],
) -> list[dict[str, Any]]:
    history = list_practice_history(root, class_id=class_id, user=user)["publications"]
    by_id = {str(item["id"]): item for item in history}
    clean_ids = list(dict.fromkeys(str(item).strip() for item in source_publication_ids if str(item).strip()))
    missing = [item for item in clean_ids if item not in by_id]
    if missing:
        raise PermissionError("Selected publication does not belong to this teacher and class")
    return [by_id[item] for item in clean_ids]


def _class_students(root: Path, class_id: str) -> list[dict[str, Any]]:
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT s.* FROM students s
            JOIN class_students cs ON cs.student_id = s.id
            WHERE cs.class_id = ? AND s.status = 'active'
            ORDER BY s.student_no, s.id
            """,
            (class_id,),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]
