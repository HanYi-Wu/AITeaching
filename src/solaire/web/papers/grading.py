"""Connection-scoped grading reads and score aggregation."""

from __future__ import annotations

from pathlib import Path
import sqlite3
from typing import Any

from solaire.web.papers.scoring import rounded_total, validate_manual_score
from solaire.web.papers.visibility import attempt_access_clause
from solaire.web.platform_db import connect, row_to_dict


def paper_attempt_row_in_connection(
    con: sqlite3.Connection,
    *,
    paper_id: str,
    attempt_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    access_clause, access_params = attempt_access_clause(user)
    row = con.execute(
        f"""
        SELECT
          sa.*,
          ep.paper_id,
          ep.title AS publication_title,
          ep.submission_mode,
          pr.exam_id,
          COALESCE(ep.subject, pr.subject) AS subject,
          pr.title AS paper_title,
          s.student_no,
          s.display_name AS student_name,
          u.username AS account_username
        FROM student_attempts sa
        JOIN exam_publications ep ON ep.id = sa.publication_id
        JOIN paper_records pr ON pr.id = ep.paper_id
        JOIN students s ON s.id = sa.student_id
        LEFT JOIN users u ON u.id = s.user_id
        WHERE sa.id = ? AND ep.paper_id = ? AND {access_clause}
        """,
        (attempt_id, paper_id, *access_params),
    ).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise ValueError("attempt not found for this paper")
    return data


def recompute_attempt_score_in_connection(
    con: sqlite3.Connection,
    *,
    attempt_id: str,
    score_by_id: dict[str, float],
) -> dict[str, Any]:
    rows = con.execute(
        "SELECT question_id, score FROM student_answers WHERE attempt_id = ?",
        (attempt_id,),
    ).fetchall()
    scores_by_question = {str(row["question_id"]): row["score"] for row in rows}
    expected_ids = set(score_by_id)
    fully_graded = bool(expected_ids) and all(
        qid in scores_by_question and scores_by_question[qid] is not None
        for qid in expected_ids
    )
    final_score = (
        rounded_total(float(scores_by_question[qid]) for qid in expected_ids)
        if fully_graded
        else None
    )
    final_max = (
        rounded_total(float(score_by_id.get(qid, 0.0)) for qid in expected_ids)
        if expected_ids
        else None
    )
    con.execute(
        "UPDATE student_attempts SET score = ?, max_score = ? WHERE id = ?",
        (final_score, final_max, attempt_id),
    )
    row = con.execute("SELECT * FROM student_attempts WHERE id = ?", (attempt_id,)).fetchone()
    attempt = row_to_dict(row)
    if attempt is None:
        raise RuntimeError("failed to update attempt score")
    return attempt


def completed_attempt_scores_in_connection(
    con: sqlite3.Connection,
    *,
    attempt_id: str,
    score_by_id: dict[str, float],
) -> tuple[float, float]:
    rows = con.execute(
        "SELECT question_id, score FROM student_answers WHERE attempt_id = ?",
        (attempt_id,),
    ).fetchall()
    scores_by_question = {str(row["question_id"]): row["score"] for row in rows}
    missing = [qid for qid in score_by_id if scores_by_question.get(qid) is None]
    if missing:
        raise ValueError(f"仍有 {len(missing)} 道题未完成批改，不能发布成绩")

    clean_scores = {
        qid: validate_manual_score(scores_by_question[qid], maximum)
        for qid, maximum in score_by_id.items()
    }
    return (
        rounded_total(clean_scores[qid] for qid in score_by_id),
        rounded_total(score_by_id.values()),
    )


def recompute_attempt_score(
    root: Path,
    *,
    attempt_id: str,
    score_by_id: dict[str, float],
) -> dict[str, Any]:
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        return recompute_attempt_score_in_connection(
            con,
            attempt_id=attempt_id,
            score_by_id=score_by_id,
        )
