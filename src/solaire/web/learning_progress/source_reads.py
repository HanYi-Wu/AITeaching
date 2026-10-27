"""Request-local batch reads for the source publications used by adaptive practice."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any

from solaire.web.learning_progress.sources import _online_source_snapshot_hash_from_rows
from solaire.web.platform_db import row_to_dict

_PAIR_CHUNK_SIZE = 400
_ATTEMPT_CHUNK_SIZE = 500


@dataclass(slots=True)
class OnlineSourceReadContext:
    """Source rows shared only during one selection or publication phase."""

    attempts_by_pair: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    answers_by_attempt: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    includes_scores: bool = False
    _hashes_by_pair: dict[tuple[str, str], str] = field(default_factory=dict)

    def attempt(self, publication_id: str, student_id: str) -> dict[str, Any] | None:
        return self.attempts_by_pair.get((str(publication_id), str(student_id)))

    def answers(self, attempt_id: str) -> list[dict[str, Any]]:
        return self.answers_by_attempt.get(str(attempt_id), [])

    def source_snapshot_hash(self, publication_id: str, student_id: str) -> str:
        if not self.includes_scores:
            raise RuntimeError("source scores were not loaded for this read context")
        key = (str(publication_id), str(student_id))
        if key not in self._hashes_by_pair:
            attempt = self.attempts_by_pair[key]
            attempt_id = str(attempt["id"])
            rows = [
                {
                    "attempt_id": attempt_id,
                    "student_id": key[1],
                    "question_id": row["question_id"],
                    "score": row["score"],
                    "is_correct": row["is_correct"],
                    "_source_rowid": row["_source_rowid"],
                }
                for row in self.answers(attempt_id)
            ]
            rows.sort(
                key=lambda row: (
                    row["question_id"] is not None,
                    str(row["question_id"] or ""),
                    int(row["_source_rowid"]),
                )
            )
            self._hashes_by_pair[key] = _online_source_snapshot_hash_from_rows(rows)
        return self._hashes_by_pair[key]


def load_online_source_read_context(
    con: sqlite3.Connection,
    *,
    source_publication_ids: list[str],
    student_ids: list[str],
    require_grading_completed: bool = False,
    include_scores: bool = False,
    include_answer_keys: bool = True,
) -> OnlineSourceReadContext:
    """Read submitted attempts and answer fields for exact publication/student pairs.

    Pair and answer queries are chunked below SQLite's common variable limit. The
    returned rows are scoped to the caller's validated source IDs and students.
    """
    source_ids = list(dict.fromkeys(str(item) for item in source_publication_ids))
    students = list(dict.fromkeys(str(item) for item in student_ids))
    context = OnlineSourceReadContext(includes_scores=include_scores)
    if not source_ids or not students:
        return context

    pairs = [(source_id, student_id) for source_id in source_ids for student_id in students]
    grading_clause = (
        "AND sa.grading_completed_at IS NOT NULL AND sa.grading_completed_at != ''"
        if require_grading_completed
        else ""
    )
    attempt_columns = (
        "sa.id, sa.publication_id, sa.student_id, sa.status, sa.question_payload_json, "
        "sa.answer_key_json, sa.practice_metadata_json, sa.question_payload_version, "
        "sa.max_score, sa.grading_completed_at, pr.exam_id"
        if include_answer_keys
        else "sa.id, sa.publication_id, sa.student_id, sa.question_payload_json, sa.grading_completed_at"
    )
    for offset in range(0, len(pairs), _PAIR_CHUNK_SIZE):
        chunk = pairs[offset : offset + _PAIR_CHUNK_SIZE]
        pair_placeholders = ", ".join("(?, ?)" for _ in chunk)
        params = [value for pair in chunk for value in pair]
        rows = con.execute(
            f"""
            SELECT {attempt_columns}
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.status = 'submitted'
              {grading_clause}
              AND (sa.publication_id, sa.student_id) IN ({pair_placeholders})
            ORDER BY sa.publication_id ASC, sa.student_id ASC
            """,
            params,
        ).fetchall()
        for row in rows:
            attempt = row_to_dict(row) or {}
            pair = (str(attempt["publication_id"]), str(attempt["student_id"]))
            context.attempts_by_pair[pair] = attempt

    attempt_ids = list(dict.fromkeys(str(row["id"]) for row in context.attempts_by_pair.values()))
    answer_score_column = ", score" if include_scores else ""
    for offset in range(0, len(attempt_ids), _ATTEMPT_CHUNK_SIZE):
        chunk = attempt_ids[offset : offset + _ATTEMPT_CHUNK_SIZE]
        placeholders = ", ".join("?" for _ in chunk)
        rows = con.execute(
            f"""
            SELECT rowid AS _source_rowid, attempt_id, question_id{answer_score_column}, is_correct, responded_at
            FROM student_answers
            WHERE attempt_id IN ({placeholders})
            ORDER BY attempt_id ASC, responded_at ASC, rowid ASC
            """,
            chunk,
        ).fetchall()
        for row in rows:
            answer = row_to_dict(row) or {}
            context.answers_by_attempt.setdefault(str(answer["attempt_id"]), []).append(answer)

    return context
