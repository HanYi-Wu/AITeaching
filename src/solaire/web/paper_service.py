"""Paper management services for offline/online exam delivery."""

from __future__ import annotations

import uuid
import json
import asyncio
import base64
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.papers.grading_versions import (
    advance_answer_revision, answer_grading_version, check_grading_version, load_answer_revisions,
)
from solaire.web.papers.scoring import (
    question_score_map, score_percent, validate_manual_score,
)
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.papers.repository import (
    clean_subject as _clean_subject,
    clean_title as _clean_title,
    get_or_create_exam_paper,
    get_paper_record,
    list_adaptive_paper_records,
)
from solaire.web.papers.visibility import (
    adaptive_paper_summary as _adaptive_paper_summary,
    attempt_access_clause as _attempt_access_clause,
    ensure_paper_access as _ensure_paper_access,
    paper_visible_to_user as _paper_visible_to_user,
    publication_access_clause as _publication_access_clause,
    publication_stats as _publication_stats,
)
from solaire.web.papers.publication_policy import (
    DELIVERY_MODES,
    PUBLICATION_STATUSES,
    SUBMISSION_MODES,
    ensure_publication_status_transition,
    normalize_delivery_mode,
    normalize_publication_status,
    normalize_schedule,
    normalize_submission_mode,
    normalize_time_limit,
)
from solaire.web.papers import publication_service
from solaire.web.papers import ai_grading
from solaire.web.papers.grading import (
    completed_attempt_scores_in_connection,
    paper_attempt_row_in_connection,
    recompute_attempt_score,
    recompute_attempt_score_in_connection,
)
from solaire.web.result_service import list_exam_results
from solaire.web.student_service import _load_attempt_question_payloads, _load_exam_question_payloads
from solaire.web.student_service import _publication_datetime

MAX_PAGE_SIZE = 100


def _new_id() -> str:
    return uuid.uuid4().hex


def _normalized_schedule(start_at, end_at):
    return normalize_schedule(start_at, end_at)


