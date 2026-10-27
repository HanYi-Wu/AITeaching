from __future__ import annotations

from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from solaire.web import platform_db
from solaire.web.platform_db import row_to_dict
from solaire.web.school import common, importer, organization, roster


class QueryCounts:
    def __init__(self) -> None:
        self.selects = 0
        self.rows_read = 0


class CountedCursor:
    def __init__(self, cursor, counts: QueryCounts) -> None:
        self.cursor = cursor
        self.counts = counts

    def fetchone(self):
        row = self.cursor.fetchone()
        self.counts.rows_read += int(row is not None)
        return row

    def fetchall(self):
        rows = self.cursor.fetchall()
        self.counts.rows_read += len(rows)
        return rows

    def fetchmany(self, size: int | None = None):
        rows = self.cursor.fetchmany(size) if size is not None else self.cursor.fetchmany()
        self.counts.rows_read += len(rows)
        return rows

    def __getattr__(self, name: str):
        return getattr(self.cursor, name)


class CountedConnection:
    def __init__(self, connection, counts: QueryCounts) -> None:
        self.connection = connection
        self.counts = counts

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback):
        return self.connection.__exit__(exc_type, exc, traceback)

    def close(self) -> None:
        self.connection.close()

    def execute(self, sql: str, params=()):
        if sql.lstrip().upper().startswith(("SELECT", "WITH")):
            self.counts.selects += 1
        return CountedCursor(self.connection.execute(sql, params), self.counts)

    def executemany(self, *args, **kwargs):
        return self.connection.executemany(*args, **kwargs)

    def __getattr__(self, name: str):
        return getattr(self.connection, name)


