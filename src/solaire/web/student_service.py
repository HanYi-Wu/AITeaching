"""Student-side online exam services."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from solaire.exam_compiler.loaders.questions import load_all_questions
from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.web.auth_service import utc_now
from solaire.web.exam_service import _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.result_service import _flatten_questions


def _new_id() -> str:
    return uuid.uuid4().hex


def _student_for_user(root: Path, user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "student":
        raise PermissionError("Student role required")
    init_platform_db(root)
    with connect(root) as con:
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


def _normalise_answer(value: object, qtype: str | None = None) -> str:
    text = str(value or "").strip()
    if qtype in {"single_choice", "multiple_choice", "choice", "judge"}:
        chars = [ch for ch in text.upper() if ch.isalnum()]
        if qtype in {"multiple_choice"}:
            return "".join(sorted(dict.fromkeys(chars)))
        return "".join(chars)
    return " ".join(text.split()).lower()


def _score_percent(score: object, max_score: object) -> float | None:
    if score is None:
        return None
    try:
        raw = float(score)
        max_raw = float(max_score or 0)
    except (TypeError, ValueError):
        return None
    if max_raw <= 0:
        return round(raw, 2)
    return round(raw / max_raw * 100, 2)


def _load_exam_question_payloads(project_root: Path, exam_id: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    exam_dir = workspace_dir(project_root, exam_id)
    exam_yaml = exam_dir / "exam.yaml"
    if not exam_yaml.is_file():
        raise FileNotFoundError(f"exam.yaml not found for: {exam_id}")

    exam = _load_exam_config(exam_yaml)
    flattened = _flatten_questions(exam)
    loaded = None
    if exam.question_libraries:
        refs = [(ref.namespace, ref.path) for ref in exam.question_libraries]
        loaded = load_all_questions(exam_yaml, refs)

    questions: list[dict[str, Any]] = []
    answer_keys: dict[str, str] = {}
    for item in flattened:
        qid = item.question_id
        record = loaded.by_qualified.get(qid) if loaded is not None else None
        payload: dict[str, Any] = {
            "question_id": qid,
            "header": item.csv_header(),
            "section_id": item.section_id,
            "score_per_item": float(item.score_per_item),
            "type": "unknown",
            "content": qid,
            "options": None,
        }
        if isinstance(record, QuestionItem):
            payload.update(
                {
                    "type": record.type,
                    "content": record.content,
                    "options": record.options if record.options else None,
                }
            )
            answer_keys[qid] = record.answer
        elif isinstance(record, QuestionGroupRecord):
            payload.update({"type": "group", "content": record.material, "options": None})
        questions.append(payload)
    return questions, answer_keys


def _ensure_assigned_attempt(root: Path, publication_id: str, student_id: str) -> dict[str, Any]:
    with connect(root) as con:
        publication = con.execute(
            """
            SELECT ep.*, pr.exam_id, pr.title AS paper_title, pr.subject, pr.id AS paper_id
            FROM exam_publications ep
            JOIN paper_records pr ON pr.id = ep.paper_id
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN class_students cs ON cs.class_id = pc.class_id
            WHERE ep.id = ? AND cs.student_id = ? AND ep.status IN ('published', 'closed')
            LIMIT 1
            """,
            (publication_id, student_id),
        ).fetchone()
        if publication is None:
            raise PermissionError("No assigned publication for this student")
        con.execute(
            """
            INSERT OR IGNORE INTO student_attempts (id, publication_id, student_id, status)
            VALUES (?, ?, ?, 'not_started')
            """,
            (_new_id(), publication_id, student_id),
        )
        row = con.execute(
            """
            SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
                   ep.submission_mode,
                   pr.exam_id, pr.subject, pr.id AS paper_id, pr.title AS paper_title,
                   COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id), 0) AS screen_switch_count
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
    with connect(root) as con:
        row = con.execute(
            """
            SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
                   ep.submission_mode,
                   pr.exam_id, pr.subject, pr.id AS paper_id, pr.title AS paper_title,
                   COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id), 0) AS screen_switch_count
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
    return {
        "id": row["id"],
        "publication_id": row["publication_id"],
        "paper_id": row["paper_id"],
        "exam_id": row["exam_id"],
        "title": row.get("title") or row.get("paper_title"),
        "subject": row.get("subject"),
        "status": row.get("status"),
        "started_at": row.get("started_at"),
        "submitted_at": row.get("submitted_at"),
        "score": row.get("score"),
        "max_score": row.get("max_score"),
        "score_percent": _score_percent(row.get("score"), row.get("max_score")),
        "time_spent_seconds": int(row.get("time_spent_seconds") or 0),
        "screen_switch_count": int(row.get("screen_switch_count") or 0),
        "show_results": bool(row.get("show_results_immediately")) or str(row.get("publication_status")) == "closed",
        "submission_mode": row.get("submission_mode") or "online",
    }


def list_student_papers(root: Path, project_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    student = _student_for_user(root, user)
    student_id = str(student["id"])
    with connect(root) as con:
        pub_rows = con.execute(
            """
            SELECT DISTINCT ep.id
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN class_students cs ON cs.class_id = pc.class_id
            WHERE cs.student_id = ? AND ep.status IN ('published', 'closed')
            ORDER BY ep.created_at DESC
            """,
            (student_id,),
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in pub_rows:
        attempt = _ensure_assigned_attempt(root, str(row["id"]), student_id)
        payload = _attempt_payload(attempt)
        try:
            questions, _answers = _load_exam_question_payloads(project_root, str(payload["exam_id"]))
            question_count = len(questions)
        except Exception:
            question_count = 0
        payload.update(
            {
                "publication_id": attempt["publication_id"],
                "attempt_id": attempt["id"],
                "question_count": question_count,
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
    if str(attempt.get("publication_status")) != "published" and str(attempt.get("status")) != "submitted":
        raise ValueError("Publication is not open")
    now = utc_now()
    if str(attempt.get("status")) == "not_started":
        with connect(root) as con:
            con.execute(
                "UPDATE student_attempts SET status = 'in_progress', started_at = ? WHERE id = ?",
                (now, attempt["id"]),
            )
        attempt = _attempt_for_student(root, str(attempt["id"]), str(student["id"]))
    questions, _answers = _load_exam_question_payloads(project_root, str(attempt["exam_id"]))
    return {"attempt": _attempt_payload(attempt), "questions": questions}


def save_student_answers(
    root: Path,
    *,
    attempt_id: str,
    user: dict[str, Any],
    answers: list[dict[str, Any]],
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    if str(attempt.get("status")) == "submitted":
        raise ValueError("Attempt already submitted")
    now = utc_now()
    rows: list[tuple[object, ...]] = []
    for answer in answers:
        qid = str(answer.get("question_id") or "").strip()
        if not qid:
            continue
        payload: dict[str, Any] = {}
        if "answer" in answer:
            payload["answer"] = answer.get("answer")
        images = answer.get("images")
        if isinstance(images, list):
            payload["images"] = [
                {
                    "name": str(item.get("name") or "image") if isinstance(item, dict) else "image",
                    "mime_type": str(item.get("mime_type") or "") if isinstance(item, dict) else "",
                    "data_url": str(item.get("data_url") or "") if isinstance(item, dict) else "",
                }
                for item in images
                if isinstance(item, dict) and str(item.get("data_url") or "").strip()
            ]
        rows.append((_new_id(), attempt_id, qid, json.dumps(payload, ensure_ascii=False), now))
    with connect(root) as con:
        con.executemany(
            """
            INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, responded_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(attempt_id, question_id) DO UPDATE SET
              answer_payload = excluded.answer_payload,
              responded_at = excluded.responded_at,
              is_correct = NULL,
              score = NULL,
              grading_status = 'pending',
              feedback = NULL,
              ai_suggested_score = NULL,
              ai_feedback = NULL,
              ai_ocr_text = NULL,
              graded_by = NULL,
              graded_at = NULL
            """,
            rows,
        )
    return {"answer_count": len(rows)}


def record_student_proctor_event(
    root: Path,
    *,
    attempt_id: str,
    user: dict[str, Any],
    event_type: str,
    duration_ms: int | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    now = utc_now()
    event_id = _new_id()
    clean_type = event_type.strip() or "unknown"
    with connect(root) as con:
        con.execute(
            """
            INSERT INTO proctor_events (
              id, attempt_id, student_id, publication_id, event_type, occurred_at, duration_ms, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                attempt_id,
                student["id"],
                attempt["publication_id"],
                clean_type,
                now,
                duration_ms,
                json.dumps(payload or {}, ensure_ascii=False),
            ),
        )
        row = con.execute("SELECT * FROM proctor_events WHERE id = ?", (event_id,)).fetchone()
    event = row_to_dict(row)
    if event is None:
        raise RuntimeError("failed to record proctor event")
    return event


