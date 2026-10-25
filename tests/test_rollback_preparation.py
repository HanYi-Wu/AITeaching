"""Rollback preparation preserves publication identity instead of creating a new draft."""

import sqlite3

import pytest
import yaml

from tools.release_verify.rollback import RollbackPreparationError, prepare_rollback


@pytest.fixture
def rollback_case(tmp_path):
    project, platform = tmp_path / "project", tmp_path / "platform"
    database = platform / ".solaire" / "platform.db"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE paper_records (id TEXT PRIMARY KEY, exam_id TEXT, subject TEXT,
                owner_teacher_id TEXT, delivery_mode TEXT, status TEXT, folder_id TEXT,
                UNIQUE(exam_id, subject));
            CREATE TABLE exam_publications (id TEXT PRIMARY KEY, paper_id TEXT REFERENCES paper_records(id));
            CREATE TABLE student_attempts (id TEXT PRIMARY KEY, publication_id TEXT REFERENCES exam_publications(id));
            INSERT INTO paper_records VALUES ('paper', 'Quiz/Math', 'Math', 'teacher', 'online', 'published', 'folder');
            INSERT INTO exam_publications VALUES ('publication', 'paper');
            INSERT INTO student_attempts VALUES ('attempt', 'publication');
        """)
    path = project / "exams" / "Quiz" / "Math" / "exam.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(yaml.safe_dump({"name": "Quiz", "subject": "Math", "metadata": {"owner_teacher_id": "teacher"}}), encoding="utf-8")
    return project, platform, database, path


def test_plan_does_not_write_and_apply_preserves_all_identity_and_delivery_fields(rollback_case):
    project, platform, database, path = rollback_case
    original = path.read_bytes()
    with sqlite3.connect(database) as connection:
        before = connection.execute("SELECT * FROM paper_records").fetchone()
    plan = prepare_rollback(project, platform)
    assert plan["applied"] is False
    assert plan["changes"] == [{"paper_id": "paper", "exam_id": "Quiz/Math", "previous_subject": "Math", "subject": "通用"}]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT * FROM paper_records").fetchone() == before
    applied = prepare_rollback(project, platform, apply=True)
    assert applied["changes"] == plan["changes"]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT * FROM paper_records").fetchone() == (*before[:2], "通用", *before[3:])
        assert connection.execute("SELECT * FROM exam_publications").fetchall() == [("publication", "paper")]
        assert connection.execute("SELECT * FROM student_attempts").fetchall() == [("attempt", "publication")]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    assert prepare_rollback(project, platform, apply=True)["changes"] == []
    assert path.read_bytes() == original  # In particular, no export_label is introduced.


def test_explicit_legacy_subject_needs_no_conversion(rollback_case):
    project, platform, _, path = rollback_case
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    document["metadata"]["subject"] = "Math"
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    assert prepare_rollback(project, platform, apply=True)["changes"] == []


def test_duplicate_subject_records_are_refused_without_modifying_either(rollback_case):
    project, platform, database, _ = rollback_case
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO paper_records VALUES ('duplicate', 'Quiz/Math', '通用', 'teacher', 'offline', 'draft', 'other')")
        before = connection.execute("SELECT * FROM paper_records ORDER BY id").fetchall()
    with pytest.raises(RollbackPreparationError, match="Multiple paper records"):
        prepare_rollback(project, platform, apply=True)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT * FROM paper_records ORDER BY id").fetchall() == before


def test_owner_conflict_aborts_all_changes(rollback_case):
    project, platform, database, _ = rollback_case
    other = project / "exams" / "Z" / "Math" / "exam.yaml"
    other.parent.mkdir(parents=True)
    other.write_text(yaml.safe_dump({"metadata": {"owner_teacher_id": "another"}}), encoding="utf-8")
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO paper_records VALUES ('other', 'Z/Math', 'Math', 'teacher', 'online', 'published', 'folder')")
    with pytest.raises(RollbackPreparationError, match="owner conflicts"):
        prepare_rollback(project, platform, apply=True)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT subject FROM paper_records ORDER BY id").fetchall() == [("Math",), ("Math",)]


def test_workspace_traversal_is_refused(rollback_case):
    project, platform, database, _ = rollback_case
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE paper_records SET exam_id='../outside'")
    with pytest.raises(RollbackPreparationError, match="Invalid workspace"):
        prepare_rollback(project, platform, apply=True)


def test_missing_database_is_not_created(tmp_path):
    platform = tmp_path / "platform"
    with pytest.raises(FileNotFoundError):
        prepare_rollback(tmp_path / "project", platform, apply=True)
    assert not platform.exists()


def test_invalid_metadata_is_not_silently_treated_as_an_empty_workspace(rollback_case):
    project, platform, database, path = rollback_case
    path.write_text("metadata: []\n", encoding="utf-8")
    with pytest.raises(RollbackPreparationError, match="Invalid exam metadata"):
        prepare_rollback(project, platform, apply=True)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT subject FROM paper_records").fetchone() == ("Math",)