def seed_school_data(root: Path, count: int = 25) -> str:
    platform_db.init_platform_db(root)
    school_ids = [f"school_{index:02}" for index in range(count)]
    target_school = school_ids[-1]
    with closing(platform_db.connect(root)) as con, con:
        for index, school_id in enumerate(school_ids):
            name = "İstanbul Straße" if index == count - 1 else f"School {index:02}"
            stamp = f"2026-01-01T00:00:{index:02}Z"
            con.execute(
                "INSERT INTO schools (id, name, status, ai_enabled, created_at, updated_at) VALUES (?, ?, 'active', 0, ?, ?)",
                (school_id, name, stamp, stamp),
            )
        for index in range(count):
            stamp = f"2026-01-01T00:00:{index:02}Z"
            class_id = f"class_{index:02}"
            teacher_id = f"teacher_{index:02}"
            student_user_id = f"student_user_{index:02}"
            student_id = f"student_{index:02}"
            class_name = "Needle Class" if index == count - 1 else f"Class {index:02}"
            teacher_name = "Needle Teacher" if index == count - 1 else f"Teacher {index:02}"
            student_name = "Needle Student" if index == count - 1 else f"Student {index:02}"
            status = "disabled" if index % 2 else "active"
            con.execute(
                "INSERT INTO classes (id, school_id, name, grade, created_at, updated_at) VALUES (?, ?, ?, 'G10', ?, ?)",
                (class_id, target_school, class_name, stamp, stamp),
            )
            con.execute(
                """INSERT INTO users (id, school_id, role, username, password_hash, display_name, status, created_at, updated_at)
                   VALUES (?, ?, 'teacher', ?, 'hash', ?, ?, ?, ?)""",
                (teacher_id, target_school, f"teacher_{index:02}", teacher_name, status, stamp, stamp),
            )
            if index != 0:
                con.execute(
                    "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, 'Math')",
                    (f"subject_math_{index:02}", teacher_id),
                )
            if index == count - 1:
                con.execute(
                    "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, 'Science')",
                    (f"subject_science_{index:02}", teacher_id),
                )
            con.execute(
                """INSERT INTO users (id, school_id, role, username, password_hash, display_name, status, created_at, updated_at)
                   VALUES (?, ?, 'student', ?, 'hash', ?, ?, ?, ?)""",
                (student_user_id, target_school, f"student_{index:02}", student_name, status, stamp, stamp),
            )
            con.execute(
                """INSERT INTO students (id, school_id, user_id, student_no, display_name, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (student_id, target_school, student_user_id, f"N{index:02}", student_name, status, stamp, stamp),
            )
            con.execute("INSERT INTO class_students (class_id, student_id) VALUES (?, ?)", (class_id, student_id))
            con.execute(
                "INSERT INTO teacher_class_assignments (teacher_id, class_id, subject) VALUES (?, ?, 'Math')",
                (teacher_id, class_id),
            )
    return target_school


def counted_call(module, root: Path, function, *args, **kwargs):
    counts = QueryCounts()

    def counted_connect(db_root: Path):
        return CountedConnection(platform_db.connect(db_root), counts)

    with patch.object(module, "connect", counted_connect), patch.object(module, "init_platform_db", lambda _root: None):
        result = function(root, *args, **kwargs)
    return result, counts


def legacy_page(items, *, page: int, page_size: int) -> dict:
    return common._page(items, page=page, page_size=page_size)


def test_sql_query_pages_match_python_search_and_sort_semantics(tmp_path: Path) -> None:
    school_id = seed_school_data(tmp_path)
    page, page_size = 1, 5

    schools = organization.list_schools(tmp_path)
    school_expected = legacy_page(
        [school for school in schools if common._contains_query(school, "i\u0307stanbul", ["name", "status", "created_at", "updated_at"])],
        page=page,
        page_size=page_size,
    )
    school_actual = organization.query_schools(tmp_path, q="i\u0307stanbul", page=page, page_size=page_size)
    assert school_actual == {"schools": school_expected.pop("items"), **school_expected}
    assert organization.query_schools(tmp_path, q="STRASSE")["total"] == 0  # Python lower(), not casefold().

    classes = organization.list_classes(tmp_path, school_id=school_id)
    with closing(platform_db.connect(tmp_path)) as con, con:
        ids = [str(row["id"]) for row in classes]
        placeholders = ",".join("?" for _ in ids)
        students = con.execute(
            f"SELECT class_id, COUNT(*) AS n FROM class_students WHERE class_id IN ({placeholders}) GROUP BY class_id",
            tuple(ids),
        ).fetchall()
        teachers = con.execute(
            f"SELECT class_id, COUNT(DISTINCT teacher_id) AS n FROM teacher_class_assignments WHERE class_id IN ({placeholders}) GROUP BY class_id",
            tuple(ids),
        ).fetchall()
    students_by_class = {str(row["class_id"]): int(row["n"]) for row in students}
    teachers_by_class = {str(row["class_id"]): int(row["n"]) for row in teachers}
    for klass in classes:
        klass["student_count"] = students_by_class.get(str(klass["id"]), 0)
        klass["teacher_count"] = teachers_by_class.get(str(klass["id"]), 0)
    class_expected = legacy_page(
        [klass for klass in classes if common._contains_query(klass, "needle", ["name", "grade", "student_count", "teacher_count"])],
        page=page,
        page_size=page_size,
    )
    class_actual = organization.query_classes(tmp_path, school_id=school_id, q="needle", page=page, page_size=page_size)
    assert class_actual == {"classes": class_expected.pop("items"), **class_expected}

    teachers = roster.list_teachers(tmp_path, school_id=school_id)
    teacher_expected = legacy_page(
        [teacher for teacher in teachers if common._contains_query(teacher, "math science", ["username", "display_name", "email", "status", "subjects"])],
        page=page,
        page_size=page_size,
    )
    teacher_actual = roster.query_teachers(tmp_path, school_id=school_id, q="math science", page=page, page_size=page_size)
    assert teacher_actual == {"teachers": teacher_expected.pop("items"), **teacher_expected}
    assert roster.query_teachers(tmp_path, school_id=school_id, q="math, science")["total"] == 0
    unfiltered_teachers = roster.query_teachers(tmp_path, school_id=school_id, page_size=100)["teachers"]
    assert next(teacher for teacher in unfiltered_teachers if teacher["username"] == "teacher_00")["subjects"] == []

    students = roster.list_students(tmp_path, school_id=school_id)
    student_expected = legacy_page(
        [student for student in students if common._contains_query(student, "needle", ["student_no", "display_name", "email", "account_username", "class_names", "status"])],
        page=page,
        page_size=page_size,
    )
    student_actual = roster.query_students(tmp_path, school_id=school_id, q="needle", page=page, page_size=page_size)
    assert student_actual == {"students": student_expected.pop("items"), **student_expected}
    class_students = roster.list_students(tmp_path, school_id=school_id, class_id="class_23")
    class_student_expected = legacy_page(class_students, page=1, page_size=100)
    class_student_actual = roster.query_students(
        tmp_path, school_id=school_id, class_id="class_23", page_size=100
    )
    assert class_student_actual == {"students": class_student_expected.pop("items"), **class_student_expected}

    with closing(platform_db.connect(tmp_path)) as con, con:
        rows = con.execute(
            """SELECT tca.teacher_id, tca.class_id, tca.subject, u.username AS teacher_username,
                      u.display_name AS teacher_name, u.status AS teacher_status,
                      c.name AS class_name, c.grade AS class_grade
               FROM teacher_class_assignments tca JOIN users u ON u.id=tca.teacher_id
               JOIN classes c ON c.id=tca.class_id WHERE u.school_id=? AND c.school_id=?
               ORDER BY u.display_name,c.grade,c.name,tca.subject""",
            (school_id, school_id),
        ).fetchall()
    assignment_rows = [row_to_dict(row) or {} for row in rows]
    assignment_expected = legacy_page(
        [row for row in assignment_rows if common._contains_query(row, "needle", ["teacher_username", "teacher_name", "teacher_status", "class_name", "class_grade", "subject"])],
        page=page,
        page_size=page_size,
    )
    assignment_actual = roster.list_teacher_class_assignments(
        tmp_path, school_id=school_id, q="needle", page=page, page_size=page_size
    )
    assert assignment_actual == {"assignments": assignment_expected.pop("items"), **assignment_expected}


def test_student_class_names_keep_legacy_order_when_query_plans_differ(tmp_path: Path) -> None:
    school_id = seed_school_data(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con, con:
        # Simulate an existing database predating the single-current-class rule.
        con.execute("DROP TRIGGER one_current_class_per_student_insert")
        con.execute("DROP TRIGGER one_current_class_per_student_update")
        # The student already belongs to class_24; add class_23 second so rowid order
        # differs from class_id order, then make class-name order differ as well.
        con.execute(
            "INSERT INTO class_students (class_id, student_id) VALUES (?, ?)",
            ("class_23", "student_24"),
        )
        con.execute("UPDATE classes SET name = 'Zulu Class' WHERE id = 'class_23'")
        con.execute("UPDATE classes SET name = 'Alpha Class' WHERE id = 'class_24'")
        assert [row["name"] for row in con.execute("PRAGMA index_info(idx_class_students_student)")] == [
            "student_id", "class_id",
        ]
        con.execute("ANALYZE")
        con.execute("PRAGMA user_version = 14")

    platform_db.init_platform_db(tmp_path)

    legacy_student = next(
        student
        for student in roster.list_students(tmp_path, school_id=school_id)
        if student["id"] == "student_24"
    )
    query_student = next(
        student
        for student in roster.query_students(tmp_path, school_id=school_id, page_size=100)["students"]
        if student["id"] == "student_24"
    )
    assert query_student["class_names"] == legacy_student["class_names"]
    assert query_student["class_count"] == legacy_student["class_count"] == 2


def test_sql_paged_queries_fetch_only_page_rows(tmp_path: Path) -> None:
    school_id = seed_school_data(tmp_path)
    cases = [
        (organization, organization.query_schools, {"q": "İstanbul", "page": 1, "page_size": 5}, 1, 25, 1),
        (organization, organization.query_classes, {"school_id": school_id, "q": "Needle", "page": 1, "page_size": 5}, 1, 1, 1),
        (roster, roster.query_teachers, {"school_id": school_id, "q": "Science", "page": 1, "page_size": 5}, 2, 50, 1),
        (roster, roster.query_students, {"school_id": school_id, "q": "Needle", "page": 1, "page_size": 5}, 1, 1, 1),
        (roster, roster.list_teacher_class_assignments, {"school_id": school_id, "q": "Needle", "page": 1, "page_size": 5}, 1, 1, 1),
        (roster, roster.query_teachers, {"school_id": school_id, "q": "no-such-teacher", "page": 99, "page_size": 5}, 2, 50, 0),
    ]
    for module, function, kwargs, expected_selects, expected_rows, expected_total in cases:
        result, counts = counted_call(module, tmp_path, function, **kwargs)
        page_rows = next(iter(result[key] for key in result if key in {"schools", "classes", "teachers", "students", "assignments"}))
        assert result["total"] == expected_total
        assert result["page"] == 1
        assert len(page_rows) == expected_total
        assert counts.selects == expected_selects
        assert counts.rows_read == expected_rows


def test_pre_materialized_cte_sqlite_keeps_page_response(tmp_path: Path) -> None:
    school_id = seed_school_data(tmp_path)
    expected = organization.query_classes(tmp_path, school_id=school_id, page=2, page_size=5)
    with patch.object(common.sqlite3, "sqlite_version_info", (3, 34, 0)):
        compatible = organization.query_classes(tmp_path, school_id=school_id, page=2, page_size=5)
    assert compatible == expected


def test_six_row_imports_batch_duplicate_lookups(tmp_path: Path) -> None:
    school_id = seed_school_data(tmp_path, count=13)
    teacher_rows = [
        {"username": f"batch_teacher_{index:02}", "display_name": f"Batch Teacher {index}", "password": "secret123", "subjects": "Math"}
        for index in range(6)
    ]
    class_rows = [{"name": f"Imported Class {index}", "grade": "G9"} for index in range(6)]
    student_rows = [{"student_no": f"IMPORT_{index:02}", "display_name": f"Imported Student {index}"} for index in range(6)]
    assignment_rows = [
        {"teacher_username": f"teacher_{index:02}", "class_name": f"Class {index:02}", "subject": "Math"}
        for index in range(0, 12, 2)
    ]
    cases = [
        (import_teachers_call, {"school_id": school_id, "teachers": teacher_rows}, 2, 1),
        (import_classes_call, {"school_id": school_id, "classes": class_rows}, 2, 1),
        (import_students_call, {"school_id": school_id, "students": student_rows}, 3, 1),
        (import_assignments_call, {"school_id": school_id, "assignments": assignment_rows}, 3, 13),
    ]
    for function, kwargs, expected_selects, expected_rows in cases:
        result, counts = counted_call(importer, tmp_path, function, **kwargs)
        assert result["imported"] == 6
        assert counts.selects == expected_selects
        assert counts.rows_read == expected_rows


def test_repeated_keys_inside_one_import_batch_keep_identity_and_row_snapshots(tmp_path: Path) -> None:
    school_id = seed_school_data(tmp_path, count=3)
    classes = importer.import_classes(
        tmp_path,
        school_id=school_id,
        classes=[{"name": "Repeated Class", "grade": "G7"}, {"name": "Repeated Class", "grade": "G8"}],
    )["classes"]
    assert classes[0]["id"] == classes[1]["id"]
    assert [klass["grade"] for klass in classes] == ["G7", "G8"]

    teachers = importer.import_teachers(
        tmp_path,
        school_id=school_id,
        teachers=[
            {"username": "batch_repeat_teacher", "password": "secret123", "subjects": "Math"},
            {"username": "batch_repeat_teacher", "password": "ignored123", "subjects": "Science"},
        ],
    )["teachers"]
    assert teachers[0]["id"] == teachers[1]["id"]
    assert [teacher["subjects"] for teacher in teachers] == [["Math"], ["Science"]]

    students = importer.import_students(
        tmp_path,
        school_id=school_id,
        students=[
            {"student_no": "REPEAT001", "display_name": "First Name"},
            {"student_no": "REPEAT001", "display_name": "Second Name"},
        ],
    )["students"]
    assert students[0]["id"] == students[1]["id"]
    assert students[0]["user_id"] == students[1]["user_id"]
    assert students[0]["initial_password"] == students[1]["initial_password"]
    assert [student["display_name"] for student in students] == ["First Name", "Second Name"]

    with closing(platform_db.connect(tmp_path)) as con, con:
        saved_class = con.execute("SELECT grade FROM classes WHERE id = ?", (classes[0]["id"],)).fetchone()
        saved_teacher = con.execute("SELECT id FROM users WHERE username = 'batch_repeat_teacher'").fetchone()
        saved_student = con.execute("SELECT display_name FROM students WHERE student_no = 'REPEAT001'").fetchone()
    assert saved_class["grade"] == "G8"
    assert saved_teacher["id"] == teachers[0]["id"]
    assert saved_student["display_name"] == "Second Name"


def import_teachers_call(root: Path, **kwargs):
    return importer.import_teachers(root, **kwargs)


def import_classes_call(root: Path, **kwargs):
    return importer.import_classes(root, **kwargs)


def import_students_call(root: Path, **kwargs):
    return importer.import_students(root, **kwargs)


def import_assignments_call(root: Path, **kwargs):
    return importer.import_teacher_class_assignments(root, **kwargs)
