"""School, teacher, class, and student management services."""

from __future__ import annotations

import secrets
import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import hash_password, utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict

from solaire.web.school.common import (
    MAX_PAGE_SIZE,
    VALID_ACCOUNT_STATUSES,
    _cell_text,
    _clean_status,
    _contains_query,
    _fetch_required,
    _new_id,
    _new_student_password,
    _new_student_username,
    _page,
)
from solaire.web.school.accounts import (
    bulk_update_students,
    bulk_update_teachers,
    create_school_user,
    create_teacher,
    create_user,
    reset_student_password,
    reset_teacher_password,
    update_teacher,
)
from solaire.web.school.roster import (
    assign_teacher_class,
    list_students,
    list_teacher_class_assignments,
    list_teachers,
    query_students,
    query_teachers,
    remove_teacher_class_assignment,
    set_teacher_subjects,
    update_student,
)
from solaire.web.school.organization import (
    create_class,
    create_school,
    delete_class,
    get_school,
    list_classes,
    list_schools,
    query_classes,
    query_schools,
    update_class,
)


















def import_teachers(root: Path, *, school_id: str, teachers: list[dict[str, str]]) -> dict[str, Any]:
    init_platform_db(root)
    if not teachers:
        return {"imported": 0, "teachers": []}
    imported: list[dict[str, Any]] = []
    for raw in teachers:
        username = _cell_text(raw.get("username"))
        display_name = _cell_text(raw.get("display_name")) or _cell_text(raw.get("name")) or username
        password = _cell_text(raw.get("password")) or "teacher123"
        email = _cell_text(raw.get("email")) or None
        subjects_raw = raw.get("subjects") or raw.get("subject") or ""
        if isinstance(subjects_raw, list):
            subjects = [_cell_text(item) for item in subjects_raw if _cell_text(item)]
        else:
            subjects = [item.strip() for item in _cell_text(subjects_raw).replace("，", ",").split(",") if item.strip()]
        if not username:
            raise ValueError("teacher username is required")
        with connect(root) as con:
            existing = con.execute(
                "SELECT id FROM users WHERE username = ? AND school_id = ? AND role = 'teacher'",
                (username, school_id),
            ).fetchone()
        if existing is None:
            teacher = create_teacher(
                root,
                school_id=school_id,
                username=username,
                password=password,
                display_name=display_name,
                email=email,
                subjects=subjects,
            )
        else:
            teacher_id = str(existing["id"])
            now = utc_now()
            with connect(root) as con:
                con.execute(
                    """
                    UPDATE users
                    SET display_name = ?, email = ?, updated_at = ?
                    WHERE id = ? AND school_id = ? AND role = 'teacher'
                    """,
                    (display_name or username, email, now, teacher_id, school_id),
                )
            teacher = _fetch_required(
                root,
                """
                SELECT id, school_id, role, username, display_name, email, status, created_at, updated_at
                FROM users
                WHERE id = ?
                """,
                (teacher_id,),
                "teacher not found",
            )
            teacher["subjects"] = set_teacher_subjects(root, teacher_id=teacher_id, school_id=school_id, subjects=subjects)
        imported.append(teacher)
    return {"imported": len(imported), "teachers": imported}


def import_classes(root: Path, *, school_id: str, classes: list[dict[str, str]]) -> dict[str, Any]:
    init_platform_db(root)
    if not classes:
        return {"imported": 0, "classes": []}
    imported: list[dict[str, Any]] = []
    now = utc_now()
    with connect(root) as con:
        for raw in classes:
            name = _cell_text(raw.get("name"))
            grade = _cell_text(raw.get("grade")) or None
            if not name:
                raise ValueError("class name is required")
            existing = con.execute(
                "SELECT id FROM classes WHERE school_id = ? AND name = ?",
                (school_id, name),
            ).fetchone()
            if existing is None:
                class_id = _new_id()
                con.execute(
                    """
                    INSERT INTO classes (id, school_id, name, grade, subject_hint, created_at, updated_at)
                    VALUES (?, ?, ?, ?, NULL, ?, ?)
                    """,
                    (class_id, school_id, name, grade, now, now),
                )
            else:
                class_id = str(existing["id"])
                con.execute(
                    """
                    UPDATE classes
                    SET grade = ?, subject_hint = NULL, updated_at = ?
                    WHERE id = ? AND school_id = ?
                    """,
                    (grade, now, class_id, school_id),
                )
            row = con.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
            imported.append(row_to_dict(row) or {})
    return {"imported": len(imported), "classes": imported}


