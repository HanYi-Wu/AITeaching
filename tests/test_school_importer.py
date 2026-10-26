"""Tests for import normalization, row validation, and transaction management (C04)."""

from __future__ import annotations

from pathlib import Path

import pytest

from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.importer import (
    import_classes,
    import_students,
    import_teacher_class_assignments,
    import_teachers,
)
from solaire.web.school.organization import create_class, create_school


def test_normal_and_repeat_import_idempotency(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="Import School")
    school_id = school["id"]

    # 1. Normal import of classes
    res_classes = import_classes(
        tmp_path,
        school_id=school_id,
        classes=[
            {"name": "Class 101", "grade": "G10"},
            {"name": "Class 102", "grade": "G10"},
        ],
    )
    assert res_classes["imported"] == 2
    assert len(res_classes["classes"]) == 2

    # Repeat import updates grade without duplicating
    res_classes_repeat = import_classes(
        tmp_path,
        school_id=school_id,
        classes=[
            {"name": "Class 101", "grade": "G10-Updated"},
            {"name": "Class 102", "grade": "G10"},
        ],
    )
    assert res_classes_repeat["imported"] == 2
    with connect(tmp_path) as con:
        total_classes = con.execute("SELECT COUNT(*) FROM classes WHERE school_id = ?", (school_id,)).fetchone()[0]
        c101 = con.execute("SELECT grade FROM classes WHERE school_id = ? AND name = 'Class 101'", (school_id,)).fetchone()
    assert total_classes == 2
    assert c101["grade"] == "G10-Updated"

    # 2. Normal import of teachers
    res_teachers = import_teachers(
        tmp_path,
        school_id=school_id,
        teachers=[
            {"username": "teacher_t1", "display_name": "Teacher One", "password": "password123", "subjects": "Math,Physics"},
        ],
    )
    assert res_teachers["imported"] == 1
    t1 = res_teachers["teachers"][0]
    assert t1["subjects"] == ["Math", "Physics"]

    # Repeat import updates display_name and subjects without duplicating
    res_teachers_repeat = import_teachers(
        tmp_path,
        school_id=school_id,
        teachers=[
            {"username": "teacher_t1", "display_name": "Teacher One Updated", "subjects": "Chemistry"},
        ],
    )
    assert res_teachers_repeat["imported"] == 1
    with connect(tmp_path) as con:
        total_teachers = con.execute("SELECT COUNT(*) FROM users WHERE school_id = ? AND role = 'teacher'", (school_id,)).fetchone()[0]
    assert total_teachers == 1
    assert res_teachers_repeat["teachers"][0]["display_name"] == "Teacher One Updated"
    assert res_teachers_repeat["teachers"][0]["subjects"] == ["Chemistry"]

    # 3. Normal import of students
    res_students = import_students(
        tmp_path,
        school_id=school_id,
        students=[
            {"student_no": "S100", "display_name": "Student 100", "class_name": "Class 101"},
        ],
    )
    assert res_students["imported"] == 1
    s1 = res_students["students"][0]
    assert s1["student_no"] == "S100"
    orig_user_id = s1["user_id"]
    orig_pwd = s1["initial_password"]

    # Repeat student import updates info, retains stable user_id and initial_password
    res_students_repeat = import_students(
        tmp_path,
        school_id=school_id,
        students=[
            {"student_no": "S100", "display_name": "Student 100 Updated", "email": "s100@school.edu"},
        ],
    )
    assert res_students_repeat["imported"] == 1
    s1_repeat = res_students_repeat["students"][0]
    assert s1_repeat["user_id"] == orig_user_id
    assert s1_repeat["initial_password"] == orig_pwd
    assert s1_repeat["display_name"] == "Student 100 Updated"
    with connect(tmp_path) as con:
        total_students = con.execute("SELECT COUNT(*) FROM students WHERE school_id = ?", (school_id,)).fetchone()[0]
    assert total_students == 1

    # 4. Normal import of assignments
    res_assign = import_teacher_class_assignments(
        tmp_path,
        school_id=school_id,
        assignments=[
            {"teacher_username": "teacher_t1", "class_name": "Class 101", "subject": "Chemistry"},
        ],
    )
    assert res_assign["imported"] == 1
    # Repeat assignment is idempotent
    res_assign_repeat = import_teacher_class_assignments(
        tmp_path,
        school_id=school_id,
        assignments=[
            {"teacher_username": "teacher_t1", "class_name": "Class 101", "subject": "Chemistry"},
        ],
    )
    assert res_assign_repeat["imported"] == 1
    with connect(tmp_path) as con:
        total_assignments = con.execute("SELECT COUNT(*) FROM teacher_class_assignments").fetchone()[0]
    assert total_assignments == 1


