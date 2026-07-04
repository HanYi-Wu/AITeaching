"""School, teacher, class, and student management services."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import hash_password, utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict


def _new_id() -> str:
    return uuid.uuid4().hex


def _fetch_required(root: Path, sql: str, params: tuple[object, ...], message: str) -> dict[str, Any]:
    with connect(root) as con:
        row = con.execute(sql, params).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise ValueError(message)
    return data


def create_school(root: Path, *, name: str) -> dict[str, Any]:
    init_platform_db(root)
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("school name is required")
    now = utc_now()
    school_id = _new_id()
    with connect(root) as con:
        con.execute(
            """
            INSERT INTO schools (id, name, status, ai_enabled, created_at, updated_at)
            VALUES (?, ?, 'active', 0, ?, ?)
            """,
            (school_id, clean_name, now, now),
        )
        row = con.execute("SELECT * FROM schools WHERE id = ?", (school_id,)).fetchone()
    school = row_to_dict(row)
    if school is None:
        raise RuntimeError("failed to create school")
    return school


def list_schools(root: Path) -> list[dict[str, Any]]:
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute("SELECT * FROM schools ORDER BY created_at DESC").fetchall()
    return [row_to_dict(row) or {} for row in rows]


def create_user(
    root: Path,
    *,
    role: str,
    username: str,
    password: str,
    display_name: str,
    school_id: str | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    clean_username = username.strip()
    if len(clean_username) < 3:
        raise ValueError("username must be at least 3 characters")
    clean_display_name = display_name.strip() or clean_username
    clean_email = email.strip() if email and email.strip() else None
    now = utc_now()
    user_id = _new_id()
    with connect(root) as con:
        if school_id is not None:
            school = con.execute("SELECT 1 FROM schools WHERE id = ? AND status = 'active'", (school_id,)).fetchone()
            if school is None:
                raise ValueError("school not found")
        con.execute(
            """
            INSERT INTO users (
              id, school_id, role, username, password_hash, display_name, email, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            """,
            (user_id, school_id, role, clean_username, hash_password(password), clean_display_name, clean_email, now, now),
        )
        row = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    user = row_to_dict(row)
    if user is None:
        raise RuntimeError("failed to create user")
    user.pop("password_hash", None)
    return user


def create_school_user(
    root: Path,
    *,
    school_id: str,
    username: str,
    password: str,
    display_name: str,
    email: str | None = None,
) -> dict[str, Any]:
    return create_user(
        root,
        role="school",
        username=username,
        password=password,
        display_name=display_name,
        school_id=school_id,
        email=email,
    )


def set_teacher_subjects(root: Path, *, teacher_id: str, school_id: str, subjects: list[str]) -> list[str]:
    clean_subjects = sorted({subject.strip() for subject in subjects if subject.strip()})
    if not clean_subjects:
        raise ValueError("at least one subject is required")
    with connect(root) as con:
        teacher = con.execute(
            "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND status = 'active'",
            (teacher_id, school_id),
        ).fetchone()
        if teacher is None:
            raise ValueError("teacher not found")
        con.execute("DELETE FROM teacher_subjects WHERE teacher_id = ?", (teacher_id,))
        con.executemany(
            "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, ?)",
            [(_new_id(), teacher_id, subject) for subject in clean_subjects],
        )
    return clean_subjects


def create_teacher(
    root: Path,
    *,
    school_id: str,
    username: str,
    password: str,
    display_name: str,
    subjects: list[str],
    email: str | None = None,
) -> dict[str, Any]:
    user = create_user(
        root,
        role="teacher",
        username=username,
        password=password,
        display_name=display_name,
        school_id=school_id,
        email=email,
    )
    user["subjects"] = set_teacher_subjects(root, teacher_id=str(user["id"]), school_id=school_id, subjects=subjects)
    return user


def list_teachers(root: Path, *, school_id: str) -> list[dict[str, Any]]:
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT id, school_id, role, username, display_name, email, status, created_at, updated_at
            FROM users
            WHERE school_id = ? AND role = 'teacher'
            ORDER BY created_at DESC
            """,
            (school_id,),
        ).fetchall()
        subject_rows = con.execute(
            """
            SELECT teacher_id, subject
            FROM teacher_subjects
            WHERE teacher_id IN (SELECT id FROM users WHERE school_id = ? AND role = 'teacher')
            ORDER BY subject
            """,
            (school_id,),
        ).fetchall()
    subjects_by_teacher: dict[str, list[str]] = {}
    for row in subject_rows:
        subjects_by_teacher.setdefault(str(row["teacher_id"]), []).append(str(row["subject"]))
    teachers: list[dict[str, Any]] = []
    for row in rows:
        item = row_to_dict(row) or {}
        item["subjects"] = subjects_by_teacher.get(str(item["id"]), [])
        teachers.append(item)
    return teachers


