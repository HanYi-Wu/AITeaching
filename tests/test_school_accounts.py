"""Tests for school account lifecycle, status, and password reset (C02)."""

from __future__ import annotations

from pathlib import Path

import pytest

from solaire.web.auth_service import authenticate_user
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.accounts import (
    bulk_update_students,
    bulk_update_teachers,
    create_school_user,
    create_teacher,
    create_user,
    reset_student_password,
    reset_teacher_password,
    update_teacher,
)
from solaire.web.school.organization import create_school


def test_teacher_account_lifecycle_and_school_boundary(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school_1 = create_school(tmp_path, name="School Alpha")
    school_2 = create_school(tmp_path, name="School Beta")

    # Short username rejected
    with pytest.raises(ValueError, match="username must be at least 3 characters"):
        create_teacher(
            tmp_path,
            school_id=school_1["id"],
            username="t1",
            password="teacher123",
            display_name="Teacher One",
            subjects=["Math"],
        )

    # Valid teacher creation
    teacher = create_teacher(
        tmp_path,
        school_id=school_1["id"],
        username="teacher_alpha",
        password="teacher123",
        display_name="Teacher Alpha",
        subjects=["Math", "Physics"],
    )
    assert teacher["username"] == "teacher_alpha"
    assert teacher["subjects"] == ["Math", "Physics"]
    assert "password_hash" not in teacher

    # Authentication succeeds
    auth = authenticate_user(tmp_path, "teacher_alpha", "teacher123")
    assert auth is not None
    assert auth["must_change_password"] is True

    # Cross-school update rejected
    with pytest.raises(ValueError, match="teacher not found"):
        update_teacher(
            tmp_path,
            school_id=school_2["id"],
            teacher_id=teacher["id"],
            display_name="Hacked Teacher",
        )

    # Legitimate update with subject replacement in single transaction
    updated = update_teacher(
        tmp_path,
        school_id=school_1["id"],
        teacher_id=teacher["id"],
        display_name="Teacher Alpha Updated",
        subjects=["Chemistry"],
    )
    assert updated["display_name"] == "Teacher Alpha Updated"
    assert updated["subjects"] == ["Chemistry"]

    # Cross-school password reset rejected
    with pytest.raises(ValueError, match="teacher not found"):
        reset_teacher_password(tmp_path, school_id=school_2["id"], teacher_id=teacher["id"])

    # Legitimate reset sets must_change_password and status active
    reset_res = reset_teacher_password(tmp_path, school_id=school_1["id"], teacher_id=teacher["id"])
    new_pw = reset_res["password"]
    assert len(new_pw) >= 8
    assert authenticate_user(tmp_path, "teacher_alpha", "teacher123") is None
    authed_reset = authenticate_user(tmp_path, "teacher_alpha", new_pw)
    assert authed_reset is not None
    assert authed_reset["must_change_password"] is True

    # Bulk status toggle across school boundary
    res_other = bulk_update_teachers(tmp_path, school_id=school_2["id"], teacher_ids=[teacher["id"]], status="disabled")
    assert res_other["updated"] == 0
    # Still active
    assert authenticate_user(tmp_path, "teacher_alpha", new_pw) is not None

    # Bulk disable within correct school
    res_own = bulk_update_teachers(tmp_path, school_id=school_1["id"], teacher_ids=[teacher["id"]], status="disabled")
    assert res_own["updated"] == 1
    # Disabled accounts cannot authenticate
    assert authenticate_user(tmp_path, "teacher_alpha", new_pw) is None


def test_student_account_reset_and_boundary(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school_1 = create_school(tmp_path, name="School Gamma")
    school_2 = create_school(tmp_path, name="School Delta")

    # Seed student in school 1
    with connect(tmp_path) as con:
        con.execute(
            """
            INSERT INTO users (id, school_id, role, username, password_hash, display_name, status, must_change_password, created_at, updated_at)
            VALUES ('u_stu1', ?, 'student', 'stu_gamma_1', 'dummyhash', 'Student Gamma', 'active', 1, '2026-01-01', '2026-01-01')
            """,
            (school_1["id"],),
        )
        con.execute(
            """
            INSERT INTO students (id, school_id, user_id, student_no, display_name, initial_password, status, created_at, updated_at)
            VALUES ('s_gamma1', ?, 'u_stu1', 'G001', 'Student Gamma', 'oldpwd', 'active', '2026-01-01', '2026-01-01')
            """,
            (school_1["id"],),
        )

    # Cross-school student reset rejected
    with pytest.raises(ValueError, match="student not found"):
        reset_student_password(tmp_path, school_id=school_2["id"], student_id="s_gamma1")

    # Legitimate reset
    reset_res = reset_student_password(tmp_path, school_id=school_1["id"], student_id="s_gamma1")
    new_pwd = reset_res["password"]
    assert authenticate_user(tmp_path, "stu_gamma_1", new_pwd) is not None

    # Bulk status update across school boundary has no effect
    bulk_other = bulk_update_students(tmp_path, school_id=school_2["id"], student_ids=["s_gamma1"], status="disabled")
    assert bulk_other["updated"] == 0

    # Bulk disable within correct school updates both student and user
    bulk_own = bulk_update_students(tmp_path, school_id=school_1["id"], student_ids=["s_gamma1"], status="disabled")
    assert bulk_own["updated"] == 1
    assert authenticate_user(tmp_path, "stu_gamma_1", new_pwd) is None


def test_create_user_and_school_user(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="User School")

    user = create_school_user(
        tmp_path,
        school_id=school["id"],
        username="school_admin_test",
        password="password123",
        display_name="School Admin",
    )
    assert user["role"] == "school"
    assert user["username"] == "school_admin_test"
    assert "password_hash" not in user

    # Cross school verification: invalid school_id rejected
    with pytest.raises(ValueError, match="school not found"):
        create_user(
            tmp_path,
            role="school",
            username="bad_school_user",
            password="password123",
            display_name="Bad School User",
            school_id="non-existent",
        )
