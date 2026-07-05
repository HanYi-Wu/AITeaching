"""Paper management services for offline/online exam delivery."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.result_service import list_exam_results

DELIVERY_MODES = {"offline", "online"}


def _new_id() -> str:
    return uuid.uuid4().hex


def _clean_subject(value: object) -> str:
    return str(value or "").strip() or "未分科"


def _clean_title(value: object, fallback: str) -> str:
    return str(value or "").strip() or fallback


def _paper_record_for_exam(root: Path, exam: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    exam_id = str(exam.get("exam_id") or "").strip()
    if not exam_id:
        raise ValueError("exam_id is required")
    subject = _clean_subject(exam.get("subject"))
    title = _clean_title(exam.get("exam_title"), exam_id)
    now = utc_now()
    user_role = str(user.get("role") or "")
    owner_teacher_id = str(user.get("id")) if user_role == "teacher" else None
    school_id = str(user.get("school_id")) if user.get("school_id") else None

    with connect(root) as con:
        row = con.execute(
            "SELECT * FROM paper_records WHERE exam_id = ? AND subject = ?",
            (exam_id, subject),
        ).fetchone()
        if row is None:
            paper_id = _new_id()
            con.execute(
                """
                INSERT INTO paper_records (
                  id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 'offline', ?, ?, 'draft', ?, ?)
                """,
                (paper_id, exam_id, title, subject, owner_teacher_id, school_id, now, now),
            )
        else:
            paper_id = str(row["id"])
            updates: list[str] = ["title = ?", "subject = ?", "updated_at = ?"]
            params: list[object] = [title, subject, now]
            if owner_teacher_id and row["owner_teacher_id"] is None:
                updates.append("owner_teacher_id = ?")
                params.append(owner_teacher_id)
            if school_id and row["school_id"] is None:
                updates.append("school_id = ?")
                params.append(school_id)
            params.append(paper_id)
            con.execute(f"UPDATE paper_records SET {', '.join(updates)} WHERE id = ?", params)
        stored = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(stored)
    if paper is None:
        raise RuntimeError("failed to sync paper record")
    return paper


def _publication_stats(root: Path, paper_id: str) -> dict[str, int]:
    with connect(root) as con:
        publication_count = con.execute(
            "SELECT COUNT(*) AS n FROM exam_publications WHERE paper_id = ?",
            (paper_id,),
        ).fetchone()["n"]
        published_class_count = con.execute(
            """
            SELECT COUNT(DISTINCT pc.class_id) AS n
            FROM publication_classes pc
            JOIN exam_publications ep ON ep.id = pc.publication_id
            WHERE ep.paper_id = ?
            """,
            (paper_id,),
        ).fetchone()["n"]
    return {"publication_count": int(publication_count), "published_class_count": int(published_class_count)}


def list_papers(project_root: Path, platform_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(platform_root)
    exams = list_exam_results(project_root)
    papers: list[dict[str, Any]] = []
    for exam in exams:
        record = _paper_record_for_exam(platform_root, exam, user)
        stats = _publication_stats(platform_root, str(record["id"]))
        papers.append(
            {
                "paper_id": record["id"],
                "exam_id": record["exam_id"],
                "title": record["title"],
                "subject": record["subject"],
                "delivery_mode": record["delivery_mode"],
                "status": record["status"],
                "owner_teacher_id": record["owner_teacher_id"],
                "school_id": record["school_id"],
                "question_count": int(exam.get("question_count") or 0),
                "section_count": int(exam.get("section_count") or 0),
                "score_batch_count": int(exam.get("score_batch_count") or 0),
                "has_score": bool(exam.get("has_score")),
                "has_pdf": bool(exam.get("has_pdf")),
                "has_docx": bool(exam.get("has_docx")),
                "latest_batch_id": exam.get("latest_batch_id"),
                "exam_dir": exam.get("exam_dir"),
                "mtime": exam.get("mtime"),
                **stats,
            }
        )
    return papers


def get_paper(root: Path, paper_id: str) -> dict[str, Any]:
    init_platform_db(root)
    with connect(root) as con:
        row = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(row)
    if paper is None:
        raise ValueError("paper not found")
    return paper


def update_paper_delivery_mode(root: Path, paper_id: str, delivery_mode: str, user: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("Only teachers and admins can update paper delivery mode")
    clean_mode = delivery_mode.strip()
    if clean_mode not in DELIVERY_MODES:
        raise ValueError("delivery_mode must be offline or online")
    now = utc_now()
    with connect(root) as con:
        existing = con.execute("SELECT 1 FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
        if existing is None:
            raise ValueError("paper not found")
        con.execute(
            "UPDATE paper_records SET delivery_mode = ?, updated_at = ? WHERE id = ?",
            (clean_mode, now, paper_id),
        )
        row = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(row)
    if paper is None:
        raise RuntimeError("failed to update paper")
    return paper


def _score_percent(score: object, max_score: object) -> float | None:
    if score is None:
        return None
    try:
        raw = float(score)
    except (TypeError, ValueError):
        return None
    try:
        max_raw = float(max_score)
    except (TypeError, ValueError):
        max_raw = 0
    if max_raw > 0:
        return round(raw / max_raw * 100, 2)
    return round(raw, 2)


def analyze_paper(root: Path, *, paper_id: str, user: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    role = str(user.get("role") or "")
    if role == "teacher" and paper.get("owner_teacher_id") not in (None, user.get("id")):
        raise PermissionError("Teacher can only analyze own papers")
    if role == "school" and paper.get("school_id") not in (None, user.get("school_id")):
        raise PermissionError("School can only analyze own papers")
    if role not in {"admin", "school", "teacher"}:
        raise PermissionError("Only admin, school, and teacher users can analyze papers")

    with connect(root) as con:
        publication_rows = con.execute(
            "SELECT * FROM exam_publications WHERE paper_id = ? ORDER BY created_at DESC",
            (paper_id,),
        ).fetchall()
        attempt_rows = con.execute(
            """
            SELECT
              sa.*,
              s.student_no,
              s.display_name,
              u.username AS account_username
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN students s ON s.id = sa.student_id
            LEFT JOIN users u ON u.id = s.user_id
            WHERE ep.paper_id = ?
            ORDER BY s.display_name, s.student_no
            """,
            (paper_id,),
        ).fetchall()
        event_rows = con.execute(
            """
            SELECT pe.*
            FROM proctor_events pe
            JOIN exam_publications ep ON ep.id = pe.publication_id
            WHERE ep.paper_id = ?
            ORDER BY pe.occurred_at
            """,
            (paper_id,),
        ).fetchall()

    events_by_attempt: dict[str, list[dict[str, Any]]] = {}
    for row in event_rows:
        event = row_to_dict(row) or {}
        events_by_attempt.setdefault(str(event.get("attempt_id")), []).append(event)

    students: list[dict[str, Any]] = []
    score_values: list[float] = []
    time_values: list[int] = []
    completed = 0
    in_progress = 0
    not_started = 0
    flagged_student_ids: set[str] = set()
    for row in attempt_rows:
        attempt = row_to_dict(row) or {}
        status = str(attempt.get("status") or "not_started")
        if status in {"submitted", "completed"} or attempt.get("submitted_at"):
            completed += 1
            status_group = "completed"
        elif status == "in_progress" or attempt.get("started_at"):
            in_progress += 1
            status_group = "in_progress"
        else:
            not_started += 1
            status_group = "not_started"
        score_percent = _score_percent(attempt.get("score"), attempt.get("max_score"))
        if score_percent is not None:
            score_values.append(score_percent)
        time_spent = int(attempt.get("time_spent_seconds") or 0)
        if time_spent > 0:
            time_values.append(time_spent)
        attempt_events = events_by_attempt.get(str(attempt.get("id")), [])
        screen_switch_count = len(attempt_events)
        if screen_switch_count:
            flagged_student_ids.add(str(attempt.get("student_id")))
        students.append(
            {
                "student_id": attempt.get("student_id"),
                "student_no": attempt.get("student_no"),
                "display_name": attempt.get("display_name"),
                "account_username": attempt.get("account_username"),
                "status": status_group,
                "score": attempt.get("score"),
                "max_score": attempt.get("max_score"),
                "score_percent": score_percent,
                "started_at": attempt.get("started_at"),
                "submitted_at": attempt.get("submitted_at"),
                "time_spent_seconds": time_spent,
                "screen_switch_count": screen_switch_count,
                "screen_switch_duration_ms": sum(int(event.get("duration_ms") or 0) for event in attempt_events),
            }
        )
    students.sort(
        key=lambda item: (
            -int(item.get("screen_switch_count") or 0),
            str(item.get("display_name") or ""),
            str(item.get("student_no") or ""),
        )
    )

    total = len(students)
    completion_rate = round(completed / total * 100, 2) if total else 0
    average_score = round(sum(score_values) / len(score_values), 2) if score_values else None
    average_time_seconds = round(sum(time_values) / len(time_values), 2) if time_values else None
    screen_switch_count = len(event_rows)
    screen_switch_duration_ms = sum(int(row["duration_ms"] or 0) for row in event_rows)

    return {
        "paper": {
            "paper_id": paper["id"],
            "exam_id": paper["exam_id"],
            "title": paper["title"],
            "subject": paper["subject"],
            "delivery_mode": paper["delivery_mode"],
            "status": paper["status"],
        },
        "summary": {
            "total_students": total,
            "completed_students": completed,
            "in_progress_students": in_progress,
            "not_started_students": not_started,
            "completion_rate": completion_rate,
            "average_score": average_score,
            "average_time_seconds": average_time_seconds,
            "publication_count": len(publication_rows),
        },
        "proctoring": {
            "screen_switch_count": screen_switch_count,
            "screen_switch_duration_ms": screen_switch_duration_ms,
            "flagged_student_count": len(flagged_student_ids),
        },
        "students": students,
    }


def list_teacher_classes(root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(root)
    role = user.get("role")
    with connect(root) as con:
        if role == "teacher":
            rows = con.execute(
                """
                SELECT c.id, c.school_id, c.name, c.grade, c.subject_hint, tca.subject
                FROM teacher_class_assignments tca
                JOIN classes c ON c.id = tca.class_id
                WHERE tca.teacher_id = ?
                ORDER BY c.grade, c.name, tca.subject
                """,
                (str(user["id"]),),
            ).fetchall()
        elif role == "school":
            rows = con.execute(
                """
                SELECT c.id, c.school_id, c.name, c.grade, c.subject_hint, c.subject_hint AS subject
                FROM classes c
                WHERE c.school_id = ?
                ORDER BY c.grade, c.name
                """,
                (str(user.get("school_id") or ""),),
            ).fetchall()
        elif role == "admin":
            rows = con.execute(
                """
                SELECT c.id, c.school_id, c.name, c.grade, c.subject_hint, c.subject_hint AS subject
                FROM classes c
                ORDER BY c.grade, c.name
                """
            ).fetchall()
        else:
            raise PermissionError("Only school, teacher, and admin users can list teacher classes")
    return [row_to_dict(row) or {} for row in rows]


def _validate_publish_classes(root: Path, user: dict[str, Any], class_ids: list[str]) -> list[str]:
    clean_ids = [cid.strip() for cid in class_ids if cid.strip()]
    if not clean_ids:
        raise ValueError("at least one class is required")
    unique_ids = list(dict.fromkeys(clean_ids))
    role = user.get("role")
    with connect(root) as con:
        placeholders = ",".join("?" for _ in unique_ids)
        existing_rows = con.execute(
            f"SELECT id FROM classes WHERE id IN ({placeholders})",
            tuple(unique_ids),
        ).fetchall()
        existing = {str(row["id"]) for row in existing_rows}
        missing = [cid for cid in unique_ids if cid not in existing]
        if missing:
            raise ValueError(f"class not found: {missing[0]}")
        if role == "teacher":
            assigned_rows = con.execute(
                f"""
                SELECT class_id
                FROM teacher_class_assignments
                WHERE teacher_id = ? AND class_id IN ({placeholders})
                """,
                (str(user["id"]), *unique_ids),
            ).fetchall()
            assigned = {str(row["class_id"]) for row in assigned_rows}
            denied = [cid for cid in unique_ids if cid not in assigned]
            if denied:
                raise PermissionError("Teacher is not assigned to one or more selected classes")
    return unique_ids


def publish_online_paper(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    class_ids: list[str],
    title: str | None = None,
    description: str | None = None,
    start_at: str | None = None,
    end_at: str | None = None,
    show_results_immediately: bool = False,
    randomize_questions: bool = False,
    randomize_answers: bool = False,
) -> dict[str, Any]:
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("Only teachers and admins can publish papers")
    selected_class_ids = _validate_publish_classes(root, user, class_ids)
    paper = get_paper(root, paper_id)
    now = utc_now()
    publication_id = _new_id()
    teacher_id = str(user["id"])
    publication_title = _clean_title(title, str(paper["title"]))
    clean_description = description.strip() if description and description.strip() else None

    with connect(root) as con:
        con.execute(
            """
            INSERT INTO exam_publications (
              id, paper_id, teacher_id, title, description, start_at, end_at,
              show_results_immediately, randomize_questions, randomize_answers, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
            """,
            (
                publication_id,
                paper_id,
                teacher_id,
                publication_title,
                clean_description,
                start_at,
                end_at,
                1 if show_results_immediately else 0,
                1 if randomize_questions else 0,
                1 if randomize_answers else 0,
                now,
                now,
            ),
        )
        con.executemany(
            "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
            [(publication_id, class_id) for class_id in selected_class_ids],
        )
        student_rows = con.execute(
            f"""
            SELECT DISTINCT student_id
            FROM class_students
            WHERE class_id IN ({','.join('?' for _ in selected_class_ids)})
            """,
            tuple(selected_class_ids),
        ).fetchall()
        con.executemany(
            """
            INSERT OR IGNORE INTO student_attempts (id, publication_id, student_id, status)
            VALUES (?, ?, ?, 'not_started')
            """,
            [(_new_id(), publication_id, str(row["student_id"])) for row in student_rows],
        )
        con.execute(
            "UPDATE paper_records SET delivery_mode = 'online', status = 'published', updated_at = ? WHERE id = ?",
            (now, paper_id),
        )
        row = con.execute("SELECT * FROM exam_publications WHERE id = ?", (publication_id,)).fetchone()
    publication = row_to_dict(row)
    if publication is None:
        raise RuntimeError("failed to publish paper")
    publication["class_ids"] = selected_class_ids
    publication["attempt_count"] = len(student_rows)
    return publication
