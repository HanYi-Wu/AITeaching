"""Paper management services for offline/online exam delivery."""

from __future__ import annotations

import uuid
import json
import asyncio
import base64
import binascii
import io
import re
import threading
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.result_service import list_exam_results
from solaire.web.student_service import _load_exam_question_payloads

DELIVERY_MODES = {"offline", "online"}
PUBLICATION_STATUSES = {"draft", "published", "paused", "closed", "revoked"}
SUBMISSION_MODES = {"online", "image_manual", "image_ai"}
MAX_PAGE_SIZE = 100


def _new_id() -> str:
    return uuid.uuid4().hex


def _clean_subject(value: object) -> str:
    return str(value or "").strip() or "未分科"


def _clean_title(value: object, fallback: str) -> str:
    return str(value or "").strip() or fallback


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


def _paper_record_for_exam(root: Path, exam: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    exam_id = str(exam.get("exam_id") or "").strip()
    if not exam_id:
        raise ValueError("exam_id is required")
    subject = _clean_subject(exam.get("subject"))
    title = _clean_title(exam.get("exam_title"), exam_id)
    now = utc_now()
    user_role = str(user.get("role") or "")
    owner_teacher_id = str(user.get("id")) if user_role == "teacher" else None
    school_id = str(user.get("school_id")) if user.get("school_id") else None

    with connect(root) as con:
        row = con.execute(
            "SELECT * FROM paper_records WHERE exam_id = ? AND subject = ?",
            (exam_id, subject),
        ).fetchone()
        if row is None:
            paper_id = _new_id()
            con.execute(
                """
                INSERT INTO paper_records (
                  id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 'offline', ?, ?, 'draft', ?, ?)
                """,
                (paper_id, exam_id, title, subject, owner_teacher_id, school_id, now, now),
            )
        else:
            paper_id = str(row["id"])
            updates: list[str] = ["title = ?", "subject = ?", "updated_at = ?"]
            params: list[object] = [title, subject, now]
            if owner_teacher_id and row["owner_teacher_id"] is None:
                updates.append("owner_teacher_id = ?")
                params.append(owner_teacher_id)
            if school_id and row["school_id"] is None:
                updates.append("school_id = ?")
                params.append(school_id)
            params.append(paper_id)
            con.execute(f"UPDATE paper_records SET {', '.join(updates)} WHERE id = ?", params)
        stored = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(stored)
    if paper is None:
        raise RuntimeError("failed to sync paper record")
    return paper


def _publication_stats(root: Path, paper_id: str) -> dict[str, int]:
    with connect(root) as con:
        row = con.execute(
            """
            SELECT
              COUNT(DISTINCT ep.id) AS publication_count,
              COUNT(DISTINCT pc.class_id) AS published_class_count,
              COUNT(DISTINCT sa.id) AS total_student_count,
              COUNT(DISTINCT CASE
                WHEN sa.status IN ('submitted', 'completed') OR sa.submitted_at IS NOT NULL THEN sa.id
              END) AS submitted_student_count,
              COUNT(DISTINCT CASE
                WHEN sa.status = 'in_progress' AND sa.submitted_at IS NULL THEN sa.id
              END) AS in_progress_student_count
            FROM exam_publications ep
            LEFT JOIN publication_classes pc ON pc.publication_id = ep.id
            LEFT JOIN student_attempts sa ON sa.publication_id = ep.id
            WHERE ep.paper_id = ? AND ep.status <> 'revoked'
            """,
            (paper_id,),
        ).fetchone()
    return {
        "publication_count": int(row["publication_count"] or 0),
        "published_class_count": int(row["published_class_count"] or 0),
        "total_student_count": int(row["total_student_count"] or 0),
        "submitted_student_count": int(row["submitted_student_count"] or 0),
        "in_progress_student_count": int(row["in_progress_student_count"] or 0),
    }


def _paper_visible_to_user(paper: dict[str, Any], user: dict[str, Any]) -> bool:
    role = str(user.get("role") or "")
    if role == "admin":
        return True
    if role == "school":
        return paper.get("school_id") in (None, user.get("school_id"))
    if role == "teacher":
        return paper.get("owner_teacher_id") in (None, user.get("id"))
    return False


def _adaptive_paper_summary(root: Path, paper_id: str) -> tuple[int, bool]:
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT sa.question_payload_json, sa.score
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ?
            """,
            (paper_id,),
        ).fetchall()
    question_count = 0
    has_score = False
    for row in rows:
        has_score = has_score or row["score"] is not None
        try:
            payload = json.loads(str(row["question_payload_json"] or "[]"))
        except json.JSONDecodeError:
            payload = []
        if isinstance(payload, list):
            question_count = max(question_count, len(payload))
    return question_count, has_score


def list_papers(project_root: Path, platform_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(platform_root)
    exams = list_exam_results(project_root)
    papers: list[dict[str, Any]] = []
    for exam in exams:
        record = _paper_record_for_exam(platform_root, exam, user)
        if not _paper_visible_to_user(record, user):
            continue
        stats = _publication_stats(platform_root, str(record["id"]))
        papers.append(
            {
                "paper_id": record["id"],
                "exam_id": record["exam_id"],
                "title": record["title"],
                "subject": record["subject"],
                "delivery_mode": record["delivery_mode"],
                "status": record["status"],
                "owner_teacher_id": record["owner_teacher_id"],
                "school_id": record["school_id"],
                "question_count": int(exam.get("question_count") or 0),
                "section_count": int(exam.get("section_count") or 0),
                "score_batch_count": int(exam.get("score_batch_count") or 0),
                "has_score": bool(exam.get("has_score")),
                "has_pdf": bool(exam.get("has_pdf")),
                "has_docx": bool(exam.get("has_docx")),
                "latest_batch_id": exam.get("latest_batch_id"),
                "exam_dir": exam.get("exam_dir"),
                "mtime": exam.get("mtime"),
                **stats,
            }
        )
    with connect(platform_root) as con:
        adaptive_rows = con.execute(
            "SELECT * FROM paper_records WHERE exam_id LIKE 'adaptive/%' ORDER BY updated_at DESC"
        ).fetchall()
    existing_ids = {str(item["paper_id"]) for item in papers}
    for row in adaptive_rows:
        record = row_to_dict(row) or {}
        paper_id = str(record.get("id") or "")
        if not paper_id or paper_id in existing_ids or not _paper_visible_to_user(record, user):
            continue
        question_count, has_score = _adaptive_paper_summary(platform_root, paper_id)
        papers.append(
            {
                "paper_id": paper_id,
                "exam_id": record.get("exam_id"),
                "title": record.get("title"),
                "subject": record.get("subject"),
                "delivery_mode": record.get("delivery_mode"),
                "status": record.get("status"),
                "owner_teacher_id": record.get("owner_teacher_id"),
                "school_id": record.get("school_id"),
                "question_count": question_count,
                "section_count": 1 if question_count else 0,
                "score_batch_count": 0,
                "has_score": has_score,
                "has_pdf": False,
                "has_docx": False,
                "latest_batch_id": None,
                "exam_dir": None,
                "mtime": record.get("updated_at"),
                **_publication_stats(platform_root, paper_id),
            }
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
    exams = list_exam_results(project_root)
    matched = next((exam for exam in exams if str(exam.get("exam_id") or "") == clean_exam_id), None)
    if matched is None:
        raise ValueError("exam not found")
    record = _paper_record_for_exam(platform_root, matched, user)
    _ensure_paper_access(record, user)
    stats = _publication_stats(platform_root, str(record["id"]))
    return {
        "paper_id": record["id"],
        "exam_id": record["exam_id"],
        "title": record["title"],
        "subject": record["subject"],
        "delivery_mode": record["delivery_mode"],
        "status": record["status"],
        "owner_teacher_id": record["owner_teacher_id"],
        "school_id": record["school_id"],
        "question_count": int(matched.get("question_count") or 0),
        "section_count": int(matched.get("section_count") or 0),
        "score_batch_count": int(matched.get("score_batch_count") or 0),
        "has_score": bool(matched.get("has_score")),
        "has_pdf": bool(matched.get("has_pdf")),
        "has_docx": bool(matched.get("has_docx")),
        "latest_batch_id": matched.get("latest_batch_id"),
        "exam_dir": matched.get("exam_dir"),
        "mtime": matched.get("mtime"),
        **stats,
    }


def query_papers(
    project_root: Path,
    platform_root: Path,
    user: dict[str, Any],
    *,
    q: str | None = None,
    delivery_mode: str | None = None,
    status: str | None = None,
    subject: str | None = None,
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
    init_platform_db(root)
    with connect(root) as con:
        row = con.execute("SELECT * FROM paper_records WHERE id = ?", (paper_id,)).fetchone()
    paper = row_to_dict(row)
    if paper is None:
        raise ValueError("paper not found")
    return paper


def _ensure_paper_access(paper: dict[str, Any], user: dict[str, Any]) -> None:
    role = str(user.get("role") or "")
    if role == "admin":
        return
    if role == "school" and paper.get("school_id") in (None, user.get("school_id")):
        return
    if role == "teacher" and paper.get("owner_teacher_id") in (None, user.get("id")):
        return
    raise PermissionError("No permission for this paper")


def update_paper_delivery_mode(root: Path, paper_id: str, delivery_mode: str, user: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("Only teachers and admins can update paper delivery mode")
    clean_mode = delivery_mode.strip()
    if clean_mode not in DELIVERY_MODES:
        raise ValueError("delivery_mode must be offline or online")
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
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT
              ep.*,
              u.display_name AS teacher_name,
              u.username AS teacher_username,
              GROUP_CONCAT(DISTINCT c.id) AS class_ids,
              GROUP_CONCAT(DISTINCT c.name) AS class_names,
              COUNT(DISTINCT sa.id) AS attempt_count,
              COUNT(DISTINCT CASE WHEN sa.status IN ('submitted', 'completed') OR sa.submitted_at IS NOT NULL THEN sa.id END) AS submitted_count,
              COUNT(DISTINCT pe.id) AS proctor_event_count
            FROM exam_publications ep
            LEFT JOIN users u ON u.id = ep.teacher_id
            LEFT JOIN publication_classes pc ON pc.publication_id = ep.id
            LEFT JOIN classes c ON c.id = pc.class_id
            LEFT JOIN student_attempts sa ON sa.publication_id = ep.id
            LEFT JOIN proctor_events pe ON pe.publication_id = ep.id
            WHERE ep.paper_id = ?
            GROUP BY ep.id
            ORDER BY ep.created_at DESC
            """,
            (paper_id,),
        ).fetchall()
    publications: list[dict[str, Any]] = []
    for row in rows:
        item = row_to_dict(row) or {}
        item["show_results_immediately"] = bool(item.get("show_results_immediately"))
        item["randomize_questions"] = bool(item.get("randomize_questions"))
        item["randomize_answers"] = bool(item.get("randomize_answers"))
        item["class_ids"] = [part for part in str(item.pop("class_ids") or "").split(",") if part]
        item["class_names"] = [part for part in str(item.pop("class_names") or "").split(",") if part]
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
        params.append(start_at.strip() or None)
    if end_at is not None:
        updates.append("end_at = ?")
        params.append(end_at.strip() or None)
    if time_limit_minutes is not None:
        updates.append("time_limit_minutes = ?")
        params.append(max(0, int(time_limit_minutes)) or None)
    if show_results_immediately is not None:
        updates.append("show_results_immediately = ?")
        params.append(1 if show_results_immediately else 0)
    if status is not None:
        clean_status = status.strip() or "published"
        if clean_status not in PUBLICATION_STATUSES:
            raise ValueError("invalid publication status")
        updates.append("status = ?")
        params.append(clean_status)
    params.extend([publication_id, paper_id])
    with connect(root) as con:
        publication = con.execute(
            "SELECT teacher_id FROM exam_publications WHERE id = ? AND paper_id = ?",
            (publication_id, paper_id),
        ).fetchone()
        if publication is None:
            raise ValueError("publication not found")
        if user.get("role") == "teacher" and str(publication["teacher_id"]) != str(user.get("id")):
            raise PermissionError("Teacher can only manage own publications")
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
    if score is None:
        return None
    try:
        raw = float(score)
    except (TypeError, ValueError):
        return None
    try:
        max_raw = float(max_score)
    except (TypeError, ValueError):
        max_raw = 0
    if max_raw > 0:
        return round(raw / max_raw * 100, 2)
    return round(raw, 2)


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


