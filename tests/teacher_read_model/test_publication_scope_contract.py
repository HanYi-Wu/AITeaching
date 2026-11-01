from __future__ import annotations

from contextlib import closing

import pytest

from solaire.web import paper_service
from solaire.web.papers.visibility import publication_stats
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.papers.teacher_read_model.publication_queries import batch_publication_stats
from solaire.web.papers.visibility import publication_access_clause


def _seed_publications(root):
    init_platform_db(root)
    with closing(connect(root)) as con, con:
        con.executemany(
            "INSERT INTO schools (id, name, created_at, updated_at) VALUES (?, ?, 'now', 'now')",
            [("school-a", "School A"), ("school-b", "School B")],
        )
        con.executemany(
            "INSERT INTO users (id, school_id, role, username, password_hash, display_name, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'hash', ?, 'now', 'now')",
            [
                ("admin", None, "admin", "admin", "Admin"),
                ("school-user-a", "school-a", "school", "school-a", "School A user"),
                ("school-user-b", "school-b", "school", "school-b", "School B user"),
                ("teacher-a", "school-a", "teacher", "teacher-a", "Teacher A"),
                ("teacher-b", "school-b", "teacher", "teacher-b", "Teacher B"),
            ],
        )
        con.executemany(
            "INSERT INTO classes (id, school_id, name, grade, created_at, updated_at) "
            "VALUES (?, ?, ?, 'G9', 'now', 'now')",
            [
                ("class-a-1", "school-a", "A Class 1"),
                ("class-a-2", "school-a", "A Class 2"),
                ("class-b-1", "school-b", "B Class 1"),
            ],
        )
        con.executemany(
            "INSERT INTO students (id, school_id, student_no, display_name, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'now', 'now')",
            [
                ("student-a-1", "school-a", "A001", "Alpha"),
                ("student-a-2", "school-a", "A002", "Beta"),
                ("student-b-1", "school-b", "B001", "Foreign"),
            ],
        )
        con.executemany(
            "INSERT INTO paper_records (id, exam_id, title, subject, owner_teacher_id, school_id, created_at, updated_at) "
            "VALUES (?, ?, ?, 'Math', ?, ?, 'now', 'now')",
            [
                ("paper-a", "exam-a", "Paper A", "teacher-a", "school-a"),
                ("paper-b", "exam-b", "Paper B", "teacher-b", "school-b"),
            ],
        )
        con.executemany(
            "INSERT INTO exam_publications (id, paper_id, teacher_id, title, recipient_scope, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'now')",
            [
                ("pub-a-active", "paper-a", "teacher-a", "Active A", "class", "active", "2026-10-01"),
                ("pub-a-old", "paper-a", "teacher-a", "Old A", "student", "revoked", "2026-09-01"),
                ("pub-b-active", "paper-b", "teacher-b", "Active B", "class", "active", "2026-10-02"),
            ],
        )
        con.executemany(
            "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
            [
                ("pub-a-active", "class-a-1"),
                ("pub-a-active", "class-a-2"),
                ("pub-a-old", "class-a-1"),
                ("pub-b-active", "class-b-1"),
            ],
        )
        con.executemany(
            "INSERT INTO student_attempts (id, publication_id, student_id, status, submitted_at, grading_completed_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("attempt-a-1", "pub-a-active", "student-a-1", "submitted", "2026-10-03", "2026-10-03"),
                ("attempt-a-2", "pub-a-active", "student-a-2", "in_progress", None, None),
                ("attempt-a-old", "pub-a-old", "student-a-1", "submitted", "2026-09-02", None),
                ("attempt-b-1", "pub-b-active", "student-b-1", "submitted", "2026-10-03", "2026-10-03"),
            ],
        )
        con.executemany(
            "INSERT INTO proctor_events (id, attempt_id, student_id, publication_id, event_type, occurred_at) "
            "VALUES (?, ?, ?, ?, 'visibility_hidden', '2026-10-03')",
            [
                ("event-a-1", "attempt-a-1", "student-a-1", "pub-a-active"),
                ("event-a-2", "attempt-a-1", "student-a-1", "pub-a-active"),
                ("event-a-3", "attempt-a-2", "student-a-2", "pub-a-active"),
                ("event-a-old", "attempt-a-old", "student-a-1", "pub-a-old"),
                ("event-b", "attempt-b-1", "student-b-1", "pub-b-active"),
            ],
        )


@pytest.fixture
def publication_root(tmp_path):
    _seed_publications(tmp_path)
    return tmp_path


@pytest.mark.parametrize(
    "user",
    [
        {"id": "admin", "role": "admin"},
        {"id": "teacher-a", "role": "teacher", "school_id": "school-a"},
        {"id": "school-user-a", "role": "school", "school_id": "school-a"},
        {"id": "teacher-b", "role": "teacher", "school_id": "school-b"},
        {"id": "school-user-b", "role": "school", "school_id": "school-b"},
    ],
)
def test_batched_publication_stats_match_single_paper_contract(publication_root, user):
    paper_ids = ["paper-a", "paper-b", "paper-a", "paper-without-publications"]
    actual = batch_publication_stats(publication_root, paper_ids, user, publication_access_clause)
    assert actual == {
        paper_id: publication_stats(publication_root, paper_id, user)
        for paper_id in dict.fromkeys(paper_ids)
    }


@pytest.mark.parametrize(
    "user",
    [
        {"id": "admin", "role": "admin"},
        {"id": "teacher-a", "role": "teacher", "school_id": "school-a"},
        {"id": "school-user-a", "role": "school", "school_id": "school-a"},
    ],
)
def test_publication_detail_preserves_scope_counts_and_list_values(publication_root, user):
    actual = paper_service.list_paper_publications(publication_root, paper_id="paper-a", user=user)
    assert [item["id"] for item in actual] == ["pub-a-active", "pub-a-old"]
    active = next(item for item in actual if item["id"] == "pub-a-active")
    assert set(active) == {
        "id", "paper_id", "teacher_id", "title", "description", "subject", "start_at", "end_at",
        "show_results_immediately", "randomize_questions", "randomize_answers", "submission_mode",
        "max_screen_switches", "time_limit_minutes", "practice_kind", "source_publication_ids_json",
        "folder_id", "recipient_scope", "status", "created_at", "updated_at", "teacher_name",
        "teacher_username", "class_ids", "class_names", "student_names", "attempt_count",
        "submitted_count", "proctor_event_count",
    }
    assert active["teacher_name"] == "Teacher A"
    assert active["teacher_username"] == "teacher-a"
    assert active["status"] == "active"
    assert active["class_ids"] == ["class-a-1", "class-a-2"]
    assert active["class_names"] == ["A Class 1", "A Class 2"]
    assert active["student_names"] == []
    assert active["attempt_count"] == 2
    assert active["submitted_count"] == 1
    assert active["proctor_event_count"] == 3
    history = next(item for item in actual if item["id"] == "pub-a-old")
    assert history["status"] == "revoked"
    assert history["class_ids"] == ["class-a-1"]
    assert history["class_names"] == ["A Class 1"]
    assert history["student_names"] == ["Alpha"]
    assert history["attempt_count"] == 1
    assert history["proctor_event_count"] == 1


def test_school_and_teacher_cannot_read_other_paper_publications(publication_root):
    for user in (
        {"id": "teacher-a", "role": "teacher", "school_id": "school-a"},
        {"id": "school-user-a", "role": "school", "school_id": "school-a"},
    ):
        with pytest.raises(PermissionError):
            paper_service.list_paper_publications(publication_root, paper_id="paper-b", user=user)
