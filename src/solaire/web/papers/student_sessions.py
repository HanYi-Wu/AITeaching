"""Student qualification, assignment and frozen examination session reads."""

from __future__ import annotations

from contextlib import closing

import json
import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.papers.class_snapshots import freeze_attempt_class_memberships
from solaire.web.papers.scoring import score_percent
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.papers.exam_timing import (
    _publication_availability, _time_limit_exceeded, _remaining_seconds,
    _ensure_attempt_can_collect, _ensure_attempt_can_submit,
)
from solaire.web.papers.snapshots import _load_attempt_question_payloads, public_snapshot_identity, project_scope_identity


def _new_id() -> str:
    return uuid.uuid4().hex

def _student_for_user_in_connection(con: Any, user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "student":
        raise PermissionError("Student role required")
    row = con.execute(
        """
        SELECT s.*, u.username AS account_username
        FROM students s
        JOIN users u ON u.id = s.user_id
        WHERE s.user_id = ? AND s.status = 'active' AND u.status = 'active'
        """,
        (str(user["id"]),),
    ).fetchone()
    student = row_to_dict(row)
    if student is None:
        raise PermissionError("Active student profile required")
    return student


def _student_for_user(root: Path, user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "student":
        raise PermissionError("Student role required")
    init_platform_db(root)
    with closing(connect(root)) as con, con:
        return _student_for_user_in_connection(con, user)


def _student_and_attempt_for_user(root: Path, user: dict[str, Any], attempt_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if user.get("role") != "student":
        raise PermissionError("Student role required")
    init_platform_db(root)
    with closing(connect(root)) as con, con:
        student = _student_for_user_in_connection(con, user)
        attempt = _attempt_for_student_in_connection(con, attempt_id, str(student["id"]))
    return student, attempt

def _score_percent(score: object, max_score: object) -> float | None:
    return score_percent(score, max_score, legacy_zero_max=True)

def _saved_answer_payloads(root: Path, attempt_id: str) -> list[dict[str, Any]]:
    with closing(connect(root)) as con, con:
        rows = con.execute(
            "SELECT question_id, answer_payload FROM student_answers WHERE attempt_id = ? ORDER BY responded_at, question_id",
            (attempt_id,),
        ).fetchall()
    saved: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(str(row["answer_payload"] or "{}"))
        except json.JSONDecodeError:
            payload = {}
        images = payload.get("images")
        saved.append(
            {
                "question_id": str(row["question_id"]),
                "answer": payload.get("answer"),
                "images": images if isinstance(images, list) else [],
            }
        )
    return saved

def _ensure_assigned_attempt(root: Path, publication_id: str, student_id: str) -> dict[str, Any]:
    with closing(connect(root)) as con, con:
        publication = con.execute(
            """
            SELECT ep.*, pr.exam_id, pr.title AS paper_title, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id
            FROM exam_publications ep
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE ep.id = ? AND ep.status IN ('published', 'paused', 'closed')
            """,
            (publication_id,),
        ).fetchone()
        if publication is None:
            raise PermissionError("No assigned publication for this student")
        current_class_member = con.execute(
            """SELECT 1 FROM publication_classes pc JOIN class_students cs ON cs.class_id=pc.class_id
               WHERE pc.publication_id=? AND cs.student_id=? LIMIT 1""",
            (publication_id, student_id),
        ).fetchone() is not None
        assigned = con.execute(
            """SELECT sa.id FROM student_attempts sa
               WHERE sa.publication_id=? AND sa.student_id=? LIMIT 1""",
            (publication_id, student_id),
        ).fetchone()
        if not current_class_member and assigned is None:
            raise PermissionError("No assigned publication for this student")
        if publication["practice_kind"] or publication["recipient_scope"] == "student" or publication["folder_id"]:
            # A folder-bound release has a frozen recipient roster. Newly added classmates
            # must not silently acquire another attempt in a one-per-student folder.
            folder_kind = con.execute("SELECT kind FROM content_folders WHERE id=?", (publication["folder_id"],)).fetchone()
            fixed_roster = publication["practice_kind"] or publication["recipient_scope"] == "student" or (folder_kind and folder_kind["kind"] == "paper")
        else:
            fixed_roster = False
        if fixed_roster:
            fixed_assignment = con.execute(
                "SELECT 1 FROM student_attempts WHERE publication_id = ? AND student_id = ?",
                (publication_id, student_id),
            ).fetchone()
            if fixed_assignment is None:
                raise PermissionError("No personalized practice assigned for this student")
        elif current_class_member:
            attempt_id = _new_id()
            inserted = con.execute(
                """
                INSERT OR IGNORE INTO student_attempts (id, publication_id, student_id, status)
                VALUES (?, ?, ?, 'not_started')
                """,
                (attempt_id, publication_id, student_id),
            )
            if inserted.rowcount:
                freeze_attempt_class_memberships(con, [attempt_id], captured_at=utc_now())
        elif assigned is None:
            raise PermissionError("No assigned publication for this student")
        row = con.execute(
            """
            SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
                   ep.submission_mode, ep.recipient_scope, ep.max_screen_switches, ep.start_at, ep.end_at, ep.time_limit_minutes,
                   pr.exam_id, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id, pr.title AS paper_title,
                   COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'), 0) AS screen_switch_count
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.publication_id = ? AND sa.student_id = ?
            """,
            (publication_id, student_id),
        ).fetchone()
    attempt = row_to_dict(row)
    if attempt is None:
        raise RuntimeError("failed to create student attempt")
    return attempt

def _attempt_for_student(root: Path, attempt_id: str, student_id: str) -> dict[str, Any]:
    with closing(connect(root)) as con, con:
        attempt = _attempt_for_student_in_connection(con, attempt_id, student_id)
    return attempt

def _attempt_for_student_in_connection(con: Any, attempt_id: str, student_id: str) -> dict[str, Any]:
    row = con.execute(
        """
        SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
               ep.submission_mode, ep.recipient_scope, ep.max_screen_switches, ep.start_at, ep.end_at, ep.time_limit_minutes,
               pr.exam_id, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id, pr.title AS paper_title,
               COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'), 0) AS screen_switch_count
        FROM student_attempts sa
        JOIN exam_publications ep ON ep.id = sa.publication_id
        JOIN paper_records pr ON pr.id = ep.paper_id
        WHERE sa.id = ? AND sa.student_id = ?
        """,
        (attempt_id, student_id),
    ).fetchone()
    attempt = row_to_dict(row)
    if attempt is None:
        raise PermissionError("No permission for this attempt")
    return attempt

def _attempt_payload(row: dict[str, Any]) -> dict[str, Any]:
    results_released = bool(row.get("grading_completed_at"))
    payload = {
        "id": row["id"],
        "publication_id": row["publication_id"],
        "paper_id": row["paper_id"],
        "exam_id": row["exam_id"],
        "title": row.get("title") or row.get("paper_title"),
        "subject": row.get("subject"),
        "status": row.get("status"),
        "started_at": row.get("started_at"),
        "submitted_at": row.get("submitted_at"),
        "score": row.get("score") if results_released else None,
        "max_score": row.get("max_score") if results_released else None,
        "score_percent": _score_percent(row.get("score"), row.get("max_score")) if results_released else None,
        "time_spent_seconds": int(row.get("time_spent_seconds") or 0),
        # A stored/AI score is only a draft until a teacher explicitly finishes
        # the whole submission.  Publication timing must never expose it early.
        "show_results": results_released,
        "results_released": results_released,
        "grading_completed_at": row.get("grading_completed_at"),
        "submission_mode": row.get("submission_mode") or "online",
        "recipient_scope": row.get("recipient_scope") or "class",
        "publication_status": row.get("publication_status"),
        "start_at": row.get("start_at"),
        "end_at": row.get("end_at"),
        "time_limit_minutes": int(row["time_limit_minutes"]) if row.get("time_limit_minutes") is not None else None,
        "can_answer": _publication_availability(row)[0]
        and (not _time_limit_exceeded(row) or str(row.get("status")) == "in_progress"),
        "remaining_seconds": _remaining_seconds(row),
    }
    if row.get("practice_metadata_json"):
        try:
            metadata = json.loads(str(row["practice_metadata_json"]))
        except json.JSONDecodeError:
            metadata = None
        if isinstance(metadata, dict):
            payload["practice_metadata"] = metadata
    return payload

def list_student_papers(root: Path, project_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    student = _student_for_user(root, user)
    student_id = str(student["id"])
    with closing(connect(root)) as con, con:
        pub_rows = con.execute(
            """
            SELECT DISTINCT ep.id
            FROM exam_publications ep
            WHERE ep.status IN ('published', 'paused', 'closed')
              AND (
                  ((ep.practice_kind IS NULL AND ep.recipient_scope = 'class'
                    AND NOT EXISTS (SELECT 1 FROM content_folders cf WHERE cf.id=ep.folder_id AND cf.kind='paper'))
                   AND EXISTS (
                     SELECT 1 FROM publication_classes pc JOIN class_students cs ON cs.class_id=pc.class_id
                     WHERE pc.publication_id=ep.id AND cs.student_id=?
                   ))
                OR EXISTS (
                    SELECT 1 FROM student_attempts assigned
                    WHERE assigned.publication_id=ep.id AND assigned.student_id=?
                )
              )
            ORDER BY ep.created_at DESC
            """,
            (student_id, student_id),
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in pub_rows:
        attempt = _ensure_assigned_attempt(root, str(row["id"]), student_id)
        payload = _attempt_payload(attempt)
        try:
            questions, _answers = _load_attempt_question_payloads(project_root, attempt, root=root)
            question_count = len(questions)
            paper_max_score = round(sum(float(item.get("score_per_item") or 0) for item in questions), 2)
        except Exception:
            question_count = 0
            paper_max_score = None
        payload.update(
            {
                "publication_id": attempt["publication_id"],
                "attempt_id": attempt["id"],
                "question_count": question_count,
                "paper_max_score": paper_max_score,
            }
        )
        items.append(payload)
    return items

def start_student_publication(
    root: Path,
    project_root: Path,
    *,
    publication_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _ensure_assigned_attempt(root, publication_id, str(student["id"]))
    if str(attempt.get("status")) != "submitted":
        if str(attempt.get("status")) == "in_progress" and _time_limit_exceeded(attempt):
            # Let a student recover the frozen questions and saved draft after a
            # browser crash; the zero-second client timer will atomically submit it.
            _ensure_attempt_can_submit(attempt)
        else:
            _ensure_attempt_can_collect(attempt)
    now = utc_now()
    if str(attempt.get("status")) == "not_started":
        with closing(connect(root)) as con, con:
            con.execute(
                "UPDATE student_attempts SET status = 'in_progress', started_at = ? WHERE id = ?",
                (now, attempt["id"]),
            )
        attempt = _attempt_for_student(root, str(attempt["id"]), str(student["id"]))
    questions, _answers = _load_attempt_question_payloads(project_root, attempt, root=root)
    public_questions = [
        {
            key: value
            for key, value in question.items()
            if key not in {"analysis", "answer", "correct_answer"}
        }
        for question in questions
    ]
    attempt_payload = _attempt_payload(attempt)
    attempt_payload["snapshot_version"] = public_snapshot_identity(public_questions)
    attempt_payload["project_scope"] = project_scope_identity(project_root)
    return {
        "attempt": attempt_payload,
        "questions": public_questions,
        "saved_answers": _saved_answer_payloads(root, str(attempt["id"])),
    }
