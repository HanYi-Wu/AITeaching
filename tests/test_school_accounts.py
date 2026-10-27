"""Tests for school account lifecycle, status, and password reset (C02)."""

from __future__ import annotations

from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

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
from solaire.web.school.organization import create_class, create_school


@pytest.mark.parametrize("kind", ["teacher", "student"])
def test_parallel_bulk_requests_report_only_one_status_transition(tmp_path: Path, kind):
    school = create_school(tmp_path, name="Concurrent School")
    if kind == "teacher":
        record = create_teacher(tmp_path, school_id=school["id"], username="parallel_teacher",
                                password="teacher123", display_name="Teacher", subjects=[])
        update = lambda: bulk_update_teachers(tmp_path, school_id=school["id"], teacher_ids=[record["id"]], status="disabled")
    else:
        with connect(tmp_path) as con:
            con.execute("""INSERT INTO students(id, school_id, student_no, display_name, status, created_at, updated_at)
                           VALUES ('parallel_student', ?, 'P001', 'Student', 'active', '2026-01-01', '2026-01-01')""", (school["id"],))
        update = lambda: bulk_update_students(tmp_path, school_id=school["id"], student_ids=["parallel_student"], status="disabled")
    barrier = Barrier(2)

    def disable(_index):
        barrier.wait(timeout=5)
        return update()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(disable, range(2)))
    assert [result["updated"] for result in results] == [1, 1]
    assert sorted(result["changed"] for result in results) == [0, 1]
    assert sorted(result["unchanged"] for result in results) == [0, 1]


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
    assert res_other == {
        "updated": 0,
        "changed": 0,
        "unchanged": 0,
        "not_found": 1,
        "changed_ids": [],
        "status": "disabled",
    }
    # Still active
    assert authenticate_user(tmp_path, "teacher_alpha", new_pw) is not None

    # Bulk disable within correct school
    res_own = bulk_update_teachers(tmp_path, school_id=school_1["id"], teacher_ids=[teacher["id"]], status="disabled")
    assert res_own == {
        "updated": 1,
        "changed": 1,
        "unchanged": 0,
        "not_found": 0,
        "changed_ids": [teacher["id"]],
        "status": "disabled",
    }
    # Disabled accounts cannot authenticate
    assert authenticate_user(tmp_path, "teacher_alpha", new_pw) is None
    repeated = bulk_update_teachers(
        tmp_path, school_id=school_1["id"], teacher_ids=[teacher["id"], teacher["id"]], status="disabled"
    )
    assert repeated == {
        "updated": 1,
        "changed": 0,
        "unchanged": 1,
        "not_found": 0,
        "changed_ids": [],
        "status": "disabled",
    }


def test_student_account_reset_and_boundary(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school_1 = create_school(tmp_path, name="School Gamma")
    school_2 = create_school(tmp_path, name="School Delta")
    klass = create_class(tmp_path, school_id=school_1["id"], name="Gamma Class")
    teacher = create_teacher(
        tmp_path,
        school_id=school_1["id"],
        username="teacher_gamma",
        password="teacher123",
        display_name="Teacher Gamma",
        subjects=["Math"],
    )

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
        con.execute("INSERT INTO class_students (class_id, student_id) VALUES (?, 's_gamma1')", (klass["id"],))
        con.execute(
            """
            INSERT INTO students (id, school_id, student_no, display_name, status, created_at, updated_at)
            VALUES ('s_delta1', ?, 'D001', 'Student Delta', 'active', '2026-01-01', '2026-01-01')
            """,
            (school_2["id"],),
        )
        con.execute(
            """
            INSERT INTO paper_records (id, exam_id, title, subject, owner_teacher_id, school_id, status, created_at, updated_at)
            VALUES ('paper_gamma', 'exam_gamma', 'Gamma Paper', 'Math', ?, ?, 'published', '2026-01-01', '2026-01-01')
            """,
            (teacher["id"], school_1["id"]),
        )
        con.execute(
            """
            INSERT INTO exam_publications (id, paper_id, teacher_id, title, status, created_at, updated_at)
            VALUES ('publication_gamma', 'paper_gamma', ?, 'Gamma Paper', 'published', '2026-01-01', '2026-01-01')
            """,
            (teacher["id"],),
        )
        con.execute(
            """
            INSERT INTO student_attempts (id, publication_id, student_id, status, score, max_score)
            VALUES ('attempt_gamma', 'publication_gamma', 's_gamma1', 'submitted', 90, 100)
            """
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
    assert bulk_other == {
        "updated": 0,
        "changed": 0,
        "unchanged": 0,
        "not_found": 1,
        "changed_ids": [],
        "status": "disabled",
    }

    # Bulk disable within correct school updates both student and user
    bulk_own = bulk_update_students(tmp_path, school_id=school_1["id"], student_ids=["s_gamma1"], status="disabled")
    assert bulk_own == {
        "updated": 1,
        "changed": 1,
        "unchanged": 0,
        "not_found": 0,
        "changed_ids": ["s_gamma1"],
        "status": "disabled",
    }
    assert authenticate_user(tmp_path, "stu_gamma_1", new_pwd) is None
    repeated = bulk_update_students(
        tmp_path,
        school_id=school_1["id"],
        student_ids=["s_gamma1", "s_gamma1", "s_delta1", "missing_student"],
        status="disabled",
    )
    assert repeated == {
        "updated": 1,
        "changed": 0,
        "unchanged": 1,
        "not_found": 2,
        "changed_ids": [],
        "status": "disabled",
    }

    restored = bulk_update_students(tmp_path, school_id=school_1["id"], student_ids=["s_gamma1"], status="active")
    assert restored == {
        "updated": 1,
        "changed": 1,
        "unchanged": 0,
        "not_found": 0,
        "changed_ids": ["s_gamma1"],
        "status": "active",
    }
    assert authenticate_user(tmp_path, "stu_gamma_1", new_pwd) is not None
    with connect(tmp_path) as con:
        student = con.execute("SELECT id, user_id, status FROM students WHERE id = 's_gamma1'").fetchone()
        user = con.execute("SELECT id, status FROM users WHERE id = 'u_stu1'").fetchone()
        class_links = con.execute("SELECT class_id FROM class_students WHERE student_id = 's_gamma1'").fetchall()
        attempt = con.execute(
            "SELECT id, student_id, score, max_score FROM student_attempts WHERE id = 'attempt_gamma'"
        ).fetchone()
        other_student = con.execute("SELECT status FROM students WHERE id = 's_delta1'").fetchone()
    assert dict(student) == {"id": "s_gamma1", "user_id": "u_stu1", "status": "active"}
    assert dict(user) == {"id": "u_stu1", "status": "active"}
    assert [row["class_id"] for row in class_links] == [klass["id"]]
    assert dict(attempt) == {"id": "attempt_gamma", "student_id": "s_gamma1", "score": 90.0, "max_score": 100.0}
    assert other_student["status"] == "active"


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
