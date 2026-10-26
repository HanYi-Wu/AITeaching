"""Tests for roster and teaching assignments with stable identity (C03)."""

from __future__ import annotations

from pathlib import Path

import pytest

from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.accounts import create_teacher
from solaire.web.school.organization import create_class, create_school
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


def test_student_roster_identity_stability_on_rename(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="Roster School")
    klass = create_class(tmp_path, school_id=school["id"], name="Class R101")

    # Seed student with account and class membership
    with connect(tmp_path) as con:
        con.execute(
            """
            INSERT INTO users (id, school_id, role, username, password_hash, display_name, email, status, created_at, updated_at)
            VALUES ('u_stu_orig', ?, 'student', 'stu_orig_01', 'hash1', 'Original Name', 'orig@school.edu', 'active', '2026-01-01', '2026-01-01')
            """,
            (school["id"],),
        )
        con.execute(
            """
            INSERT INTO students (id, school_id, user_id, student_no, display_name, email, initial_password, status, created_at, updated_at)
            VALUES ('s_orig_01', ?, 'u_stu_orig', 'STU001', 'Original Name', 'orig@school.edu', 'initpass', 'active', '2026-01-01', '2026-01-01')
            """,
            (school["id"],),
        )
        con.execute(
            "INSERT INTO class_students (class_id, student_id) VALUES (?, 's_orig_01')",
            (klass["id"],),
        )

    # Verify initial list
    initial_students = list_students(tmp_path, school_id=school["id"], class_id=klass["id"])
    assert len(initial_students) == 1
    assert initial_students[0]["display_name"] == "Original Name"
    assert initial_students[0]["account_username"] == "stu_orig_01"
    assert initial_students[0]["class_names"] == "Class R101"

    # Rename student: changing display_name must NOT create a new identity
    updated = update_student(
        tmp_path,
        school_id=school["id"],
        student_id="s_orig_01",
        display_name="Renamed Student",
        email="renamed@school.edu",
    )
    assert updated["id"] == "s_orig_01"
    assert updated["user_id"] == "u_stu_orig"
    assert updated["student_no"] == "STU001"
    assert updated["display_name"] == "Renamed Student"
    assert updated["account_username"] == "stu_orig_01"

    # Check database: user and student IDs unchanged, class membership intact
    with connect(tmp_path) as con:
        student_count = con.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        user_count = con.execute("SELECT COUNT(*) FROM users WHERE role = 'student'").fetchone()[0]
        class_student_count = con.execute("SELECT COUNT(*) FROM class_students WHERE student_id = 's_orig_01'").fetchone()[0]
        user_row = con.execute("SELECT display_name, email FROM users WHERE id = 'u_stu_orig'").fetchone()

    assert student_count == 1
    assert user_count == 1
    assert class_student_count == 1
    assert user_row["display_name"] == "Renamed Student"
    assert user_row["email"] == "renamed@school.edu"


def test_teaching_assignment_idempotency_and_cross_school(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school_1 = create_school(tmp_path, name="Assign School 1")
    school_2 = create_school(tmp_path, name="Assign School 2")

    t1 = create_teacher(
        tmp_path,
        school_id=school_1["id"],
        username="teacher_t1",
        password="secret123",
        display_name="Teacher T1",
        subjects=["Math"],
    )
    c1 = create_class(tmp_path, school_id=school_1["id"], name="Class 1A")
    c2 = create_class(tmp_path, school_id=school_2["id"], name="Class 2A")

    # Cross-school assignment rejected: t1 belongs to school_1, c2 belongs to school_2
    with pytest.raises(ValueError, match="class not found"):
        assign_teacher_class(tmp_path, school_id=school_1["id"], teacher_id=t1["id"], class_id=c2["id"], subject="Math")

    with pytest.raises(ValueError, match="teacher not found"):
        assign_teacher_class(tmp_path, school_id=school_2["id"], teacher_id=t1["id"], class_id=c2["id"], subject="Math")

    # Initial assignment
    res1 = assign_teacher_class(tmp_path, school_id=school_1["id"], teacher_id=t1["id"], class_id=c1["id"], subject="Math")
    assert res1["teacher_id"] == t1["id"]
    assert res1["class_id"] == c1["id"]
    assert res1["subject"] == "Math"

    # Repeated assignment must be idempotent (no duplicate rows, no error)
    res2 = assign_teacher_class(tmp_path, school_id=school_1["id"], teacher_id=t1["id"], class_id=c1["id"], subject="Math")
    assert res2 == res1

    # Assignment without subject
    res_nosub = assign_teacher_class(tmp_path, school_id=school_1["id"], teacher_id=t1["id"], class_id=c1["id"])
    assert "subject" not in res_nosub

    # Repeated assignment without subject is also idempotent
    res_nosub2 = assign_teacher_class(tmp_path, school_id=school_1["id"], teacher_id=t1["id"], class_id=c1["id"])
    assert res_nosub2 == res_nosub

    # Verify assignments table count
    with connect(tmp_path) as con:
        total_assignments = con.execute("SELECT COUNT(*) FROM teacher_class_assignments").fetchone()[0]
    assert total_assignments == 2  # one with 'Math', one with ''

    # List assignments
    listed = list_teacher_class_assignments(tmp_path, school_id=school_1["id"])
    assert listed["total"] == 2
    assert listed["assignments"][0]["teacher_username"] == "teacher_t1"
    assert listed["assignments"][0]["class_name"] == "Class 1A"

    # Cross-school remove rejected
    with pytest.raises(ValueError, match="assignment not found"):
        remove_teacher_class_assignment(tmp_path, school_id=school_2["id"], teacher_id=t1["id"], class_id=c1["id"])

    # Legitimate removal of Math assignment
    rem_math = remove_teacher_class_assignment(
        tmp_path, school_id=school_1["id"], teacher_id=t1["id"], class_id=c1["id"], subject="Math"
    )
    assert rem_math["deleted"] == 1

    rem_nosub = remove_teacher_class_assignment(
        tmp_path, school_id=school_1["id"], teacher_id=t1["id"], class_id=c1["id"], subject=""
    )
    assert rem_nosub["deleted"] == 1

    assert list_teacher_class_assignments(tmp_path, school_id=school_1["id"])["total"] == 0
