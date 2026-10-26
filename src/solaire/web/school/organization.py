"""School organization, class relations, and scope queries."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.school.common import (
    _contains_query,
    _fetch_required,
    _new_id,
    _page,
)


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


def get_school(root: Path, *, school_id: str) -> dict[str, Any]:
    init_platform_db(root)
    return _fetch_required(root, "SELECT * FROM schools WHERE id = ?", (school_id,), "school not found")


def create_class(
    root: Path,
    *,
    school_id: str,
    name: str,
    grade: str | None = None,
    subject_hint: str | None = None,
) -> dict[str, Any]:
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