def _page(items: list[dict[str, Any]], *, page: int = 1, page_size: int = 10) -> dict[str, Any]:
    clean_page = max(1, int(page or 1))
    clean_page_size = max(1, min(MAX_PAGE_SIZE, int(page_size or 10)))
    total = len(items)
    total_pages = max(1, (total + clean_page_size - 1) // clean_page_size)
    if clean_page > total_pages:
        clean_page = total_pages
    start = (clean_page - 1) * clean_page_size
    return {
        "items": items[start : start + clean_page_size],
        "total": total,
        "page": clean_page,
        "page_size": clean_page_size,
        "total_pages": total_pages,
    }


def _contains_query(item: dict[str, Any], query: str, fields: list[str]) -> bool:
    needle = query.strip().lower()
    if not needle:
        return True
    values = [str(item.get(field) or "") for field in fields]
    return needle in " ".join(values).lower()


def _paper_record_for_exam(
    root: Path,
    exam: dict[str, Any],
    user: dict[str, Any],
    *,
    claim: bool = False,
) -> dict[str, Any]:
    return get_or_create_exam_paper(root, exam, user, claim=claim, id_factory=_new_id)


def _paper_summary(
    record: dict[str, Any],
    stats: dict[str, int],
    *,
    exam: dict[str, Any] | None = None,
    question_count: int = 0,
    section_count: int = 0,
    score_batch_count: int = 0,
    has_score: bool = False,
    has_pdf: bool = False,
    has_docx: bool = False,
    latest_batch_id: str | None = None,
    exam_dir: str | None = None,
    mtime: str | None = None,
) -> dict[str, Any]:
    if exam is not None:
        question_count = int(exam.get("question_count") or 0)
        section_count = int(exam.get("section_count") or 0)
        score_batch_count = int(exam.get("score_batch_count") or 0)
        has_score = bool(exam.get("has_score"))
        has_pdf = bool(exam.get("has_pdf"))
        has_docx = bool(exam.get("has_docx"))
        latest_batch_id = exam.get("latest_batch_id")
        exam_dir = exam.get("exam_dir")
        mtime = exam.get("mtime")
    return {
        "paper_id": record["id"],
        "exam_id": record["exam_id"],
        "title": record["title"],
        "subject": record["subject"],
        "delivery_mode": record["delivery_mode"],
        "status": record["status"],
        "owner_teacher_id": record["owner_teacher_id"],
        "school_id": record["school_id"],
        "folder_id": record.get("folder_id"),
        "question_count": question_count,
        "section_count": section_count,
        "score_batch_count": score_batch_count,
        "has_score": has_score,
        "has_pdf": has_pdf,
        "has_docx": has_docx,
        "latest_batch_id": latest_batch_id,
        "exam_dir": exam_dir,
        "mtime": mtime,
        **stats,
    }


def list_papers(project_root: Path, platform_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(platform_root)
    exams = list_exam_results(project_root)
    papers: list[dict[str, Any]] = []
    for exam in exams:
        try:
            record = _paper_record_for_exam(platform_root, exam, user)
        except PermissionError:
            continue
        if not _paper_visible_to_user(record, user):
            continue
        stats = _publication_stats(platform_root, str(record["id"]), user)
        papers.append(_paper_summary(record, stats, exam=exam))
    adaptive_records = list_adaptive_paper_records(platform_root)
    existing_ids = {str(item["paper_id"]) for item in papers}
    for record in adaptive_records:
        paper_id = str(record.get("id") or "")
        if not paper_id or paper_id in existing_ids or not _paper_visible_to_user(record, user):
            continue
        question_count, has_score = _adaptive_paper_summary(platform_root, paper_id, user)
        papers.append(
            _paper_summary(
                record,
                _publication_stats(platform_root, paper_id, user),
                question_count=question_count,
                section_count=1 if question_count else 0,
                has_score=has_score,
                mtime=record.get("updated_at"),
            )
        )
    return papers


def sync_paper_for_exam(
    project_root: Path,
    platform_root: Path,
    user: dict[str, Any],
    *,
    exam_id: str,
) -> dict[str, Any]:
    init_platform_db(platform_root)
    clean_exam_id = exam_id.strip()
    if not clean_exam_id:
        raise ValueError("exam_id is required")
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("Only teachers and admins can sync papers")
    from solaire.web.exam_workspace_service import workspace_dir
    workspace_dir(project_root, clean_exam_id)
    exams = list_exam_results(project_root)
    matched = next((exam for exam in exams if str(exam.get("exam_id") or "") == clean_exam_id), None)
    if matched is None:
        raise ValueError("exam not found")
    record = _paper_record_for_exam(platform_root, matched, user, claim=True)
    _ensure_paper_access(record, user)
    stats = _publication_stats(platform_root, str(record["id"]), user)
    return _paper_summary(record, stats, exam=matched)


def query_papers(
    project_root: Path,
    platform_root: Path,
    user: dict[str, Any],
    *,
    q: str | None = None,
    delivery_mode: str | None = None,
    status: str | None = None,
    subject: str | None = None,
    folder_id: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    papers = list_papers(project_root, platform_root, user)
    if delivery_mode and delivery_mode != "all":
        papers = [paper for paper in papers if str(paper.get("delivery_mode") or "") == delivery_mode]
    if status and status != "all":
        papers = [paper for paper in papers if str(paper.get("status") or "") == status]
    if subject and subject != "all":
        papers = [paper for paper in papers if str(paper.get("subject") or "") == subject]
    if folder_id:
        with connect(platform_root) as con:
            folder_rows = con.execute(
                "WITH RECURSIVE subtree(id) AS (SELECT id FROM content_folders WHERE id=? UNION ALL SELECT child.id FROM content_folders child JOIN subtree parent ON child.parent_id=parent.id) SELECT id FROM subtree",
                (folder_id,),
            ).fetchall()
        allowed_folders = {str(row["id"]) for row in folder_rows}
        papers = [paper for paper in papers if str(paper.get("folder_id") or "") in allowed_folders]
    if q:
        papers = [
            paper
            for paper in papers
            if _contains_query(paper, q, ["title", "exam_id", "subject", "delivery_mode", "status"])
        ]
    papers.sort(key=lambda item: str(item.get("mtime") or item.get("updated_at") or ""), reverse=True)
    result = _page(papers, page=page, page_size=page_size)
    return {"papers": result.pop("items"), **result}


def get_paper(root: Path, paper_id: str) -> dict[str, Any]:
    paper = get_paper_record(root, paper_id)
    if paper is None:
        raise ValueError("paper not found")
    return paper


def update_paper_delivery_mode(root: Path, paper_id: str, delivery_mode: str, user: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("Only teachers and admins can update paper delivery mode")
    clean_mode = normalize_delivery_mode(delivery_mode)
    now = utc_now()
    with connect(root) as con:
        existing = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
        if existing is None:
            raise ValueError("paper not found")
        _ensure_paper_access(row_to_dict(existing) or {}, user)
        con.execute(
            "UPDATE paper_records SET delivery_mode = ?, updated_at = ? WHERE id = ?",
            (clean_mode, now, paper_id),
        )
        row = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(row)
    if paper is None:
        raise RuntimeError("failed to update paper")
    return paper


def list_paper_publications(root: Path, *, paper_id: str, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    access_clause, access_params = _publication_access_clause(user)
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT
              ep.*,
              u.display_name AS teacher_name,
              u.username AS teacher_username,
              GROUP_CONCAT(DISTINCT c.id) AS class_ids,
              GROUP_CONCAT(DISTINCT c.name) AS class_names,
              GROUP_CONCAT(DISTINCT CASE WHEN ep.recipient_scope='student' THEN s.display_name END) AS student_names,
              COUNT(DISTINCT sa.id) AS attempt_count,
              COUNT(DISTINCT CASE WHEN sa.status IN ('submitted', 'completed') OR sa.submitted_at IS NOT NULL THEN sa.id END) AS submitted_count,
              COUNT(DISTINCT pe.id) AS proctor_event_count
            FROM exam_publications ep
            LEFT JOIN users u ON u.id = ep.teacher_id
            LEFT JOIN publication_classes pc ON pc.publication_id = ep.id
            LEFT JOIN classes c ON c.id = pc.class_id
            LEFT JOIN student_attempts sa ON sa.publication_id = ep.id
            LEFT JOIN students s ON s.id = sa.student_id
            LEFT JOIN proctor_events pe ON pe.publication_id = ep.id
            WHERE ep.paper_id = ? AND {access_clause}
            GROUP BY ep.id
            ORDER BY ep.created_at DESC
            """,
            (paper_id, *access_params),
        ).fetchall()
    publications: list[dict[str, Any]] = []
    for row in rows:
        item = row_to_dict(row) or {}
        item["show_results_immediately"] = bool(item.get("show_results_immediately"))
        item["randomize_questions"] = bool(item.get("randomize_questions"))
        item["randomize_answers"] = bool(item.get("randomize_answers"))
        item["class_ids"] = [part for part in str(item.pop("class_ids") or "").split(",") if part]
        item["class_names"] = [part for part in str(item.pop("class_names") or "").split(",") if part]
        item["student_names"] = [part for part in str(item.pop("student_names") or "").split(",") if part]
        item["attempt_count"] = int(item.get("attempt_count") or 0)
        item["submitted_count"] = int(item.get("submitted_count") or 0)
        item["proctor_event_count"] = int(item.get("proctor_event_count") or 0)
        item["max_screen_switches"] = int(item.get("max_screen_switches") or 0)
        item["time_limit_minutes"] = (
            int(item["time_limit_minutes"]) if item.get("time_limit_minutes") is not None else None
        )
        publications.append(item)
    return publications


def update_paper_publication(
    root: Path,
    *,
    paper_id: str,
    publication_id: str,
    user: dict[str, Any],
    title: str | None = None,
    description: str | None = None,
    start_at: str | None = None,
    end_at: str | None = None,
    time_limit_minutes: int | None = None,
    show_results_immediately: bool | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    now = utc_now()
    updates: list[str] = ["updated_at = ?"]
    params: list[object] = [now]
    if title is not None:
        updates.append("title = ?")
        params.append(_clean_title(title, str(paper["title"])))
    if description is not None:
        updates.append("description = ?")
        params.append(description.strip() or None)
    if start_at is not None:
        updates.append("start_at = ?")
        params.append(_normalized_schedule(start_at, None)[0])
    if end_at is not None:
        updates.append("end_at = ?")
        params.append(_normalized_schedule(None, end_at)[1])
    if time_limit_minutes is not None:
        updates.append("time_limit_minutes = ?")
        params.append(normalize_time_limit(time_limit_minutes))
    if show_results_immediately is not None:
        updates.append("show_results_immediately = ?")
        params.append(1 if show_results_immediately else 0)
    if status is not None:
        clean_status = normalize_publication_status(status)
        updates.append("status = ?")
        params.append(clean_status)
    params.extend([publication_id, paper_id])
    with connect(root) as con:
        publication = con.execute(
            "SELECT teacher_id, start_at, end_at, folder_id, status FROM exam_publications WHERE id = ? AND paper_id = ?",
            (publication_id, paper_id),
        ).fetchone()
        if publication is None:
            raise ValueError("publication not found")
        if user.get("role") == "teacher" and str(publication["teacher_id"]) != str(user.get("id")):
            raise PermissionError("Teacher can only manage own publications")
        ensure_publication_status_transition(publication["status"], status)
        _normalized_schedule(start_at if start_at is not None else publication['start_at'],
                             end_at if end_at is not None else publication['end_at'])
        con.execute(
            f"UPDATE exam_publications SET {', '.join(updates)} WHERE id = ? AND paper_id = ?",
            tuple(params),
        )
    matches = [item for item in list_paper_publications(root, paper_id=paper_id, user=user) if item["id"] == publication_id]
    if not matches:
        raise RuntimeError("failed to update publication")
    return matches[0]


def revoke_paper_publication(root: Path, *, paper_id: str, publication_id: str, user: dict[str, Any]) -> dict[str, Any]:
    publication = update_paper_publication(
        root,
        paper_id=paper_id,
        publication_id=publication_id,
        user=user,
        status="revoked",
    )
    with connect(root) as con:
        active = con.execute(
            "SELECT 1 FROM exam_publications WHERE paper_id = ? AND status <> 'revoked' LIMIT 1",
            (paper_id,),
        ).fetchone()
        if active is None:
            con.execute("UPDATE paper_records SET status = 'draft', updated_at = ? WHERE id = ?", (utc_now(), paper_id))
    return publication


def _score_percent(score: object, max_score: object) -> float | None:
    return score_percent(score, max_score, legacy_zero_max=True)


def _risk_level(value: float | None) -> str:
    if value is None:
        return "no_data"
    if value < 60:
        return "high"
    if value < 75:
        return "medium"
    return "low"


def _attempt_status_group(attempt: dict[str, Any]) -> str:
    status = str(attempt.get("status") or "not_started")
    if status in {"submitted", "completed"} or attempt.get("submitted_at"):
        return "completed"
    if status == "in_progress" or attempt.get("started_at"):
        return "in_progress"
    return "not_started"


def _analysis_question_maps(root: Path, project_root: Path, paper: dict[str, Any], user: dict[str, Any], publication_id: str | None, class_id: str | None = None):
    # Published snapshots, not the editable source, define historical exam content.
    clause, params = _analysis_attempt_clause(user, publication_id, class_id=class_id)
    with connect(root) as con:
        rows = con.execute(
            f"SELECT sa.question_payload_json FROM student_attempts sa "
            f"JOIN exam_publications ep ON ep.id=sa.publication_id WHERE ep.paper_id=? AND {clause} ORDER BY sa.rowid",
            (paper['id'], *params),
        ).fetchall()
    by_id = {}
    for row in rows:
        try:
            payload = json.loads(row['question_payload_json'] or '[]')
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(payload, list):
            for question in payload:
                if isinstance(question, dict) and question.get('question_id'):
                    by_id.setdefault(str(question['question_id']), question)
    if by_id:
        return list(by_id.values()), by_id, {qid: float(q.get('score_per_item') or 0) for qid, q in by_id.items()}
    return _question_maps(project_root, paper)


def _build_module_report(
    root: Path,
    *,
    paper_id: str,
    project_root: Path | None,
    paper: dict[str, Any],
    students: list[dict[str, Any]],
    average_score: float | None,
    user: dict[str, Any],
    publication_id: str | None = None,
    class_id: str | None = None,
) -> list[dict[str, Any]]:
    if project_root is None:
        return []
    try:
        questions, _by_id, score_by_id = _analysis_question_maps(root, project_root, paper, user, publication_id, class_id)
    except (FileNotFoundError, ValueError):
        return []
    modules: dict[str, dict[str, Any]] = {}
    question_module: dict[str, str] = {}
    for question in questions:
        qid = str(question.get("question_id") or "")
        module_id = str(question.get("section_id") or "Unassigned")
        question_module[qid] = module_id
        item = modules.setdefault(
            module_id,
            {
                "module_id": module_id,
                "label": module_id,
                "question_ids": [],
                "question_count": 0,
                "student_count": len(students),
                "answered_count": 0,
                "scored_count": 0,
                "correct_count": 0,
                "wrong_count": 0,
                "max_score": 0.0,
                "_scores": [],
                "_max_scores": [],
            },
        )
        item["question_ids"].append(qid)
        item["question_count"] = len(item["question_ids"])
        item["max_score"] = round(float(item["max_score"]) + float(score_by_id.get(qid) or 0), 2)

    if not modules:
        return []

    access_clause, access_params = _analysis_attempt_clause(user, publication_id, class_id=class_id)
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT ans.question_id, ans.score, ans.is_correct, ans.answer_payload,
                   sa.score AS attempt_score
            FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ? AND {access_clause}
            """,
            (paper_id, *access_params),
        ).fetchall()

    for row in rows:
        question_id = str(row["question_id"] or "")
        module_id = question_module.get(question_id)
        if not module_id:
            continue
        item = modules[module_id]
        payload = _json_payload(row["answer_payload"])
        if payload:
            item["answered_count"] = int(item["answered_count"]) + 1
        if row["score"] is not None and row["attempt_score"] is not None:
            max_score = float(score_by_id.get(question_id) or 0)
            if max_score > 0:
                item["_scores"].append(float(row["score"]))
                item["_max_scores"].append(max_score)
            item["scored_count"] = int(item["scored_count"]) + 1
        if row["is_correct"] is not None and row["attempt_score"] is not None:
            if int(row["is_correct"]):
                item["correct_count"] = int(item["correct_count"]) + 1
            else:
                item["wrong_count"] = int(item["wrong_count"]) + 1

    out: list[dict[str, Any]] = []
    for item in modules.values():
        scores = [float(value) for value in item.pop("_scores")]
        max_scores = [float(value) for value in item.pop("_max_scores")]
        if scores and sum(max_scores) > 0:
            average_score_percent: float | None = round(sum(scores) / sum(max_scores) * 100, 2)
        else:
            average_score_percent = average_score
        correct_total = int(item["correct_count"]) + int(item["wrong_count"])
        accuracy_rate = round(int(item["correct_count"]) / correct_total * 100, 2) if correct_total else None
        item["average_score_percent"] = average_score_percent
        item["accuracy_rate"] = accuracy_rate
        item["risk_level"] = _risk_level(average_score_percent)
        out.append(item)
    return sorted(out, key=lambda value: str(value.get("module_id") or ""))


def _build_question_report(
    root: Path,
    *,
    paper_id: str,
    project_root: Path | None,
    paper: dict[str, Any],
    user: dict[str, Any],
    publication_id: str | None = None,
    class_id: str | None = None,
) -> list[dict[str, Any]]:
    if project_root is None:
        return []
    try:
        questions, _by_id, score_by_id = _analysis_question_maps(root, project_root, paper, user, publication_id, class_id)
    except (FileNotFoundError, ValueError):
        return []
    reports: dict[str, dict[str, Any]] = {}
    for order, question in enumerate(questions):
        qid = str(question.get("question_id") or "")
        if not qid:
            continue
        reports[qid] = {
            "_order": order,
            "question_id": qid,
            "header": question.get("header"),
            "section_id": question.get("section_id"),
            "type": question.get("type"),
            "content": question.get("content"),
            "score_per_item": float(score_by_id.get(qid) or 0),
            "answered_count": 0,
            "scored_count": 0,
            "correct_count": 0,
            "wrong_count": 0,
            "_scores": [],
            "_max_scores": [],
        }
    if not reports:
        return []

    access_clause, access_params = _analysis_attempt_clause(user, publication_id, class_id=class_id)
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT ans.question_id, ans.answer_payload, ans.is_correct, ans.score,
                   sa.score AS attempt_score
            FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ? AND {access_clause}
            """,
            (paper_id, *access_params),
        ).fetchall()

    for row in rows:
        question_id = str(row["question_id"] or "")
        item = reports.get(question_id)
        if item is None:
            continue
        payload = _json_payload(row["answer_payload"])
        if payload:
            item["answered_count"] = int(item["answered_count"]) + 1
        if row["score"] is not None and row["attempt_score"] is not None:
            max_score = float(score_by_id.get(question_id) or 0)
            if max_score > 0:
                item["_scores"].append(float(row["score"]))
                item["_max_scores"].append(max_score)
            item["scored_count"] = int(item["scored_count"]) + 1
        if row["is_correct"] is not None and row["attempt_score"] is not None:
            if int(row["is_correct"]):
                item["correct_count"] = int(item["correct_count"]) + 1
            else:
                item["wrong_count"] = int(item["wrong_count"]) + 1

    out: list[dict[str, Any]] = []
    for item in reports.values():
        scores = [float(value) for value in item.pop("_scores")]
        max_scores = [float(value) for value in item.pop("_max_scores")]
        if scores and sum(max_scores) > 0:
            average_score_percent: float | None = round(sum(scores) / sum(max_scores) * 100, 2)
        else:
            average_score_percent = None
        correct_total = int(item["correct_count"]) + int(item["wrong_count"])
        accuracy_rate = round(int(item["correct_count"]) / correct_total * 100, 2) if correct_total else None
        item["average_score_percent"] = average_score_percent
        item["accuracy_rate"] = accuracy_rate
        item["risk_level"] = _risk_level(average_score_percent if average_score_percent is not None else accuracy_rate)
        out.append(item)
    out = sorted(out, key=lambda value: int(value.get("_order") or 0))
    for item in out:
        item.pop("_order", None)
    return out


def _build_class_report(root: Path, *, paper_id: str, user: dict[str, Any], publication_id: str | None = None, class_id: str | None = None) -> list[dict[str, Any]]:
    access_clause, access_params = _analysis_attempt_clause(user, publication_id, class_id=class_id)
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT
              c.id AS class_id,
              c.name AS class_name,
              c.grade AS class_grade,
              sa.id AS attempt_id,
              sa.status,
              sa.started_at,
              sa.submitted_at,
              sa.score,
              sa.max_score,
              sa.time_spent_seconds,
              (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id) AS answer_count,
              (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id AND aa.score IS NULL) AS unscored_answer_count,
              COUNT(pe.id) AS screen_switch_count
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN classes c ON c.id = pc.class_id
            JOIN student_attempts sa ON sa.publication_id = ep.id
            JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = sa.student_id
            LEFT JOIN proctor_events pe ON pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'
            WHERE ep.paper_id = ? AND {access_clause}
            GROUP BY c.id, sa.id
            ORDER BY c.name
            """,
            (paper_id, *access_params),
        ).fetchall()

    classes: dict[str, dict[str, Any]] = {}
    for row in rows:
        class_id = str(row["class_id"] or "")
        if not class_id:
            continue
        item = classes.setdefault(
            class_id,
            {
                "class_id": class_id,
                "class_name": row["class_name"],
                "class_grade": row["class_grade"],
                "student_count": 0,
                "completed_count": 0,
                "in_progress_count": 0,
                "not_started_count": 0,
                "screen_switch_count": 0,
                "_scores": [],
                "_times": [],
            },
        )
        item["student_count"] = int(item["student_count"]) + 1
        status_group = _attempt_status_group(row_to_dict(row) or {})
        if status_group == "completed":
            item["completed_count"] = int(item["completed_count"]) + 1
        elif status_group == "in_progress":
            item["in_progress_count"] = int(item["in_progress_count"]) + 1
        else:
            item["not_started_count"] = int(item["not_started_count"]) + 1
        score_percent = (
            _score_percent(row["score"], row["max_score"])
            if int(row["answer_count"] or 0) > 0 and int(row["unscored_answer_count"] or 0) == 0
            else None
        )
        if score_percent is not None:
            item["_scores"].append(score_percent)
        time_spent = int(row["time_spent_seconds"] or 0)
        if time_spent > 0:
            item["_times"].append(time_spent)
        item["screen_switch_count"] = int(item["screen_switch_count"]) + int(row["screen_switch_count"] or 0)

    out: list[dict[str, Any]] = []
    for item in classes.values():
        scores = [float(value) for value in item.pop("_scores")]
        times = [int(value) for value in item.pop("_times")]
        total = int(item["student_count"])
        item["completion_rate"] = round(int(item["completed_count"]) / total * 100, 2) if total else 0
        item["average_score"] = round(sum(scores) / len(scores), 2) if scores else None
        item["average_time_seconds"] = round(sum(times) / len(times), 2) if times else None
        out.append(item)
    return sorted(out, key=lambda value: str(value.get("class_name") or ""))


def _build_radar(
    *,
    completion_rate: float,
    average_score: float | None,
    average_time_seconds: float | None,
    total: int,
    exceeded_student_count: int,
    modules: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if average_time_seconds is None:
        time_efficiency = 0.0
    else:
        average_minutes = max(0.0, float(average_time_seconds) / 60)
        time_efficiency = max(0.0, min(100.0, 100.0 - max(0.0, average_minutes - 30.0) * 1.25))
    proctoring = 100.0 if total <= 0 else max(0.0, 100.0 - (exceeded_student_count / total * 100.0))
    module_values = [
        float(item["average_score_percent"])
        for item in modules
        if item.get("average_score_percent") is not None
    ]
    module_mastery = round(sum(module_values) / len(module_values), 2) if module_values else float(average_score or 0)
    axes = [
        ("completion", "完成率", completion_rate),
        ("score", "得分率", average_score or 0),
        ("time_efficiency", "时间效率", time_efficiency),
        ("proctoring", "监考诚信", proctoring),
        ("module_mastery", "模块掌握度", module_mastery),
    ]
    return [{"id": axis_id, "label": label, "value": round(max(0.0, min(100.0, float(value))), 2)} for axis_id, label, value in axes]


def _analysis_attempt_clause(user: dict[str, Any], publication_id: str | None, *, attempt_alias: str = "sa", class_id: str | None = None) -> tuple[str, list[str]]:
    clause, params = _attempt_access_clause(user, attempt_alias=attempt_alias)
    if publication_id:
        clause = f"({clause}) AND {attempt_alias}.publication_id = ?"
        params = [*params, publication_id]
    if class_id:
        clause = (f"({clause}) AND EXISTS (SELECT 1 FROM publication_classes filter_pc "
                  f"JOIN class_students filter_cs ON filter_cs.class_id = filter_pc.class_id "
                  f"JOIN exam_publications filter_ep ON filter_ep.id = filter_pc.publication_id "
                  f"WHERE filter_pc.publication_id = {attempt_alias}.publication_id "
                  f"AND filter_ep.recipient_scope = 'class' "
                  f"AND filter_pc.class_id = ? AND filter_cs.student_id = "
                  f"{attempt_alias}.student_id)")
        params = [*params, class_id]
    return clause, params


def analyze_paper(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    project_root: Path | None = None,
    publication_id: str | None = None,
    class_id: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    role = str(user.get("role") or "")
    if role == "teacher" and paper.get("owner_teacher_id") != user.get("id"):
        raise PermissionError("Teacher can only analyze own papers")
    if role == "school" and paper.get("school_id") != user.get("school_id"):
        raise PermissionError("School can only analyze own papers")
    if role not in {"admin", "school", "teacher"}:
        raise PermissionError("Only admin, school, and teacher users can analyze papers")

    publication_access, publication_params = _publication_access_clause(user)
    with connect(root) as con:
        publication_rows = con.execute(
            f"SELECT * FROM exam_publications ep WHERE paper_id = ? AND {publication_access} ORDER BY created_at DESC, ep.rowid DESC",
            (paper_id, *publication_params),
        ).fetchall()
        available_publications = [row_to_dict(row) or {} for row in publication_rows]
        if publication_id is None and publication_rows:
            publication_id = str(next((row for row in publication_rows if row["status"] != "revoked"), publication_rows[0])["id"])
        if publication_id and publication_id not in {str(row["id"]) for row in publication_rows}:
            raise FileNotFoundError("发布记录不存在或无权访问")
        if class_id:
            allowed_class = con.execute(
                f"SELECT 1 FROM exam_publications ep JOIN publication_classes pc ON pc.publication_id=ep.id "
                f"WHERE ep.paper_id=? AND ep.id=? AND ep.recipient_scope='class' AND pc.class_id=? AND {publication_access} LIMIT 1",
                (paper_id, publication_id, class_id, *publication_params),
            ).fetchone()
            if allowed_class is None:
                raise PermissionError("无权查看该发布批次的班级分析")
        class_choices = [row_to_dict(row) or {} for row in con.execute(
            f"SELECT DISTINCT c.id, c.name, c.grade FROM exam_publications ep "
            f"JOIN publication_classes pc ON pc.publication_id=ep.id "
            f"JOIN classes c ON c.id=pc.class_id "
            f"WHERE ep.paper_id=? AND ep.recipient_scope='class' AND (? IS NULL OR ep.id=?) AND {publication_access} ORDER BY c.name",
            (paper_id, publication_id, publication_id, *publication_params),
        ).fetchall()]
        publication_rows = [row for row in publication_rows if str(row["id"]) == publication_id]
        attempt_access, attempt_params = _analysis_attempt_clause(user, publication_id, class_id=class_id)
        event_access, event_params = _analysis_attempt_clause(user, publication_id, attempt_alias="pe", class_id=class_id)
        attempt_rows = con.execute(
            f"""
            SELECT
              sa.*,
              ep.id AS publication_id,
              ep.title AS publication_title,
              ep.max_screen_switches,
              (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id) AS answer_count,
              (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id AND aa.score IS NULL) AS unscored_answer_count,
              (
                SELECT GROUP_CONCAT(c.name)
                FROM publication_classes pc
                JOIN classes c ON c.id = pc.class_id
                WHERE pc.publication_id = ep.id
              ) AS class_names,
              s.student_no,
              s.display_name,
              u.username AS account_username
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN students s ON s.id = sa.student_id
            LEFT JOIN users u ON u.id = s.user_id
            WHERE ep.paper_id = ? AND {attempt_access}
            ORDER BY s.display_name, s.student_no
            """,
            (paper_id, *attempt_params),
        ).fetchall()
        event_rows = con.execute(
            f"""
            SELECT pe.*
            FROM proctor_events pe
            JOIN exam_publications ep ON ep.id = pe.publication_id
            WHERE ep.paper_id = ? AND {event_access}
            ORDER BY pe.occurred_at
            """,
            (paper_id, *event_params),
        ).fetchall()
        answer_rows = con.execute(
            f"SELECT ans.attempt_id, ans.question_id, ans.score FROM student_answers ans "
            f"JOIN student_attempts sa ON sa.id=ans.attempt_id JOIN exam_publications ep ON ep.id=sa.publication_id "
            f"WHERE ep.paper_id=? AND {attempt_access}", (paper_id, *attempt_params)
        ).fetchall()

    allowed_publication_ids = {str(row["id"]) for row in publication_rows}
    attempt_rows = [row for row in attempt_rows if str(row["publication_id"]) in allowed_publication_ids]
    event_rows = [row for row in event_rows if str(row["publication_id"]) in allowed_publication_ids]

    events_by_attempt: dict[str, list[dict[str, Any]]] = {}
    scores_by_attempt: dict[str, dict[str, float | None]] = {}
    for answer in answer_rows:
        scores_by_attempt.setdefault(str(answer['attempt_id']), {})[str(answer['question_id'])] = answer['score']
    for row in event_rows:
        event = row_to_dict(row) or {}
        events_by_attempt.setdefault(str(event.get("attempt_id")), []).append(event)

    students: list[dict[str, Any]] = []
    score_values: list[float] = []
    time_values: list[int] = []
    completed = 0
    in_progress = 0
    not_started = 0
    flagged_student_ids: set[str] = set()
    for row in attempt_rows:
        attempt = row_to_dict(row) or {}
        if project_root is not None:
            _questions, _by_id, score_by_id = _question_maps_for_attempt(root, project_root, paper, attempt)
            canonical_max = round(sum(score_by_id.values()), 2)
            if canonical_max > 0:
                attempt["max_score"] = canonical_max
        status_group = _attempt_status_group(attempt)
        if status_group == "completed":
            completed += 1
        elif status_group == "in_progress":
            in_progress += 1
        else:
            not_started += 1
        score_percent = (
            _score_percent(attempt.get("score"), attempt.get("max_score"))
            if int(attempt.get("answer_count") or 0) > 0 and int(attempt.get("unscored_answer_count") or 0) == 0
            else None
        )
        if score_percent is not None:
            score_values.append(score_percent)
        time_spent = int(attempt.get("time_spent_seconds") or 0)
        if time_spent > 0:
            time_values.append(time_spent)
        attempt_events = events_by_attempt.get(str(attempt.get("id")), [])
        switch_events = [event for event in attempt_events if event.get("event_type") == "visibility_hidden"]
        event_type_counts: dict[str, int] = {}
        for event in attempt_events:
            event_type = str(event.get("event_type") or "unknown")
            event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
        integrity_risk_score = min(
            100,
            event_type_counts.get("visibility_hidden", 0) * 15
            + event_type_counts.get("fullscreen_exit", 0) * 20
            + event_type_counts.get("copy", 0) * 10
            + event_type_counts.get("paste", 0) * 15
            + event_type_counts.get("context_menu", 0) * 5
            + event_type_counts.get("window_blur", 0) * 2,
        )
        screen_switch_count = len(switch_events)
        screen_switch_limit = int(attempt.get("max_screen_switches") or 0)
        screen_switch_exceeded = screen_switch_count > screen_switch_limit
        if screen_switch_exceeded:
            flagged_student_ids.add(str(attempt.get("student_id")))
        students.append(
            {
                "student_id": attempt.get("student_id"),
                "student_no": attempt.get("student_no"),
                "display_name": attempt.get("display_name"),
                "account_username": attempt.get("account_username"),
                "publication_id": attempt.get("publication_id"),
                "publication_title": attempt.get("publication_title"),
                "question_scores": scores_by_attempt.get(str(attempt.get("id")), {}) if score_percent is not None else {},
                "class_names": [part for part in str(attempt.get("class_names") or "").split(",") if part],
                "status": status_group,
                "score": attempt.get("score"),
                "max_score": attempt.get("max_score"),
                "score_percent": score_percent,
                "started_at": attempt.get("started_at"),
                "submitted_at": attempt.get("submitted_at"),
                "time_spent_seconds": time_spent,
                "screen_switch_count": screen_switch_count,
                "screen_switch_limit": screen_switch_limit,
                "screen_switch_exceeded": screen_switch_exceeded,
                "screen_switch_remaining": max(0, screen_switch_limit - screen_switch_count),
                "screen_switch_duration_ms": sum(int(event.get("duration_ms") or 0) for event in switch_events),
                "integrity_event_count": len(attempt_events),
                "integrity_event_type_counts": dict(sorted(event_type_counts.items())),
                "integrity_risk_score": integrity_risk_score,
            }
        )
    students.sort(
        key=lambda item: (
            -int(item.get("screen_switch_count") or 0),
            str(item.get("display_name") or ""),
            str(item.get("student_no") or ""),
        )
    )

    total = len(students)
    completion_rate = round(completed / total * 100, 2) if total else 0
    average_score = round(sum(score_values) / len(score_values), 2) if score_values else None
    average_time_seconds = round(sum(time_values) / len(time_values), 2) if time_values else None
    switch_event_rows = [row for row in event_rows if row["event_type"] == "visibility_hidden"]
    screen_switch_count = len(switch_event_rows)
    screen_switch_duration_ms = sum(int(row["duration_ms"] or 0) for row in switch_event_rows)
    event_type_counts: dict[str, int] = {}
    for row in event_rows:
        event_type = str(row["event_type"] or "unknown")
        event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
    exceeded_student_count = len(flagged_student_ids)
    modules = _build_module_report(
        root,
        paper_id=paper_id,
        project_root=project_root,
        paper=paper,
        students=students,
        average_score=average_score,
        user=user,
        publication_id=publication_id,
        class_id=class_id,
    )
    questions = _build_question_report(root, paper_id=paper_id, project_root=project_root, paper=paper, user=user, publication_id=publication_id, class_id=class_id)
    classes = _build_class_report(root, paper_id=paper_id, user=user, publication_id=publication_id, class_id=class_id)
    radar = _build_radar(
        completion_rate=completion_rate,
        average_score=average_score,
        average_time_seconds=average_time_seconds,
        total=total,
        exceeded_student_count=exceeded_student_count,
        modules=modules,
    )

    return {
        "publication_id": publication_id,
        "class_id": class_id,
        "available_classes": class_choices,
        "publications": [{"id": row["id"], "title": row["title"], "created_at": row["created_at"], "status": row["status"]} for row in available_publications],
        "paper": {
            "paper_id": paper["id"],
            "exam_id": paper["exam_id"],
            "title": paper["title"],
            "subject": paper["subject"],
            "delivery_mode": paper["delivery_mode"],
            "status": paper["status"],
        },
        "summary": {
            "total_students": total,
            "completed_students": completed,
            "in_progress_students": in_progress,
            "not_started_students": not_started,
            "completion_rate": completion_rate,
            "average_score": average_score,
            "average_time_seconds": average_time_seconds,
            "publication_count": len(publication_rows),
        },
        "proctoring": {
            "event_count": len(event_rows),
            "event_type_counts": dict(sorted(event_type_counts.items())),
            "screen_switch_count": screen_switch_count,
            "screen_switch_duration_ms": screen_switch_duration_ms,
            "flagged_student_count": len(flagged_student_ids),
            "exceeded_student_count": exceeded_student_count,
        },
        "modules": modules,
        "questions": questions,
        "classes": classes,
        "radar": radar,
        "students": students,
    }


def list_teacher_classes(root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(root)
    role = user.get("role")
    with connect(root) as con:
        if role == "teacher":
            rows = con.execute(
                """
                SELECT c.id, c.school_id, c.name, c.grade, c.subject_hint,
                       GROUP_CONCAT(DISTINCT tca.subject) AS subject
                FROM teacher_class_assignments tca
                JOIN classes c ON c.id = tca.class_id
                WHERE tca.teacher_id = ?
                GROUP BY c.id, c.school_id, c.name, c.grade, c.subject_hint
                ORDER BY c.grade, c.name
                """,
                (str(user["id"]),),
            ).fetchall()
        elif role == "school":
            rows = con.execute(
                """
                SELECT c.id, c.school_id, c.name, c.grade, c.subject_hint, c.subject_hint AS subject
                FROM classes c
                WHERE c.school_id = ?
                ORDER BY c.grade, c.name
                """,
                (str(user.get("school_id") or ""),),
            ).fetchall()
        elif role == "admin":
            rows = con.execute(
                """
                SELECT c.id, c.school_id, c.name, c.grade, c.subject_hint, c.subject_hint AS subject
                FROM classes c
                ORDER BY c.grade, c.name
                """
            ).fetchall()
        else:
            raise PermissionError("Only school, teacher, and admin users can list teacher classes")
    return [row_to_dict(row) or {} for row in rows]


def _validate_publish_classes(root: Path, user: dict[str, Any], class_ids: list[str]) -> list[str]:
    return publication_service.validate_publish_classes(root, user, class_ids)


def _paper_exam_question_payloads(project_root: Path, paper: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    return publication_service.paper_exam_question_payloads(project_root, paper)


def _ensure_publishable_paper(project_root: Path | None, paper: dict[str, Any]) -> None:
    publication_service.ensure_publishable_paper(project_root, paper)


def _ensure_class_not_already_published(root: Path, *, paper_id: str, class_ids: list[str]) -> None:
    publication_service.ensure_class_not_already_published(
        root,
        paper_id=paper_id,
        class_ids=class_ids,
    )


def _json_payload(value: object) -> dict[str, Any]:
    try:
        payload = json.loads(str(value or "{}"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _answer_public_payload(row: dict[str, Any], question: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = _json_payload(row.get("answer_payload"))
    images = payload.get("images") if isinstance(payload.get("images"), list) else []
    return {
        "question_id": row.get("question_id"),
        "answer": payload.get("answer"),
        "images": images,
        "score": row.get("score"),
        "is_correct": None if row.get("is_correct") is None else bool(row.get("is_correct")),
        "grading_status": row.get("grading_status") or "pending",
        "feedback": row.get("feedback"),
        "ai_suggested_score": row.get("ai_suggested_score"),
        "ai_feedback": row.get("ai_feedback"),
        "ai_ocr_text": row.get("ai_ocr_text"),
        "responded_at": row.get("responded_at"),
        "header": (question or {}).get("header"),
        "content": (question or {}).get("content"),
        "type": (question or {}).get("type"),
        "score_per_item": (question or {}).get("score_per_item"),
        "options": (question or {}).get("options"),
        "analysis": (question or {}).get("analysis"),
        "correct_answer": (question or {}).get("correct_answer"),
        "section_id": (question or {}).get("section_id"),
        "tags": (question or {}).get("tags") or [],
    }


def _paper_attempt_row(
    root: Path,
    *,
    paper_id: str,
    attempt_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    with connect(root) as con:
        return paper_attempt_row_in_connection(
            con,
            paper_id=paper_id,
            attempt_id=attempt_id,
            user=user,
        )


def _question_maps(project_root: Path, paper: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
    questions, _answer_keys = _paper_exam_question_payloads(project_root, paper)
    by_id = {str(item.get("question_id")): item for item in questions}
    score_by_id = question_score_map(questions)
    return questions, by_id, score_by_id


def _question_maps_for_attempt(
    root: Path | None,
    project_root: Path,
    paper: dict[str, Any],
    attempt: dict[str, Any],
    *,
    connection: sqlite3.Connection | None = None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
    attempt_payload = attempt if attempt.get("exam_id") else {**attempt, "exam_id": paper.get("exam_id")}
    questions, _answer_keys = _load_attempt_question_payloads(
        project_root,
        attempt_payload,
        root=root,
        connection=connection,
    )
    by_id = {str(item.get("question_id")): {**item, 'correct_answer': _answer_keys.get(str(item.get('question_id')))} for item in questions}
    score_by_id = question_score_map(questions)
    return questions, by_id, score_by_id


def _run_async_blocking(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    box: dict[str, Any] = {}

    def runner() -> None:
        try:
            box["result"] = asyncio.run(coro)
        except BaseException as exc:  # pragma: no cover - defensive bridge for agent loop calls
            box["error"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if "error" in box:
        raise box["error"]
    return box.get("result")


def _extract_json_object(text: str) -> dict[str, Any] | None:
    return ai_grading.extract_json_object(text)


def _clamp_score(value: object, max_score: float) -> float | None:
    return ai_grading.clamp_score(value, max_score)


def _ocr_images(images: list[Any]) -> tuple[str, list[str]]:
    return ai_grading.ocr_images(images)


_OCR_SEMAPHORE = ai_grading.OCR_SEMAPHORE


def _ocr_attempt_scan_images(root: Path, attempt_id: str) -> tuple[str, list[str]]:
    return ai_grading.ocr_attempt_scan_images(
        root,
        attempt_id,
        ocr_images_fn=_ocr_images,
        semaphore=_OCR_SEMAPHORE,
    )


async def _ai_grade_answer(
    project_root: Path,
    *,
    question: dict[str, Any],
    answer_text: str,
    ocr_text: str,
    max_score: float,
) -> dict[str, Any] | None:
    return await ai_grading.ai_grade_answer(
        project_root,
        question=question,
        answer_text=answer_text,
        ocr_text=ocr_text,
        max_score=max_score,
        extract_json_object_fn=_extract_json_object,
        clamp_score_fn=_clamp_score,
    )


def publish_online_paper(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    class_ids: list[str],
    student_ids: list[str] | None = None,
    folder_id: str | None = None,
    project_root: Path | None = None,
    title: str | None = None,
    description: str | None = None,
    start_at: str | None = None,
    end_at: str | None = None,
    show_results_immediately: bool = False,
    randomize_questions: bool = False,
    randomize_answers: bool = False,
    submission_mode: str = "online",
    max_screen_switches: int = 0,
    time_limit_minutes: int | None = None,
    subject: str | None = None,
) -> dict[str, Any]:
    return publication_service.publish_online_paper(
        root,
        paper_id=paper_id,
        user=user,
        class_ids=class_ids,
        student_ids=student_ids,
        folder_id=folder_id,
        project_root=project_root,
        title=title,
        description=description,
        start_at=start_at,
        end_at=end_at,
        show_results_immediately=show_results_immediately,
        randomize_questions=randomize_questions,
        randomize_answers=randomize_answers,
        submission_mode=submission_mode,
        max_screen_switches=max_screen_switches,
        time_limit_minutes=time_limit_minutes,
        subject=subject,
        id_factory=_new_id,
    )

def ingest_offline_submission(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    class_id: str,
    student_id: str,
    files: list[dict[str, Any]],
    user: dict[str, Any],
) -> dict[str, Any]:
    """Create or replace one student's submitted offline scan attempt."""
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("仅教师或管理员可以上传线下答卷")
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    if paper.get("delivery_mode") != "offline":
        raise ValueError("该试卷当前为在线模式；如需采集线下照片，请先在试卷管理中设为线下")
    _validate_publish_classes(root, user, [class_id])
    student = resolve_teacher_class_student(root, class_id=class_id, user=user, student_id=student_id)
    if not files:
        raise ValueError("请至少上传一张答卷照片")
    questions, answer_keys = _paper_exam_question_payloads(project_root, paper)
    if not questions:
        raise ValueError("试卷没有可批改题目，请先完成组卷")
    now = utc_now()
    with connect(root) as con:
        publication = con.execute(
            """
            SELECT ep.id, ep.submission_mode
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            WHERE ep.paper_id = ? AND pc.class_id = ? AND ep.status <> 'revoked'
            ORDER BY ep.created_at DESC
            LIMIT 1
            """,
            (paper_id, class_id),
        ).fetchone()
        if publication is None:
            publication_id = _new_id()
            con.execute(
                """
                INSERT INTO exam_publications (
                  id, paper_id, teacher_id, title, submission_mode, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'offline_scan', 'published', ?, ?)
                """,
                (publication_id, paper_id, str(user["id"]), f"线下采集：{paper['title']}", now, now),
            )
            con.execute(
                "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
                (publication_id, class_id),
            )
        else:
            if str(publication["submission_mode"] or "") != "offline_scan":
                raise ValueError("该班级已有在线发布记录；为避免覆盖学生在线答卷，请先撤回原发布后再上传线下照片")
            publication_id = str(publication["id"])
        existing = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (publication_id, student_id),
        ).fetchone()
        attempt_id = str(existing["id"]) if existing is not None else _new_id()
        if existing is not None:
            protected_answer = con.execute(
                """
                SELECT 1
                FROM student_answers
                WHERE attempt_id = ?
                  AND (
                    COALESCE(grading_status, 'pending') <> 'pending'
                    OR score IS NOT NULL
                    OR feedback IS NOT NULL
                    OR ai_suggested_score IS NOT NULL
                    OR ai_feedback IS NOT NULL
                    OR graded_at IS NOT NULL
                  )
                LIMIT 1
                """,
                (attempt_id,),
            ).fetchone()
            if protected_answer is not None:
                raise ValueError("该学生的答卷已进入批改流程，不能用新照片覆盖；请保留现有答卷或先完成复核")
        question_json = json.dumps(questions, ensure_ascii=False)
        answer_json = json.dumps(answer_keys, ensure_ascii=False)
        if existing is None:
            con.execute(
                """
                INSERT INTO student_attempts (
                  id, publication_id, student_id, status, started_at, submitted_at,
                  question_payload_json, answer_key_json, question_payload_version
                ) VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, 3)
                """,
                (attempt_id, publication_id, student_id, now, now, question_json, answer_json),
            )
        else:
            con.execute(
                """
                UPDATE student_attempts
                SET status = 'submitted', started_at = COALESCE(started_at, ?), submitted_at = ?,
                    score = NULL, max_score = NULL, question_payload_json = ?, answer_key_json = ?,
                    question_payload_version = 3
                WHERE id = ?
                """,
                (now, now, question_json, answer_json, attempt_id),
            )
            con.execute("DELETE FROM student_answers WHERE attempt_id = ?", (attempt_id,))
            con.execute("DELETE FROM attempt_scan_images WHERE attempt_id = ?", (attempt_id,))
        con.executemany(
            """
            INSERT INTO attempt_scan_images (
              id, attempt_id, page_index, file_name, mime_type, file_size, content, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    _new_id(),
                    attempt_id,
                    index,
                    str(item["name"]),
                    str(item["mime_type"]),
                    len(item["content"]),
                    item["content"],
                    now,
                )
                for index, item in enumerate(files)
            ],
        )
        con.executemany(
            """
            INSERT INTO student_answers (
              id, attempt_id, question_id, answer_payload, grading_status, responded_at
            ) VALUES (?, ?, ?, '{}', 'pending', ?)
            """,
            [(_new_id(), attempt_id, str(question["question_id"]), now) for question in questions],
        )
        con.execute(
            "UPDATE paper_records SET status = 'published', updated_at = ? WHERE id = ?",
            (now, paper_id),
        )
    return {
        "attempt_id": attempt_id,
        "publication_id": publication_id,
        "paper_id": paper_id,
        "student_id": student["id"],
        "student_no": student["student_no"],
        "student_name": student["display_name"],
        "status": "submitted",
        "submission_mode": "offline_scan",
        "scan_image_count": len(files),
        "question_count": len(questions),
        "submitted_at": now,
    }


_GRADING_INJECTION_PATTERNS = (
    re.compile(r"(?:请|必须|务必|直接|测试用例).{0,24}(?:满分|给.*分|通过|忽略.*评分)", re.I),
    re.compile(r"(?:give|award).{0,24}(?:full|maximum).{0,12}(?:score|marks?)", re.I),
    re.compile(r"ignore.{0,24}(?:rubric|grading|question|previous)", re.I),
)


def _contains_grading_prompt_injection(value: str) -> bool:
    compact = re.sub(r"\s+", " ", str(value or "")).strip()
    return any(pattern.search(compact) for pattern in _GRADING_INJECTION_PATTERNS)


def _attempt_scan_payloads(root: Path, attempt_id: str, *, include_content: bool = True) -> list[dict[str, Any]]:
    content_column = ", content" if include_content else ""
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT page_index, file_name, mime_type, file_size{content_column}
            FROM attempt_scan_images
            WHERE attempt_id = ?
            ORDER BY page_index
            """,
            (attempt_id,),
        ).fetchall()
    payloads: list[dict[str, Any]] = []
    for row in rows:
        payload = {
            "page_index": int(row["page_index"]),
            "name": str(row["file_name"]),
            "mime_type": str(row["mime_type"]),
            "size": int(row["file_size"]),
        }
        if include_content:
            payload["data_url"] = (
                f"data:{row['mime_type']};base64,{base64.b64encode(bytes(row['content'])).decode('ascii')}"
            )
        payloads.append(payload)
    return payloads


def get_attempt_scan_image(
    root: Path,
    *,
    paper_id: str,
    attempt_id: str,
    page_index: int,
    user: dict[str, Any],
) -> dict[str, Any]:
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    _paper_attempt_row(root, paper_id=paper_id, attempt_id=attempt_id, user=user)
    with connect(root) as con:
        row = con.execute(
            """
            SELECT file_name, mime_type, file_size, content
            FROM attempt_scan_images
            WHERE attempt_id = ? AND page_index = ?
            """,
            (attempt_id, int(page_index)),
        ).fetchone()
    if row is None:
        raise ValueError("答卷图片不存在")
    return {
        "name": str(row["file_name"]),
        "mime_type": str(row["mime_type"]),
        "size": int(row["file_size"]),
        "content": bytes(row["content"]),
    }


def list_paper_submissions(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
) -> list[dict[str, Any]]:
    from solaire.agent_layer.llm.router import load_llm_settings

    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    access_clause, access_params = _attempt_access_clause(user)
    with connect(root) as con:
        con.execute("BEGIN")
        attempt_rows = con.execute(
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
              u.username AS account_username,
              COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'), 0) AS screen_switch_count
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            JOIN students s ON s.id = sa.student_id
            LEFT JOIN users u ON u.id = s.user_id
            WHERE ep.paper_id = ? AND {access_clause}
            ORDER BY sa.submitted_at DESC, s.display_name, s.student_no
            """,
            (paper_id, *access_params),
        ).fetchall()
        answer_rows = con.execute(
            f"""
            SELECT ans.*
            FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ? AND {access_clause}
            ORDER BY ans.responded_at
            """,
            (paper_id, *access_params),
        ).fetchall()
        revisions = load_answer_revisions(con, [str(row["id"]) for row in attempt_rows])

    attempts = [row_to_dict(row) or {} for row in attempt_rows]
    maps_by_attempt: dict[str, tuple[dict[str, dict[str, Any]], dict[str, int]]] = {}
    max_score_by_attempt: dict[str, float] = {}
    for attempt in attempts:
        questions, by_id, score_by_id = _question_maps_for_attempt(root, project_root, paper, attempt)
        attempt_id = str(attempt.get("id"))
        maps_by_attempt[str(attempt.get("id"))] = (
            by_id,
            {str(item.get("question_id")): index for index, item in enumerate(questions)},
        )
        max_score_by_attempt[attempt_id] = round(sum(score_by_id.values()), 2)

    answers_by_attempt: dict[str, list[dict[str, Any]]] = {}
    for row in answer_rows:
        answer = row_to_dict(row) or {}
        attempt_id = str(answer.get("attempt_id"))
        qid = str(answer.get("question_id") or "")
        by_id, _order_index = maps_by_attempt.get(attempt_id, ({}, {}))
        public_answer = _answer_public_payload(answer, by_id.get(qid))
        public_answer["grading_version"] = answer_grading_version(
            attempt_id, qid, by_id.get(qid), answer, revisions.get((attempt_id, qid), 0),
        )
        answers_by_attempt.setdefault(attempt_id, []).append(public_answer)

    submissions: list[dict[str, Any]] = []
    for attempt in attempts:
        attempt_id = str(attempt.get("id"))
        attempt_answers = answers_by_attempt.get(attempt_id, [])
        scan_images = _attempt_scan_payloads(root, attempt_id, include_content=False)
        by_id, order_index = maps_by_attempt.get(attempt_id, ({}, {}))
        if _attempt_status_group(attempt) == "completed":
            answered_ids = {str(item.get("question_id") or "") for item in attempt_answers}
            for question_id, question in by_id.items():
                if question_id not in answered_ids:
                    missing = {"question_id": question_id, "answer_payload": "{}", "grading_status": "pending"}
                    public_answer = _answer_public_payload(missing, question)
                    public_answer["grading_version"] = answer_grading_version(
                        attempt_id, question_id, question, missing, revisions.get((attempt_id, question_id), 0),
                    )
                    attempt_answers.append(public_answer)
        attempt_answers.sort(key=lambda item: order_index.get(str(item.get("question_id")), 999999))
        submissions.append(
            {
                "attempt_id": attempt.get("id"),
                "publication_id": attempt.get("publication_id"),
                "paper_id": paper_id,
                "exam_id": attempt.get("exam_id"),
                "title": attempt.get("publication_title") or attempt.get("paper_title"),
                "subject": attempt.get("subject"),
                "student_id": attempt.get("student_id"),
                "student_no": attempt.get("student_no"),
                "student_name": attempt.get("student_name"),
                "account_username": attempt.get("account_username"),
                "status": attempt.get("status"),
                "score": attempt.get("score"),
                "max_score": max_score_by_attempt.get(attempt_id) or attempt.get("max_score"),
                "grading_completed_at": attempt.get("grading_completed_at"),
                "submitted_at": attempt.get("submitted_at"),
                "screen_switch_count": int(attempt.get("screen_switch_count") or 0),
                "submission_mode": "offline_scan" if scan_images else (attempt.get("submission_mode") or "online"),
                "scan_images": scan_images,
                "answers": attempt_answers,
            }
        )
    return submissions


def find_paper_submissions(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    student_query: str | None = None,
    status: str | None = None,
    grading_status: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Return lightweight submission metadata suitable for AI tool context."""
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    clean_limit = max(1, min(int(limit or 20), 100))
    clean_query = str(student_query or "").strip()
    clean_status = str(status or "").strip()
    clean_grading = str(grading_status or "").strip()
    clauses = ["ep.paper_id = ?"]
    params: list[Any] = [paper_id]
    access_clause, access_params = _attempt_access_clause(user)
    clauses.append(access_clause)
    params.extend(access_params)
    if clean_query:
        pattern = f"%{clean_query}%"
        clauses.append("(s.student_no LIKE ? OR s.display_name LIKE ? OR u.username LIKE ?)")
        params.extend([pattern, pattern, pattern])
    if clean_status:
        clauses.append("sa.status = ?")
        params.append(clean_status)
    if clean_grading:
        clauses.append(
            "EXISTS (SELECT 1 FROM student_answers af WHERE af.attempt_id = sa.id AND COALESCE(af.grading_status, 'pending') = ?)"
        )
        params.append(clean_grading)
    params.append(clean_limit)
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT
              sa.id AS attempt_id,
              sa.publication_id,
              ep.paper_id,
              sa.student_id,
              s.student_no,
              s.display_name AS student_name,
              u.username AS account_username,
              sa.status,
              ep.submission_mode,
              sa.score,
              sa.max_score,
              sa.submitted_at,
              COUNT(ans.id) AS answer_count,
              SUM(CASE WHEN ans.id IS NOT NULL AND COALESCE(ans.grading_status, 'pending') = 'pending' THEN 1 ELSE 0 END) AS pending_answer_count,
              SUM(CASE WHEN ans.id IS NOT NULL AND ans.ai_suggested_score IS NOT NULL THEN 1 ELSE 0 END) AS ai_suggested_count,
              SUM(CASE WHEN ans.id IS NOT NULL AND ans.grading_status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed_answer_count
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN students s ON s.id = sa.student_id
            LEFT JOIN users u ON u.id = s.user_id
            LEFT JOIN student_answers ans ON ans.attempt_id = sa.id
            WHERE {' AND '.join(clauses)}
            GROUP BY sa.id
            ORDER BY sa.submitted_at DESC, s.display_name, s.student_no
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def list_teacher_class_students(root: Path, *, class_id: str, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(root)
    _validate_publish_classes(root, user, [class_id])
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT s.id, s.student_no, s.display_name, s.email, s.status,
                   u.username AS account_username
            FROM class_students cs
            JOIN students s ON s.id = cs.student_id
            LEFT JOIN users u ON u.id = s.user_id
            WHERE cs.class_id = ?
            ORDER BY s.student_no, s.display_name
            """,
            (class_id,),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def resolve_teacher_class_student(
    root: Path,
    *,
    class_id: str,
    user: dict[str, Any],
    student_id: str | None = None,
    student_query: str | None = None,
) -> dict[str, Any]:
    students = list_teacher_class_students(root, class_id=class_id, user=user)
    clean_id = str(student_id or "").strip()
    if clean_id:
        match = next((item for item in students if str(item.get("id")) == clean_id), None)
        if match is None:
            raise ValueError("该学生不在所选班级中")
        return match
    query = str(student_query or "").strip().casefold()
    if not query:
        raise ValueError("请提供 student_id，或学生学号、账号、姓名")
    exact = [
        item
        for item in students
        if query
        in {
            str(item.get("student_no") or "").casefold(),
            str(item.get("account_username") or "").casefold(),
            str(item.get("display_name") or "").casefold(),
        }
    ]
    candidates = exact or [
        item
        for item in students
        if any(
            query in str(item.get(key) or "").casefold()
            for key in ("student_no", "account_username", "display_name")
        )
    ]
    if not candidates:
        raise ValueError("未在所选班级找到该学生")
    if len(candidates) > 1:
        raise ValueError("匹配到多名学生，请提供完整学号或账号")
    return candidates[0]


def get_teacher_student_profile(
    root: Path,
    *,
    class_id: str,
    user: dict[str, Any],
    student_id: str | None = None,
    student_query: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    student = resolve_teacher_class_student(
        root,
        class_id=class_id,
        user=user,
        student_id=student_id,
        student_query=student_query,
    )
    sid = str(student["id"])
    clean_date_from = str(date_from or "").strip() or None
    clean_date_to = str(date_to or "").strip() or None
    if clean_date_from and clean_date_to and clean_date_from > clean_date_to:
        raise ValueError("开始日期不能晚于结束日期")
    date_clause = """
      AND (? IS NULL OR date(COALESCE(sa.submitted_at, sa.started_at, ep.created_at)) >= date(?))
      AND (? IS NULL OR date(COALESCE(sa.submitted_at, sa.started_at, ep.created_at)) <= date(?))
    """
    date_params = (clean_date_from, clean_date_from, clean_date_to, clean_date_to)
    # Class membership is not ownership: different teachers can share a class.
    if user.get('role') == 'teacher':
        date_clause += ' AND ep.teacher_id = ?'
        date_params += (str(user['id']),)
    with connect(root) as con:
        attempt_rows = con.execute(
            f"""
            SELECT sa.id AS attempt_id, sa.status, sa.score, sa.max_score, sa.started_at,
                   sa.submitted_at, sa.time_spent_seconds, ep.id AS publication_id,
                   ep.submission_mode, pr.id AS paper_id, pr.exam_id, pr.title, COALESCE(ep.subject, pr.subject) AS subject,
                   (SELECT COUNT(*) FROM attempt_scan_images asi WHERE asi.attempt_id = sa.id) AS scan_image_count,
                   (SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id) AS integrity_event_count,
                   (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id) AS answer_count,
                   (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id AND aa.score IS NULL) AS unscored_answer_count,
                   sa.question_payload_json, sa.grading_completed_at
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.student_id = ?
              AND EXISTS (
                SELECT 1 FROM publication_classes pc
                WHERE pc.publication_id = ep.id AND pc.class_id = ?
              )
              {date_clause}
            ORDER BY COALESCE(sa.submitted_at, sa.started_at, ep.created_at) DESC
            """,
            (sid, class_id, *date_params),
        ).fetchall()
        weak_rows = con.execute(
            f"""
            SELECT pr.id AS paper_id, pr.title AS paper_title, ans.question_id,
                   ans.is_correct, ans.score, sa.question_payload_json
            FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.student_id = ?
              AND EXISTS (
                SELECT 1 FROM publication_classes pc
                WHERE pc.publication_id = ep.id AND pc.class_id = ?
              )
              {date_clause}
            """,
            (sid, class_id, *date_params),
        ).fetchall()
    recent = [row_to_dict(row) or {} for row in attempt_rows]
    weak_groups: dict[tuple[str, str], dict[str, Any]] = {}
    for row in weak_rows:
        paper_key = str(row["paper_id"])
        question_key = str(row["question_id"])
        key = (paper_key, question_key)
        group = weak_groups.setdefault(
            key,
            {
                "paper_id": paper_key,
                "paper_title": str(row["paper_title"] or ""),
                "question_id": question_key,
                "attempt_count": 0,
                "wrong_count": 0,
                "score_percentages": [],
                "header": None,
                "content": None,
                "section_id": None,
                "tags": [],
            },
        )
        group["attempt_count"] += 1
        if row["is_correct"] == 0:
            group["wrong_count"] += 1
        question_score = 0.0
        try:
            frozen_questions = json.loads(str(row["question_payload_json"] or "[]"))
        except (TypeError, ValueError, json.JSONDecodeError):
            frozen_questions = []
        if isinstance(frozen_questions, list):
            frozen = next(
                (
                    item
                    for item in frozen_questions
                    if isinstance(item, dict) and str(item.get("question_id") or "") == question_key
                ),
                None,
            )
            if frozen is not None:
                question_score = float(frozen.get("score_per_item") or 0.0)
                group["header"] = frozen.get("header")
                group["content"] = frozen.get("content")
                group["section_id"] = frozen.get("section_id")
                group["tags"] = frozen.get("tags") or []
        if row["score"] is not None and question_score > 0:
            group["score_percentages"].append(float(row["score"]) / question_score * 100)
    weak_questions = []
    for group in weak_groups.values():
        if int(group["wrong_count"]) <= 0:
            continue
        percentages_for_question = group.pop("score_percentages")
        group["average_score_percent"] = (
            round(sum(percentages_for_question) / len(percentages_for_question), 2)
            if percentages_for_question
            else None
        )
        weak_questions.append(group)
    weak_questions.sort(key=lambda item: (-int(item["wrong_count"]), -int(item["attempt_count"]), item["paper_title"]))
    submitted = [item for item in recent if _attempt_status_group(item) == "completed"]
    percentages = []
    for item in submitted:
        if not item.get("grading_completed_at"):
            continue
        percent = _score_percent(item.get("score"), item.get("max_score"))
        if percent is not None:
            percentages.append(percent)
    question_counts: dict[str, int] = {}
    for item in recent:
        try:
            frozen = json.loads(str(item.get("question_payload_json") or "[]"))
        except (TypeError, ValueError, json.JSONDecodeError):
            frozen = []
        question_counts[str(item.get("attempt_id"))] = len(frozen) if isinstance(frozen, list) else 0
    per_question_times = [
        float(item["time_spent_seconds"]) / question_counts[str(item.get("attempt_id"))]
        for item in submitted
        if item.get("time_spent_seconds") is not None and question_counts.get(str(item.get("attempt_id")), 0) > 0
    ]
    integrity_count = sum(int(item.get("integrity_event_count") or 0) for item in recent)
    event_average = round(integrity_count / len(submitted), 1) if submitted else 0.0
    average_score_percent = round(sum(percentages) / len(percentages), 2) if percentages else None
    average_time_per_question = round(sum(per_question_times) / len(per_question_times), 1) if per_question_times else None
    radar = [
        {"id": "completion", "label": "完成率", "value": round(len(submitted) / len(recent) * 100, 2) if recent else 0},
        {"id": "score", "label": "得分率", "value": average_score_percent or 0},
        {"id": "time_efficiency", "label": "每题用时效率", "value": max(0, round(100 - max(0, (average_time_per_question or 120) - 60) / 2, 2))},
        {"id": "behavior", "label": "考试行为稳定度", "value": max(0, round(100 - event_average * 10, 2))},
        {"id": "module_mastery", "label": "模块掌握度", "value": average_score_percent or 0},
    ]
    return {
        "student": student,
        "class_id": class_id,
        "summary": {
            "exam_count": len(recent),
            "submitted_exam_count": len(submitted),
            "graded_exam_count": len(percentages),
            "completion_rate": round(len(submitted) / len(recent) * 100, 2) if recent else 0,
            "average_score_percent": average_score_percent,
            "average_time_per_question_seconds": average_time_per_question,
            "integrity_event_count": integrity_count,
            "behavior_event_average_per_exam": event_average,
        },
        "recent_exams": [
            {
                **item,
                "score_percent": (
                    _score_percent(item.get("score"), item.get("max_score"))
                    if item.get("grading_completed_at")
                    else None
                ),
                "submission_mode": "offline_scan" if int(item.get("scan_image_count") or 0) else item.get("submission_mode"),
            }
            for item in recent[:20]
        ],
        "weak_questions": weak_questions,
        "radar": radar,
        "date_range": {"from": clean_date_from, "to": clean_date_to},
    }


def resolve_paper_attempt(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    attempt_id: str | None = None,
    student_query: str | None = None,
    require_submitted: bool = False,
) -> dict[str, Any]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    clean_attempt = str(attempt_id or "").strip()
    if clean_attempt:
        attempt = _paper_attempt_row(root, paper_id=paper_id, attempt_id=clean_attempt, user=user)
        if require_submitted and attempt.get("status") != "submitted":
            raise ValueError("该学生答卷尚未提交，不能生成 AI 批改建议")
        return attempt
    query = str(student_query or "").strip()
    if not query:
        raise ValueError("请提供 attempt_id，或填写学生学号、账号、姓名")
    candidates = find_paper_submissions(
        root,
        paper_id=paper_id,
        user=user,
        student_query=query,
        status="submitted" if require_submitted else None,
        limit=100,
    )
    exact = [
        item
        for item in candidates
        if query.casefold()
        in {
            str(item.get("student_no") or "").casefold(),
            str(item.get("account_username") or "").casefold(),
            str(item.get("student_name") or "").casefold(),
        }
    ]
    matches = exact or candidates
    if not matches:
        raise ValueError(f"未找到学生“{query}”在该试卷中的已提交答卷")
    if len(matches) > 1:
        raise ValueError(f"学生“{query}”匹配到多份答卷，请改用完整学号、账号或 attempt_id")
    return _paper_attempt_row(root, paper_id=paper_id, attempt_id=str(matches[0]["attempt_id"]), user=user)


def suggest_ai_grades_for_pending_attempts(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    max_attempts: int = 5,
    max_questions_total: int = 50,
) -> dict[str, Any]:
    clean_limit = max(1, min(int(max_attempts or 5), 20))
    question_budget = max(1, min(int(max_questions_total or 50), 100))
    attempts = find_paper_submissions(
        root,
        paper_id=paper_id,
        user=user,
        status="submitted",
        grading_status="pending",
        limit=clean_limit,
    )
    items: list[dict[str, Any]] = []
    suggestion_count = 0
    attempted_question_count = 0
    for attempt in attempts:
        if attempted_question_count >= question_budget:
            break
        attempt_id = str(attempt["attempt_id"])
        with connect(root) as con:
            rows = con.execute(
                "SELECT question_id FROM student_answers WHERE attempt_id = ? AND COALESCE(grading_status, 'pending') = 'pending'",
                (attempt_id,),
            ).fetchall()
        question_ids = [str(row["question_id"]) for row in rows][
            : question_budget - attempted_question_count
        ]
        if not question_ids:
            continue
        attempted_question_count += len(question_ids)
        try:
            suggestions = suggest_ai_grades_for_attempt(
                root,
                project_root,
                paper_id=paper_id,
                attempt_id=attempt_id,
                user=user,
                question_ids=question_ids,
            )
            generated_count = sum(item.get("status") == "needs_review" for item in suggestions)
            suggestion_count += generated_count
            items.append(
                {
                    "attempt_id": attempt_id,
                    "student_no": attempt.get("student_no"),
                    "student_name": attempt.get("student_name"),
                    "status": "succeeded",
                    "suggestion_count": generated_count,
                    "attempted_question_count": len(question_ids),
                }
            )
        except (ValueError, PermissionError, FileNotFoundError, RuntimeError) as exc:
            items.append(
                {
                    "attempt_id": attempt_id,
                    "student_no": attempt.get("student_no"),
                    "student_name": attempt.get("student_name"),
                    "status": "failed",
                    "error": str(exc),
                }
            )
    return {
        "items": items,
        "processed_count": len(items),
        "failed_count": sum(item["status"] == "failed" for item in items),
        "suggestion_count": suggestion_count,
        "attempted_question_count": attempted_question_count,
        "question_limit": question_budget,
        "remaining_hint": len(attempts) == clean_limit or attempted_question_count >= question_budget,
    }


def _recompute_attempt_score(root: Path, *, attempt_id: str, score_by_id: dict[str, float]) -> dict[str, Any]:
    return recompute_attempt_score(root, attempt_id=attempt_id, score_by_id=score_by_id)


def grade_paper_answer(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    attempt_id: str,
    question_id: str,
    user: dict[str, Any],
    score: float,
    feedback: str | None = None,
    is_correct: bool | None = None,
    expected_version: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("只有教师或管理员可以保存最终批改结果")
    clean_feedback = feedback.strip() if feedback and feedback.strip() else None
    now = utc_now()
    answer_id = _new_id()
    answer: dict[str, Any] | None = None
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        paper_row = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
        paper = row_to_dict(paper_row)
        if paper is None:
            raise ValueError("paper not found")
        _ensure_paper_access(paper, user)
        attempt = paper_attempt_row_in_connection(
            con,
            paper_id=paper_id,
            attempt_id=attempt_id,
            user=user,
        )
        if _attempt_status_group(attempt) != "completed":
            raise ValueError("只能批改已提交的答卷")
        # Keep legacy snapshot repair in the same transaction as the answer update.
        _questions, by_id, score_by_id = _question_maps_for_attempt(
            None,
            project_root,
            paper,
            attempt,
            connection=con,
        )
        if question_id not in by_id:
            raise ValueError("question not found in paper")
        previous_row = con.execute(
            "SELECT * FROM student_answers WHERE attempt_id=? AND question_id=?", (attempt_id, question_id),
        ).fetchone()
        revisions = load_answer_revisions(con, [attempt_id])
        check_grading_version(expected_version, answer_grading_version(
            attempt_id, question_id, by_id.get(question_id), row_to_dict(previous_row),
            revisions.get((attempt_id, question_id), 0),
        ))
        max_score = float(score_by_id.get(question_id, 0.0))
        clean_score = validate_manual_score(score, max_score)
        resolved_is_correct = is_correct
        if resolved_is_correct is None and max_score > 0:
            resolved_is_correct = clean_score >= max_score
        con.execute(
            """
            INSERT INTO student_answers (
              id, attempt_id, question_id, answer_payload, is_correct, score,
              grading_status, feedback, graded_by, graded_at, responded_at
            )
            VALUES (?, ?, ?, '{}', ?, ?, 'reviewed', ?, ?, ?, ?)
            ON CONFLICT(attempt_id, question_id) DO UPDATE SET
              is_correct = excluded.is_correct,
              score = excluded.score,
              grading_status = 'reviewed',
              feedback = excluded.feedback,
              graded_by = excluded.graded_by,
              graded_at = excluded.graded_at
            """,
            (
                answer_id,
                attempt_id,
                question_id,
                None if resolved_is_correct is None else (1 if resolved_is_correct else 0),
                clean_score,
                clean_feedback,
                str(user.get("id") or ""),
                now,
                now,
            ),
        )
        answer_row = con.execute(
            "SELECT * FROM student_answers WHERE attempt_id = ? AND question_id = ?",
            (attempt_id, question_id),
        ).fetchone()
        con.execute(
            "UPDATE student_attempts SET grading_completed_at = NULL, grading_completed_by = NULL WHERE id = ?",
            (attempt_id,),
        )
        recompute_attempt_score_in_connection(
            con,
            attempt_id=str(attempt["id"]),
            score_by_id=score_by_id,
        )
        answer_data = row_to_dict(answer_row)
        if answer_data is None:
            raise RuntimeError("failed to grade answer")
        revision = advance_answer_revision(con, attempt_id, question_id)
        answer = _answer_public_payload(answer_data, by_id.get(question_id))
        answer["grading_version"] = answer_grading_version(
            attempt_id, question_id, by_id.get(question_id), answer_data, revision,
        )
    if answer is None:
        raise RuntimeError("failed to grade answer")
    return answer


def complete_paper_attempt_grading(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    attempt_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    """Publish one fully reviewed submission to the student."""
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("只有教师或管理员可以完成并发布批改结果")
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        paper_row = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
        paper = row_to_dict(paper_row)
        if paper is None:
            raise ValueError("paper not found")
        _ensure_paper_access(paper, user)
        attempt = paper_attempt_row_in_connection(
            con,
            paper_id=paper_id,
            attempt_id=attempt_id,
            user=user,
        )
        if _attempt_status_group(attempt) != "completed":
            raise ValueError("只能发布已提交答卷的批改结果")
        _questions, _by_id, score_by_id = _question_maps_for_attempt(
            None,
            project_root,
            paper,
            attempt,
            connection=con,
        )
        total, maximum = completed_attempt_scores_in_connection(
            con,
            attempt_id=attempt_id,
            score_by_id=score_by_id,
        )
        try:
            same_score = float(attempt["score"]) == total
            same_maximum = float(attempt["max_score"]) == maximum
        except (TypeError, ValueError, OverflowError):
            same_score = same_maximum = False
        already_published = bool(attempt.get("grading_completed_at")) and same_score and same_maximum
        if not already_published:
            con.execute(
                """
                UPDATE student_attempts
                SET score = ?, max_score = ?, grading_completed_at = ?, grading_completed_by = ?
                WHERE id = ?
                """,
                (total, maximum, utc_now(), str(user.get("id") or ""), attempt_id),
            )
        stored = con.execute("SELECT * FROM student_attempts WHERE id = ?", (attempt_id,)).fetchone()
    result = row_to_dict(stored)
    if result is None:
        raise RuntimeError("failed to publish grading result")
    return result


def suggest_ai_grades_for_attempt(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    attempt_id: str,
    user: dict[str, Any],
    question_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    from solaire.agent_layer.llm.router import load_llm_settings

    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("只有教师或管理员可以生成 AI 预批改建议")
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    attempt = _paper_attempt_row(root, paper_id=paper_id, attempt_id=attempt_id, user=user)
    if _attempt_status_group(attempt) != "completed":
        raise ValueError("只能对已提交的答卷生成 AI 预批改建议")
    questions, by_id, score_by_id = _question_maps_for_attempt(root, project_root, paper, attempt)
    selected = [str(qid).strip() for qid in (question_ids or []) if str(qid).strip()]
    if not selected:
        selected = [str(item.get("question_id")) for item in questions]
    missing = [qid for qid in selected if qid not in by_id]
    if missing:
        raise ValueError(f"question not found in paper: {missing[0]}")
    if len(selected) > 50:
        raise ValueError("单次 AI 预批改最多处理 50 道题，请分批操作")

    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT *
            FROM student_answers
            WHERE attempt_id = ?
              AND question_id IN ({','.join('?' for _ in selected)})
            """,
            (attempt_id, *selected),
        ).fetchall()
        by_question = {str(row["question_id"]): row_to_dict(row) or {} for row in rows}
        selected = [
            qid
            for qid in selected
            if str(by_question.get(qid, {}).get("grading_status") or "pending") == "pending"
        ]
    if not selected:
        return []

    shared_scan_images = _attempt_scan_payloads(root, attempt_id, include_content=False)
    shared_ocr_text, shared_ocr_errors = _ocr_attempt_scan_images(root, attempt_id)
    has_api_key = bool(load_llm_settings(project_root).api_key)
    generated: list[dict[str, Any]] = []
    for qid in selected:
        answer = by_question.get(qid)
        if answer is None:
            continue
        payload = _json_payload(answer.get("answer_payload"))
        answer_images = payload.get("images") if isinstance(payload.get("images"), list) else []
        has_images = bool(answer_images or shared_scan_images)
        if answer_images:
            ocr_text, ocr_errors = _ocr_images(answer_images)
        else:
            ocr_text, ocr_errors = shared_ocr_text, shared_ocr_errors
        ocr_text = ocr_text[:12000]
        answer_text = str(payload.get("answer") or "").strip()
        max_score = float(score_by_id.get(qid, 0.0))
        suggestion = None
        ai_error: str | None = None
        if _contains_grading_prompt_injection(f"{answer_text}\n{ocr_text}"):
            ai_error = "检测到疑似操纵评分的答题指令，已禁止 AI 自动给分，请教师人工核对实际作答"
        elif not answer_text and not ocr_text:
            ai_error = "未识别到可用于 AI 判分的答案文本"
        elif not has_api_key:
            ai_error = "未配置 AI 模型"
        else:
            try:
                suggestion = _run_async_blocking(
                    _ai_grade_answer(
                        project_root,
                        question=by_id[qid],
                        answer_text=answer_text,
                        ocr_text=ocr_text,
                        max_score=max_score,
                    )
                )
                if suggestion is None:
                    ai_error = "模型未返回有效的结构化建议"
            except Exception as exc:
                ai_error = str(exc)
        if suggestion is None:
            feedback_parts = []
            if has_images:
                feedback_parts.append("图片答案需要教师复核。")
                if ocr_text:
                    feedback_parts.append("已提取 OCR 文本，可作为参考。")
                elif ocr_errors:
                    feedback_parts.append("OCR 未能清晰识别，请人工查看图片。")
            else:
                feedback_parts.append("主观题答案需要教师复核。")
            if ai_error:
                feedback_parts.append(f"AI 建议暂未生成：{ai_error}")
            feedback = "".join(feedback_parts)
            suggested_score = None
            status = "pending"
        else:
            feedback = str(suggestion.get("feedback") or "AI 已生成建议，请教师复核。")
            suggested_score = suggestion.get("suggested_score")
            status = "needs_review"
        generated.append(
            {
                "answer_id": str(answer.get("id") or ""),
                "question_id": qid,
                "suggested_score": suggested_score,
                "feedback": feedback,
                "status": status,
                "ocr_text": ocr_text or "\n".join(ocr_errors),
            }
        )

    suggestions: list[dict[str, Any]] = []
    with connect(root) as con:
        for item in generated:
            updated = con.execute(
                """
                UPDATE student_answers
                SET grading_status = ?,
                    ai_suggested_score = ?,
                    ai_feedback = ?,
                    ai_ocr_text = ?,
                    responded_at = responded_at
                WHERE id = ?
                  AND COALESCE(grading_status, 'pending') = 'pending'
                """,
                (
                    item["status"],
                    item["suggested_score"],
                    item["feedback"],
                    item["ocr_text"],
                    item["answer_id"],
                ),
            )
            if updated.rowcount != 1:
                continue
            suggestions.append(
                {
                    "question_id": item["question_id"],
                    "suggested_score": item["suggested_score"],
                    "feedback": item["feedback"],
                    "status": item["status"],
                }
            )
    return suggestions
