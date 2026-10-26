"""Freezing knowledge baselines at publication time in the caller's SQL transaction."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from solaire.web.learning_progress.sources import (
    compute_batch_snapshot_hash,
    compute_online_source_snapshot_hash,
    get_graph_question_node_bindings,
    resolve_batch_student_scores,
)
from solaire.web.learning_progress.store import (
    insert_frozen_baseline_items,
    record_practice_source,
)
from solaire.web.platform_db import row_to_dict

DEFAULT_CALCULATION_RULE_VERSION = "v1_equal_split"


def freeze_publication_baseline(
    con: sqlite3.Connection,
    *,
    project_root: Path,
    publication_id: str,
    student_ids: list[str],
    source_exam_id: str,
    source_batch_id: str,
    captured_at: str,
    practice_kind: str = "remediation",
    calculation_rule_version: str = DEFAULT_CALCULATION_RULE_VERSION,
) -> int:
    """Freeze baseline from diagnostic batch into the current publication SQL transaction.

    Must use caller's existing sqlite3.Connection. Does not commit.
    If freezing fails, raises an exception to trigger total transaction rollback.
    """
    record_practice_source(
        con,
        practice_publication_id=publication_id,
        practice_kind=practice_kind,
        source_type="diagnostic_batch",
        source_exam_id=source_exam_id,
        source_batch_id=source_batch_id,
        captured_at=captured_at,
        calculation_rule_version=calculation_rule_version,
    )

    source_snapshot_hash = compute_batch_snapshot_hash(project_root, source_exam_id, source_batch_id)
    batch_students = resolve_batch_student_scores(project_root, source_exam_id, source_batch_id)
    node_bindings = get_graph_question_node_bindings(project_root)

    # Build mapping of platform students by student_no
    if student_ids:
        placeholders = ",".join("?" for _ in student_ids)
        rows = con.execute(
            f"SELECT id, student_no FROM students WHERE id IN ({placeholders})",
            tuple(student_ids),
        ).fetchall()
        no_to_student_id = {
            str(r["student_no"]).strip(): str(r["id"])
            for r in rows
            if r["student_no"] and str(r["student_no"]).strip()
        }
    else:
        no_to_student_id = {}

    baseline_items: list[dict[str, Any]] = []

    for bs in batch_students:
        s_no = str(bs.get("student_no") or "").strip()
        if not s_no or s_no not in no_to_student_id:
            # Without verified platform student identity, we do not guess by name
            continue
        plat_student_id = no_to_student_id[s_no]
        scores = bs.get("scores") or {}
        raw_max_scores = bs.get("raw_max_scores") or {}

        for qid, raw_score in scores.items():
            if raw_score is None:
                continue
            raw_max = float(raw_max_scores.get(qid) or 5.0)
            bound_nodes = node_bindings.get(qid) or []
            if not bound_nodes:
                continue

            unique_nodes = list(dict.fromkeys(bound_nodes))
            m = len(unique_nodes)
            weight = 1.0 / m
            effective_score = round(raw_score / m, 4)
            effective_max = round(raw_max / m, 4)

            for nid in unique_nodes:
                baseline_items.append({
                    "practice_publication_id": publication_id,
                    "student_id": plat_student_id,
                    "source_type": "diagnostic_batch",
                    "source_ref_id": source_batch_id,
                    "source_attempt_id": None,
                    "source_question_id": qid,
                    "knowledge_node_id": nid,
                    "effective_score": effective_score,
                    "effective_max_score": effective_max,
                    "weight": weight,
                    "raw_score": raw_score,
                    "raw_max_score": raw_max,
                    "rule_version": calculation_rule_version,
                    "source_snapshot_hash": source_snapshot_hash,
                    "captured_at": captured_at,
                })

    return insert_frozen_baseline_items(con, baseline_items)


def freeze_personalized_baseline(
    con: sqlite3.Connection,
    *,
    project_root: Path | None,
    publication_id: str,
    practice_kind: str,
    source_publication_ids: list[str],
    assignments: list[dict[str, Any]],
    captured_at: str,
    calculation_rule_version: str = DEFAULT_CALCULATION_RULE_VERSION,
) -> int:
    """Freeze baseline for personalized adaptive practice in caller's SQL transaction."""
    for sp_id in source_publication_ids:
        record_practice_source(
            con,
            practice_publication_id=publication_id,
            practice_kind=practice_kind,
            source_type="exam_publication",
            source_publication_id=sp_id,
            captured_at=captured_at,
            calculation_rule_version=calculation_rule_version,
        )

    node_bindings = get_graph_question_node_bindings(project_root) if project_root else {}

    baseline_items: list[dict[str, Any]] = []

    for assignment in assignments:
        plat_student_id = str(assignment["student_id"])
        # For wrong_questions practice, look up source answers from source publications
        for sp_id in source_publication_ids:
            # Check source attempt
            attempt_row = con.execute(
                """
                SELECT id, question_payload_json FROM student_attempts
                WHERE publication_id = ? AND student_id = ? AND status = 'submitted'
                """,
                (sp_id, plat_student_id),
            ).fetchone()
            if attempt_row is None:
                continue
            src_attempt_id = str(attempt_row["id"])
            source_hash = compute_online_source_snapshot_hash(con, sp_id, plat_student_id)

            # Query source answers
            ans_rows = con.execute(
                """
                SELECT question_id, score, is_correct FROM student_answers
                WHERE attempt_id = ?
                """,
                (src_attempt_id,),
            ).fetchall()

            # Attempt question payload to know max score
            try:
                q_payloads = json.loads(str(attempt_row["question_payload_json"] or "[]"))
            except Exception:
                q_payloads = []
            max_scores = {
                str(qp.get("question_id")): float(qp.get("score_per_item") or 5.0)
                for qp in q_payloads
                if isinstance(qp, dict)
            }

            for ar in ans_rows:
                qid = str(ar["question_id"])
                raw_score = float(ar["score"]) if ar["score"] is not None else 0.0
                raw_max = max_scores.get(qid, 5.0)
                bound_nodes = node_bindings.get(qid) or []
                if not bound_nodes:
                    continue

                unique_nodes = list(dict.fromkeys(bound_nodes))
                m = len(unique_nodes)
                weight = 1.0 / m
                effective_score = round(raw_score / m, 4)
                effective_max = round(raw_max / m, 4)

                for nid in unique_nodes:
                    baseline_items.append({
                        "practice_publication_id": publication_id,
                        "student_id": plat_student_id,
                        "source_type": "exam_publication",
                        "source_ref_id": sp_id,
                        "source_attempt_id": src_attempt_id,
                        "source_question_id": qid,
                        "knowledge_node_id": nid,
                        "effective_score": effective_score,
                        "effective_max_score": effective_max,
                        "weight": weight,
                        "raw_score": raw_score,
                        "raw_max_score": raw_max,
                        "rule_version": calculation_rule_version,
                        "source_snapshot_hash": source_hash,
                        "captured_at": captured_at,
                    })

    return insert_frozen_baseline_items(con, baseline_items)
