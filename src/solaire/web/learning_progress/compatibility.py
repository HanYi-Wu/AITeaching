"""Read frozen sources and current answers without changing historical evidence."""

from __future__ import annotations

from contextlib import closing
import json
from pathlib import Path
from typing import Any

from solaire.web.learning_progress.sources import (
    compute_batch_snapshot_hash,
    compute_online_source_snapshot_hashes,
    get_graph_question_node_bindings,
    question_node_ids,
)
from solaire.web.learning_progress.store import get_frozen_baselines, get_practice_sources
from solaire.web.learning_progress.types import FrozenBaselineItem
from solaire.web.platform_db import connect


def get_frozen_baseline(root: Path, *, practice_publication_id: str, student_id: str | None = None) -> list[dict[str, Any]]:
    return [item.to_dict() for item in get_frozen_baselines(
        root, practice_publication_id=practice_publication_id, student_id=student_id,
    )]


def get_authoritative_source_status(
    root: Path,
    project_root: Path | None,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
    allowed_student_ids: set[str] | None = None,
    frozen_baselines: list[FrozenBaselineItem] | None = None,
) -> dict[str, Any]:
    sources = get_practice_sources(root, practice_publication_id)
    baselines = frozen_baselines if frozen_baselines is not None else get_frozen_baselines(
        root, practice_publication_id=practice_publication_id, student_id=student_id,
    )
    if student_id is not None:
        baselines = [item for item in baselines if item.student_id == student_id]
    if allowed_student_ids is not None:
        baselines = [item for item in baselines if item.student_id in allowed_student_ids]
    result = {
        "status": "valid", "source_type": sources[0].source_type if sources else "unknown",
        "source_ref_id": (sources[0].source_batch_id or sources[0].source_publication_id or "") if sources else "",
        "is_modified": False, "is_missing": False, "reason": None,
    }
    if not sources or not baselines:
        return {**result, "status": "source_missing", "is_missing": True, "reason": "No verified frozen baseline"}

    # Online baselines are frozen per source and student, not as one class-wide hash.
    expected = {(item.source_type, item.source_ref_id, item.student_id): item.source_snapshot_hash for item in baselines}
    online_refs = {(source.source_type, str(source.source_batch_id or source.source_publication_id or ""))
                   for source in sources if source.source_type != "diagnostic_batch"}
    pairs = [(ref, sid) for kind, ref, sid in expected if (kind, ref) in online_refs]
    with closing(connect(root)) as con, con:
        con.execute("BEGIN")
        online_hashes = compute_online_source_snapshot_hashes(con, pairs)
        publication_statuses = {}
        source_ids = list(dict.fromkeys(ref for ref, _sid in pairs))
        for start in range(0, len(source_ids), 500):
            chunk = source_ids[start : start + 500]
            placeholders = ",".join("?" for _ in chunk)
            publication_statuses.update({str(row["id"]): row["status"] for row in con.execute(
                f"SELECT id, status FROM exam_publications WHERE id IN ({placeholders})", chunk,
            )})
        for source in sources:
            source_ref = str(source.source_batch_id or source.source_publication_id or "")
            relevant = [(key, digest) for key, digest in expected.items() if key[:2] == (source.source_type, source_ref)]
            if not relevant:
                continue
            if source.source_type == "diagnostic_batch":
                if project_root is None:
                    return {**result, "status": "source_missing", "is_missing": True, "reason": "Source project is not open"}
                try:
                    current = compute_batch_snapshot_hash(project_root, str(source.source_exam_id), source_ref)
                except FileNotFoundError:
                    return {**result, "status": "source_missing", "is_missing": True, "reason": "Source score batch was deleted"}
                result["is_modified"] |= any(digest != current for _, digest in relevant)
            else:
                if source_ref not in publication_statuses or publication_statuses[source_ref] == "revoked":
                    return {**result, "status": "source_missing", "is_missing": True, "reason": "Source publication was revoked or deleted"}
                for key, digest in relevant:
                    result["is_modified"] |= digest != online_hashes[(source_ref, key[2])]
    if result["is_modified"]:
        result.update(status="source_modified", reason="Source scores were regraded or modified after the baseline was frozen")
    return result


def get_authoritative_target_evidence(
    root: Path,
    project_root: Path | None,
    *,
    practice_publication_id: str,
    student_id: str | None = None,
    include_unreleased: bool = False,
) -> list[dict[str, Any]]:
    """Use each recipient's frozen questions and the existing explicit grade release."""
    bindings = get_graph_question_node_bindings(project_root) if project_root else {}
    params: list[Any] = [practice_publication_id]
    student_clause = ""
    if student_id is not None:
        student_clause = " AND sa.student_id = ?"
        params.append(student_id)
    with closing(connect(root)) as con, con:
        attempts = con.execute(
            f"SELECT sa.* FROM student_attempts sa WHERE sa.publication_id = ? {student_clause}", tuple(params),
        ).fetchall()
        answers = con.execute(
            f"""SELECT ans.* FROM student_answers ans JOIN student_attempts sa ON sa.id = ans.attempt_id
                WHERE sa.publication_id = ? {student_clause}""", tuple(params),
        ).fetchall()
    answer_map = {(row["attempt_id"], row["question_id"]): row for row in answers}
    evidence: list[dict[str, Any]] = []
    for attempt in attempts:
        try:
            questions = json.loads(attempt["question_payload_json"] or "[]")
        except json.JSONDecodeError:
            questions = []
        if not questions:
            questions = [{"question_id": "", "knowledge_node_ids": []}]
        for question in questions:
            qid = str(question.get("question_id") or "")
            answer = answer_map.get((attempt["id"], qid))
            nodes = question_node_ids(question, bindings)
            released = bool(attempt["grading_completed_at"])
            grading = str(answer["grading_status"] or "pending") if answer else "pending"
            if attempt["status"] != "submitted":
                status, reason = "target_unsubmitted", "复练答卷尚未提交"
            elif grading not in {"graded", "reviewed"}:
                status, reason = "target_ungraded", "复练答卷正在批改中"
            elif not released and not include_unreleased:
                status, reason = "target_unreleased", "复练成绩尚未发布"
            elif not nodes:
                status, reason = "missing_knowledge_node", "题目缺少发布时的知识点绑定"
            else:
                status, reason = "valid", None
            weight = 1.0 / len(nodes) if nodes else 1.0
            score = float(answer["score"]) if answer and answer["score"] is not None else None
            maximum = float(question.get("score_per_item") or 0.0)
            for node in nodes or [None]:
                evidence.append({
                    "student_id": str(attempt["student_id"]), "attempt_id": str(attempt["id"]),
                    "publication_id": practice_publication_id, "question_id": qid, "knowledge_node_id": node,
                    "score": score * weight if score is not None and (released or include_unreleased) else None,
                    "max_score": maximum * weight, "weight": weight,
                    "is_correct": answer["is_correct"] if answer and (released or include_unreleased) else None,
                    "submission_status": attempt["status"], "grading_status": grading,
                    "is_released": released, "status": status, "incomparable_reason": reason,
                })
    return evidence