def _student_with_account(con, student_id: str) -> dict[str, Any]:
    row = con.execute(
        """
        SELECT s.*, u.username AS account_username
        FROM students s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
        """,
        (student_id,),
    ).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise RuntimeError("failed to load student")
    return data


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
            student_no = _cell_text(raw.get("student_no"))
            display_name = _cell_text(raw.get("display_name")) or _cell_text(raw.get("name"))
            email = _cell_text(raw.get("email")) or None
            if not student_no or not display_name:
                raise ValueError("student_no and display_name are required")
            target_class_id = class_id
            class_name = _cell_text(raw.get("class_name"))
            if class_name:
                klass_row = con.execute(
                    "SELECT id FROM classes WHERE school_id = ? AND name = ?",
                    (school_id, class_name),
                ).fetchone()
                if klass_row is None:
                    raise ValueError(f"class not found: {class_name}")
                target_class_id = str(klass_row["id"])
            existing = con.execute(
                "SELECT id, user_id, initial_password FROM students WHERE school_id = ? AND student_no = ?",
                (school_id, student_no),
            ).fetchone()
            if existing is None:
                student_id = _new_id()
                user_id = _new_id()
                account_username = _new_student_username(con, school_id)
                initial_password = _new_student_password()
                con.execute(
                    """
                    INSERT INTO users (
                      id, school_id, role, username, password_hash, display_name, email, status,
                      must_change_password, created_at, updated_at
                    )
                    VALUES (?, ?, 'student', ?, ?, ?, ?, 'active', 1, ?, ?)
                    """,
                    (user_id, school_id, account_username, hash_password(initial_password), display_name, email, now, now),
                )
                con.execute(
                    """
                    INSERT INTO students (
                      id, school_id, user_id, student_no, display_name, email, initial_password,
                      status, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
                    """,
                    (student_id, school_id, user_id, student_no, display_name, email, initial_password, now, now),
                )
            else:
                student_id = str(existing["id"])
                user_id = existing["user_id"]
                initial_password = existing["initial_password"]
                if not user_id:
                    user_id = _new_id()
                    account_username = _new_student_username(con, school_id)
                    initial_password = _new_student_password()
                    con.execute(
                        """
                        INSERT INTO users (
                          id, school_id, role, username, password_hash, display_name, email, status,
                          must_change_password, created_at, updated_at
                        )
                        VALUES (?, ?, 'student', ?, ?, ?, ?, 'active', 1, ?, ?)
                        """,
                        (
                            user_id,
                            school_id,
                            account_username,
                            hash_password(initial_password),
                            display_name,
                            email,
                            now,
                            now,
                        ),
                    )
                con.execute(
                    """
                    UPDATE students
                    SET user_id = ?, display_name = ?, email = ?, initial_password = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (str(user_id), display_name, email, str(initial_password), now, student_id),
                )
                con.execute(
                    """
                    UPDATE users
                    SET display_name = ?, email = ?, updated_at = ?
                    WHERE id = ? AND role = 'student'
                    """,
                    (display_name, email, now, str(user_id)),
                )
            if target_class_id is not None:
                con.execute(
                    "INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)",
                    (target_class_id, student_id),
                )
            imported.append(_student_with_account(con, student_id))
    return {"imported": len(imported), "students": imported}









def import_teacher_class_assignments(
    root: Path,
    *,
    school_id: str,
    assignments: list[dict[str, Any]],
) -> dict[str, Any]:
    init_platform_db(root)
    if not assignments:
        return {"imported": 0, "assignments": []}
    imported: list[dict[str, Any]] = []
    with connect(root) as con:
        for raw in assignments:
            teacher_id = _cell_text(raw.get("teacher_id"))
            teacher_username = _cell_text(raw.get("teacher_username")) or _cell_text(raw.get("username"))
            class_id = _cell_text(raw.get("class_id"))
            class_name = _cell_text(raw.get("class_name"))
            subject = _cell_text(raw.get("subject"))
            if teacher_id:
                teacher = con.execute(
                    "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND status = 'active'",
                    (teacher_id, school_id),
                ).fetchone()
            else:
                if not teacher_username:
                    raise ValueError("teacher_username is required")
                teacher = con.execute(
                    "SELECT id FROM users WHERE username = ? AND school_id = ? AND role = 'teacher' AND status = 'active'",
                    (teacher_username, school_id),
                ).fetchone()
            if teacher is None:
                raise ValueError(f"teacher not found: {teacher_username or teacher_id}")
            if class_id:
                klass = con.execute(
                    "SELECT id FROM classes WHERE id = ? AND school_id = ?",
                    (class_id, school_id),
                ).fetchone()
            else:
                if not class_name:
                    raise ValueError("class_name is required")
                klass = con.execute(
                    "SELECT id FROM classes WHERE name = ? AND school_id = ?",
                    (class_name, school_id),
                ).fetchone()
            if klass is None:
                raise ValueError(f"class not found: {class_name or class_id}")
            resolved_teacher_id = str(teacher["id"])
            resolved_class_id = str(klass["id"])
            con.execute(
                "INSERT OR IGNORE INTO teacher_class_assignments (teacher_id, class_id, subject) VALUES (?, ?, ?)",
                (resolved_teacher_id, resolved_class_id, subject),
            )
            item = {"teacher_id": resolved_teacher_id, "class_id": resolved_class_id}
            if subject:
                item["subject"] = subject
            imported.append(item)
    return {"imported": len(imported), "assignments": imported}







def update_school_ai_enabled(root: Path, *, school_id: str, ai_enabled: bool) -> dict[str, Any]:
    init_platform_db(root)
    now = utc_now()
    with connect(root) as con:
        existing = con.execute("SELECT 1 FROM schools WHERE id = ?", (school_id,)).fetchone()
        if existing is None:
            raise ValueError("school not found")
        con.execute(
            "UPDATE schools SET ai_enabled = ?, updated_at = ? WHERE id = ?",
            (1 if ai_enabled else 0, now, school_id),
        )
        row = con.execute("SELECT * FROM schools WHERE id = ?", (school_id,)).fetchone()
    school = row_to_dict(row)
    if school is None:
        raise RuntimeError("failed to update school")
    return school
