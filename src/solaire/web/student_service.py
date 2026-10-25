"""Student-side online exam services."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.papers.scoring import (
    normalise_answer as _normalise_answer, question_score_map, rounded_total,
    score_objective_answer,
)
from solaire.web.papers.answer_batches import (
    MAX_ANSWERS_PER_REQUEST, MAX_ANSWER_TEXT_LENGTH, MAX_IMAGES_PER_ANSWER,
    MAX_IMAGE_DATA_URL_LENGTH, MAX_ANSWER_BATCH_BYTES,
    save_student_answers, _prepare_answer_mutations, _validate_answer_batch, _write_answer_mutations,
)
from solaire.web.papers.exam_timing import (
    _parse_datetime, _publication_availability, _publication_datetime,
    _time_limit_exceeded, _remaining_seconds, _ensure_attempt_can_collect,
    _ensure_attempt_can_submit,
)
from solaire.web.papers.student_sessions import (
    _new_id, _student_for_user, _score_percent, _saved_answer_payloads,
    _ensure_assigned_attempt, _attempt_for_student, _attempt_for_student_in_connection,
    _attempt_payload, list_student_papers, start_student_publication,
)
from solaire.web.papers.snapshots import (
    _normalize_exam_question_refs, _load_exam_question_payloads,
    _is_placeholder_question, _load_attempt_question_payloads, public_snapshot_identity,
)
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.common.answer_logic import PREFIX as ANSWER_LOGIC_PREFIX, matches as matches_answer_logic, decode as decode_answer_logic, valid_choice_key


PROCTOR_EVENT_TYPES = {
    "visibility_hidden",
    "window_blur",
    "fullscreen_exit",
    "copy",
    "paste",
    "context_menu",
}
MAX_PROCTOR_EVENTS_PER_ATTEMPT = 1_000
MAX_PROCTOR_EVENTS_PER_MINUTE = 120





def ensure_student_resource_access(root: Path, project_root: Path, user: dict[str, Any], target: Path) -> None:
    """Only images in this student's opened papers or released analysis are readable."""
    student = _student_for_user(root, user)
    with connect(root) as con:
        rows = con.execute(
            "SELECT sa.*, pr.exam_id FROM student_attempts sa "
            "JOIN exam_publications ep ON ep.id = sa.publication_id "
            "JOIN paper_records pr ON pr.id = ep.paper_id "
            "WHERE sa.student_id = ? AND sa.status <> 'not_started' "
            "AND EXISTS (SELECT 1 FROM publication_classes pc JOIN class_students cs ON cs.class_id = pc.class_id "
            "WHERE pc.publication_id = ep.id AND cs.student_id = sa.student_id)", (student['id'],),
        ).fetchall()
    for row in rows:
        attempt = dict(row)
        try:
            questions, _ = _load_attempt_question_payloads(project_root, attempt)
        except (ValueError, FileNotFoundError):
            continue
        for question in questions:
            texts = [str(question.get('content') or ''), *[str(v) for v in (question.get('options') or {}).values()]]
            if attempt.get('grading_completed_at'):
                texts.append(str(question.get('analysis') or ''))
            for text in texts:
                for rel in re.findall(r':::[A-Z_]*IMG:([^:]+):::', text):
                    if (project_root / 'resource' / rel.strip().replace('\\', '/')).resolve() == target:
                        return
    raise PermissionError('该图片不属于当前学生可查看的试卷')


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
    if str(attempt.get("status")) != "in_progress":
        raise ValueError("Proctor events require an in-progress attempt")
    now = utc_now()
    event_id = _new_id()
    clean_type = event_type.strip() or "unknown"
    if clean_type not in PROCTOR_EVENT_TYPES:
        raise ValueError(f"Unsupported proctor event type: {clean_type}")
    clean_duration = int(duration_ms or 0)
    if clean_duration < 0 or clean_duration > 86_400_000:
        raise ValueError("Proctor event duration is out of range")
    payload_json = json.dumps(payload or {}, ensure_ascii=False, sort_keys=True)
    if len(payload_json.encode("utf-8")) > 4096:
        raise ValueError("Proctor event payload is too large")
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        current = _attempt_for_student_in_connection(con, attempt_id, str(student["id"]))
        if str(current.get("status")) != "in_progress":
            raise ValueError("Proctor events require an in-progress attempt")
        total_count = int(
            con.execute("SELECT COUNT(*) FROM proctor_events WHERE attempt_id = ?", (attempt_id,)).fetchone()[0]
        )
        if total_count >= MAX_PROCTOR_EVENTS_PER_ATTEMPT:
            raise ValueError("Proctor event limit exceeded")
        recent_count = int(
            con.execute(
                "SELECT COUNT(*) FROM proctor_events WHERE attempt_id = ? AND datetime(occurred_at) >= datetime('now', '-1 minute')",
                (attempt_id,),
            ).fetchone()[0]
        )
        if recent_count >= MAX_PROCTOR_EVENTS_PER_MINUTE:
            raise ValueError("Proctor event rate limit exceeded")
        previous = con.execute(
            """
            SELECT * FROM proctor_events
            WHERE attempt_id = ? AND event_type = ? AND payload_json = ?
            ORDER BY occurred_at DESC LIMIT 1
            """,
            (attempt_id, clean_type, payload_json),
        ).fetchone()
        previous_payload = row_to_dict(previous)
        if previous_payload is not None:
            occurred_at = _parse_datetime(previous_payload.get("occurred_at"))
            if occurred_at is not None and (datetime.now(UTC) - occurred_at).total_seconds() < 2:
                previous_payload["deduplicated"] = True
                return previous_payload
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
                clean_duration,
                payload_json,
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
    answers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    if str(attempt.get("status")) == "submitted":
        return _attempt_payload(attempt)
    # An expired timer blocks further answer edits, but the client must still be
    # able to finalize the saved answers when its countdown reaches zero.
    _ensure_attempt_can_submit(attempt)
    questions, answer_keys = _load_attempt_question_payloads(project_root, attempt, root=root)
    if answers is not None:
        _validate_answer_batch(answers, {str(item.get("question_id")) for item in questions})
    qtype_by_id = {str(q["question_id"]): str(q.get("type") or "") for q in questions}
    score_by_id = question_score_map(questions)
    max_score = rounded_total(score_by_id.values())
    auto_release = bool(questions) and str(attempt.get('submission_mode')) == 'online' and all(
        str(question.get('type')) in {'single_choice', 'multiple_choice', 'choice'}
        and valid_choice_key(answer_keys.get(str(question['question_id'])), question.get('options'), str(question.get('type')) == 'multiple_choice')
        for question in questions
    )

    now = utc_now()
    submitted_rows, cleared_question_ids = _prepare_answer_mutations(attempt_id, answers or [], now)
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        attempt = _attempt_for_student_in_connection(con, attempt_id, str(student["id"]))
        if str(attempt.get("status")) == "submitted":
            return _attempt_payload(attempt)
        _ensure_attempt_can_submit(attempt)
        if answers is not None:
            _write_answer_mutations(con, attempt_id, submitted_rows, cleared_question_ids)
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

        for raw_answer in answers.values():
            if isinstance(raw_answer, str) and raw_answer.startswith(ANSWER_LOGIC_PREFIX):
                decode_answer_logic(raw_answer)

        if auto_release:
            # Unanswered choices count as zero, including an entirely blank paper.
            for qid in qtype_by_id:
                if qid not in answers:
                    con.execute('INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, grading_status, responded_at) VALUES (?, ?, ?, ?, ?, ?)',
                                (_new_id(), attempt_id, qid, '{}', 'pending', now))
                    answers[qid] = None

        scored_any = False
        total = 0.0
        for qid, raw_answer in answers.items():
            expected = answer_keys.get(qid)
            qtype = qtype_by_id.get(qid)
            is_correct, score = score_objective_answer(
                raw_answer, expected, qtype, score_by_id.get(qid, 0.0), zero_unanswered=auto_release,
            )
            if score is not None:
                total += score
                scored_any = True
            con.execute(
                "UPDATE student_answers SET is_correct = ?, score = ?, grading_status = ? WHERE attempt_id = ? AND question_id = ?",
                (is_correct, score, "auto_scored" if score is not None else "pending", attempt_id, qid),
            )
        submitted_at = _parse_datetime(now) or datetime.now(UTC)
        started_at = _parse_datetime(attempt.get("started_at"))
        if started_at is None:
            authoritative_time_spent = 0
        else:
            authoritative_time_spent = max(0, int((submitted_at - started_at).total_seconds()))
            time_limit_seconds = max(0, int(attempt.get("time_limit_minutes") or 0)) * 60
            if time_limit_seconds:
                authoritative_time_spent = min(authoritative_time_spent, time_limit_seconds)
        final_score: float | None = rounded_total([total]) if scored_any or auto_release else None
        if not attempt.get("started_at"):
            con.execute("UPDATE student_attempts SET started_at = ? WHERE id = ?", (now, attempt_id))
        con.execute(
            """
            UPDATE student_attempts
            SET status = 'submitted', submitted_at = ?, score = ?, max_score = ?, time_spent_seconds = ?
            WHERE id = ?
            """,
            (now, final_score, max_score, authoritative_time_spent, attempt_id),
        )
        if auto_release:
            con.execute('UPDATE student_attempts SET grading_completed_at = ?, grading_completed_by = ? WHERE id = ?',
                        (now, None, attempt_id))
    return _attempt_payload(_attempt_for_student(root, attempt_id, str(student["id"])))


