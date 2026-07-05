"""School, teacher, class, and student management services."""

from __future__ import annotations

import secrets
import string
import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import hash_password, utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict


def _new_id() -> str:
    return uuid.uuid4().hex


def _new_student_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(10))


def _new_student_username(con, school_id: str) -> str:
    """Generate a platform login username, not an exam taker number."""
    for _ in range(20):
        candidate = f"stu_{uuid.uuid4().hex[:10]}"
        row = con.execute("SELECT 1 FROM users WHERE username = ?", (candidate,)).fetchone()
        if row is None:
            return candidate
    return f"stu_{school_id[:4]}_{uuid.uuid4().hex}"


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
    with connect(root) as con:
        teacher = con.execute(
            "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND status = 'active'",
            (teacher_id, school_id),
        ).fetchone()
        if teacher is None:
            raise ValueError("teacher not found")
        con.execute("DELETE FROM teacher_subjects WHERE teacher_id = ?", (teacher_id,))
        if clean_subjects:
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
        clean_status = status.strip() or "active"
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
        clean_subjects = set_teacher_subjects(root, teacher_id=teacher_id, school_id=school_id, subjects=subjects)
    else:
        clean_subjects = []
        with connect(root) as con:
            subject_rows = con.execute(
                "SELECT subject FROM teacher_subjects WHERE teacher_id = ? ORDER BY subject",
                (teacher_id,),
            ).fetchall()
        clean_subjects = [str(row["subject"]) for row in subject_rows]
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
    teacher["subjects"] = clean_subjects
    return teacher


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


def update_class(
    root: Path,
    *,
    school_id: str,
    class_id: str,
    name: str | None = None,
    grade: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    now = utc_now()
    updates: list[str] = ["updated_at = ?"]
    params: list[object] = [now]
    if name is not None:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("class name is required")
        updates.append("name = ?")
        params.append(clean_name)
    if grade is not None:
        updates.append("grade = ?")
        params.append(grade.strip() or None)
    params.extend([class_id, school_id])
    with connect(root) as con:
        existing = con.execute(
            "SELECT 1 FROM classes WHERE id = ? AND school_id = ?",
            (class_id, school_id),
        ).fetchone()
        if existing is None:
            raise ValueError("class not found")
        con.execute(
            f"UPDATE classes SET {', '.join(updates)}, subject_hint = NULL WHERE id = ? AND school_id = ?",
            tuple(params),
        )
        row = con.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
    klass = row_to_dict(row)
    if klass is None:
        raise RuntimeError("failed to update class")
    return klass


def import_teachers(root: Path, *, school_id: str, teachers: list[dict[str, str]]) -> dict[str, Any]:
    init_platform_db(root)
    if not teachers:
        return {"imported": 0, "teachers": []}
    imported: list[dict[str, Any]] = []
    for raw in teachers:
        username = str(raw.get("username", "")).strip()
        display_name = str(raw.get("display_name") or raw.get("name") or username).strip()
        password = str(raw.get("password") or "teacher123").strip()
        email = str(raw.get("email") or "").strip() or None
        subjects_raw = raw.get("subjects") or raw.get("subject") or ""
        if isinstance(subjects_raw, list):
            subjects = [str(item).strip() for item in subjects_raw if str(item).strip()]
        else:
            subjects = [item.strip() for item in str(subjects_raw).replace("，", ",").split(",") if item.strip()]
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
            name = str(raw.get("name", "")).strip()
            grade = str(raw.get("grade") or "").strip() or None
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
            student_no = str(raw.get("student_no", "")).strip()
            display_name = str(raw.get("display_name") or raw.get("name") or "").strip()
            email = str(raw.get("email", "")).strip() or None
            if not student_no or not display_name:
                raise ValueError("student_no and display_name are required")
            target_class_id = class_id
            class_name = str(raw.get("class_name") or "").strip()
            if target_class_id is None and class_name:
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
                      id, school_id, role, username, password_hash, display_name, email, status, created_at, updated_at
                    )
                    VALUES (?, ?, 'student', ?, ?, ?, ?, 'active', ?, ?)
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
                          id, school_id, role, username, password_hash, display_name, email, status, created_at, updated_at
                        )
                        VALUES (?, ?, 'student', ?, ?, ?, ?, 'active', ?, ?)
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


def list_students(root: Path, *, school_id: str, class_id: str | None = None) -> list[dict[str, Any]]:
    init_platform_db(root)
    params: list[object] = [school_id]
    class_join = ""
    class_where = ""
    if class_id:
        class_join = "JOIN class_students cs_filter ON cs_filter.student_id = s.id"
        class_where = "AND cs_filter.class_id = ?"
        params.append(class_id)
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT
              s.*,
              u.username AS account_username,
              GROUP_CONCAT(c.name, ', ') AS class_names
            FROM students s
            LEFT JOIN users u ON u.id = s.user_id
            LEFT JOIN class_students cs ON cs.student_id = s.id
            LEFT JOIN classes c ON c.id = cs.class_id
            {class_join}
            WHERE s.school_id = ? {class_where}
            GROUP BY s.id
            ORDER BY s.created_at DESC
            """,
            tuple(params),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def update_student(
    root: Path,
    *,
    school_id: str,
    student_id: str,
    student_no: str | None = None,
    display_name: str | None = None,
    email: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    now = utc_now()
    updates: list[str] = ["updated_at = ?"]
    params: list[object] = [now]
    if student_no is not None:
        clean_no = student_no.strip()
        if not clean_no:
            raise ValueError("student_no is required")
        updates.append("student_no = ?")
        params.append(clean_no)
    if display_name is not None:
        clean_name = display_name.strip()
        if not clean_name:
            raise ValueError("display_name is required")
        updates.append("display_name = ?")
        params.append(clean_name)
    if email is not None:
        updates.append("email = ?")
        params.append(email.strip() or None)
    if status is not None:
        updates.append("status = ?")
        params.append(status.strip() or "active")
    params.extend([student_id, school_id])
    with connect(root) as con:
        existing = con.execute(
            "SELECT user_id FROM students WHERE id = ? AND school_id = ?",
            (student_id, school_id),
        ).fetchone()
        if existing is None:
            raise ValueError("student not found")
        con.execute(
            f"UPDATE students SET {', '.join(updates)} WHERE id = ? AND school_id = ?",
            tuple(params),
        )
        row = con.execute("SELECT display_name, email, status, user_id FROM students WHERE id = ?", (student_id,)).fetchone()
        if row is not None and row["user_id"]:
            con.execute(
                """
                UPDATE users
                SET display_name = ?, email = ?, status = ?, updated_at = ?
                WHERE id = ? AND school_id = ? AND role = 'student'
                """,
                (row["display_name"], row["email"], row["status"], now, str(row["user_id"]), school_id),
            )
        return _student_with_account(con, student_id)


def assign_teacher_class(root: Path, *, school_id: str, teacher_id: str, class_id: str, subject: str | None = None) -> dict[str, Any]:
    init_platform_db(root)
    clean_subject = subject.strip() if subject else ""
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
        con.execute(
            """
            INSERT OR IGNORE INTO teacher_class_assignments (teacher_id, class_id, subject)
            VALUES (?, ?, ?)
            """,
            (teacher_id, class_id, clean_subject),
        )
    result = {"teacher_id": teacher_id, "class_id": class_id}
    if clean_subject:
        result["subject"] = clean_subject
    return result


def get_school(root: Path, *, school_id: str) -> dict[str, Any]:
    init_platform_db(root)
    return _fetch_required(root, "SELECT * FROM schools WHERE id = ?", (school_id,), "school not found")
