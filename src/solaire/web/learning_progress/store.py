"""Database persistence for practice sources and frozen baselines.

All mutation operations accept an existing transaction connection and do not commit independently.
"""

from __future__ import annotations

from contextlib import closing
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from solaire.web.learning_progress.types import FrozenBaselineItem, PracticeSourceLink
from solaire.web.platform_db import connect, row_to_dict


def _new_id() -> str:
    return uuid.uuid4().hex


def record_practice_source(
    con: sqlite3.Connection,
    *,
    practice_publication_id: str,
    practice_kind: str,
    source_type: str,
    source_exam_id: str | None = None,
    source_batch_id: str | None = None,
    source_publication_id: str | None = None,
    captured_at: str,
    calculation_rule_version: str = "v1_equal_split",
    metadata: dict[str, Any] | None = None,
    link_id: str | None = None,
) -> str:
    """Record practice publication source link in caller's active database transaction."""
    record_id = link_id or _new_id()
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False) if metadata else None
    con.execute(
        """
        INSERT INTO practice_sources (
          id, practice_publication_id, practice_kind, source_type,
          source_exam_id, source_batch_id, source_publication_id,
          captured_at, calculation_rule_version, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record_id,
            practice_publication_id,
            practice_kind,
            source_type,
            source_exam_id,
            source_batch_id,
            source_publication_id,
            captured_at,
            calculation_rule_version,
            metadata_json,
        ),
    )
    return record_id


def get_practice_sources(
    root_or_con: Path | sqlite3.Connection,
    practice_publication_id: str,
) -> list[PracticeSourceLink]:
    """Retrieve practice source records for a publication."""
    query = """
        SELECT * FROM practice_sources
        WHERE practice_publication_id = ?
        ORDER BY captured_at ASC, id ASC
    """
    if isinstance(root_or_con, sqlite3.Connection):
        rows = root_or_con.execute(query, (practice_publication_id,)).fetchall()
    else:
        with closing(connect(root_or_con)) as con, con:
            rows = con.execute(query, (practice_publication_id,)).fetchall()

    results: list[PracticeSourceLink] = []
    for row in rows:
        d = row_to_dict(row) or {}
        meta_raw = d.get("metadata_json")
        try:
            meta = json.loads(meta_raw) if meta_raw else {}
        except Exception:
            meta = {}
        results.append(
            PracticeSourceLink(
                id=str(d["id"]),
                practice_publication_id=str(d["practice_publication_id"]),
                practice_kind=str(d["practice_kind"]),
                source_type=d["source_type"],
                source_exam_id=d.get("source_exam_id"),
                source_batch_id=d.get("source_batch_id"),
                source_publication_id=d.get("source_publication_id"),
                captured_at=str(d["captured_at"]),
                calculation_rule_version=str(d.get("calculation_rule_version") or "v1_equal_split"),
                metadata=meta,
            )
        )
    return results


def insert_frozen_baseline_items(
    con: sqlite3.Connection,
    items: list[dict[str, Any]],
) -> int:
    """Insert frozen baseline items into caller's active database transaction."""
    if not items:
        return 0
    records: list[tuple[Any, ...]] = []
    for it in items:
        rec_id = str(it.get("id") or _new_id())
        records.append((
            rec_id,
            str(it["practice_publication_id"]),
            str(it["student_id"]),
            str(it["source_type"]),
            str(it["source_ref_id"]),
            it.get("source_attempt_id"),
            str(it["source_question_id"]),
            str(it["knowledge_node_id"]),
            float(it["effective_score"]),
            float(it["effective_max_score"]),
            float(it.get("weight", 1.0)),
            it.get("raw_score"),
            it.get("raw_max_score"),
            str(it.get("rule_version", "v1_equal_split")),
            str(it["source_snapshot_hash"]),
            str(it["captured_at"]),
        ))
    con.executemany(
        """
        INSERT INTO practice_frozen_baselines (
          id, practice_publication_id, student_id, source_type, source_ref_id,
          source_attempt_id, source_question_id, knowledge_node_id,
          effective_score, effective_max_score, weight, raw_score, raw_max_score,
          rule_version, source_snapshot_hash, captured_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        records,
    )
    return len(records)


def get_frozen_baselines(
    root_or_con: Path | sqlite3.Connection,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
) -> list[FrozenBaselineItem]:
    """Read frozen baselines for a publication (and optional student filter)."""
    params: list[Any] = [practice_publication_id]
    student_clause = ""
    if student_id is not None:
        student_clause = " AND student_id = ?"
        params.append(student_id)

    query = f"""
        SELECT * FROM practice_frozen_baselines
        WHERE practice_publication_id = ? {student_clause}
        ORDER BY student_id ASC, knowledge_node_id ASC, source_question_id ASC
    """
    if isinstance(root_or_con, sqlite3.Connection):
        rows = root_or_con.execute(query, tuple(params)).fetchall()
    else:
        with closing(connect(root_or_con)) as con, con:
            rows = con.execute(query, tuple(params)).fetchall()

    results: list[FrozenBaselineItem] = []
    for row in rows:
        d = row_to_dict(row) or {}
        results.append(
            FrozenBaselineItem(
                id=str(d["id"]),
                practice_publication_id=str(d["practice_publication_id"]),
                student_id=str(d["student_id"]),
                source_type=str(d["source_type"]),
                source_ref_id=str(d["source_ref_id"]),
                source_attempt_id=d.get("source_attempt_id"),
                source_question_id=str(d["source_question_id"]),
                knowledge_node_id=str(d["knowledge_node_id"]),
                effective_score=float(d["effective_score"]),
                effective_max_score=float(d["effective_max_score"]),
                weight=float(d.get("weight", 1.0)),
                raw_score=float(d["raw_score"]) if d.get("raw_score") is not None else None,
                raw_max_score=float(d["raw_max_score"]) if d.get("raw_max_score") is not None else None,
                rule_version=str(d.get("rule_version", "v1_equal_split")),
                source_snapshot_hash=str(d["source_snapshot_hash"]),
                captured_at=str(d["captured_at"]),
            )
        )
    return results
