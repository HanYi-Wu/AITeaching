from __future__ import annotations

import json
import uuid
from pathlib import Path

import yaml

from solaire.exam_compiler.models import ExamConfig, SelectedSection
from solaire.web import state
from solaire.web.auth_service import hash_password, utc_now
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.paper_service import publish_online_paper, sync_paper_for_exam
from solaire.web.platform_db import connect, default_platform_root, init_platform_db, row_to_dict
from solaire.web.project_layout import ensure_project_layout


PASSWORDS = {
    "demo_admin": "demo123",
    "demo_school": "school123",
    "demo_teacher": "teacher123",
    "demo_teacher2": "teacher123",
    "demo_teacher3": "teacher123",
    "demo_student": "student123",
    "demo_student2": "student123",
    "demo_student3": "student123",
    "demo_student4": "student123",
    "demo_student5": "student123",
}


def new_id() -> str:
    return uuid.uuid4().hex


def upsert_user(
    root: Path,
    *,
    username: str,
    password: str,
    role: str,
    display_name: str,
    school_id: str | None = None,
    must_change_password: bool | None = None,
) -> dict[str, object]:
    now = utc_now()
    must_change = int(role == "student") if must_change_password is None else int(must_change_password)
    with connect(root) as con:
        row = con.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if row is None:
            user_id = new_id()
            con.execute(
                """
                INSERT INTO users (
                  id, school_id, role, username, password_hash, display_name, email, status,
                  must_change_password, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?)
                """,
                (user_id, school_id, role, username, hash_password(password), display_name, must_change, now, now),
            )
        else:
            user_id = str(row["id"])
            con.execute(
                """
                UPDATE users
                SET school_id = ?, role = ?, password_hash = ?, display_name = ?, status = 'active',
                    must_change_password = ?, updated_at = ?
                WHERE id = ?
                """,
                (school_id, role, hash_password(password), display_name, must_change, now, user_id),
            )
        updated = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    user = row_to_dict(updated)
    if user is None:
        raise RuntimeError(f"failed to upsert user: {username}")
    user.pop("password_hash", None)
    return user


def get_or_create_school(root: Path) -> dict[str, object]:
    now = utc_now()
    with connect(root) as con:
        row = con.execute("SELECT * FROM schools WHERE name = ?", ("演示学校",)).fetchone()
        if row is None:
            school_id = new_id()
            con.execute(
                """
                INSERT INTO schools (id, name, status, ai_enabled, created_at, updated_at)
                VALUES (?, '演示学校', 'active', 1, ?, ?)
                """,
                (school_id, now, now),
            )
        else:
            school_id = str(row["id"])
            con.execute(
                "UPDATE schools SET status = 'active', ai_enabled = 1, updated_at = ? WHERE id = ?",
                (now, school_id),
            )
        updated = con.execute("SELECT * FROM schools WHERE id = ?", (school_id,)).fetchone()
    school = row_to_dict(updated)
    if school is None:
        raise RuntimeError("failed to create demo school")
    return school


def get_or_create_class(root: Path, school_id: str) -> dict[str, object]:
    now = utc_now()
    with connect(root) as con:
        row = con.execute(
            "SELECT * FROM classes WHERE school_id = ? AND name = ?",
            (school_id, "演示一班"),
        ).fetchone()
        if row is None:
            class_id = new_id()
            con.execute(
                """
                INSERT INTO classes (id, school_id, name, grade, subject_hint, created_at, updated_at)
                VALUES (?, ?, '演示一班', 'G10', NULL, ?, ?)
                """,
                (class_id, school_id, now, now),
            )
        else:
            class_id = str(row["id"])
            con.execute(
                "UPDATE classes SET grade = 'G10', subject_hint = NULL, updated_at = ? WHERE id = ?",
                (now, class_id),
            )
        updated = con.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
    klass = row_to_dict(updated)
    if klass is None:
        raise RuntimeError("failed to create demo class")
    return klass


