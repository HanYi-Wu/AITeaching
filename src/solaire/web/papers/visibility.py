"""Paper, publication, and attempt visibility policies and scoped queries."""

from __future__ import annotations

from contextlib import closing

import json
from pathlib import Path
from typing import Any

from solaire.web.platform_db import connect, row_to_dict


def paper_visible_to_user(paper: dict[str, Any], user: dict[str, Any]) -> bool:
    role = str(user.get("role") or "")
    if role == "admin":
        return True
    if role == "school":
        return paper.get("school_id") == user.get("school_id")
    if role == "teacher":
        return paper.get("owner_teacher_id") == user.get("id")
    return False


def ensure_paper_access(paper: dict[str, Any], user: dict[str, Any]) -> None:
    role = str(user.get("role") or "")
    if role == "admin":
        return
    if role == "school" and paper.get("school_id") == user.get("school_id"):
        return
    if role == "teacher" and paper.get("owner_teacher_id") == user.get("id"):
        return
    raise PermissionError("No permission for this paper")


def attempt_access_clause(user: dict[str, Any], *, attempt_alias: str = "sa") -> tuple[str, list[str]]:
    role = str(user.get("role") or "")
    if role == "admin":
        return "1 = 1", []
    if role == "teacher":
        return (
            f"EXISTS (SELECT 1 FROM exam_publications owner_ep "
            f"WHERE owner_ep.id = {attempt_alias}.publication_id AND owner_ep.teacher_id = ?)",
            [str(user.get("id") or "")],
        )
    if role == "school":
        return (
            f"EXISTS (SELECT 1 FROM publication_classes pac "
            f"JOIN classes ac ON ac.id = pac.class_id "
            f"WHERE pac.publication_id = {attempt_alias}.publication_id AND ac.school_id = ?)",
            [str(user.get("school_id") or "")],
        )
    return "0 = 1", []


def publication_access_clause(user: dict[str, Any], *, publication_alias: str = "ep") -> tuple[str, list[str]]:
    role = str(user.get("role") or "")
    if role == "admin":
        return "1 = 1", []
    if role == "teacher":
        return f"{publication_alias}.teacher_id = ?", [str(user.get("id") or "")]
    if role == "school":
        return (
            f"EXISTS (SELECT 1 FROM publication_classes pac "
            f"JOIN classes ac ON ac.id = pac.class_id "
            f"WHERE pac.publication_id = {publication_alias}.id AND ac.school_id = ?)",
            [str(user.get("school_id") or "")],
        )
    return "0 = 1", []


def publication_stats(root: Path, paper_id: str, user: dict[str, Any]) -> dict[str, int]:
    access_clause, access_params = publication_access_clause(user)
    with closing(connect(root)) as con, con:
        row = con.execute(
            f"""
            SELECT
              EXISTS(SELECT 1 FROM exam_publications history WHERE history.paper_id = ?) AS has_publication_history,
              COUNT(DISTINCT ep.id) AS publication_count,
              COUNT(DISTINCT pc.class_id) AS published_class_count,
              COUNT(DISTINCT sa.id) AS total_student_count,
              COUNT(DISTINCT CASE
                WHEN sa.status IN ('submitted', 'completed') OR sa.submitted_at IS NOT NULL THEN sa.id
              END) AS submitted_student_count,
              COUNT(DISTINCT CASE
                WHEN sa.status = 'in_progress' AND sa.submitted_at IS NULL THEN sa.id
              END) AS in_progress_student_count,
              COUNT(DISTINCT CASE WHEN sa.grading_completed_at IS NOT NULL THEN sa.id END) AS graded_student_count,
              COUNT(DISTINCT CASE WHEN sa.grading_completed_at IS NOT NULL THEN sa.id END) AS published_student_count
            FROM exam_publications ep
            LEFT JOIN publication_classes pc ON pc.publication_id = ep.id
            LEFT JOIN student_attempts sa ON sa.publication_id = ep.id
            WHERE ep.paper_id = ? AND ep.status <> 'revoked' AND {access_clause}
            """,
            (paper_id, paper_id, *access_params),
        ).fetchone()
    return {
        "has_publication_history": bool(row["has_publication_history"]),
        "publication_count": int(row["publication_count"] or 0),
        "published_class_count": int(row["published_class_count"] or 0),
        "total_student_count": int(row["total_student_count"] or 0),
        "submitted_student_count": int(row["submitted_student_count"] or 0),
        "in_progress_student_count": int(row["in_progress_student_count"] or 0),
        "graded_student_count": int(row["graded_student_count"] or 0),
        "published_student_count": int(row["published_student_count"] or 0),
    }


def adaptive_paper_summary(root: Path, paper_id: str, user: dict[str, Any]) -> tuple[int, bool]:
    access_clause, access_params = attempt_access_clause(user)
    with closing(connect(root)) as con, con:
        rows = con.execute(
            f"""
            SELECT sa.question_payload_json, sa.score
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ? AND {access_clause}
            """,
            (paper_id, *access_params),
        ).fetchall()
    question_count = 0
    has_score = False
    for row in rows:
        has_score = has_score or row["score"] is not None
        try:
            payload = json.loads(str(row["question_payload_json"] or "[]"))
        except json.JSONDecodeError:
            payload = []
        if isinstance(payload, list):
            question_count = max(question_count, len(payload))
    return question_count, has_score
