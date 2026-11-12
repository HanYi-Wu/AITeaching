"""Roster management and teaching assignment services."""

from __future__ import annotations

from contextlib import closing
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.school.common import (
    _clean_status,
    _contains_query,
    _fetch_sql_page,
    _new_id,
    _page,
    _register_school_query_functions,
    _sql_search_clause,
    _student_with_account,
)


def set_teacher_subjects(root: Path, *, teacher_id: str, school_id: str, subjects: list[str]) -> list[str]:
    init_platform_db(root)
    clean_subjects = sorted({subject.strip() for subject in subjects if subject.strip()})
    with closing(connect(root)) as con, con:
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


def list_teachers(root: Path, *, school_id: str) -> list[dict[str, Any]]:
    init_platform_db(root)
    with closing(connect(root)) as con, con:
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
    teachers = list_filtered_teachers(root, school_id=school_id, q=q, status=status)
    result = _page(teachers, page=page, page_size=page_size)
    return {"teachers": result.pop("items"), **result}


def list_filtered_teachers(
    root: Path,
    *,
    school_id: str,
    q: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    """Return the complete teacher list matching the optional filters."""
    teachers = list_teachers(root, school_id=school_id)
    if status and status != "all":
        teachers = [teacher for teacher in teachers if str(teacher.get("status") or "") == status]
    if q:
        teachers = [
            teacher
            for teacher in teachers
            if _contains_query(teacher, q, ["username", "display_name", "email", "status", "subjects"])
        ]
    return teachers


def list_students(root: Path, *, school_id: str, class_id: str | None = None) -> list[dict[str, Any]]:
    init_platform_db(root)
    params: list[object] = [school_id]
    class_join = ""
    class_where = ""
    if class_id:
        class_join = "JOIN class_students cs_filter ON cs_filter.student_id = s.id"
        class_where = "AND cs_filter.class_id = ?"
        params.append(class_id)
    with closing(connect(root)) as con, con:
        rows = con.execute(
            f"""
            SELECT
              s.*,
              u.username AS account_username,
              GROUP_CONCAT(c.name, ', ') AS class_names,
              COUNT(c.id) AS class_count
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
    init_platform_db(root)
    params: list[object] = [school_id, school_id]
    class_filter = ""
    if class_id:
        class_filter = "AND EXISTS (SELECT 1 FROM class_students cs_filter WHERE cs_filter.student_id = s.id AND cs_filter.class_id = ?)"
        params.append(class_id)
    filters = ""
    filter_params: list[object] = []
    if status and status != "all":
        filters += " AND status = ?"
        filter_params.append(status)
    search, search_params = _sql_search_clause(
        q, "student_no, display_name, email, account_username, class_names, status"
    )
    filters += search
    filter_params.extend(search_params)
    student_ctes = f"""
        class_names AS (
            SELECT cs.student_id, GROUP_CONCAT(c.name, ', ') AS class_names,
                   COUNT(c.id) AS class_count
            FROM class_students cs
            JOIN students scoped_students ON scoped_students.id = cs.student_id AND scoped_students.school_id = ?
            JOIN classes c ON c.id = cs.class_id
            GROUP BY cs.student_id
        ),
        student_rows AS (
            SELECT s.*, u.username AS account_username, class_names.class_names,
                   COALESCE(class_names.class_count, 0) AS class_count
            FROM students s
            LEFT JOIN users u ON u.id = s.user_id
            LEFT JOIN class_names ON class_names.student_id = s.id
            WHERE s.school_id = ? {class_filter}
        )
    """
    query_params = (*params, *filter_params)
    with closing(connect(root)) as con, con:
        _register_school_query_functions(con)
        students, total, clean_page, clean_page_size, total_pages = _fetch_sql_page(
            con,
            ctes=student_ctes,
            rows_sql=f"SELECT * FROM student_rows WHERE 1 = 1{filters}",
            params=query_params,
            order_by="created_at DESC",
            identity_column="id",
            page=page,
            page_size=page_size,
        )
    return {
        "students": students,
        "total": total,
        "page": clean_page,
        "page_size": clean_page_size,
        "total_pages": total_pages,
    }


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
        params.append(_clean_status(status))
    params.extend([student_id, school_id])
    with closing(connect(root)) as con, con:
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


def assign_teacher_class(
    root: Path,
    *,
    school_id: str,
    teacher_id: str,
    class_id: str,
    subject: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    clean_subject = subject.strip() if subject else ""
    with closing(connect(root)) as con, con:
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


def list_teacher_class_assignments(
    root: Path,
    *,
    school_id: str,
    q: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    init_platform_db(root)
    search, search_params = _sql_search_clause(
        q, "teacher_username, teacher_name, teacher_status, class_name, class_grade, subject"
    )
    assignment_ctes = """
        assignment_rows AS (
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
        )
    """
    params = (school_id, school_id, *search_params)
    with closing(connect(root)) as con, con:
        _register_school_query_functions(con)
        assignments, total, clean_page, clean_page_size, total_pages = _fetch_sql_page(
            con,
            ctes=assignment_ctes,
            rows_sql=f"SELECT * FROM assignment_rows WHERE 1 = 1{search}",
            params=params,
            order_by="teacher_name, class_grade, class_name, subject",
            identity_column="teacher_id",
            page=page,
            page_size=page_size,
        )
    return {
        "assignments": assignments,
        "total": total,
        "page": clean_page,
        "page_size": clean_page_size,
        "total_pages": total_pages,
    }


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
    with closing(connect(root)) as con, con:
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
