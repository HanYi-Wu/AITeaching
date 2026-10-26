"""Account lifecycle, status management, and password reset services."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.auth_service import hash_password, utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.school.common import (
    _clean_status,
    _new_id,
    _new_student_password,
    _new_student_username,
    _student_with_account,
)


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
    init_platform_db(root)
    clean_username = username.strip()
    if len(clean_username) < 3:
        raise ValueError("username must be at least 3 characters")
    clean_display_name = display_name.strip() or clean_username
    clean_email = email.strip() if email and email.strip() else None
    clean_subjects = sorted({subject.strip() for subject in subjects if subject.strip()})
    now = utc_now()
    user_id = _new_id()
    with connect(root) as con:
        school = con.execute("SELECT 1 FROM schools WHERE id = ? AND status = 'active'", (school_id,)).fetchone()
        if school is None:
            raise ValueError("school not found")
        con.execute(
            """
            INSERT INTO users (
              id, school_id, role, username, password_hash, display_name, email, status, must_change_password, created_at, updated_at
            )
            VALUES (?, ?, 'teacher', ?, ?, ?, ?, 'active', 1, ?, ?)
            """,
            (user_id, school_id, clean_username, hash_password(password), clean_display_name, clean_email, now, now),
        )
        if clean_subjects:
            con.executemany(
                "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, ?)",
                [(_new_id(), user_id, subject) for subject in clean_subjects],
            )
        row = con.execute(
            """
            SELECT id, school_id, role, username, display_name, email, status, created_at, updated_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    user = row_to_dict(row)
    if user is None:
        raise RuntimeError("failed to create teacher")
    user["subjects"] = clean_subjects
    return user