def ensure_student(
    root: Path,
    *,
    school_id: str,
    class_id: str,
    user_id: str,
    student_no: str,
    display_name: str,
    initial_password: str,
) -> dict[str, object]:
    now = utc_now()
    with connect(root) as con:
        row = con.execute(
            "SELECT * FROM students WHERE school_id = ? AND student_no = ?",
            (school_id, student_no),
        ).fetchone()
        if row is None:
            student_id = new_id()
            con.execute(
                """
                INSERT INTO students (
                  id, school_id, user_id, student_no, display_name, email, initial_password, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?)
                """,
                (student_id, school_id, user_id, student_no, display_name, initial_password, now, now),
            )
        else:
            student_id = str(row["id"])
            con.execute(
                """
                UPDATE students
                SET user_id = ?, display_name = ?, initial_password = ?, status = 'active', updated_at = ?
                WHERE id = ?
                """,
                (user_id, display_name, initial_password, now, student_id),
            )
        con.execute(
            "INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)",
            (class_id, student_id),
        )
        updated = con.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    student = row_to_dict(updated)
    if student is None:
        raise RuntimeError("failed to create demo student")
    return student


def ensure_teacher_links(root: Path, *, school_id: str, teacher_id: str, class_id: str) -> None:
    with connect(root) as con:
        con.execute("DELETE FROM teacher_subjects WHERE teacher_id = ?", (teacher_id,))
        con.execute(
            "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, 'Math')",
            (new_id(), teacher_id),
        )
        con.execute(
            """
            INSERT OR IGNORE INTO teacher_class_assignments (teacher_id, class_id, subject)
            VALUES (?, ?, '')
            """,
            (teacher_id, class_id),
        )


def write_exam(project_root: Path, *, label: str, title: str) -> str:
    ensure_project_layout(project_root)
    exam_id = f"{label}/Math"
    exam_dir = workspace_dir(project_root, exam_id)
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": title, "subject": "Math", "export_label": label},
        question_libraries=[],
        template_path="templates/test.yaml",
        selected_items=[
            SelectedSection(section_id="Choice", question_ids=["demo/q1", "demo/q2"], score_per_item=5.0)
        ],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)
    return exam_id


def publish_demo_exam(
    platform_root: Path,
    project_root: Path,
    *,
    teacher: dict[str, object],
    class_id: str,
    exam_id: str,
    submission_mode: str,
    max_screen_switches: int,
) -> dict[str, object]:
    paper = sync_paper_for_exam(project_root, platform_root, teacher, exam_id=exam_id)
    try:
        return publish_online_paper(
            platform_root,
            paper_id=str(paper["paper_id"]),
            user=teacher,
            class_ids=[class_id],
            project_root=project_root,
            title=str(paper["title"]),
            submission_mode=submission_mode,
            show_results_immediately=True,
            max_screen_switches=max_screen_switches,
        )
    except ValueError as exc:
        if "already published" not in str(exc):
            raise
    with connect(platform_root) as con:
        row = con.execute(
            """
            SELECT ep.*
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            WHERE ep.paper_id = ? AND pc.class_id = ? AND ep.status <> 'revoked'
            ORDER BY ep.created_at DESC
            LIMIT 1
            """,
            (str(paper["paper_id"]), class_id),
        ).fetchone()
        if row is None:
            raise RuntimeError("failed to find existing demo publication")
        con.execute(
            """
            UPDATE exam_publications
            SET submission_mode = ?, show_results_immediately = 1, max_screen_switches = ?, updated_at = ?
            WHERE id = ?
            """,
            (submission_mode, max_screen_switches, utc_now(), str(row["id"])),
        )
        updated = con.execute("SELECT * FROM exam_publications WHERE id = ?", (str(row["id"]),)).fetchone()
    publication = row_to_dict(updated)
    if publication is None:
        raise RuntimeError("failed to load existing demo publication")
    return publication


