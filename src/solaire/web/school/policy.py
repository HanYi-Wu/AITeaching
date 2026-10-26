"""School AI policy and administrative management query services."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.school.organization import get_school, query_classes
from solaire.web.school.roster import (
    list_teacher_class_assignments,
    query_students,
    query_teachers,
)


def update_school_ai_enabled(root: Path, *, school_id: str, ai_enabled: bool) -> dict[str, Any]:
    """Toggle the school-level AI enablement state in authoritative DB."""
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


def check_admin_ai_available(root: Path | None = None) -> bool:
    """Check whether platform admin has configured LLM credentials."""
    try:
        from solaire.agent_layer.llm.router import load_llm_settings
        from solaire.web import state

        target_root = root or state.get_root()
        settings = load_llm_settings(target_root)
        return bool(settings.api_key)
    except Exception:
        return False


def get_school_ai_status(
    root: Path,
    *,
    school_id: str,
    _ai_available: bool | None = None,
) -> dict[str, Any]:
    """Read authoritative school AI settings and availability from live DB."""
    school = get_school(root, school_id=school_id)
    ai_enabled = bool(int(school.get("ai_enabled") or 0))
    school_status = str(school.get("status") or "")
    if _ai_available is None:
        _ai_available = check_admin_ai_available(root)
    return {
        "school": school,
        "ai_available": _ai_available,
        "ai_enabled": ai_enabled,
        "school_active": school_status == "active",
    }


def check_school_ai_allowed(
    root: Path,
    *,
    school_id: str,
    _connection: sqlite3.Connection | None = None,
    _ai_available: bool | None = None,
) -> dict[str, Any]:
    """Authoritative runtime verification for AI invocation.

    Reads the latest authoritative school record from DB, ensuring old sessions
    or cached status cannot bypass an administrative or school AI shutdown.

    Raises:
        ValueError: "school not found" if school does not exist
        ValueError: "school is not active" if school is disabled
        ValueError: "AI API is not configured by admin" if platform AI is missing
        ValueError: "School AI is disabled" if school has disabled AI
    """
    if _connection is None:
        school = get_school(root, school_id=school_id)
    else:
        row = _connection.execute("SELECT * FROM schools WHERE id = ?", (school_id,)).fetchone()
        school = row_to_dict(row)
        if school is None:
            raise ValueError("school not found")
    if str(school.get("status") or "") != "active":
        raise ValueError("school is not active")
    if _ai_available is None:
        _ai_available = check_admin_ai_available(root)
    ai_available = _ai_available
    if not ai_available:
        raise ValueError("AI API is not configured by admin")
    ai_enabled = bool(int(school.get("ai_enabled") or 0))
    if not ai_enabled:
        raise ValueError("School AI is disabled")
    return {
        "school": school,
        "ai_available": ai_available,
        "ai_enabled": ai_enabled,
    }


def get_school_management_stats(root: Path, *, school_id: str) -> dict[str, int]:
    """Query authoritative real-time counts for school administrative dashboard."""
    teachers = query_teachers(root, school_id=school_id, page=1, page_size=1)
    classes = query_classes(root, school_id=school_id, page=1, page_size=1)
    students = query_students(root, school_id=school_id, page=1, page_size=1)
    assignments = list_teacher_class_assignments(root, school_id=school_id, page=1, page_size=1)
    return {
        "teachers": int(teachers.get("total") or 0),
        "classes": int(classes.get("total") or 0),
        "students": int(students.get("total") or 0),
        "assignments": int(assignments.get("total") or 0),
    }


def get_school_management_context(root: Path, *, school_id: str) -> dict[str, Any]:
    """Query authoritative school context for management tools and AI review."""
    stats = get_school_management_stats(root, school_id=school_id)
    teachers = query_teachers(root, school_id=school_id, page=1, page_size=50).get("teachers", [])
    classes = query_classes(root, school_id=school_id, page=1, page_size=50).get("classes", [])
    students = query_students(root, school_id=school_id, page=1, page_size=50).get("students", [])
    assignments = list_teacher_class_assignments(root, school_id=school_id, page=1, page_size=50).get("assignments", [])
    return {
        "stats": stats,
        "teachers": [
            {
                "username": item.get("username"),
                "display_name": item.get("display_name"),
                "subjects": item.get("subjects") or [],
                "status": item.get("status"),
            }
            for item in teachers
        ],
        "classes": [
            {
                "name": item.get("name"),
                "grade": item.get("grade"),
                "student_count": item.get("student_count") or 0,
                "teacher_count": item.get("teacher_count") or 0,
            }
            for item in classes
        ],
        "students": [
            {
                "student_no": item.get("student_no"),
                "display_name": item.get("display_name"),
                "account_username": item.get("account_username"),
                "class_names": item.get("class_names") or "",
                "status": item.get("status"),
            }
            for item in students
        ],
        "assignments": [
            {
                "teacher_username": item.get("teacher_username"),
                "teacher_name": item.get("teacher_name"),
                "class_name": item.get("class_name"),
                "class_grade": item.get("class_grade"),
                "teacher_status": item.get("teacher_status"),
                "subject": item.get("subject") or "",
            }
            for item in assignments
        ],
    }
