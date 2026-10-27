"""Import normalization, row validation, and transaction management services."""

from __future__ import annotations

import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any, Iterator

from solaire.web.auth_service import hash_password, utc_now
from solaire.web.platform_db import connect, ensure_teacher_default_folder, init_platform_db, row_to_dict
from solaire.web.school.common import (
    _cell_text,
    _fetch_in_values,
    _new_id,
    _new_student_password,
    _new_student_usernames,
)


def _check_active_school(con: Any, school_id: str) -> None:
    school = con.execute("SELECT 1 FROM schools WHERE id = ? AND status = 'active'", (school_id,)).fetchone()
    if school is None:
        raise ValueError("school not found")


@contextmanager
def _import_connection(root: Path, connection: sqlite3.Connection | None) -> Iterator[sqlite3.Connection]:
    if connection is not None:
        yield connection
    else:
        with closing(connect(root)) as con, con:
            yield con


def import_teachers(
    root: Path,
    *,
    school_id: str,
    teachers: list[dict[str, str]],
    _connection: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if not teachers:
        return {"imported": 0, "teachers": []}
    if _connection is None:
        init_platform_db(root)
    imported: list[dict[str, Any]] = []
    now = utc_now()
    with _import_connection(root, _connection) as con:
        _check_active_school(con, school_id)
        normalized: list[dict[str, Any]] = []
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
            clean_subjects = sorted(set(subjects))
            normalized.append({
                "username": username,
                "display_name": display_name,
                "password": password,
                "email": email,
                "subjects": clean_subjects,
            })

        users = _fetch_in_values(
            con,
            """SELECT id, school_id, role, username, display_name, email, status, created_at, updated_at
               FROM users WHERE username IN ({})""",
            [row["username"] for row in normalized if row["username"]],
        )
        users_by_username = {str(row["username"]): row_to_dict(row) or {} for row in users}
        for idx, row in enumerate(normalized, start=1):
            username = str(row["username"])
            display_name = str(row["display_name"])
            password = str(row["password"])
            email = row["email"]
            clean_subjects = list(row["subjects"])
            if not username:
                raise ValueError(f"Row {idx} (username): teacher username is required")
            if len(username) < 3:
                raise ValueError(f"Row {idx} (username): username must be at least 3 characters")
            if len(password) < 6:
                raise ValueError(f"Row {idx} (password): password must be at least 6 characters")

            existing = users_by_username.get(username)
            if existing is not None and (existing["school_id"] != school_id or existing["role"] != "teacher"):
                raise ValueError(f"Row {idx} (username): username already in use by another account")

            if existing is None:
                user_id = _new_id()
                con.execute(
                    """
                    INSERT INTO users (
                      id, school_id, role, username, password_hash, display_name, email, status,
                      must_change_password, created_at, updated_at
                    )
                    VALUES (?, ?, 'teacher', ?, ?, ?, ?, 'active', 1, ?, ?)
                    """,
                    (user_id, school_id, username, hash_password(password), display_name, email, now, now),
                )
                user = {
                    "id": user_id,
                    "school_id": school_id,
                    "role": "teacher",
                    "username": username,
                    "display_name": display_name,
                    "email": email,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                }
                if clean_subjects:
                    con.executemany(
                        "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, ?)",
                        [(_new_id(), user_id, subj) for subj in clean_subjects],
                    )
            else:
                user_id = str(existing["id"])
                con.execute(
                    """
                    UPDATE users
                    SET display_name = ?, email = ?, updated_at = ?
                    WHERE id = ? AND school_id = ? AND role = 'teacher'
                    """,
                    (display_name, email, now, user_id, school_id),
                )
                user = {
                    **existing,
                    "display_name": display_name,
                    "email": email,
                    "updated_at": now,
                }
                con.execute("DELETE FROM teacher_subjects WHERE teacher_id = ?", (user_id,))
                if clean_subjects:
                    con.executemany(
                        "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, ?)",
                        [(_new_id(), user_id, subj) for subj in clean_subjects],
                    )

            ensure_teacher_default_folder(con, user_id)
            users_by_username[username] = user
            teacher = dict(user)
            teacher["subjects"] = clean_subjects
            imported.append(teacher)
    return {"imported": len(imported), "teachers": imported}


def import_classes(
    root: Path,
    *,
    school_id: str,
    classes: list[dict[str, str]],
    _connection: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if not classes:
        return {"imported": 0, "classes": []}
    if _connection is None:
        init_platform_db(root)
    imported: list[dict[str, Any]] = []
    now = utc_now()
    with _import_connection(root, _connection) as con:
        _check_active_school(con, school_id)
        normalized = [
            {"name": _cell_text(raw.get("name")), "grade": _cell_text(raw.get("grade")) or None}
            for raw in classes
        ]
        existing_rows = _fetch_in_values(
            con,
            """SELECT id, school_id, name, grade, subject_hint, created_at, updated_at
               FROM classes WHERE school_id = ? AND name IN ({})""",
            [str(row["name"]) for row in normalized if row["name"]],
            prefix_params=(school_id,),
        )
        classes_by_name = {str(row["name"]): row_to_dict(row) or {} for row in existing_rows}
        for idx, row in enumerate(normalized, start=1):
            name = str(row["name"])
            grade = row["grade"]
            if not name:
                raise ValueError(f"Row {idx} (name): class name is required")
            existing = classes_by_name.get(name)
            if existing is None:
                class_id = _new_id()
                con.execute(
                    """
                    INSERT INTO classes (id, school_id, name, grade, subject_hint, created_at, updated_at)
                    VALUES (?, ?, ?, ?, NULL, ?, ?)
                    """,
                    (class_id, school_id, name, grade, now, now),
                )
                klass = {
                    "id": class_id,
                    "school_id": school_id,
                    "name": name,
                    "grade": grade,
                    "subject_hint": None,
                    "created_at": now,
                    "updated_at": now,
                }
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
                klass = {
                    **existing,
                    "grade": grade,
                    "subject_hint": None,
                    "updated_at": now,
                }
            classes_by_name[name] = klass
            imported.append(dict(klass))
    return {"imported": len(imported), "classes": imported}


def import_students(
    root: Path,
    *,
    school_id: str,
    students: list[dict[str, str]],
    class_id: str | None = None,
    _connection: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if not students:
        return {"imported": 0, "students": []}
    if _connection is None:
        init_platform_db(root)
    now = utc_now()
    imported: list[dict[str, Any]] = []
    with _import_connection(root, _connection) as con:
        _check_active_school(con, school_id)
        if class_id is not None:
            klass = con.execute("SELECT 1 FROM classes WHERE id = ? AND school_id = ?", (class_id, school_id)).fetchone()
            if klass is None:
                raise ValueError("class not found")
        normalized = [
            {
                "student_no": _cell_text(raw.get("student_no")),
                "display_name": _cell_text(raw.get("display_name")) or _cell_text(raw.get("name")),
                "email": _cell_text(raw.get("email")) or None,
                "class_name": _cell_text(raw.get("class_name")),
            }
            for raw in students
        ]
        class_names = [str(row["class_name"]) for row in normalized if row["class_name"]]
        class_rows = _fetch_in_values(
            con,
            "SELECT id, name FROM classes WHERE school_id = ? AND name IN ({})",
            class_names,
            prefix_params=(school_id,),
        )
        classes_by_name = {str(row["name"]): str(row["id"]) for row in class_rows}
        student_rows = _fetch_in_values(
            con,
            """SELECT s.*, u.username AS account_username
               FROM students s LEFT JOIN users u ON u.id = s.user_id
               WHERE s.school_id = ? AND s.student_no IN ({})""",
            [str(row["student_no"]) for row in normalized if row["student_no"]],
            prefix_params=(school_id,),
        )
        students_by_no = {str(row["student_no"]): row_to_dict(row) or {} for row in student_rows}

        for idx, row in enumerate(normalized, start=1):
            if not row["student_no"] or not row["display_name"]:
                raise ValueError(f"Row {idx} (student_no): student_no and display_name are required")
            class_name = str(row["class_name"])
            if class_name and class_name not in classes_by_name:
                raise ValueError(f"Row {idx} (class_name): class not found: {class_name}")

        account_numbers = list(dict.fromkeys(
            str(row["student_no"])
            for row in normalized
            if str(row["student_no"]) not in students_by_no
            or not students_by_no[str(row["student_no"])].get("user_id")
        ))
        account_usernames = _new_student_usernames(con, school_id, len(account_numbers))
        usernames_by_student_no = dict(zip(account_numbers, account_usernames, strict=False))

        for row in normalized:
            student_no = str(row["student_no"])
            display_name = str(row["display_name"])
            email = row["email"]
            target_class_id = class_id
            class_name = str(row["class_name"])
            if class_name:
                target_class_id = classes_by_name[class_name]
            existing = students_by_no.get(student_no)
            if existing is None:
                student_id = _new_id()
                user_id = _new_id()
                account_username = usernames_by_student_no[student_no]
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
                student = {
                    "id": student_id,
                    "school_id": school_id,
                    "user_id": user_id,
                    "student_no": student_no,
                    "display_name": display_name,
                    "email": email,
                    "initial_password": initial_password,
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                    "account_username": account_username,
                }
            else:
                student_id = str(existing["id"])
                user_id = existing["user_id"]
                initial_password = existing["initial_password"]
                account_username = existing.get("account_username")
                if not user_id:
                    user_id = _new_id()
                    account_username = usernames_by_student_no[student_no]
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
                student = {
                    **existing,
                    "user_id": str(user_id),
                    "display_name": display_name,
                    "email": email,
                    "initial_password": str(initial_password),
                    "updated_at": now,
                    "account_username": account_username,
                }
            if target_class_id is not None:
                con.execute(
                    "INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)",
                    (target_class_id, student_id),
                )
            students_by_no[student_no] = student
            imported.append(dict(student))
    return {"imported": len(imported), "students": imported}


def import_teacher_class_assignments(
    root: Path,
    *,
    school_id: str,
    assignments: list[dict[str, Any]],
    _connection: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if not assignments:
        return {"imported": 0, "assignments": []}
    if _connection is None:
        init_platform_db(root)
    imported: list[dict[str, Any]] = []
    with _import_connection(root, _connection) as con:
        _check_active_school(con, school_id)
        normalized = [
            {
                "teacher_id": _cell_text(raw.get("teacher_id")),
                "teacher_username": _cell_text(raw.get("teacher_username")) or _cell_text(raw.get("username")),
                "class_id": _cell_text(raw.get("class_id")),
                "class_name": _cell_text(raw.get("class_name")),
                "subject": _cell_text(raw.get("subject")),
            }
            for raw in assignments
        ]
        teacher_ids = [str(row["teacher_id"]) for row in normalized if row["teacher_id"]]
        teacher_usernames = [
            str(row["teacher_username"]) for row in normalized
            if not row["teacher_id"] and row["teacher_username"]
        ]
        teachers_by_id = {
            str(row["id"]): row
            for row in _fetch_in_values(
                con,
                """SELECT id, username FROM users
                   WHERE school_id = ? AND role = 'teacher' AND status = 'active' AND id IN ({})""",
                teacher_ids,
                prefix_params=(school_id,),
            )
        }
        teachers_by_username = {
            str(row["username"]): row
            for row in _fetch_in_values(
                con,
                """SELECT id, username FROM users
                   WHERE school_id = ? AND role = 'teacher' AND status = 'active' AND username IN ({})""",
                teacher_usernames,
                prefix_params=(school_id,),
            )
        }
        class_ids = [str(row["class_id"]) for row in normalized if row["class_id"]]
        class_names = [
            str(row["class_name"]) for row in normalized
            if not row["class_id"] and row["class_name"]
        ]
        classes_by_id = {
            str(row["id"]): row
            for row in _fetch_in_values(
                con,
                "SELECT id FROM classes WHERE school_id = ? AND id IN ({})",
                class_ids,
                prefix_params=(school_id,),
            )
        }
        classes_by_name = {
            str(row["name"]): row
            for row in _fetch_in_values(
                con,
                "SELECT id, name FROM classes WHERE school_id = ? AND name IN ({})",
                class_names,
                prefix_params=(school_id,),
            )
        }
        for idx, row in enumerate(normalized, start=1):
            teacher_id = str(row["teacher_id"])
            teacher_username = str(row["teacher_username"])
            class_id = str(row["class_id"])
            class_name = str(row["class_name"])
            subject = str(row["subject"])
            if teacher_id:
                teacher = teachers_by_id.get(teacher_id)
            else:
                if not teacher_username:
                    raise ValueError(f"Row {idx} (teacher_username): teacher_username is required")
                teacher = teachers_by_username.get(teacher_username)
            if teacher is None:
                raise ValueError(f"Row {idx} (teacher): teacher not found: {teacher_username or teacher_id}")
            if class_id:
                klass = classes_by_id.get(class_id)
            else:
                if not class_name:
                    raise ValueError(f"Row {idx} (class_name): class_name is required")
                klass = classes_by_name.get(class_name)
            if klass is None:
                raise ValueError(f"Row {idx} (class): class not found: {class_name or class_id}")
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