def seed_demo_attempts(root: Path, *, publication_id: str, class_id: str) -> None:
    now = utc_now()
    with connect(root) as con:
        students = con.execute(
            """
            SELECT s.id, s.student_no
            FROM students s
            JOIN class_students cs ON cs.student_id = s.id
            WHERE cs.class_id = ?
            ORDER BY s.student_no
            """,
            (class_id,),
        ).fetchall()
        for row in students:
            con.execute(
                """
                INSERT OR IGNORE INTO student_attempts (id, publication_id, student_id, status)
                VALUES (?, ?, ?, 'not_started')
                """,
                (new_id(), publication_id, str(row["id"])),
            )
        attempts = con.execute(
            """
            SELECT sa.id, sa.student_id, s.student_no
            FROM student_attempts sa
            JOIN students s ON s.id = sa.student_id
            WHERE sa.publication_id = ?
            ORDER BY s.student_no
            """,
            (publication_id,),
        ).fetchall()
        con.execute("DELETE FROM proctor_events WHERE publication_id = ?", (publication_id,))
        for attempt in attempts:
            if str(attempt["student_no"]) == "S001":
                con.execute(
                    """
                    UPDATE student_attempts
                    SET status = 'submitted', score = 8, max_score = 10,
                        started_at = '2026-07-04T08:00:00+00:00',
                        submitted_at = '2026-07-04T08:28:00+00:00',
                        time_spent_seconds = 1680
                    WHERE id = ?
                    """,
                    (str(attempt["id"]),),
                )
                events = [
                    ("visibility_hidden", 1100),
                    ("window_blur", 0),
                ]
            else:
                con.execute(
                    """
                    UPDATE student_attempts
                    SET status = 'in_progress',
                        started_at = '2026-07-04T08:05:00+00:00',
                        submitted_at = NULL,
                        score = NULL,
                        max_score = NULL,
                        time_spent_seconds = 600
                    WHERE id = ?
                    """,
                    (str(attempt["id"]),),
                )
                events = [("visibility_hidden", 700)]
            for event_type, duration_ms in events:
                con.execute(
                    """
                    INSERT INTO proctor_events (
                      id, attempt_id, student_id, publication_id, event_type, occurred_at, duration_ms, payload_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
                    """,
                    (
                        new_id(),
                        str(attempt["id"]),
                        str(attempt["student_id"]),
                        publication_id,
                        event_type,
                        now,
                        duration_ms,
                    ),
                )


def seed_demo_adaptive_histories(
    root: Path,
    *,
    teacher: dict[str, object],
    class_id: str,
    students: list[dict[str, object]],
) -> None:
    """Create ten idempotent submitted histories for adaptive-practice demos."""
    init_platform_db(root)
    now = utc_now()
    with connect(root) as con:
        for index in range(1, 11):
            exam_id = f"demo-history/{index:02d}"
            title = f"演示历史错题 {index:02d}"
            paper_row = con.execute(
                "SELECT id FROM paper_records WHERE exam_id = ? AND subject = 'Math'",
                (exam_id,),
            ).fetchone()
            if paper_row is None:
                paper_id = new_id()
                con.execute(
                    """
                    INSERT INTO paper_records (
                      id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id,
                      status, created_at, updated_at
                    ) VALUES (?, ?, ?, 'Math', 'online', ?, ?, 'published', ?, ?)
                    """,
                    (paper_id, exam_id, title, str(teacher["id"]), teacher.get("school_id"), now, now),
                )
            else:
                paper_id = str(paper_row["id"])

            publication_row = con.execute(
                """
                SELECT ep.id FROM exam_publications ep
                JOIN publication_classes pc ON pc.publication_id = ep.id
                WHERE ep.paper_id = ? AND pc.class_id = ? AND ep.status <> 'revoked'
                LIMIT 1
                """,
                (paper_id, class_id),
            ).fetchone()
            if publication_row is None:
                publication_id = new_id()
                con.execute(
                    """
                    INSERT INTO exam_publications (
                      id, paper_id, teacher_id, title, show_results_immediately, submission_mode,
                      max_screen_switches, time_limit_minutes, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 1, 'online', 2, 30, 'published', ?, ?)
                    """,
                    (publication_id, paper_id, str(teacher["id"]), title, now, now),
                )
                con.execute(
                    "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
                    (publication_id, class_id),
                )
            else:
                publication_id = str(publication_row["id"])

            question_id = f"demo_history/{index:02d}/q1"
            correct_answer = "B"
            questions = [
                {
                    "question_id": question_id,
                    "header": f"历史错题 {index:02d}",
                    "section_id": "practice",
                    "score_per_item": 5,
                    "type": "single_choice",
                    "content": f"{index + 2} × 4 等于多少？",
                    "options": {"A": str((index + 2) * 3), "B": str((index + 2) * 4)},
                }
            ]
            for student_index, student in enumerate(students):
                attempt_row = con.execute(
                    "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
                    (publication_id, str(student["id"])),
                ).fetchone()
                attempt_id = str(attempt_row["id"]) if attempt_row is not None else new_id()
                if attempt_row is None:
                    con.execute(
                        """
                        INSERT INTO student_attempts (
                          id, publication_id, student_id, status, started_at, submitted_at,
                          score, max_score, time_spent_seconds, question_payload_json, answer_key_json
                        ) VALUES (?, ?, ?, 'submitted', ?, ?, ?, 5, 600, ?, ?)
                        """,
                        (
                            attempt_id,
                            publication_id,
                            str(student["id"]),
                            now,
                            now,
                            0 if student_index == 0 else 5,
                            json.dumps(questions, ensure_ascii=False),
                            json.dumps({question_id: correct_answer}),
                        ),
                    )
                else:
                    con.execute(
                        """
                        UPDATE student_attempts SET
                          status = 'submitted', started_at = ?, submitted_at = ?, score = ?, max_score = 5,
                          time_spent_seconds = 600, question_payload_json = ?, answer_key_json = ?
                        WHERE id = ?
                        """,
                        (
                            now,
                            now,
                            0 if student_index == 0 else 5,
                            json.dumps(questions, ensure_ascii=False),
                            json.dumps({question_id: correct_answer}),
                            attempt_id,
                        ),
                    )
                student_answer = "A" if student_index == 0 else correct_answer
                con.execute("DELETE FROM student_answers WHERE attempt_id = ? AND question_id = ?", (attempt_id, question_id))
                con.execute(
                    """
                    INSERT INTO student_answers (
                      id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'auto_scored', ?)
                    """,
                    (
                        new_id(),
                        attempt_id,
                        question_id,
                        json.dumps({"answer": student_answer}),
                        0 if student_index == 0 else 1,
                        0 if student_index == 0 else 5,
                        now,
                    ),
                )


