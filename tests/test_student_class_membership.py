from __future__ import annotations

from contextlib import closing
from pathlib import Path

import pytest

from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school import importer
from solaire.web.school.importer import import_students
from solaire.web.school.organization import create_class, create_school


def _school_with_classes(root: Path) -> tuple[str, dict[str, str]]:
    init_platform_db(root)
    school = create_school(root, name="Membership School")
    school_id = str(school["id"])
    classes = {
        name: str(create_class(root, school_id=school_id, name=name)["id"])
        for name in ("Class A", "Class B")
    }
    return school_id, classes


def _memberships(root: Path, student_no: str) -> list[str]:
    with closing(connect(root)) as con:
        rows = con.execute(
            """
            SELECT c.name
            FROM students s
            JOIN class_students cs ON cs.student_id = s.id
            JOIN classes c ON c.id = cs.class_id
            WHERE s.student_no = ?
            ORDER BY c.name
            """,
            (student_no,),
        ).fetchall()
    return [str(row["name"]) for row in rows]


def test_import_rejects_existing_student_in_a_different_class(tmp_path: Path) -> None:
    school_id, classes = _school_with_classes(tmp_path)
    import_students(
        tmp_path,
        school_id=school_id,
        class_id=classes["Class A"],
        students=[{"student_no": "S001", "display_name": "Student One"}],
    )

    with pytest.raises(ValueError) as error:
        import_students(
            tmp_path,
            school_id=school_id,
            class_id=classes["Class B"],
            students=[{"student_no": "S001", "display_name": "Changed Name"}],
        )
    message = str(error.value)
    assert "Row 1 (class):" in message
    assert "S001" in message
    assert "当前属于班级“Class A”" in message
    assert "请求的班级是“Class B”" in message
    assert "转班需单独核对处理" in message

    assert _memberships(tmp_path, "S001") == ["Class A"]
    with closing(connect(tmp_path)) as con:
        student = con.execute(
            "SELECT display_name FROM students WHERE school_id = ? AND student_no = ?",
            (school_id, "S001"),
        ).fetchone()
    assert student["display_name"] == "Student One"


def test_same_batch_student_number_cannot_target_two_classes_atomically(tmp_path: Path) -> None:
    school_id, _ = _school_with_classes(tmp_path)

    with pytest.raises(ValueError) as error:
        import_students(
            tmp_path,
            school_id=school_id,
            students=[
                {"student_no": "S002", "display_name": "Student Two", "class_name": "Class A"},
                {"student_no": "S002", "display_name": "Student Two", "class_name": "Class B"},
            ],
        )
    message = str(error.value)
    assert "Row 2 (class):" in message
    assert "S002" in message
    assert "第1行“Class A”" in message
    assert "本行“Class B”" in message
    assert "转班需单独核对处理" in message

    assert _memberships(tmp_path, "S002") == []
    with closing(connect(tmp_path)) as con:
        students = con.execute(
            "SELECT COUNT(*) FROM students WHERE school_id = ? AND student_no = ?",
            (school_id, "S002"),
        ).fetchone()[0]
        users = con.execute(
            "SELECT COUNT(*) FROM users WHERE school_id = ? AND role = 'student'",
            (school_id,),
        ).fetchone()[0]
    assert students == 0
    assert users == 0


def test_same_class_import_is_idempotent_and_no_class_keeps_membership(tmp_path: Path) -> None:
    school_id, classes = _school_with_classes(tmp_path)
    first = import_students(
        tmp_path,
        school_id=school_id,
        class_id=classes["Class A"],
        students=[{"student_no": "S003", "display_name": "Student Three"}],
    )["students"][0]
    repeated = import_students(
        tmp_path,
        school_id=school_id,
        class_id=classes["Class A"],
        students=[{"student_no": "S003", "display_name": "Updated Student Three"}],
    )["students"][0]
    updated_without_class = import_students(
        tmp_path,
        school_id=school_id,
        students=[{"student_no": "S003", "display_name": "Final Student Three"}],
    )["students"][0]

    assert repeated["id"] == first["id"]
    assert updated_without_class["id"] == first["id"]
    assert _memberships(tmp_path, "S003") == ["Class A"]
    assert updated_without_class["display_name"] == "Final Student Three"