def _build_module_report(
    root: Path,
    *,
    paper_id: str,
    project_root: Path | None,
    paper: dict[str, Any],
    students: list[dict[str, Any]],
    average_score: float | None,
) -> list[dict[str, Any]]:
    if project_root is None:
        return []
    try:
        questions, _by_id, score_by_id = _question_maps(project_root, paper)
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

    with connect(root) as con:
        rows = con.execute(
            """
            SELECT ans.question_id, ans.score, ans.is_correct, ans.answer_payload
            FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ?
            """,
            (paper_id,),
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
        if row["score"] is not None:
            max_score = float(score_by_id.get(question_id) or 0)
            if max_score > 0:
                item["_scores"].append(float(row["score"]))
                item["_max_scores"].append(max_score)
            item["scored_count"] = int(item["scored_count"]) + 1
        if row["is_correct"] is not None:
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
) -> list[dict[str, Any]]:
    if project_root is None:
        return []
    try:
        questions, _by_id, score_by_id = _question_maps(project_root, paper)
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

    with connect(root) as con:
        rows = con.execute(
            """
            SELECT ans.question_id, ans.answer_payload, ans.is_correct, ans.score
            FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ?
            """,
            (paper_id,),
        ).fetchall()

    for row in rows:
        question_id = str(row["question_id"] or "")
        item = reports.get(question_id)
        if item is None:
            continue
        payload = _json_payload(row["answer_payload"])
        if payload:
            item["answered_count"] = int(item["answered_count"]) + 1
        if row["score"] is not None:
            max_score = float(score_by_id.get(question_id) or 0)
            if max_score > 0:
                item["_scores"].append(float(row["score"]))
                item["_max_scores"].append(max_score)
            item["scored_count"] = int(item["scored_count"]) + 1
        if row["is_correct"] is not None:
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


