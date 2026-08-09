from __future__ import annotations

from pathlib import Path

from scripts.seed_demo_data import PASSWORDS, seed_demo_accounts, seed_demo_adaptive_histories
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