def seed_demo_accounts(platform_root: Path) -> dict[str, object]:
    init_platform_db(platform_root)
    school = get_or_create_school(platform_root)
    school_id = str(school["id"])
    klass = get_or_create_class(platform_root, school_id)
    class_id = str(klass["id"])

    upsert_user(
        platform_root,
        username="demo_admin",
        password=PASSWORDS["demo_admin"],
        role="admin",
        display_name="演示管理员",
    )
    upsert_user(
        platform_root,
        username="demo_school",
        password=PASSWORDS["demo_school"],
        role="school",
        display_name="演示学校端",
        school_id=school_id,
    )
    teachers: list[dict[str, object]] = []
    for index, username in enumerate(("demo_teacher", "demo_teacher2", "demo_teacher3"), start=1):
        teacher = upsert_user(
            platform_root,
            username=username,
            password=PASSWORDS[username],
            role="teacher",
            display_name=f"演示教师{index}",
            school_id=school_id,
        )
        ensure_teacher_links(platform_root, school_id=school_id, teacher_id=str(teacher["id"]), class_id=class_id)
        teachers.append(teacher)

    students: list[dict[str, object]] = []
    for index, username in enumerate(
        ("demo_student", "demo_student2", "demo_student3", "demo_student4", "demo_student5"),
        start=1,
    ):
        display_name = f"演示学生{index}"
        student_user = upsert_user(
            platform_root,
            username=username,
            password=PASSWORDS[username],
            role="student",
            display_name=display_name,
            school_id=school_id,
            must_change_password=False,
        )
        student = ensure_student(
            platform_root,
            school_id=school_id,
            class_id=class_id,
            user_id=str(student_user["id"]),
            student_no=f"S{index:03d}",
            display_name=display_name,
            initial_password=PASSWORDS[username],
        )
        students.append(student)

    return {"school": school, "class": klass, "teachers": teachers, "students": students}


def main() -> None:
    platform_root = default_platform_root()
    project_root = state.default_content_root()
    ensure_project_layout(project_root)
    seeded = seed_demo_accounts(platform_root)
    teacher = seeded["teachers"][0]
    class_id = str(seeded["class"]["id"])

    online_exam = write_exam(project_root, label="demo-online", title="演示线上答题")
    image_exam = write_exam(project_root, label="demo-image", title="演示图片AI批改")
    online_publication = publish_demo_exam(
        platform_root,
        project_root,
        teacher=teacher,
        class_id=class_id,
        exam_id=online_exam,
        submission_mode="online",
        max_screen_switches=1,
    )
    publish_demo_exam(
        platform_root,
        project_root,
        teacher=teacher,
        class_id=class_id,
        exam_id=image_exam,
        submission_mode="image_ai",
        max_screen_switches=0,
    )
    seed_demo_attempts(platform_root, publication_id=str(online_publication["id"]), class_id=class_id)
    seed_demo_adaptive_histories(
        platform_root,
        teacher=teacher,
        class_id=class_id,
        students=seeded["students"],
    )

    print(f"platform_root={platform_root}")
    print(f"content_root={project_root}")
    for username, password in PASSWORDS.items():
        print(f"{username} / {password}")


if __name__ == "__main__":
    main()