def _build_class_report(root: Path, *, paper_id: str) -> list[dict[str, Any]]:
    with connect(root) as con:
        rows = con.execute(
            """
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
              COUNT(pe.id) AS screen_switch_count
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN classes c ON c.id = pc.class_id
            JOIN student_attempts sa ON sa.publication_id = ep.id
            JOIN class_students cs ON cs.class_id = c.id AND cs.student_id = sa.student_id
            LEFT JOIN proctor_events pe ON pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'
            WHERE ep.paper_id = ?
            GROUP BY c.id, sa.id
            ORDER BY c.name
            """,
            (paper_id,),
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
        score_percent = _score_percent(row["score"], row["max_score"])
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


def analyze_paper(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    project_root: Path | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    role = str(user.get("role") or "")
    if role == "teacher" and paper.get("owner_teacher_id") not in (None, user.get("id")):
        raise PermissionError("Teacher can only analyze own papers")
    if role == "school" and paper.get("school_id") not in (None, user.get("school_id")):
        raise PermissionError("School can only analyze own papers")
    if role not in {"admin", "school", "teacher"}:
        raise PermissionError("Only admin, school, and teacher users can analyze papers")

    with connect(root) as con:
        publication_rows = con.execute(
            "SELECT * FROM exam_publications WHERE paper_id = ? ORDER BY created_at DESC",
            (paper_id,),
        ).fetchall()
        attempt_rows = con.execute(
            """
            SELECT
              sa.*,
              ep.id AS publication_id,
              ep.title AS publication_title,
              ep.max_screen_switches,
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
            WHERE ep.paper_id = ?
            ORDER BY s.display_name, s.student_no
            """,
            (paper_id,),
        ).fetchall()
        event_rows = con.execute(
            """
            SELECT pe.*
            FROM proctor_events pe
            JOIN exam_publications ep ON ep.id = pe.publication_id
            WHERE ep.paper_id = ?
            ORDER BY pe.occurred_at
            """,
            (paper_id,),
        ).fetchall()

    events_by_attempt: dict[str, list[dict[str, Any]]] = {}
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
        status_group = _attempt_status_group(attempt)
        if status_group == "completed":
            completed += 1
        elif status_group == "in_progress":
            in_progress += 1
        else:
            not_started += 1
        score_percent = _score_percent(attempt.get("score"), attempt.get("max_score"))
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
    )
    questions = _build_question_report(root, paper_id=paper_id, project_root=project_root, paper=paper)
    classes = _build_class_report(root, paper_id=paper_id)
    radar = _build_radar(
        completion_rate=completion_rate,
        average_score=average_score,
        average_time_seconds=average_time_seconds,
        total=total,
        exceeded_student_count=exceeded_student_count,
        modules=modules,
    )

    return {
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
                SELECT c.id, c.school_id, c.name, c.grade, c.subject_hint, tca.subject
                FROM teacher_class_assignments tca
                JOIN classes c ON c.id = tca.class_id
                WHERE tca.teacher_id = ?
                ORDER BY c.grade, c.name, tca.subject
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
    clean_ids = [cid.strip() for cid in class_ids if cid.strip()]
    if not clean_ids:
        raise ValueError("at least one class is required")
    unique_ids = list(dict.fromkeys(clean_ids))
    role = user.get("role")
    with connect(root) as con:
        placeholders = ",".join("?" for _ in unique_ids)
        existing_rows = con.execute(
            f"SELECT id FROM classes WHERE id IN ({placeholders})",
            tuple(unique_ids),
        ).fetchall()
        existing = {str(row["id"]) for row in existing_rows}
        missing = [cid for cid in unique_ids if cid not in existing]
        if missing:
            raise ValueError(f"class not found: {missing[0]}")
        if role == "teacher":
            assigned_rows = con.execute(
                f"""
                SELECT class_id
                FROM teacher_class_assignments
                WHERE teacher_id = ? AND class_id IN ({placeholders})
                """,
                (str(user["id"]), *unique_ids),
            ).fetchall()
            assigned = {str(row["class_id"]) for row in assigned_rows}
            denied = [cid for cid in unique_ids if cid not in assigned]
            if denied:
                raise PermissionError("Teacher is not assigned to one or more selected classes")
    return unique_ids


def _paper_exam_question_payloads(project_root: Path, paper: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    return _load_exam_question_payloads(project_root, str(paper.get("exam_id") or ""))


def _ensure_publishable_paper(project_root: Path | None, paper: dict[str, Any]) -> None:
    if project_root is None:
        return
    questions, _answer_keys = _paper_exam_question_payloads(project_root, paper)
    if len(questions) <= 0:
        raise ValueError("paper must contain at least one question before publish")


def _ensure_class_not_already_published(root: Path, *, paper_id: str, class_ids: list[str]) -> None:
    if not class_ids:
        return
    placeholders = ",".join("?" for _ in class_ids)
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT c.name, c.id
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN classes c ON c.id = pc.class_id
            WHERE ep.paper_id = ?
              AND ep.status <> 'revoked'
              AND pc.class_id IN ({placeholders})
            ORDER BY c.name
            """,
            (paper_id, *class_ids),
        ).fetchall()
    if rows:
        class_names = ", ".join(str(row["name"] or row["id"]) for row in rows)
        raise ValueError(f"paper already published to class: {class_names}")


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
    }


def _paper_attempt_row(root: Path, *, paper_id: str, attempt_id: str) -> dict[str, Any]:
    with connect(root) as con:
        row = con.execute(
            """
            SELECT
              sa.*,
              ep.paper_id,
              ep.title AS publication_title,
              ep.submission_mode,
              pr.exam_id,
              pr.subject,
              pr.title AS paper_title,
              s.student_no,
              s.display_name AS student_name,
              u.username AS account_username
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            JOIN students s ON s.id = sa.student_id
            LEFT JOIN users u ON u.id = s.user_id
            WHERE sa.id = ? AND ep.paper_id = ?
            """,
            (attempt_id, paper_id),
        ).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise ValueError("attempt not found for this paper")
    return data


def _question_maps(project_root: Path, paper: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
    questions, _answer_keys = _paper_exam_question_payloads(project_root, paper)
    by_id = {str(item.get("question_id")): item for item in questions}
    score_by_id = {qid: float(item.get("score_per_item") or 0) for qid, item in by_id.items()}
    return questions, by_id, score_by_id


def _question_maps_for_attempt(
    project_root: Path,
    paper: dict[str, Any],
    attempt: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
    raw_questions = attempt.get("question_payload_json")
    if raw_questions:
        try:
            questions = json.loads(str(raw_questions))
        except json.JSONDecodeError as exc:
            raise ValueError("Frozen question payload is invalid") from exc
        if not isinstance(questions, list) or not all(isinstance(item, dict) for item in questions):
            raise ValueError("Frozen question payload is invalid")
        by_id = {str(item.get("question_id")): item for item in questions}
        score_by_id = {qid: float(item.get("score_per_item") or 0) for qid, item in by_id.items()}
        return questions, by_id, score_by_id
    return _question_maps(project_root, paper)


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
    match = re.search(r"\{.*\}", text, flags=re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _clamp_score(value: object, max_score: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        raw = float(value)
    except (TypeError, ValueError):
        return None
    if raw < 0:
        return 0.0
    if max_score > 0 and raw > max_score:
        return max_score
    return round(raw, 2)


def _ocr_images(images: list[Any]) -> tuple[str, list[str]]:
    if not images:
        return "", []
    try:
        from PIL import Image
        import pytesseract
    except ImportError:
        return "", ["OCR unavailable: missing Pillow or pytesseract"]

    texts: list[str] = []
    errors: list[str] = []
    for index, image in enumerate(images, start=1):
        if not isinstance(image, dict):
            continue
        data_url = str(image.get("data_url") or "")
        if not data_url:
            continue
        raw = data_url.split(",", 1)[1] if "," in data_url else data_url
        try:
            data = base64.b64decode(raw, validate=True)
            with Image.open(io.BytesIO(data)) as img:
                text = pytesseract.image_to_string(img, lang="chi_sim+eng").strip()
        except (binascii.Error, OSError, RuntimeError, ValueError) as exc:
            errors.append(f"OCR image {index} failed: {exc}")
            continue
        if text:
            texts.append(text)
    return "\n\n".join(texts), errors


async def _ai_grade_answer(
    project_root: Path,
    *,
    question: dict[str, Any],
    answer_text: str,
    ocr_text: str,
    max_score: float,
) -> dict[str, Any] | None:
    from solaire.agent_layer.llm.router import ModelRouter, load_llm_settings

    settings = load_llm_settings(project_root)
    if not settings.api_key:
        return None
    adapter = ModelRouter(settings=settings).fast()
    payload = {
        "question_id": question.get("question_id"),
        "question_header": question.get("header"),
        "question_type": question.get("type"),
        "question_content": question.get("content"),
        "max_score": max_score,
        "student_answer_text": answer_text,
        "ocr_text": ocr_text,
    }
    response = await adapter.chat(
        [
            {
                "role": "system",
                "content": (
                    "你是考试批改助手。请根据题目、分值、学生答案和 OCR 文本给出批改建议。"
                    "只返回 JSON：{\"suggested_score\": number|null, \"feedback\": string, \"status\": \"needs_review\"}。"
                    "不要直接判定为最终成绩，反馈应说明老师需要复核的点。"
                ),
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        temperature=0.1,
        max_tokens=600,
    )
    data = _extract_json_object(response.content or "")
    if data is None:
        return None
    return {
        "suggested_score": _clamp_score(data.get("suggested_score"), max_score),
        "feedback": str(data.get("feedback") or "").strip() or "AI 已生成建议，请教师复核。",
        "status": "needs_review",
    }


def publish_online_paper(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    class_ids: list[str],
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
) -> dict[str, Any]:
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("Only teachers and admins can publish papers")
    selected_class_ids = _validate_publish_classes(root, user, class_ids)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    _ensure_publishable_paper(project_root, paper)
    _ensure_class_not_already_published(root, paper_id=paper_id, class_ids=selected_class_ids)
    clean_submission_mode = submission_mode.strip() or "online"
    if clean_submission_mode not in SUBMISSION_MODES:
        raise ValueError("submission_mode must be online, image_manual, or image_ai")
    clean_max_screen_switches = max(0, int(max_screen_switches or 0))
    clean_time_limit_minutes = max(0, int(time_limit_minutes or 0)) or None
    now = utc_now()
    publication_id = _new_id()
    teacher_id = str(user["id"])
    publication_title = _clean_title(title, str(paper["title"]))
    clean_description = description.strip() if description and description.strip() else None
    frozen_questions: list[dict[str, Any]] = []
    frozen_answer_keys: dict[str, str] = {}
    if project_root is not None:
        frozen_questions, frozen_answer_keys = _paper_exam_question_payloads(project_root, paper)
    frozen_questions_json = json.dumps(frozen_questions, ensure_ascii=False) if frozen_questions else None
    frozen_answer_keys_json = json.dumps(frozen_answer_keys, ensure_ascii=False) if frozen_questions else None

    with connect(root) as con:
        con.execute(
            """
            INSERT INTO exam_publications (
              id, paper_id, teacher_id, title, description, start_at, end_at,
              show_results_immediately, randomize_questions, randomize_answers,
              submission_mode, max_screen_switches, time_limit_minutes, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
            """,
            (
                publication_id,
                paper_id,
                teacher_id,
                publication_title,
                clean_description,
                start_at,
                end_at,
                1 if show_results_immediately else 0,
                1 if randomize_questions else 0,
                1 if randomize_answers else 0,
                clean_submission_mode,
                clean_max_screen_switches,
                clean_time_limit_minutes,
                now,
                now,
            ),
        )
        con.executemany(
            "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
            [(publication_id, class_id) for class_id in selected_class_ids],
        )
        student_rows = con.execute(
            f"""
            SELECT DISTINCT student_id
            FROM class_students
            WHERE class_id IN ({','.join('?' for _ in selected_class_ids)})
            """,
            tuple(selected_class_ids),
        ).fetchall()
        con.executemany(
            """
            INSERT OR IGNORE INTO student_attempts
              (id, publication_id, student_id, status, question_payload_json, answer_key_json)
            VALUES (?, ?, ?, 'not_started', ?, ?)
            """,
            [
                (_new_id(), publication_id, str(row["student_id"]), frozen_questions_json, frozen_answer_keys_json)
                for row in student_rows
            ],
        )
        con.execute(
            "UPDATE paper_records SET delivery_mode = 'online', status = 'published', updated_at = ? WHERE id = ?",
            (now, paper_id),
        )
        row = con.execute("SELECT * FROM exam_publications WHERE id = ?", (publication_id,)).fetchone()
    publication = row_to_dict(row)
    if publication is None:
        raise RuntimeError("failed to publish paper")
    publication["class_ids"] = selected_class_ids
    publication["attempt_count"] = len(student_rows)
    publication["submission_mode"] = clean_submission_mode
    publication["max_screen_switches"] = clean_max_screen_switches
    publication["time_limit_minutes"] = clean_time_limit_minutes
    return publication


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
    with connect(root) as con:
        attempt_rows = con.execute(
            """
            SELECT
              sa.*,
              ep.paper_id,
              ep.title AS publication_title,
              ep.submission_mode,
              pr.exam_id,
              pr.subject,
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
            WHERE ep.paper_id = ?
            ORDER BY sa.submitted_at DESC, s.display_name, s.student_no
            """,
            (paper_id,),
        ).fetchall()
        answer_rows = con.execute(
            """
            SELECT ans.*
            FROM student_answers ans
            JOIN student_attempts sa ON sa.id = ans.attempt_id
            JOIN exam_publications ep ON ep.id = sa.publication_id
            WHERE ep.paper_id = ?
            ORDER BY ans.responded_at
            """,
            (paper_id,),
        ).fetchall()

    attempts = [row_to_dict(row) or {} for row in attempt_rows]
    maps_by_attempt: dict[str, tuple[dict[str, dict[str, Any]], dict[str, int]]] = {}
    for attempt in attempts:
        questions, by_id, _score_by_id = _question_maps_for_attempt(project_root, paper, attempt)
        maps_by_attempt[str(attempt.get("id"))] = (
            by_id,
            {str(item.get("question_id")): index for index, item in enumerate(questions)},
        )

    answers_by_attempt: dict[str, list[dict[str, Any]]] = {}
    for row in answer_rows:
        answer = row_to_dict(row) or {}
        attempt_id = str(answer.get("attempt_id"))
        qid = str(answer.get("question_id") or "")
        by_id, _order_index = maps_by_attempt.get(attempt_id, ({}, {}))
        answers_by_attempt.setdefault(attempt_id, []).append(
            _answer_public_payload(answer, by_id.get(qid)),
        )

    submissions: list[dict[str, Any]] = []
    for attempt in attempts:
        attempt_id = str(attempt.get("id"))
        attempt_answers = answers_by_attempt.get(attempt_id, [])
        _by_id, order_index = maps_by_attempt.get(attempt_id, ({}, {}))
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
                "max_score": attempt.get("max_score"),
                "submitted_at": attempt.get("submitted_at"),
                "screen_switch_count": int(attempt.get("screen_switch_count") or 0),
                "submission_mode": attempt.get("submission_mode") or "online",
                "answers": attempt_answers,
            }
        )
    return submissions


def _recompute_attempt_score(root: Path, *, attempt_id: str, score_by_id: dict[str, float]) -> dict[str, Any]:
    with connect(root) as con:
        rows = con.execute(
            "SELECT question_id, score FROM student_answers WHERE attempt_id = ?",
            (attempt_id,),
        ).fetchall()
        total = 0.0
        max_score = 0.0
        scored_any = False
        for row in rows:
            score = row["score"]
            if score is None:
                continue
            qid = str(row["question_id"])
            total += float(score)
            max_score += float(score_by_id.get(qid, 0.0))
            scored_any = True
        final_score = round(total, 2) if scored_any else None
        final_max = round(max_score, 2) if scored_any else None
        con.execute(
            "UPDATE student_attempts SET score = ?, max_score = ? WHERE id = ?",
            (final_score, final_max, attempt_id),
        )
        row = con.execute("SELECT * FROM student_attempts WHERE id = ?", (attempt_id,)).fetchone()
    attempt = row_to_dict(row)
    if attempt is None:
        raise RuntimeError("failed to update attempt score")
    return attempt


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
) -> dict[str, Any]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    attempt = _paper_attempt_row(root, paper_id=paper_id, attempt_id=attempt_id)
    _questions, by_id, score_by_id = _question_maps_for_attempt(project_root, paper, attempt)
    if question_id not in by_id:
        raise ValueError("question not found in paper")
    max_score = float(score_by_id.get(question_id, 0.0))
    clean_score = float(score)
    if clean_score < 0 or (max_score > 0 and clean_score > max_score):
        raise ValueError("score is out of range")
    clean_feedback = feedback.strip() if feedback and feedback.strip() else None
    now = utc_now()
    answer_id = _new_id()
    with connect(root) as con:
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
                None if is_correct is None else (1 if is_correct else 0),
                clean_score,
                clean_feedback,
                str(user.get("id") or ""),
                now,
                now,
            ),
        )
        row = con.execute(
            "SELECT * FROM student_answers WHERE attempt_id = ? AND question_id = ?",
            (attempt_id, question_id),
        ).fetchone()
    _recompute_attempt_score(root, attempt_id=str(attempt["id"]), score_by_id=score_by_id)
    answer = row_to_dict(row)
    if answer is None:
        raise RuntimeError("failed to grade answer")
    return _answer_public_payload(answer, by_id.get(question_id))


def suggest_ai_grades_for_attempt(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    attempt_id: str,
    user: dict[str, Any],
    question_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    attempt = _paper_attempt_row(root, paper_id=paper_id, attempt_id=attempt_id)
    questions, by_id, score_by_id = _question_maps_for_attempt(project_root, paper, attempt)
    selected = [str(qid).strip() for qid in (question_ids or []) if str(qid).strip()]
    if not selected:
        selected = [str(item.get("question_id")) for item in questions]
    missing = [qid for qid in selected if qid not in by_id]
    if missing:
        raise ValueError(f"question not found in paper: {missing[0]}")

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
        suggestions: list[dict[str, Any]] = []
        for qid in selected:
            answer = by_question.get(qid)
            if answer is None:
                continue
            payload = _json_payload(answer.get("answer_payload"))
            has_images = bool(payload.get("images"))
            ocr_text, ocr_errors = _ocr_images(payload.get("images") if isinstance(payload.get("images"), list) else [])
            answer_text = str(payload.get("answer") or "").strip()
            max_score = float(score_by_id.get(qid, 0.0))
            suggestion = None
            ai_error: str | None = None
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
                    feedback_parts.append(f"AI 建议生成失败：{ai_error}")
                elif not load_llm_settings(project_root).api_key:
                    feedback_parts.append("未配置 AI 模型，暂不能生成自动建议。")
                feedback = "".join(feedback_parts)
                suggested_score = None
                status = "needs_review"
            else:
                feedback = str(suggestion.get("feedback") or "AI 已生成建议，请教师复核。")
                suggested_score = suggestion.get("suggested_score")
                status = str(suggestion.get("status") or "needs_review")
            con.execute(
                """
                UPDATE student_answers
                SET grading_status = 'needs_review',
                    ai_suggested_score = ?,
                    ai_feedback = ?,
                    ai_ocr_text = ?,
                    responded_at = responded_at
                WHERE attempt_id = ? AND question_id = ?
                """,
                (
                    suggested_score,
                    feedback,
                    ocr_text or "\n".join(ocr_errors),
                    attempt_id,
                    qid,
                ),
            )
            suggestions.append(
                {
                    "question_id": qid,
                    "suggested_score": suggested_score,
                    "feedback": feedback,
                    "status": status,
                }
            )
    return suggestions