def list_student_results(root: Path, project_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    student = _student_for_user(root, user)
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
                   ep.submission_mode, ep.max_screen_switches, ep.start_at, ep.end_at, ep.time_limit_minutes,
                   pr.exam_id, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id, pr.title AS paper_title,
                   COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'), 0) AS screen_switch_count,
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
        question_by_id: dict[str, dict[str, Any]] = {}
        try:
            questions, answer_keys = _load_attempt_question_payloads(project_root, attempt, root=root)
            question_order = [str(q["question_id"]) for q in questions]
            question_by_id = {str(q["question_id"]): q for q in questions}
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
                "images": answer_payload.get("images") if isinstance(answer_payload.get("images"), list) else [],
                "score": answer.get("score") if show_results else None,
                "is_correct": is_correct if show_results else None,
                "feedback": answer.get("feedback") if show_results else None,
                "responded_at": answer.get("responded_at"),
            }
            question = question_by_id.get(str(answer.get("question_id") or ""), {})
            if show_results:
                item.update(
                    {
                        "header": question.get("header"),
                        "content": question.get("content"),
                        "type": question.get("type"),
                        "options": question.get("options"),
                        "section_id": question.get("section_id"),
                        "score_per_item": question.get("score_per_item"),
                        "tags": question.get("tags") or [],
                        "correct_answer": answer_keys.get(str(answer.get("question_id") or "")),
                        "analysis": question.get("analysis"),
                    }
                )
            answers.append(item)
        order_index = {qid: index for index, qid in enumerate(question_order)}
        answers.sort(key=lambda item: order_index.get(str(item.get("question_id")), 999999))
        payload.update(
            {
                "attempt_id": attempt["id"],
                "publication_id": attempt["publication_id"],
                "answers": answers if show_results else [],
                "analysis": {
                    "correct_count": correct_count if show_results else None,
                    "wrong_count": wrong_count if show_results else None,
                    "answered_count": len(answer_rows),
                    "average_time_per_question_seconds": (
                        round(int(attempt.get("time_spent_seconds") or 0) / max(1, len(question_order)), 1)
                        if show_results and question_order
                        else None
                    ),
                },
            }
        )
        results.append(payload)
    return results