def create_class(root: Path, *, school_id: str, name: str, grade: str | None = None, subject_hint: str | None = None) -> dict[str, Any]:
    init_platform_db(root)
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("class name is required")
    now = utc_now()
    class_id = _new_id()
    with connect(root) as con:
        school = con.execute("SELECT 1 FROM schools WHERE id = ? AND status = 'active'", (school_id,)).fetchone()
        if school is None:
            raise ValueError("school not found")
        con.execute(
            """
            INSERT INTO classes (id, school_id, name, grade, subject_hint, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                class_id,
                school_id,
                clean_name,
                grade.strip() if grade and grade.strip() else None,
                subject_hint.strip() if subject_hint and subject_hint.strip() else None,
                now,
                now,
            ),
        )
        row = con.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
    klass = row_to_dict(row)
    if klass is None:
        raise RuntimeError("failed to create class")
    return klass


def list_classes(root: Path, *, school_id: str) -> list[dict[str, Any]]:
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute("SELECT * FROM classes WHERE school_id = ? ORDER BY created_at DESC", (school_id,)).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def import_students(
    root: Path,
    *,
    school_id: str,
    students: list[dict[str, str]],
    class_id: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    if not students:
        return {"imported": 0, "students": []}
    now = utc_now()
    imported: list[dict[str, Any]] = []
    with connect(root) as con:
        if class_id is not None:
            klass = con.execute("SELECT 1 FROM classes WHERE id = ? AND school_id = ?", (class_id, school_id)).fetchone()
            if klass is None:
                raise ValueError("class not found")
        for raw in students:
            student_no = str(raw.get("student_no", "")).strip()
            display_name = str(raw.get("display_name", "")).strip()
            email = str(raw.get("email", "")).strip() or None
            if not student_no or not display_name:
                raise ValueError("student_no and display_name are required")
            existing = con.execute(
                "SELECT id FROM students WHERE school_id = ? AND student_no = ?",
                (school_id, student_no),
            ).fetchone()
            if existing is None:
                student_id = _new_id()
                con.execute(
                    """
                    INSERT INTO students (
                      id, school_id, student_no, display_name, email, status, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
                    """,
                    (student_id, school_id, student_no, display_name, email, now, now),
                )
            else:
                student_id = str(existing["id"])
                con.execute(
                    """
                    UPDATE students
                    SET display_name = ?, email = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (display_name, email, now, student_id),
                )
            if class_id is not None:
                con.execute(
                    "INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)",
                    (class_id, student_id),
                )
            row = con.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
            imported.append(row_to_dict(row) or {})
    return {"imported": len(imported), "students": imported}


def assign_teacher_class(root: Path, *, school_id: str, teacher_id: str, class_id: str, subject: str) -> dict[str, Any]:
    init_platform_db(root)
    clean_subject = subject.strip()
    if not clean_subject:
        raise ValueError("subject is required")
    with connect(root) as con:
        teacher = con.execute(
            "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND status = 'active'",
            (teacher_id, school_id),
        ).fetchone()
        if teacher is None:
            raise ValueError("teacher not found")
        klass = con.execute("SELECT 1 FROM classes WHERE id = ? AND school_id = ?", (class_id, school_id)).fetchone()
        if klass is None:
            raise ValueError("class not found")
        teacher_subject = con.execute(
            "SELECT 1 FROM teacher_subjects WHERE teacher_id = ? AND subject = ?",
            (teacher_id, clean_subject),
        ).fetchone()
        if teacher_subject is None:
            raise ValueError("teacher is not assigned to this subject")
        con.execute(
            """
            INSERT OR IGNORE INTO teacher_class_assignments (teacher_id, class_id, subject)
            VALUES (?, ?, ?)
            """,
            (teacher_id, class_id, clean_subject),
        )
    return {"teacher_id": teacher_id, "class_id": class_id, "subject": clean_subject}


def get_school(root: Path, *, school_id: str) -> dict[str, Any]:
    init_platform_db(root)
    return _fetch_required(root, "SELECT * FROM schools WHERE id = ?", (school_id,), "school not found")
