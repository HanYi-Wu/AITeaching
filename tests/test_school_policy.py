"""Tests for school AI policy and authoritative management queries (C05)."""

from __future__ import annotations

from pathlib import Path

import pytest

from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.importer import import_classes, import_students, import_teachers
from solaire.web.school.organization import create_school, get_school
from solaire.web.school.policy import (
    check_school_ai_allowed,
    get_school_ai_status,
    get_school_management_context,
    get_school_management_stats,
    update_school_ai_enabled,
)
from solaire.web.school.roster import assign_teacher_class


def test_school_ai_toggle_and_authoritative_status(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="Policy School")
    school_id = school["id"]

    # Initial state in DB is disabled (ai_enabled = 0)
    assert school["ai_enabled"] == 0

    # Toggle to enabled
    updated = update_school_ai_enabled(tmp_path, school_id=school_id, ai_enabled=True)
    assert updated["ai_enabled"] == 1
    assert get_school(tmp_path, school_id=school_id)["ai_enabled"] == 1

    # Toggle to disabled
    updated_off = update_school_ai_enabled(tmp_path, school_id=school_id, ai_enabled=False)
    assert updated_off["ai_enabled"] == 0
    assert get_school(tmp_path, school_id=school_id)["ai_enabled"] == 0

    # Missing school raises error
    with pytest.raises(ValueError, match="school not found"):
        update_school_ai_enabled(tmp_path, school_id="missing-id", ai_enabled=True)


def test_check_school_ai_allowed_policy_rules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="Policy Check School")
    school_id = school["id"]

    # 1. Missing admin LLM API key
    for key in ("SOLAIRE_LLM_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "user-ai"))

    with pytest.raises(ValueError, match="AI API is not configured by admin"):
        check_school_ai_allowed(tmp_path, school_id=school_id)

    # 2. Configure admin API key, but school AI is disabled
    monkeypatch.setenv("SOLAIRE_LLM_API_KEY", "sk-test-admin-key-12345")
    with pytest.raises(ValueError, match="School AI is disabled"):
        check_school_ai_allowed(tmp_path, school_id=school_id)

    # 3. Enable school AI -> now allowed
    update_school_ai_enabled(tmp_path, school_id=school_id, ai_enabled=True)
    allowed = check_school_ai_allowed(tmp_path, school_id=school_id)
    assert allowed["ai_available"] is True
    assert allowed["ai_enabled"] is True
    assert allowed["school"]["id"] == school_id

    # 4. Authoritative check: if school status is disabled directly in DB, runtime check immediately blocks
    with connect(tmp_path) as con:
        con.execute("UPDATE schools SET status = 'disabled' WHERE id = ?", (school_id,))

    with pytest.raises(ValueError, match="school is not active"):
        check_school_ai_allowed(tmp_path, school_id=school_id)


def test_school_management_stats_and_context(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="Management School")
    school_id = school["id"]

    # Seed data
    import_classes(tmp_path, school_id=school_id, classes=[{"name": "Class M1", "grade": "G10"}])
    import_teachers(
        tmp_path,
        school_id=school_id,
        teachers=[{"username": "teacher_m1", "display_name": "Teacher M1", "subjects": "Math"}],
    )
    import_students(
        tmp_path,
        school_id=school_id,
        students=[{"student_no": "SM001", "display_name": "Student M1", "class_name": "Class M1"}],
    )
    with connect(tmp_path) as con:
        t_id = con.execute("SELECT id FROM users WHERE username = 'teacher_m1'").fetchone()["id"]
        c_id = con.execute("SELECT id FROM classes WHERE name = 'Class M1'").fetchone()["id"]
    assign_teacher_class(tmp_path, school_id=school_id, teacher_id=str(t_id), class_id=str(c_id), subject="Math")

    # Query stats
    stats = get_school_management_stats(tmp_path, school_id=school_id)
    assert stats == {
        "teachers": 1,
        "classes": 1,
        "students": 1,
        "assignments": 1,
    }

    # Query context
    context = get_school_management_context(tmp_path, school_id=school_id)
    assert context["stats"] == stats
    assert len(context["teachers"]) == 1
    assert context["teachers"][0]["username"] == "teacher_m1"
    assert len(context["classes"]) == 1
    assert context["classes"][0]["name"] == "Class M1"
    assert len(context["students"]) == 1
    assert context["students"][0]["student_no"] == "SM001"
    assert len(context["assignments"]) == 1
    assert context["assignments"][0]["teacher_username"] == "teacher_m1"
    assert context["assignments"][0]["class_name"] == "Class M1"