def test_import_does_not_guess_which_existing_class_is_current(tmp_path: Path) -> None:
    school_id, classes = _school_with_classes(tmp_path)
    import_students(
        tmp_path,
        school_id=school_id,
        students=[{"student_no": "S004", "display_name": "Student Four"}],
    )
    with closing(connect(tmp_path)) as con, con:
        student = con.execute(
            "SELECT id FROM students WHERE school_id = ? AND student_no = ?",
            (school_id, "S004"),
        ).fetchone()
        insert_guard = con.execute(
            """SELECT name, sql FROM sqlite_master
               WHERE type = 'trigger' AND tbl_name = 'class_students'
                 AND upper(sql) LIKE '%BEFORE INSERT%'"""
        ).fetchone()
        assert insert_guard is not None
        quoted_name = '"' + str(insert_guard["name"]).replace('"', '""') + '"'
        con.execute(f"DROP TRIGGER {quoted_name}")
        con.executemany(
            "INSERT INTO class_students (class_id, student_id) VALUES (?, ?)",
            [(classes["Class A"], student["id"]), (classes["Class B"], student["id"])],
        )
        con.execute(str(insert_guard["sql"]))

    with pytest.raises(ValueError) as error:
        import_students(
            tmp_path,
            school_id=school_id,
            class_id=classes["Class A"],
            students=[{"student_no": "S004", "display_name": "Should Not Change"}],
        )
    message = str(error.value)
    assert "Row 1 (class):" in message
    assert "S004" in message
    assert "已关联多个班级（Class A、Class B）" in message
    assert "本次请求班级“Class A”" in message
    assert "如需转班，需单独核对处理" in message

    no_class_update = import_students(
        tmp_path,
        school_id=school_id,
        students=[{"student_no": "S004", "display_name": "Updated Without Guessing"}],
    )
    assert _memberships(tmp_path, "S004") == ["Class A", "Class B"]
    assert no_class_update["students"][0]["display_name"] == "Updated Without Guessing"


def test_trigger_conflict_is_translated_and_owned_import_rolls_back(tmp_path: Path, monkeypatch) -> None:
    school_id, classes = _school_with_classes(tmp_path)
    student = import_students(
        tmp_path,
        school_id=school_id,
        class_id=classes["Class A"],
        students=[{"student_no": "S005", "display_name": "Student Five"}],
    )["students"][0]
    with closing(connect(tmp_path)) as con, con:
        con.execute(
            """
            CREATE TRIGGER test_single_current_class_insert
            BEFORE INSERT ON class_students
            WHEN EXISTS (
              SELECT 1 FROM class_students old
              WHERE old.student_id = NEW.student_id AND old.class_id <> NEW.class_id
            )
            BEGIN
              SELECT RAISE(ABORT, 'student already belongs to a different class');
            END
            """
        )

    original_fetch = importer._fetch_in_values

    def hide_membership_prefetch(con, sql_template, values, *, prefix_params=()):
        if "FROM class_students cs" in sql_template:
            return []
        return original_fetch(con, sql_template, values, prefix_params=prefix_params)

    monkeypatch.setattr(importer, "_fetch_in_values", hide_membership_prefetch)
    with pytest.raises(ValueError) as error:
        import_students(
            tmp_path,
            school_id=school_id,
            class_id=classes["Class B"],
            students=[{"student_no": "S005", "display_name": "Should Not Persist"}],
        )
    message = str(error.value)
    assert "Row 1 (class):" in message
    assert "S005" in message
    assert "当前属于班级“Class A”" in message
    assert "请求的班级是“Class B”" in message
    assert "转班需单独核对处理" in message

    assert _memberships(tmp_path, "S005") == ["Class A"]
    with closing(connect(tmp_path)) as con:
        saved = con.execute(
            "SELECT display_name FROM students WHERE id = ?",
            (student["id"],),
        ).fetchone()
    assert saved["display_name"] == "Student Five"