def test_same_name_students_different_ids(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="Same Name School")
    school_id = school["id"]

    # Two students with same display_name "Zhang San", but different student_no
    res = import_students(
        tmp_path,
        school_id=school_id,
        students=[
            {"student_no": "NO_001", "display_name": "Zhang San"},
            {"student_no": "NO_002", "display_name": "Zhang San"},
        ],
    )
    assert res["imported"] == 2
    stu1, stu2 = res["students"][0], res["students"][1]
    assert stu1["id"] != stu2["id"]
    assert stu1["user_id"] != stu2["user_id"]
    assert stu1["student_no"] == "NO_001"
    assert stu2["student_no"] == "NO_002"
    assert stu1["account_username"] != stu2["account_username"]


def test_cross_school_targets_and_row_error_location(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school_a = create_school(tmp_path, name="School A")
    school_b = create_school(tmp_path, name="School B")

    class_b = create_class(tmp_path, school_id=school_b["id"], name="Class B Only")

    # 1. Row error locating row index and field on missing username
    with pytest.raises(ValueError) as excinfo:
        import_teachers(
            tmp_path,
            school_id=school_a["id"],
            teachers=[
                {"username": "valid_user", "display_name": "Valid"},
                {"username": "", "display_name": "Invalid User"},
            ],
        )
    assert "Row 2 (username): teacher username is required" in str(excinfo.value)

    # Row error on short password
    with pytest.raises(ValueError) as excinfo_pwd:
        import_teachers(
            tmp_path,
            school_id=school_a["id"],
            teachers=[
                {"username": "valid_user2", "display_name": "Valid", "password": "123"},
            ],
        )
    assert "Row 1 (password): password must be at least 6 characters" in str(excinfo_pwd.value)

    # 2. Row error on missing student_no
    with pytest.raises(ValueError) as excinfo:
        import_students(
            tmp_path,
            school_id=school_a["id"],
            students=[
                {"student_no": "S1", "display_name": "Student 1"},
                {"student_no": "", "display_name": "Missing No"},
            ],
        )
    assert "Row 2 (student_no): student_no and display_name are required" in str(excinfo.value)

    # 3. Cross-school target: student import targeting Class B Only from School A
    with pytest.raises(ValueError) as excinfo:
        import_students(
            tmp_path,
            school_id=school_a["id"],
            students=[
                {"student_no": "S1", "display_name": "Student 1", "class_name": class_b["name"]},
            ],
        )
    assert "Row 1 (class_name): class not found: Class B Only" in str(excinfo.value)

    # 4. Cross-school target: assignment targeting class from School B
    import_teachers(
        tmp_path,
        school_id=school_a["id"],
        teachers=[{"username": "teacher_a", "display_name": "Teacher A"}],
    )
    with pytest.raises(ValueError) as excinfo:
        import_teacher_class_assignments(
            tmp_path,
            school_id=school_a["id"],
            assignments=[
                {"teacher_username": "teacher_a", "class_name": class_b["name"], "subject": "Math"},
            ],
        )
    assert "Row 1 (class): class not found: Class B Only" in str(excinfo.value)


def test_batch_transaction_atomicity_no_half_accounts(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    school = create_school(tmp_path, name="Atomicity School")
    school_id = school["id"]

    # Student batch: Row 1 is valid, Row 2 targets a non-existent class
    with pytest.raises(ValueError, match="Row 2"):
        import_students(
            tmp_path,
            school_id=school_id,
            students=[
                {"student_no": "STU_VAL_1", "display_name": "Valid Student"},
                {"student_no": "STU_VAL_2", "display_name": "Invalid Student", "class_name": "NonExistentClass"},
            ],
        )

    # Entire batch must be rolled back: NO student row and NO half user account created!
    with connect(tmp_path) as con:
        students = con.execute("SELECT * FROM students WHERE school_id = ?", (school_id,)).fetchall()
        users = con.execute("SELECT * FROM users WHERE school_id = ? AND role = 'student'", (school_id,)).fetchall()
    assert len(students) == 0
    assert len(users) == 0

    # Teacher batch: Row 1 is valid, Row 2 has invalid short username
    with pytest.raises(ValueError, match="Row 2"):
        import_teachers(
            tmp_path,
            school_id=school_id,
            teachers=[
                {"username": "valid_teacher", "display_name": "Teacher 1"},
                {"username": "t", "display_name": "Teacher 2"},
            ],
        )

    # Entire teacher batch rolled back: no user or subject created!
    with connect(tmp_path) as con:
        teachers = con.execute("SELECT * FROM users WHERE school_id = ? AND role = 'teacher'", (school_id,)).fetchall()
        subjects = con.execute("SELECT * FROM teacher_subjects").fetchall()
    assert len(teachers) == 0
    assert len(subjects) == 0
