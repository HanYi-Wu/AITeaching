"""Compatibility readers and authoritative comparison checks for learning progress."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from solaire.web.learning_progress.sources import (
    compute_batch_snapshot_hash,
    compute_online_source_snapshot_hash,
    get_graph_question_node_bindings,
)
from solaire.web.learning_progress.store import (
    get_frozen_baselines,
    get_practice_sources,
)
from solaire.web.learning_progress.types import TargetEvidenceItem
from solaire.web.platform_db import connect, row_to_dict


def get_frozen_baseline(
    root: Path,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
) -> list[dict[str, Any]]:
    """G7 Contract: Read frozen baseline items for a practice publication.

    Returns list of dicts with:
        student_id, knowledge_node_id, source_type, source_ref_id,
        source_question_id, effective_score, effective_max_score,
        weight, raw_score, raw_max_score, rule_version,
        source_snapshot_hash, captured_at.
    """
    items = get_frozen_baselines(
        root,
        practice_publication_id=practice_publication_id,
        student_id=student_id,
    )
    return [it.to_dict() for it in items]


def get_authoritative_source_status(
    root: Path,
    project_root: Path | None,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
) -> dict[str, Any]:
    """G7 Contract: Check live source existence and authoritative digest match.

    Returns:
        {
            "status": "valid" | "source_missing" | "source_modified",
            "source_type": str,
            "source_ref_id": str,
            "is_modified": bool,
            "is_missing": bool,
            "reason": str | None,
        }
    """
    sources = get_practice_sources(root, practice_publication_id)
    if not sources:
        return {
            "status": "source_missing",
            "source_type": "unknown",
            "source_ref_id": "",
            "is_modified": False,
            "is_missing": True,
            "reason": "No practice source link recorded for this publication",
        }

    baselines = get_frozen_baselines(root, practice_publication_id=practice_publication_id, student_id=student_id)
    if not baselines:
        return {
            "status": "source_missing",
            "source_type": sources[0].source_type,
            "source_ref_id": sources[0].source_batch_id or sources[0].source_publication_id or "",
            "is_modified": False,
            "is_missing": True,
            "reason": "No frozen baselines found for this publication",
        }

    src = sources[0]
    expected_hash = baselines[0].source_snapshot_hash

    if src.source_type == "diagnostic_batch":
        if project_root is None:
            return {
                "status": "valid",
                "source_type": "diagnostic_batch",
                "source_ref_id": str(src.source_batch_id),
                "is_modified": False,
                "is_missing": False,
                "reason": None,
            }
        try:
            current_hash = compute_batch_snapshot_hash(
                project_root,
                str(src.source_exam_id),
                str(src.source_batch_id),
            )
        except FileNotFoundError:
            return {
                "status": "source_missing",
                "source_type": "diagnostic_batch",
                "source_ref_id": str(src.source_batch_id),
                "is_modified": False,
                "is_missing": True,
                "reason": "Source score batch directory was deleted",
            }
    else:
        # online exam publication
        pub_id = str(src.source_publication_id)
        with connect(root) as con:
            row = con.execute("SELECT id, status FROM exam_publications WHERE id = ?", (pub_id,)).fetchone()
            if row is None or row["status"] == "revoked":
                return {
                    "status": "source_missing",
                    "source_type": "exam_publication",
                    "source_ref_id": pub_id,
                    "is_modified": False,
                    "is_missing": True,
                    "reason": "Source exam publication was revoked or deleted",
                }
            current_hash = compute_online_source_snapshot_hash(con, pub_id, student_id)

    if current_hash != expected_hash:
        return {
            "status": "source_modified",
            "source_type": src.source_type,
            "source_ref_id": str(src.source_batch_id or src.source_publication_id),
            "is_modified": True,
            "is_missing": False,
            "reason": "Source scores were regraded or modified after practice baseline was frozen",
        }

    return {
        "status": "valid",
        "source_type": src.source_type,
        "source_ref_id": str(src.source_batch_id or src.source_publication_id),
        "is_modified": False,
        "is_missing": False,
        "reason": None,
    }


def get_authoritative_target_evidence(
    root: Path,
    project_root: Path | None,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
) -> list[dict[str, Any]]:
    """G7 Contract: Read authoritative practice attempt scores and knowledge node evidence."""
    node_bindings = get_graph_question_node_bindings(project_root) if project_root else {}

    params: list[Any] = [practice_publication_id]
    student_clause = ""
    if student_id is not None:
        student_clause = " AND sa.student_id = ?"
        params.append(student_id)

    with connect(root) as con:
        pub_row = con.execute("SELECT * FROM exam_publications WHERE id = ?", (practice_publication_id,)).fetchone()
        if pub_row is None:
            return []
        pub = row_to_dict(pub_row) or {}
        is_released = bool(pub.get("show_results_immediately")) or pub.get("status") == "closed"

        query = f"""
            SELECT sa.id as attempt_id, sa.student_id, sa.status as attempt_status,
                   sa.question_payload_json,
                   ans.question_id, ans.score, ans.is_correct, ans.grading_status
            FROM student_attempts sa
            LEFT JOIN student_answers ans ON ans.attempt_id = sa.id
            WHERE sa.publication_id = ? {student_clause}
            ORDER BY sa.student_id ASC, ans.question_id ASC
        """
        rows = con.execute(query, tuple(params)).fetchall()

    results: list[dict[str, Any]] = []
    attempts_seen: set[str] = set()

    for r in rows:
        st_id = str(r["student_id"])
        att_id = str(r["attempt_id"])
        att_status = str(r["attempt_status"])
        attempts_seen.add(att_id)

        qid = str(r["question_id"]) if r["question_id"] is not None else None
        if not qid:
            # Attempt with no answers yet
            results.append(
                TargetEvidenceItem(
                    student_id=st_id,
                    attempt_id=att_id,
                    publication_id=practice_publication_id,
                    question_id="",
                    knowledge_node_id=None,
                    score=None,
                    max_score=0.0,
                    weight=0.0,
                    is_correct=None,
                    submission_status=att_status,
                    grading_status="pending",
                    is_released=is_released,
                    status="target_unsubmitted" if att_status != "submitted" else "target_ungraded",
                    incomparable_reason="Practice attempt has not submitted answers",
                ).to_dict()
            )
            continue

        raw_score = float(r["score"]) if r["score"] is not None else None
        is_corr = int(r["is_correct"]) if r["is_correct"] is not None else None
        gr_status = str(r["grading_status"] or "pending")

        # Parse question max score and potential embedded node_id from payload
        try:
            q_payloads = json.loads(str(r["question_payload_json"] or "[]"))
        except Exception:
            q_payloads = []
        q_meta = next((qp for qp in q_payloads if isinstance(qp, dict) and str(qp.get("question_id")) == qid), {})
        max_score = float(q_meta.get("score_per_item") or 5.0)

        # Knowledge node resolution: check payload or project graph
        embedded_nid = str(q_meta.get("knowledge_node_id") or q_meta.get("node_id") or "").strip() or None
        bound_nodes = [embedded_nid] if embedded_nid else node_bindings.get(qid, [])

        if not bound_nodes:
            results.append(
                TargetEvidenceItem(
                    student_id=st_id,
                    attempt_id=att_id,
                    publication_id=practice_publication_id,
                    question_id=qid,
                    knowledge_node_id=None,
                    score=raw_score,
                    max_score=max_score,
                    weight=1.0,
                    is_correct=is_corr,
                    submission_status=att_status,
                    grading_status=gr_status,
                    is_released=is_released,
                    status="missing_knowledge_node",
                    incomparable_reason=f"Question {qid} has no bound knowledge node in graph",
                ).to_dict()
            )
            continue

        unique_nodes = list(dict.fromkeys(bound_nodes))
        m = len(unique_nodes)
        weight = 1.0 / m
        eff_score = round(raw_score / m, 4) if raw_score is not None else None
        eff_max = round(max_score / m, 4)

        for nid in unique_nodes:
            if att_status != "submitted":
                comp_status = "target_unsubmitted"
                reason = "Practice attempt is not yet submitted"
            elif gr_status != "graded":
                comp_status = "target_ungraded"
                reason = "Practice attempt is pending grading"
            elif not is_released:
                comp_status = "target_unreleased"
                reason = "Practice publication results have not been released to students"
            else:
                comp_status = "valid"
                reason = None

            results.append(
                TargetEvidenceItem(
                    student_id=st_id,
                    attempt_id=att_id,
                    publication_id=practice_publication_id,
                    question_id=qid,
                    knowledge_node_id=nid,
                    score=eff_score,
                    max_score=eff_max,
                    weight=weight,
                    is_correct=is_corr,
                    submission_status=att_status,
                    grading_status=gr_status,
                    is_released=is_released,
                    status=comp_status,
                    incomparable_reason=reason,
                ).to_dict()
            )

    return results