def submit_student_attempt(
    root: Path,
    project_root: Path,
    *,
    attempt_id: str,
    user: dict[str, Any],
    time_spent_seconds: int | None = None,
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    if str(attempt.get("status")) == "submitted":
        return _attempt_payload(attempt)
    questions, answer_keys = _load_exam_question_payloads(project_root, str(attempt["exam_id"]))
    qtype_by_id = {str(q["question_id"]): str(q.get("type") or "") for q in questions}
    score_by_id = {str(q["question_id"]): float(q.get("score_per_item") or 0) for q in questions}
    max_score = round(sum(score_by_id.values()), 2)

    with connect(root) as con:
        answer_rows = con.execute(
            "SELECT * FROM student_answers WHERE attempt_id = ?",
            (attempt_id,),
        ).fetchall()
        answers: dict[str, Any] = {}
        for row in answer_rows:
            try:
                payload = json.loads(str(row["answer_payload"] or "{}"))
            except json.JSONDecodeError:
                payload = {}
            answers[str(row["question_id"])] = payload.get("answer")

        scored_any = False
        total = 0.0
        for qid, raw_answer in answers.items():
            expected = answer_keys.get(qid)
            qtype = qtype_by_id.get(qid)
            if expected is None or raw_answer is None or str(raw_answer).strip() == "":
                is_correct = None
                score = None
            else:
                is_correct_bool = _normalise_answer(raw_answer, qtype) == _normalise_answer(expected, qtype)
                is_correct = 1 if is_correct_bool else 0
                score = score_by_id.get(qid, 0.0) if is_correct_bool else 0.0
                total += float(score)
                scored_any = True
            con.execute(
                "UPDATE student_answers SET is_correct = ?, score = ?, grading_status = ? WHERE attempt_id = ? AND question_id = ?",
                (is_correct, score, "auto_scored" if score is not None else "pending", attempt_id, qid),
            )
        now = utc_now()
        final_score: float | None = round(total, 2) if scored_any else None
        if not attempt.get("started_at"):
            con.execute("UPDATE student_attempts SET started_at = ? WHERE id = ?", (now, attempt_id))
        con.execute(
            """
            UPDATE student_attempts
            SET status = 'submitted', submitted_at = ?, score = ?, max_score = ?, time_spent_seconds = ?
            WHERE id = ?
            """,
            (now, final_score, max_score, int(time_spent_seconds or 0), attempt_id),
        )
    return _attempt_payload(_attempt_for_student(root, attempt_id, str(student["id"])))


def list_student_results(root: Path, project_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    student = _student_for_user(root, user)
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
                   ep.submission_mode,
                   pr.exam_id, pr.subject, pr.id AS paper_id, pr.title AS paper_title,
                   COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id), 0) AS screen_switch_count,
                   COALESCE((SELECT SUM(duration_ms) FROM proctor_events pe WHERE pe.attempt_id = sa.id), 0) AS screen_switch_duration_ms
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.student_id = ? AND (sa.status = 'submitted' OR sa.submitted_at IS NOT NULL)
            ORDER BY sa.submitted_at DESC
            """,
            (str(student["id"]),),
        ).fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        attempt = row_to_dict(row) or {}
        payload = _attempt_payload(attempt)
        show_results = bool(payload["show_results"])
        question_order: list[str] = []
        try:
            questions, _answer_keys = _load_exam_question_payloads(project_root, str(attempt["exam_id"]))
            question_order = [str(q["question_id"]) for q in questions]
        except Exception:
            pass
        with connect(root) as con:
            answer_rows = con.execute(
                "SELECT * FROM student_answers WHERE attempt_id = ?",
                (attempt["id"],),
            ).fetchall()
        answers: list[dict[str, Any]] = []
        correct_count = 0
        wrong_count = 0
        for answer_row in answer_rows:
            answer = row_to_dict(answer_row) or {}
            try:
                answer_payload = json.loads(str(answer.get("answer_payload") or "{}"))
            except json.JSONDecodeError:
                answer_payload = {}
            is_correct_raw = answer.get("is_correct")
            is_correct = None if is_correct_raw is None else bool(is_correct_raw)
            if is_correct is True:
                correct_count += 1
            elif is_correct is False:
                wrong_count += 1
            item = {
                "question_id": answer.get("question_id"),
                "answer": answer_payload.get("answer"),
                "score": answer.get("score") if show_results else None,
                "is_correct": is_correct if show_results else None,
                "responded_at": answer.get("responded_at"),
            }
            answers.append(item)
        order_index = {qid: index for index, qid in enumerate(question_order)}
        answers.sort(key=lambda item: order_index.get(str(item.get("question_id")), 999999))
        payload.update(
            {
                "attempt_id": attempt["id"],
                "publication_id": attempt["publication_id"],
                "screen_switch_duration_ms": int(attempt.get("screen_switch_duration_ms") or 0),
                "answers": answers if show_results else [],
                "analysis": {
                    "correct_count": correct_count if show_results else None,
                    "wrong_count": wrong_count if show_results else None,
                    "answered_count": len(answer_rows),
                    "screen_switch_count": int(payload["screen_switch_count"]),
                    "screen_switch_duration_ms": int(attempt.get("screen_switch_duration_ms") or 0),
                },
            }
        )
        results.append(payload)
    return results