def update_teacher(
    root: Path,
    *,
    school_id: str,
    teacher_id: str,
    display_name: str | None = None,
    email: str | None = None,
    subjects: list[str] | None = None,
    password: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    now = utc_now()
    updates: list[str] = ["updated_at = ?"]
    params: list[object] = [now]
    if display_name is not None:
        updates.append("display_name = ?")
        params.append(display_name.strip())
    if email is not None:
        updates.append("email = ?")
        params.append(email.strip() or None)
    if password:
        updates.append("password_hash = ?")
        params.append(hash_password(password))
    if status is not None:
        clean_status = _clean_status(status)
        updates.append("status = ?")
        params.append(clean_status)
    params.extend([teacher_id, school_id])
    with connect(root) as con:
        existing = con.execute(
            "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher'",
            (teacher_id, school_id),
        ).fetchone()
        if existing is None:
            raise ValueError("teacher not found")
        con.execute(
            f"""
            UPDATE users
            SET {', '.join(updates)}
            WHERE id = ? AND school_id = ? AND role = 'teacher'
            """,
            tuple(params),
        )
        if subjects is not None:
            clean_subjects = sorted({subject.strip() for subject in subjects if subject.strip()})
            con.execute("DELETE FROM teacher_subjects WHERE teacher_id = ?", (teacher_id,))
            if clean_subjects:
                con.executemany(
                    "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, ?)",
                    [(_new_id(), teacher_id, subject) for subject in clean_subjects],
                )
        else:
            subject_rows = con.execute(
                "SELECT subject FROM teacher_subjects WHERE teacher_id = ? ORDER BY subject",
                (teacher_id,),
            ).fetchall()
            clean_subjects = [str(row["subject"]) for row in subject_rows]
        row = con.execute(
            """
            SELECT id, school_id, role, username, display_name, email, status, created_at, updated_at
            FROM users
            WHERE id = ? AND school_id = ? AND role = 'teacher'
            """,
            (teacher_id, school_id),
        ).fetchone()
    teacher = row_to_dict(row)
    if teacher is None:
        raise ValueError("teacher not found")
    teacher["subjects"] = clean_subjects
    return teacher


def reset_teacher_password(
    root: Path,
    *,
    school_id: str,
    teacher_id: str,
    password: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    new_password = (password or _new_student_password()).strip()
    now = utc_now()
    with connect(root) as con:
        existing = con.execute(
            "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher'",
            (teacher_id, school_id),
        ).fetchone()
        if existing is None:
            raise ValueError("teacher not found")
        con.execute(
            """
            UPDATE users
            SET password_hash = ?, status = 'active', must_change_password = 1, updated_at = ?
            WHERE id = ? AND school_id = ? AND role = 'teacher'
            """,
            (hash_password(new_password), now, teacher_id, school_id),
        )
        row = con.execute(
            """
            SELECT id, school_id, role, username, display_name, email, status, created_at, updated_at
            FROM users
            WHERE id = ? AND school_id = ? AND role = 'teacher'
            """,
            (teacher_id, school_id),
        ).fetchone()
        subject_rows = con.execute(
            "SELECT subject FROM teacher_subjects WHERE teacher_id = ? ORDER BY subject",
            (teacher_id,),
        ).fetchall()
    teacher = row_to_dict(row)
    if teacher is None:
        raise ValueError("teacher not found")
    teacher["subjects"] = [str(r["subject"]) for r in subject_rows]
    return {"teacher": teacher, "password": new_password}


def bulk_update_teachers(root: Path, *, school_id: str, teacher_ids: list[str], status: str) -> dict[str, Any]:
    init_platform_db(root)
    clean_ids = [item.strip() for item in teacher_ids if item.strip()]
    clean_status = _clean_status(status)
    if not clean_ids:
        return {"updated": 0}
    placeholders = ",".join("?" for _ in clean_ids)
    now = utc_now()
    with connect(root) as con:
        cur = con.execute(
            f"""
            UPDATE users
            SET status = ?, updated_at = ?
            WHERE school_id = ? AND role = 'teacher' AND id IN ({placeholders})
            """,
            (clean_status, now, school_id, *clean_ids),
        )
    return {"updated": int(cur.rowcount if cur.rowcount is not None else 0)}


def reset_student_password(
    root: Path,
    *,
    school_id: str,
    student_id: str,
    password: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    new_password = (password or _new_student_password()).strip()
    now = utc_now()
    with connect(root) as con:
        row = con.execute(
            """
            SELECT id, user_id, student_no, display_name, email
            FROM students
            WHERE id = ? AND school_id = ?
            """,
            (student_id, school_id),
        ).fetchone()
        student = row_to_dict(row)
        if student is None:
            raise ValueError("student not found")
        user_id = str(student.get("user_id") or "")
        if not user_id:
            user_id = _new_id()
            username = _new_student_username(con, school_id)
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
                    username,
                    hash_password(new_password),
                    student.get("display_name") or student.get("student_no") or username,
                    student.get("email"),
                    now,
                    now,
                ),
            )
        else:
            user_existing = con.execute(
                "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'student'",
                (user_id, school_id),
            ).fetchone()
            if user_existing is None:
                raise ValueError("student account mismatch")
            con.execute(
                """
                UPDATE users
                SET password_hash = ?, display_name = ?, email = ?, status = 'active',
                    must_change_password = 1, updated_at = ?
                WHERE id = ? AND school_id = ? AND role = 'student'
                """,
                (hash_password(new_password), student.get("display_name"), student.get("email"), now, user_id, school_id),
            )
        con.execute(
            """
            UPDATE students
            SET user_id = ?, initial_password = ?, status = 'active', updated_at = ?
            WHERE id = ? AND school_id = ?
            """,
            (user_id, new_password, now, student_id, school_id),
        )
        updated = _student_with_account(con, student_id)
    return {"student": updated, "password": new_password}


def bulk_update_students(root: Path, *, school_id: str, student_ids: list[str], status: str) -> dict[str, Any]:
    init_platform_db(root)
    clean_ids = [item.strip() for item in student_ids if item.strip()]
    clean_status = _clean_status(status)
    if not clean_ids:
        return {"updated": 0}
    placeholders = ",".join("?" for _ in clean_ids)
    now = utc_now()
    with connect(root) as con:
        rows = con.execute(
            f"SELECT id, user_id FROM students WHERE school_id = ? AND id IN ({placeholders})",
            (school_id, *clean_ids),
        ).fetchall()
        student_ids_existing = [str(row["id"]) for row in rows]
        user_ids = [str(row["user_id"]) for row in rows if row["user_id"]]
        if not student_ids_existing:
            return {"updated": 0}
        student_placeholders = ",".join("?" for _ in student_ids_existing)
        cur = con.execute(
            f"""
            UPDATE students
            SET status = ?, updated_at = ?
            WHERE school_id = ? AND id IN ({student_placeholders})
            """,
            (clean_status, now, school_id, *student_ids_existing),
        )
        if user_ids:
            user_placeholders = ",".join("?" for _ in user_ids)
            con.execute(
                f"""
                UPDATE users
                SET status = ?, updated_at = ?
                WHERE school_id = ? AND role = 'student' AND id IN ({user_placeholders})
                """,
                (clean_status, now, school_id, *user_ids),
            )
    return {"updated": int(cur.rowcount if cur.rowcount is not None else 0)}
