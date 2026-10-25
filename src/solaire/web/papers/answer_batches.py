"""Bounded answer batches and transactional student draft saves."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect
from solaire.web.papers.exam_timing import _ensure_attempt_can_collect
from solaire.web.papers.snapshots import _load_attempt_question_payloads
from solaire.web.papers.student_sessions import (
    _new_id, _student_for_user, _attempt_for_student, _attempt_for_student_in_connection,
)


MAX_ANSWERS_PER_REQUEST = 200
MAX_ANSWER_TEXT_LENGTH = 100_000
MAX_IMAGES_PER_ANSWER = 10
MAX_IMAGE_DATA_URL_LENGTH = 5_000_000
MAX_ANSWER_BATCH_BYTES = 20_000_000


def save_student_answers(
    root: Path,
    project_root: Path,
    *,
    attempt_id: str,
    user: dict[str, Any],
    answers: list[dict[str, Any]],
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    initial_attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    questions, _answer_keys = _load_attempt_question_payloads(project_root, initial_attempt, root=root)
    _validate_answer_batch(answers, {str(item.get("question_id")) for item in questions})
    now = utc_now()
    rows, cleared_question_ids = _prepare_answer_mutations(attempt_id, answers, now)
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        attempt = _attempt_for_student_in_connection(con, attempt_id, str(student["id"]))
        if str(attempt.get("status")) == "submitted":
            raise ValueError("Attempt already submitted")
        _ensure_attempt_can_collect(attempt)
        _write_answer_mutations(con, attempt_id, rows, cleared_question_ids)
    return {"answer_count": len(rows)}

def _prepare_answer_mutations(
    attempt_id: str,
    answers: list[dict[str, Any]],
    now: str,
) -> tuple[list[tuple[object, ...]], list[str]]:
    rows: list[tuple[object, ...]] = []
    cleared_question_ids: list[str] = []
    for answer in answers:
        qid = str(answer.get("question_id") or "").strip()
        if not qid:
            continue
        payload: dict[str, Any] = {}
        if "answer" in answer:
            raw_answer = answer.get("answer")
            if raw_answer is not None and str(raw_answer).strip():
                payload["answer"] = raw_answer
        images = answer.get("images")
        if isinstance(images, list):
            clean_images = [
                {
                    "name": str(item.get("name") or "image") if isinstance(item, dict) else "image",
                    "mime_type": str(item.get("mime_type") or "") if isinstance(item, dict) else "",
                    "data_url": str(item.get("data_url") or "") if isinstance(item, dict) else "",
                }
                for item in images
                if isinstance(item, dict) and str(item.get("data_url") or "").strip()
            ]
            if clean_images:
                payload["images"] = clean_images
        if not payload:
            cleared_question_ids.append(qid)
            continue
        rows.append((_new_id(), attempt_id, qid, json.dumps(payload, ensure_ascii=False), now))
    return rows, cleared_question_ids

def _validate_answer_batch(answers: list[dict[str, Any]], allowed_question_ids: set[str]) -> None:
    if len(answers) > MAX_ANSWERS_PER_REQUEST:
        raise ValueError("Too many answers in one request")
    serialized_size = len(json.dumps(answers, ensure_ascii=False).encode("utf-8"))
    if serialized_size > MAX_ANSWER_BATCH_BYTES:
        raise ValueError("Answer payload is too large")
    seen: set[str] = set()
    for item in answers:
        qid = str(item.get("question_id") or "").strip()
        if qid not in allowed_question_ids:
            raise ValueError(f"Question does not belong to this attempt: {qid or '(empty)'}")
        if qid in seen:
            raise ValueError(f"Duplicate answer for question: {qid}")
        seen.add(qid)
        answer = item.get("answer")
        if answer is not None and len(str(answer)) > MAX_ANSWER_TEXT_LENGTH:
            raise ValueError("Answer text is too large")
        images = item.get("images")
        if images is None:
            continue
        if not isinstance(images, list) or len(images) > MAX_IMAGES_PER_ANSWER:
            raise ValueError("Too many answer images")
        for image in images:
            if not isinstance(image, dict):
                raise ValueError("Answer image is invalid")
            if len(str(image.get("data_url") or "")) > MAX_IMAGE_DATA_URL_LENGTH:
                raise ValueError("Answer image is too large")

def _write_answer_mutations(
    con: Any,
    attempt_id: str,
    rows: list[tuple[object, ...]],
    cleared_question_ids: list[str],
) -> None:
    if cleared_question_ids:
        con.executemany(
            "DELETE FROM student_answers WHERE attempt_id = ? AND question_id = ?",
            [(attempt_id, question_id) for question_id in cleared_question_ids],
        )
    if rows:
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
