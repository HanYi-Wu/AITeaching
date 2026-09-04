"""School, teacher, class, and student management services."""

from __future__ import annotations

import secrets
import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import hash_password, utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict

MAX_PAGE_SIZE = 100
VALID_ACCOUNT_STATUSES = {"active", "disabled"}


def _new_id() -> str:
    return uuid.uuid4().hex


def _new_student_password() -> str:
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    return "".join(secrets.choice(alphabet) for _ in range(10))


def _new_student_username(con, school_id: str) -> str:
    """Generate a platform login username, not an exam taker number."""
    for _ in range(20):
        candidate = f"s{secrets.randbelow(90_000_000) + 10_000_000}"
        row = con.execute("SELECT 1 FROM users WHERE username = ?", (candidate,)).fetchone()
        if row is None:
            return candidate
    return f"stu_{school_id[:4]}_{uuid.uuid4().hex}"


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "none" else text


def _fetch_required(root: Path, sql: str, params: tuple[object, ...], message: str) -> dict[str, Any]:
    with connect(root) as con:
        row = con.execute(sql, params).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise ValueError(message)
    return data


def _page(items: list[dict[str, Any]], *, page: int = 1, page_size: int = 10) -> dict[str, Any]:
    clean_page = max(1, int(page or 1))
    clean_page_size = max(1, min(MAX_PAGE_SIZE, int(page_size or 10)))
    total = len(items)
    total_pages = max(1, (total + clean_page_size - 1) // clean_page_size)
    if clean_page > total_pages:
        clean_page = total_pages
    start = (clean_page - 1) * clean_page_size
    return {
        "items": items[start : start + clean_page_size],
        "total": total,
        "page": clean_page,
        "page_size": clean_page_size,
        "total_pages": total_pages,
    }


def _contains_query(item: dict[str, Any], query: str, fields: list[str]) -> bool:
    needle = query.strip().lower()
    if not needle:
        return True
    values: list[str] = []
    for field in fields:
        value = item.get(field)
        if isinstance(value, list):
            values.extend(str(part) for part in value)
        elif value is not None:
            values.append(str(value))
    return needle in " ".join(values).lower()


def _clean_status(status: str) -> str:
    clean = status.strip() or "active"
    if clean not in VALID_ACCOUNT_STATUSES:
        raise ValueError("status must be active or disabled")
    return clean


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
        rows = con.execute(
            """
            SELECT s.*,
                   (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role = 'school') AS school_user_count
            FROM schools s
            ORDER BY s.created_at DESC
            """
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def query_schools(
    root: Path,
    *,
    q: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    schools = list_schools(root)
    if status and status != "all":
        schools = [school for school in schools if str(school.get("status") or "") == status]
    if q:
        schools = [
            school
            for school in schools
            if _contains_query(school, q, ["name", "status", "created_at", "updated_at"])
        ]
    result = _page(schools, page=page, page_size=page_size)
    return {"schools": result.pop("items"), **result}


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
              id, school_id, role, username, password_hash, display_name, email, status, created_at, updated_at
            )
            VALUES (?, ?, 'teacher', ?, ?, ?, ?, 'active', ?, ?)
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


def query_teachers(
    root: Path,
    *,
    school_id: str,
    q: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    teachers = list_teachers(root, school_id=school_id)
    if status and status != "all":
        teachers = [teacher for teacher in teachers if str(teacher.get("status") or "") == status]
    if q:
        teachers = [
            teacher
            for teacher in teachers
            if _contains_query(teacher, q, ["username", "display_name", "email", "status", "subjects"])
        ]
    result = _page(teachers, page=page, page_size=page_size)
    return {"teachers": result.pop("items"), **result}


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
            SET password_hash = ?, status = 'active', updated_at = ?
            WHERE id = ? AND school_id = ? AND role = 'teacher'
            """,
            (hash_password(new_password), now, teacher_id, school_id),
        )
    teacher = update_teacher(root, school_id=school_id, teacher_id=teacher_id)
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


def query_classes(
    root: Path,
    *,
    school_id: str,
    q: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    classes = list_classes(root, school_id=school_id)
    if classes:
        ids = [str(klass["id"]) for klass in classes]
        placeholders = ",".join("?" for _ in ids)
        with connect(root) as con:
            student_rows = con.execute(
                f"""
                SELECT class_id, COUNT(*) AS n
                FROM class_students
                WHERE class_id IN ({placeholders})
                GROUP BY class_id
                """,
                tuple(ids),
            ).fetchall()
            teacher_rows = con.execute(
                f"""
                SELECT class_id, COUNT(DISTINCT teacher_id) AS n
                FROM teacher_class_assignments
                WHERE class_id IN ({placeholders})
                GROUP BY class_id
                """,
                tuple(ids),
            ).fetchall()
        students_by_class = {str(row["class_id"]): int(row["n"]) for row in student_rows}
        teachers_by_class = {str(row["class_id"]): int(row["n"]) for row in teacher_rows}
        for klass in classes:
            class_id = str(klass["id"])
            klass["student_count"] = students_by_class.get(class_id, 0)
            klass["teacher_count"] = teachers_by_class.get(class_id, 0)
    if q:
        classes = [klass for klass in classes if _contains_query(klass, q, ["name", "grade", "student_count", "teacher_count"])]
    result = _page(classes, page=page, page_size=page_size)
    return {"classes": result.pop("items"), **result}


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


def delete_class(root: Path, *, school_id: str, class_id: str) -> dict[str, Any]:
    init_platform_db(root)
    with connect(root) as con:
        existing = con.execute(
            "SELECT 1 FROM classes WHERE id = ? AND school_id = ?",
            (class_id, school_id),
        ).fetchone()
        if existing is None:
            raise ValueError("class not found")
        con.execute("DELETE FROM classes WHERE id = ? AND school_id = ?", (class_id, school_id))
    return {"deleted": True, "class_id": class_id}


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


def query_students(
    root: Path,
    *,
    school_id: str,
    class_id: str | None = None,
    q: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    students = list_students(root, school_id=school_id, class_id=class_id)
    if status and status != "all":
        students = [student for student in students if str(student.get("status") or "") == status]
    if q:
        students = [
            student
            for student in students
            if _contains_query(
                student,
                q,
                ["student_no", "display_name", "email", "account_username", "class_names", "status"],
            )
        ]
    result = _page(students, page=page, page_size=page_size)
    return {"students": result.pop("items"), **result}


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


def list_teacher_class_assignments(
    root: Path,
    *,
    school_id: str,
    q: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT
              tca.teacher_id,
              tca.class_id,
              tca.subject,
              u.username AS teacher_username,
              u.display_name AS teacher_name,
              u.status AS teacher_status,
              c.name AS class_name,
              c.grade AS class_grade
            FROM teacher_class_assignments tca
            JOIN users u ON u.id = tca.teacher_id
            JOIN classes c ON c.id = tca.class_id
            WHERE u.school_id = ? AND c.school_id = ?
            ORDER BY u.display_name, c.grade, c.name, tca.subject
            """,
            (school_id, school_id),
        ).fetchall()
    assignments = [row_to_dict(row) or {} for row in rows]
    if q:
        assignments = [
            assignment
            for assignment in assignments
            if _contains_query(
                assignment,
                q,
                ["teacher_username", "teacher_name", "teacher_status", "class_name", "class_grade", "subject"],
            )
        ]
    result = _page(assignments, page=page, page_size=page_size)
    return {"assignments": result.pop("items"), **result}


def remove_teacher_class_assignment(
    root: Path,
    *,
    school_id: str,
    teacher_id: str,
    class_id: str,
    subject: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    clean_subject = subject.strip() if subject else ""
    with connect(root) as con:
        teacher = con.execute(
            "SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher'",
            (teacher_id, school_id),
        ).fetchone()
        klass = con.execute(
            "SELECT 1 FROM classes WHERE id = ? AND school_id = ?",
            (class_id, school_id),
        ).fetchone()
        if teacher is None or klass is None:
            raise ValueError("assignment not found")
        cur = con.execute(
            """
            DELETE FROM teacher_class_assignments
            WHERE teacher_id = ? AND class_id = ? AND subject = ?
            """,
            (teacher_id, class_id, clean_subject),
        )
    return {"deleted": int(cur.rowcount if cur.rowcount is not None else 0)}


def get_school(root: Path, *, school_id: str) -> dict[str, Any]:
    init_platform_db(root)
    return _fetch_required(root, "SELECT * FROM schools WHERE id = ?", (school_id,), "school not found")


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
