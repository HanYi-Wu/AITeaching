"""Wrong question and anchor source question selection for students."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.learning_progress.source_reads import (
    OnlineSourceReadContext,
    load_online_source_read_context,
)
from solaire.web.platform_db import connect
from solaire.web.student_service import _load_attempt_question_payloads


def _wrong_questions_for_student(
    root: Path,
    project_root: Path,
    *,
    student_id: str,
    source_publication_ids: list[str],
    read_context: OnlineSourceReadContext | None = None,
) -> list[dict[str, Any]]:
    wrong: list[dict[str, Any]] = []
    if read_context is None:
        with connect(root) as con:
            read_context = load_online_source_read_context(
                con,
                source_publication_ids=source_publication_ids,
                student_ids=[student_id],
            )
    for publication_id in source_publication_ids:
        attempt = read_context.attempt(publication_id, student_id)
        if attempt is None:
            continue
        answer_rows = [row for row in read_context.answers(str(attempt["id"])) if row.get("is_correct") == 0]
        if not answer_rows:
            continue
        questions, answer_keys = _load_attempt_question_payloads(project_root, attempt)
        by_id = {str(item.get("question_id")): item for item in questions}
        for answer_row in answer_rows:
            qid = str(answer_row["question_id"])
            question = by_id.get(qid)
            answer = answer_keys.get(qid)
            if question is None or answer is None:
                continue
            wrong.append({**question, "answer": answer, "source_publication_id": publication_id})
    return wrong


def _source_questions_for_student(
    root: Path,
    project_root: Path,
    *,
    student_id: str,
    source_publication_ids: list[str],
    read_context: OnlineSourceReadContext | None = None,
) -> list[dict[str, Any]]:
    """Load frozen source questions for an all-correct student.

    Reinforcement still needs a knowledge/difficulty anchor when the selected
    history contains no wrong answers. Per-attempt snapshots are used so a
    later edit to the source exam cannot change the generated practice.
    """
    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    if read_context is None:
        with connect(root) as con:
            read_context = load_online_source_read_context(
                con,
                source_publication_ids=source_publication_ids,
                student_ids=[student_id],
            )
    for publication_id in source_publication_ids:
        attempt = read_context.attempt(publication_id, student_id)
        if attempt is None:
            return []
        questions, answer_keys = _load_attempt_question_payloads(project_root, attempt)
        eligible_questions = [
            question
            for question in questions
            if str(question.get("question_id") or "").strip() in answer_keys
        ]
        question_ids = [str(question.get("question_id") or "").strip() for question in eligible_questions]
        if not question_ids:
            return []
        question_id_set = set(question_ids)
        graded = {
            str(answer_row["question_id"]): answer_row["is_correct"]
            for answer_row in read_context.answers(str(attempt["id"]))
            if str(answer_row["question_id"]) in question_id_set
        }
        if any(graded.get(question_id) != 1 for question_id in question_ids):
            return []
        for question in eligible_questions:
            qid = str(question.get("question_id") or "").strip()
            answer = answer_keys.get(qid)
            key = (publication_id, qid)
            if not qid or answer is None or key in seen:
                continue
            seen.add(key)
            sources.append({**question, "answer": answer, "source_publication_id": publication_id})
    return sources
