"""Tests for school organization, class relations, and scope queries (C01)."""

from __future__ import annotations

from pathlib import Path

import pytest

from solaire.web.platform_db import connect, init_platform_db
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


def test_school_lifecycle_and_scope_query(tmp_path: Path) -> None:
    init_platform_db(tmp_path)

    school_a = create_school(tmp_path, name="First High School")
    school_b = create_school(tmp_path, name="Second Experimental School")
    assert school_a["name"] == "First High School"
    assert school_a["status"] == "active"
    assert school_a["ai_enabled"] == 0

    with pytest.raises(ValueError, match="school name is required"):
        create_school(tmp_path, name="   ")

    listed = list_schools(tmp_path)
    assert len(listed) == 2
    assert {s["name"] for s in listed} == {"First High School", "Second Experimental School"}

    got_a = get_school(tmp_path, school_id=school_a["id"])
    assert got_a["id"] == school_a["id"]

    with pytest.raises(ValueError, match="school not found"):
        get_school(tmp_path, school_id="non-existent-id")

    query_res = query_schools(tmp_path, q="First", page=1, page_size=10)
    assert query_res["total"] == 1
    assert query_res["schools"][0]["name"] == "First High School"

    paged = query_schools(tmp_path, page=1, page_size=1)
    assert paged["total"] == 2
    assert paged["total_pages"] == 2
    assert len(paged["schools"]) == 1


def test_class_lifecycle_and_cross_school_boundary(tmp_path: Path) -> None:
    init_platform_db(tmp_path)

    school_1 = create_school(tmp_path, name="School One")
    school_2 = create_school(tmp_path, name="School Two")

    class_1 = create_class(tmp_path, school_id=school_1["id"], name="Class 101", grade="G10")
    class_2 = create_class(tmp_path, school_id=school_2["id"], name="Class 201", grade="G10")

    # Empty name rejected
    with pytest.raises(ValueError, match="class name is required"):
        create_class(tmp_path, school_id=school_1["id"], name="  ")

    # Inactive/non-existent school rejected
    with pytest.raises(ValueError, match="school not found"):
        create_class(tmp_path, school_id="missing-school", name="Invalid Class")

    # School 1 list does not include School 2's class
    classes_s1 = list_classes(tmp_path, school_id=school_1["id"])
    assert len(classes_s1) == 1
    assert classes_s1[0]["id"] == class_1["id"]

    # Class counts and query
    with connect(tmp_path) as con:
        # Mock student and teacher assignment
        con.execute(
            "INSERT INTO students (id, school_id, student_no, display_name, status, created_at, updated_at) "
            "VALUES ('s1', ?, 'S001', 'Student 1', 'active', '2026-01-01', '2026-01-01')",
            (school_1["id"],),
        )
        con.execute("INSERT INTO class_students (class_id, student_id) VALUES (?, 's1')", (class_1["id"],))

    q_res = query_classes(tmp_path, school_id=school_1["id"], q="101")
    assert q_res["total"] == 1
    assert q_res["classes"][0]["student_count"] == 1
    assert q_res["classes"][0]["teacher_count"] == 0

    # Cross-school update rejected
    with pytest.raises(ValueError, match="class not found"):
        update_class(tmp_path, school_id=school_2["id"], class_id=class_1["id"], name="Hijacked Name")

    # Valid update
    updated = update_class(tmp_path, school_id=school_1["id"], class_id=class_1["id"], name="Class 101-Honors", grade="G10-H")
    assert updated["name"] == "Class 101-Honors"
    assert updated["grade"] == "G10-H"

    # Cross-school delete rejected
    with pytest.raises(ValueError, match="class not found"):
        delete_class(tmp_path, school_id=school_2["id"], class_id=class_1["id"])

    # Valid delete
    deleted = delete_class(tmp_path, school_id=school_1["id"], class_id=class_1["id"])
    assert deleted["deleted"] is True
    assert len(list_classes(tmp_path, school_id=school_1["id"])) == 0
