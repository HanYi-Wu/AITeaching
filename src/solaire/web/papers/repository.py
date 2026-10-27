"""Database access for paper records and their legacy exam identities."""

from __future__ import annotations

from contextlib import closing

import uuid
from pathlib import Path
from typing import Any, Callable

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict


def new_id() -> str:
    return uuid.uuid4().hex


def clean_subject(value: object) -> str:
    clean = str(value or "").strip()
    return "通用" if not clean or clean == "未分科" else clean


def clean_title(value: object, fallback: str) -> str:
    return str(value or "").strip() or fallback


def get_or_create_exam_paper(
    root: Path,
    exam: dict[str, Any],
    user: dict[str, Any],
    *,
    claim: bool = False,
    id_factory: Callable[[], str] | None = None,
) -> dict[str, Any]:
    """Complete exam metadata while retaining an existing paper's identity."""
    exam_id = str(exam.get("exam_id") or "").strip()
    if not exam_id:
        raise ValueError("exam_id is required")
    subject = clean_subject(exam.get("subject"))
    title = clean_title(exam.get("exam_title"), exam_id)
    now = utc_now()
    user_role = str(user.get("role") or "")
    owner_teacher_id = str(exam.get("owner_teacher_id") or "").strip() or None
    school_id = str(user.get("school_id")) if user.get("school_id") else None

    with closing(connect(root)) as con, con:
        if not owner_teacher_id and user_role == "teacher" and claim:
            owner_teacher_id = str(user.get("id"))
        elif not owner_teacher_id:
            candidates = con.execute(
                "SELECT id FROM users WHERE role='teacher'",
            ).fetchall()
            if len(candidates) == 1:
                owner_teacher_id = str(candidates[0]["id"])
        if user_role == "teacher" and owner_teacher_id and owner_teacher_id != str(user.get("id")):
            raise PermissionError("No permission for this exam")
        if owner_teacher_id:
            teacher_school = con.execute(
                "SELECT school_id FROM users WHERE id=? AND role='teacher'", (owner_teacher_id,)
            ).fetchone()
            if teacher_school is not None:
                school_id = str(teacher_school["school_id"]) if teacher_school["school_id"] else None
        row = con.execute(
            "SELECT * FROM paper_records WHERE exam_id = ? AND subject = ?",
            (exam_id, subject),
        ).fetchone()
        if row is None and subject != "通用":
            # Older unspecialized workspaces were registered under the generic subject.
            # Reuse their ID so publications and attempts survive corrected display data.
            row = con.execute(
                "SELECT * FROM paper_records WHERE exam_id = ? AND subject = '通用'",
                (exam_id,),
            ).fetchone()
        if row is None:
            paper_id = (id_factory or new_id)()
            con.execute(
                """
                INSERT INTO paper_records (
                  id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at, folder_id
                )
                VALUES (?, ?, ?, ?, 'offline', ?, ?, 'draft', ?, ?, ?)
                """,
                (paper_id, exam_id, title, subject, owner_teacher_id, school_id, now, now,
                 f"paper-default-{owner_teacher_id}" if owner_teacher_id else None),
            )
        else:
            paper_id = str(row["id"])
            existing_owner = str(row["owner_teacher_id"] or "").strip() or None
            publishers = {str(item[0]) for item in con.execute(
                "SELECT DISTINCT teacher_id FROM exam_publications WHERE paper_id=?", (paper_id,)
            ) if item[0]}
            if len(publishers) > 1:
                raise PermissionError("历史发布的教师归属不一致，无法修改试卷")
            if not existing_owner and publishers:
                existing_owner = next(iter(publishers))
            if user_role == "teacher" and existing_owner and existing_owner != str(user.get("id")):
                raise PermissionError("No permission for this exam")
            if existing_owner and owner_teacher_id and existing_owner != owner_teacher_id:
                raise PermissionError("Exam owner conflicts with existing paper record")
            owner_teacher_id = existing_owner or owner_teacher_id
            updates: list[str] = ["title = ?", "subject = ?", "updated_at = ?"]
            params: list[object] = [title, subject, now]
            if owner_teacher_id and row["owner_teacher_id"] is None:
                updates.append("owner_teacher_id = ?")
                params.append(owner_teacher_id)
            if school_id and row["school_id"] is None:
                updates.append("school_id = ?")
                params.append(school_id)
            if row["folder_id"] is None and owner_teacher_id:
                updates.append("folder_id = ?")
                params.append(f"paper-default-{owner_teacher_id}")
            params.append(paper_id)
            con.execute(f"UPDATE paper_records SET {', '.join(updates)} WHERE id = ?", params)
        stored = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(stored)
    if paper is None:
        raise RuntimeError("failed to sync paper record")
    return paper


def get_paper_record(root: Path, paper_id: str) -> dict[str, Any] | None:
    init_platform_db(root)
    with closing(connect(root)) as con, con:
        row = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    return row_to_dict(row)


def list_adaptive_paper_records(root: Path) -> list[dict[str, Any]]:
    with closing(connect(root)) as con, con:
        rows = con.execute(
            "SELECT * FROM paper_records WHERE exam_id LIKE 'adaptive/%' ORDER BY updated_at DESC"
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]
