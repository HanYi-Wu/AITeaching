from contextlib import closing
import pytest

from solaire.web import platform_db
from solaire.web.papers.analysis import build_class_report
from solaire.web.papers.class_snapshots import (
    freeze_attempt_class_memberships,
    freeze_legacy_student_class_memberships,
)


@pytest.fixture
def assigned_database(tmp_path):
    platform_db.init_platform_db(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con, con:
        con.execute("INSERT INTO schools (id,name,created_at,updated_at) VALUES ('school','School','now','now')")
        con.execute(
            "INSERT INTO users (id,school_id,role,username,password_hash,display_name,created_at,updated_at) "
            "VALUES ('teacher','school','teacher','teacher','unused','Teacher','now','now')",
        )
        con.executemany(
            "INSERT INTO classes (id,school_id,name,grade,created_at,updated_at) VALUES (?,'school',?,'Grade','now','now')",
            [("class-a", "A"), ("class-b", "B")],
        )
        con.execute(
            "INSERT INTO students (id,school_id,student_no,display_name,created_at,updated_at) "
            "VALUES ('student','school','S001','Student','now','now')",
        )
        con.execute("INSERT INTO class_students VALUES ('class-a','student')")
        con.execute(
            "INSERT INTO paper_records (id,exam_id,title,subject,created_at,updated_at) "
            "VALUES ('paper','exam','Exam','Math','now','now')",
        )
        con.execute(
            "INSERT INTO exam_publications (id,paper_id,teacher_id,title,status,created_at,updated_at) "
            "VALUES ('publication','paper','teacher','Exam','published','now','now')",
        )
        con.executemany("INSERT INTO publication_classes VALUES ('publication',?)", [("class-a",), ("class-b",)])
        con.execute("INSERT INTO student_attempts (id,publication_id,student_id) VALUES ('attempt','publication','student')")
    return tmp_path


def _memberships(con):
    return [tuple(row) for row in con.execute(
        "SELECT class_id,class_name FROM attempt_class_memberships WHERE attempt_id='attempt' ORDER BY class_id",
    )]


def test_new_assignment_keeps_its_class_and_report_after_membership_changes(assigned_database):
    root = assigned_database
    with closing(platform_db.connect(root)) as con, con:
        assert freeze_attempt_class_memberships(con, ["attempt"], captured_at="assigned") == 1
        con.execute("DELETE FROM class_students WHERE student_id='student'")
        con.execute("INSERT INTO class_students VALUES ('class-b','student')")
        con.execute("UPDATE classes SET name='Renamed A' WHERE id='class-a'")
        assert _memberships(con) == [("class-a", "A")]
        assert freeze_attempt_class_memberships(con, ["attempt"], captured_at="later") == 0
        assert con.execute("SELECT captured_at FROM attempt_class_snapshots").fetchone()[0] == "assigned"

    report = build_class_report(
        root, paper_id="paper", user={"role": "admin"},
        attempt_clause_fn=lambda *args, **kwargs: ("1=1", []),
        attempt_status_group_fn=lambda row: "not_started",
        score_percent_fn=lambda score, maximum: None,
    )
    assert [(row["class_id"], row["class_name"], row["student_count"]) for row in report] == [("class-a", "A", 1)]


@pytest.mark.parametrize("known_class", [True, False])
def test_legacy_transfer_capture_preserves_visible_or_unknown_class(assigned_database, known_class):
    with closing(platform_db.connect(assigned_database)) as con, con:
        if not known_class:
            con.execute("DELETE FROM class_students")
        before = _memberships(con)
        assert freeze_legacy_student_class_memberships(con, "student", captured_at="transfer") == 1
        con.execute("DELETE FROM class_students")
        con.execute("INSERT INTO class_students VALUES ('class-b','student')")
        assert _memberships(con) == before
        assert con.execute("SELECT class_membership_frozen FROM student_attempts").fetchone()[0] == 1
        assert freeze_legacy_student_class_memberships(con, "student", captured_at="again") == 0
        sources = [row[0] for row in con.execute("SELECT source FROM attempt_class_snapshots")]
        assert sources == (["transfer_capture"] if known_class else [])


def test_upgrade_adds_snapshot_support_without_inventing_historical_classes(assigned_database):
    root = assigned_database
    with closing(platform_db.connect(root)) as con, con:
        con.execute("DROP VIEW attempt_class_memberships")
        con.execute("ALTER TABLE student_attempts DROP COLUMN class_membership_frozen")
        con.execute("PRAGMA user_version=15")
    platform_db.init_platform_db(root)
    with closing(platform_db.connect(root)) as con:
        assert con.execute("SELECT class_membership_frozen FROM student_attempts").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM attempt_class_snapshots").fetchone()[0] == 0
        assert _memberships(con) == [("class-a", "A")]


def test_new_assignment_refuses_ambiguous_legacy_current_memberships(assigned_database):
    with closing(platform_db.connect(assigned_database)) as con, con:
        con.execute("DROP TRIGGER one_current_class_per_student_insert")
        con.execute("INSERT INTO class_students VALUES ('class-b','student')")
        with pytest.raises(ValueError, match="班级归属存在冲突"):
            freeze_attempt_class_memberships(con, ["attempt"], captured_at="assignment")
        assert con.execute("SELECT class_membership_frozen FROM student_attempts").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM attempt_class_snapshots").fetchone()[0] == 0


def test_new_assignment_rechecks_current_membership_in_its_transaction(assigned_database):
    with closing(platform_db.connect(assigned_database)) as con, con:
        con.execute("DELETE FROM class_students")
        with pytest.raises(ValueError, match="当前班级不在本次发布范围"):
            freeze_attempt_class_memberships(con, ["attempt"], captured_at="assignment")
        assert con.execute("SELECT class_membership_frozen FROM student_attempts").fetchone()[0] == 0
