from __future__ import annotations

from pathlib import Path

from scripts.seed_demo_data import PASSWORDS, seed_demo_accounts, seed_demo_adaptive_histories, seed_demo_attempts
from solaire.web.auth_service import authenticate_user
from solaire.web.platform_db import connect, init_platform_db


def test_seed_creates_one_school_three_teachers_and_five_ready_students(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    seeded = seed_demo_accounts(tmp_path)

    assert len(seeded["teachers"]) == 3
    assert len(seeded["students"]) == 5
    assert set(PASSWORDS) >= {
        "demo_school",
        "demo_teacher",
        "demo_teacher2",
        "demo_teacher3",
        "demo_student",
        "demo_student2",
        "demo_student3",
        "demo_student4",
        "demo_student5",
    }

    for username, password in PASSWORDS.items():
        user = authenticate_user(tmp_path, username, password)
        assert user is not None
        assert user["username"] == username
        if username.startswith("demo_student"):
            assert user["must_change_password"] is False

    school_id = str(seeded["school"]["id"])
    class_id = str(seeded["class"]["id"])
    with connect(tmp_path) as con:
        teacher_links = con.execute(
            "SELECT COUNT(DISTINCT teacher_id) FROM teacher_class_assignments WHERE class_id = ?",
            (class_id,),
        ).fetchone()[0]
        student_links = con.execute(
            "SELECT COUNT(DISTINCT student_id) FROM class_students WHERE class_id = ?",
            (class_id,),
        ).fetchone()[0]
        school_users = con.execute("SELECT COUNT(*) FROM users WHERE school_id = ?", (school_id,)).fetchone()[0]
    assert teacher_links == 3
    assert student_links == 5
    assert school_users == 9


def test_seed_adaptive_histories_is_idempotent_and_has_ten_wrong_answers(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    seeded = seed_demo_accounts(tmp_path)
    for _ in range(2):
        seed_demo_adaptive_histories(
            tmp_path,
            teacher=seeded["teachers"][0],
            class_id=str(seeded["class"]["id"]),
            students=seeded["students"],
        )

    with connect(tmp_path) as con:
        publication_count = con.execute(
            "SELECT COUNT(*) FROM exam_publications WHERE title LIKE '演示历史错题 %'"
        ).fetchone()[0]
        wrong_count = con.execute(
            """
            SELECT COUNT(*) FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.title LIKE '演示历史错题 %' AND ans.is_correct = 0
            """
        ).fetchone()[0]
    assert publication_count == 10
    assert wrong_count == 10


def test_seed_demo_attempts_creates_varied_idempotent_answer_data(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    seeded = seed_demo_accounts(tmp_path)
    teacher = seeded["teachers"][0]
    school = seeded["school"]
    class_id = str(seeded["class"]["id"])
    with connect(tmp_path) as con:
        con.execute(
            """
            INSERT INTO paper_records
              (id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at)
            VALUES ('paper-demo', 'demo-online/Math', '演示线上答题', 'Math', 'online', ?, ?, 'published', ?, ?)
            """,
            (teacher["id"], school["id"], "2026-08-01T00:00:00+00:00", "2026-08-01T00:00:00+00:00"),
        )
        con.execute(
            """
            INSERT INTO exam_publications
              (id, paper_id, teacher_id, title, show_results_immediately, status, created_at, updated_at)
            VALUES ('publication-demo', 'paper-demo', ?, '演示线上答题', 1, 'published', ?, ?)
            """,
            (teacher["id"], "2026-08-01T00:00:00+00:00", "2026-08-01T00:00:00+00:00"),
        )
        con.execute(
            "INSERT INTO publication_classes (publication_id, class_id) VALUES ('publication-demo', ?)",
            (class_id,),
        )

    for _ in range(2):
        seed_demo_attempts(tmp_path, publication_id="publication-demo", class_id=class_id)

    with connect(tmp_path) as con:
        statuses = {
            str(row["student_no"]): str(row["status"])
            for row in con.execute(
                """
                SELECT s.student_no, sa.status
                FROM student_attempts sa JOIN students s ON s.id = sa.student_id
                WHERE sa.publication_id = 'publication-demo'
                """
            ).fetchall()
        }
        submitted_scores = [
            float(row[0])
            for row in con.execute(
                """
                SELECT sa.score FROM student_attempts sa JOIN students s ON s.id = sa.student_id
                WHERE sa.publication_id = 'publication-demo' AND sa.status = 'submitted'
                ORDER BY s.student_no
                """
            ).fetchall()
        ]
        answer_count = con.execute(
            """
            SELECT COUNT(*) FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            WHERE sa.publication_id = 'publication-demo'
            """
        ).fetchone()[0]
        event_count = con.execute(
            "SELECT COUNT(*) FROM proctor_events WHERE publication_id = 'publication-demo'"
        ).fetchone()[0]
        frozen_count = con.execute(
            """
            SELECT COUNT(*) FROM student_attempts
            WHERE publication_id = 'publication-demo' AND question_payload_json IS NOT NULL AND answer_key_json IS NOT NULL
            """
        ).fetchone()[0]

    assert statuses == {
        "S001": "submitted",
        "S002": "submitted",
        "S003": "submitted",
        "S004": "in_progress",
        "S005": "submitted",
    }
    assert submitted_scores == [10.0, 5.0, 0.0, 5.0]
    assert answer_count == 9
    assert event_count == 6
    assert frozen_count == 5
