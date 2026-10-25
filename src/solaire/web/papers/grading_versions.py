"""Optional grading preconditions backed by revisions and authoritative content."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any

from solaire.web.auth_service import utc_now


class GradingVersionConflict(ValueError):
    def __init__(self, current_version: str):
        super().__init__("该题批改已被更新，请刷新答卷后重试")
        self.current_version = current_version


def load_answer_revisions(con: sqlite3.Connection, attempt_ids: list[str]) -> dict[tuple[str, str], int]:
    result = {}
    ids = list(dict.fromkeys(attempt_ids))
    for offset in range(0, len(ids), 200):
        chunk = ids[offset:offset + 200]
        placeholders = ",".join("?" for _ in chunk)
        for row in con.execute(
            f"SELECT attempt_id, question_id, revision FROM paper_answer_grading_versions WHERE attempt_id IN ({placeholders})",
            chunk,
        ):
            result[(str(row["attempt_id"]), str(row["question_id"]))] = int(row["revision"])
    return result


def answer_grading_version(attempt_id: str, question_id: str, question: dict[str, Any] | None,
                           answer: dict[str, Any] | None, revision: int) -> str:
    row = answer or {}
    fields = ("id", "answer_payload", "is_correct", "score", "feedback", "graded_by", "graded_at", "responded_at",
              "grading_status", "ai_suggested_score", "ai_feedback", "ai_ocr_text")
    state = {key: row.get(key) for key in fields}
    state["answer_payload"] = state["answer_payload"] or "{}"
    state["grading_status"] = row.get("grading_status") or "pending"
    payload = {"attempt_id": attempt_id, "question_id": question_id, "question": question, "answer": state}
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"a1:{revision}:{digest}"


def check_grading_version(expected: str | None, current: str) -> None:
    if expected is None:
        return
    token = expected.strip()
    if token.startswith('"') and token.endswith('"'):
        token = token[1:-1]
    if token != current:
        raise GradingVersionConflict(current)


def advance_answer_revision(con: sqlite3.Connection, attempt_id: str, question_id: str) -> int:
    con.execute(
        """INSERT INTO paper_answer_grading_versions(attempt_id, question_id, revision, updated_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET
             revision = revision + 1, updated_at = excluded.updated_at""",
        (attempt_id, question_id, utc_now()),
    )
    return int(con.execute(
        "SELECT revision FROM paper_answer_grading_versions WHERE attempt_id=? AND question_id=?",
        (attempt_id, question_id),
    ).fetchone()["revision"])
