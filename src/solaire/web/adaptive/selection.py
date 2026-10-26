"""Wrong question and anchor source question selection for students."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.platform_db import connect, row_to_dict
from solaire.web.student_service import _load_attempt_question_payloads


def _wrong_questions_for_student(
    root: Path,
    project_root: Path,
    *,
    student_id: str,
    source_publication_ids: list[str],
) -> list[dict[str, Any]]:
    wrong: list[dict[str, Any]] = []
    with connect(root) as con:
        for publication_id in source_publication_ids:
            row = con.execute(
                """
                SELECT sa.*, pr.exam_id
                FROM student_attempts sa
                JOIN exam_publications ep ON ep.id = sa.publication_id
                JOIN paper_records pr ON pr.id = ep.paper_id
                WHERE sa.publication_id = ? AND sa.student_id = ? AND sa.status = 'submitted'
                """,
                (publication_id, student_id),
            ).fetchone()
            attempt = row_to_dict(row)
            if attempt is None:
                continue
            answer_rows = con.execute(
                "SELECT question_id FROM student_answers WHERE attempt_id = ? AND is_correct = 0 ORDER BY responded_at",
                (str(attempt["id"]),),
            ).fetchall()
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
) -> list[dict[str, Any]]:
    """Load frozen source questions for an all-correct student.

    Reinforcement still needs a knowledge/difficulty anchor when the selected
    history contains no wrong answers. Per-attempt snapshots are used so a
    later edit to the source exam cannot change the generated practice.
    """
    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    with connect(root) as con:
        for publication_id in source_publication_ids:
            row = con.execute(
                """
                SELECT sa.*, pr.exam_id
                FROM student_attempts sa
                JOIN exam_publications ep ON ep.id = sa.publication_id
                JOIN paper_records pr ON pr.id = ep.paper_id
                WHERE sa.publication_id = ? AND sa.student_id = ? AND sa.status = 'submitted'
                """,
                (publication_id, student_id),
            ).fetchone()
            attempt = row_to_dict(row)
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
            placeholders = ", ".join("?" for _ in question_ids)
            answer_rows = con.execute(
                f"SELECT question_id, is_correct FROM student_answers "
                f"WHERE attempt_id = ? AND question_id IN ({placeholders})",
                (str(attempt["id"]), *question_ids),
            ).fetchall()
            graded = {str(answer_row["question_id"]): answer_row["is_correct"] for answer_row in answer_rows}
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
