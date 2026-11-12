"""Database access for paper records and their legacy exam identities."""

from __future__ import annotations

from contextlib import closing

import sqlite3
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
    with closing(connect(root)) as con, con:
        return _get_or_create_exam_paper_in_connection(
            con,
            exam,
            user,
            claim=claim,
            id_factory=id_factory,
        )


def _get_or_create_exam_paper_in_connection(
    con,
    exam: dict[str, Any],
    user: dict[str, Any],
    *,
    claim: bool = False,
    id_factory: Callable[[], str] | None = None,
    fallback_teacher_id: str | None = None,
    teacher_school_by_id: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Resolve one exam while borrowing a caller-owned SQLite transaction.

    The list endpoint calls this through :func:`reconcile_exam_papers` so a
    stable paper list does not open and commit one transaction per exam.
    """
    exam_id = str(exam.get("exam_id") or "").strip()
    if not exam_id:
        raise ValueError("exam_id is required")
    subject = clean_subject(exam.get("subject"))
    title = clean_title(exam.get("exam_title"), exam_id)
    now = utc_now()
    user_role = str(user.get("role") or "")
    owner_teacher_id = str(exam.get("owner_teacher_id") or "").strip() or None
    school_id = str(user.get("school_id")) if user.get("school_id") else None

    if not owner_teacher_id and user_role == "teacher" and claim:
        owner_teacher_id = str(user.get("id"))
    elif not owner_teacher_id:
        if fallback_teacher_id is None:
            candidates = con.execute("SELECT id FROM users WHERE role='teacher'").fetchall()
            if len(candidates) == 1:
                fallback_teacher_id = str(candidates[0]["id"])
        owner_teacher_id = fallback_teacher_id
    if user_role == "teacher" and owner_teacher_id and owner_teacher_id != str(user.get("id")):
        raise PermissionError("No permission for this exam")
    if owner_teacher_id:
        if teacher_school_by_id is not None and owner_teacher_id in teacher_school_by_id:
            teacher_exists = True
            teacher_school = teacher_school_by_id[owner_teacher_id]
        else:
            teacher_row = con.execute(
                "SELECT school_id FROM users WHERE id=? AND role='teacher'", (owner_teacher_id,)
            ).fetchone()
            teacher_exists = teacher_row is not None
            teacher_school = teacher_row["school_id"] if teacher_row is not None else None
        if teacher_exists:
            school_id = str(teacher_school) if teacher_school else None
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
        try:
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
        except sqlite3.IntegrityError as exc:
            # Two first-time list requests can race after both observe no row.
            # Reuse the winner's record instead of surfacing a duplicate error.
            if "UNIQUE constraint failed: paper_records.exam_id, paper_records.subject" not in str(exc):
                raise
            row = con.execute(
                "SELECT * FROM paper_records WHERE exam_id = ? AND subject = ?",
                (exam_id, subject),
            ).fetchone()
            if row is None:
                raise
    if row is not None:
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
        updates: list[str] = []
        params: list[object] = []
        if str(row["title"] or "") != title:
            updates.append("title = ?")
            params.append(title)
        if str(row["subject"] or "") != subject:
            updates.append("subject = ?")
            params.append(subject)
        if owner_teacher_id and row["owner_teacher_id"] is None:
            updates.append("owner_teacher_id = ?")
            params.append(owner_teacher_id)
        if school_id and row["school_id"] is None:
            updates.append("school_id = ?")
            params.append(school_id)
        if row["folder_id"] is None and owner_teacher_id:
            updates.append("folder_id = ?")
            params.append(f"paper-default-{owner_teacher_id}")
        if updates:
            updates.append("updated_at = ?")
            params.append(now)
            params.append(paper_id)
            con.execute(f"UPDATE paper_records SET {', '.join(updates)} WHERE id = ?", params)
    stored = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(stored)
    if paper is None:
        raise RuntimeError("failed to sync paper record")
    return paper


def reconcile_exam_papers(
    root: Path,
    exams: list[dict[str, Any]],
    user: dict[str, Any],
    *,
    claim: bool = False,
    id_factory: Callable[[], str] | None = None,
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Resolve visible exam records in one connection/transaction.

    Missing records and legacy metadata repairs are still persisted, but
    already-correct records are read without an UPDATE. Permission conflicts
    are skipped per exam to match the historical list endpoint behavior.
    """
    if not exams:
        return []

    fallback_teacher_id: str | None = None
    with closing(connect(root)) as con, con:
        if not claim:
            candidates = con.execute("SELECT id FROM users WHERE role='teacher'").fetchall()
            if len(candidates) == 1:
                fallback_teacher_id = str(candidates[0]["id"])
        teacher_school_by_id = {
            str(row["id"]): (str(row["school_id"]) if row["school_id"] else None)
            for row in con.execute("SELECT id, school_id FROM users WHERE role='teacher'").fetchall()
        }
        resolved: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for exam in exams:
            try:
                record = _get_or_create_exam_paper_in_connection(
                    con,
                    exam,
                    user,
                    claim=claim,
                    id_factory=id_factory,
                    fallback_teacher_id=fallback_teacher_id,
                    teacher_school_by_id=teacher_school_by_id,
                )
            except PermissionError:
                continue
            resolved.append((record, exam))
    return resolved


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
