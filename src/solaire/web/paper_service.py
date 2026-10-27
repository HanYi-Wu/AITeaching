"""Paper management services for offline/online exam delivery."""

from __future__ import annotations

import uuid
import json
import asyncio
import base64
import re
import sqlite3
import threading
from collections.abc import Sequence
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
from solaire.web.papers import teacher_queries
from solaire.web.papers import analysis as paper_analysis
from solaire.web.papers.frozen_question_reads import FrozenQuestionReadContext
from solaire.web.papers.snapshots import _is_placeholder_question
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


def _attempt_status_group(attempt: dict[str, Any]) -> str:
    status = str(attempt.get("status") or "not_started")
    if status in {"submitted", "completed"} or attempt.get("submitted_at"):
        return "completed"
    if status == "in_progress" or attempt.get("started_at"):
        return "in_progress"
    return "not_started"


def _risk_level(value: float | None) -> str:
    return paper_analysis.risk_level(value)


def _analysis_question_maps(
    root: Path,
    project_root: Path,
    paper: dict[str, Any],
    user: dict[str, Any],
    publication_id: str | None,
    class_id: str | None = None,
    read_context: FrozenQuestionReadContext | None = None,
    *,
    snapshot_rows: list[Any] | None = None,
):
    return paper_analysis.analysis_question_maps(
        root,
        project_root,
        paper,
        user,
        publication_id,
        class_id,
        attempt_clause_fn=_analysis_attempt_clause,
        question_maps_fn=_question_maps,
        read_context=read_context,
        snapshot_rows=snapshot_rows,
    )


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
    read_context: FrozenQuestionReadContext | None = None,
    question_data: Any = None,
    answer_rows: list[Any] | None = None,
) -> list[dict[str, Any]]:
    return paper_analysis.build_module_report(
        root,
        paper_id=paper_id,
        project_root=project_root,
        paper=paper,
        students=students,
        average_score=average_score,
        user=user,
        publication_id=publication_id,
        class_id=class_id,
        question_maps_fn=_analysis_question_maps,
        attempt_clause_fn=_analysis_attempt_clause,
        json_payload_fn=_json_payload,
        risk_level_fn=_risk_level,
        read_context=read_context,
        question_data=question_data,
        answer_rows=answer_rows,
    )


def _build_question_report(
    root: Path,
    *,
    paper_id: str,
    project_root: Path | None,
    paper: dict[str, Any],
    user: dict[str, Any],
    publication_id: str | None = None,
    class_id: str | None = None,
    read_context: FrozenQuestionReadContext | None = None,
    question_data: Any = None,
    answer_rows: list[Any] | None = None,
) -> list[dict[str, Any]]:
    return paper_analysis.build_question_report(
        root,
        paper_id=paper_id,
        project_root=project_root,
        paper=paper,
        user=user,
        publication_id=publication_id,
        class_id=class_id,
        question_maps_fn=_analysis_question_maps,
        attempt_clause_fn=_analysis_attempt_clause,
        json_payload_fn=_json_payload,
        risk_level_fn=_risk_level,
        read_context=read_context,
        question_data=question_data,
        answer_rows=answer_rows,
    )


def _build_class_report(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    publication_id: str | None = None,
    class_id: str | None = None,
) -> list[dict[str, Any]]:
    return paper_analysis.build_class_report(
        root,
        paper_id=paper_id,
        user=user,
        publication_id=publication_id,
        class_id=class_id,
        attempt_clause_fn=_analysis_attempt_clause,
        attempt_status_group_fn=_attempt_status_group,
        score_percent_fn=_score_percent,
    )


def _build_radar(
    *,
    completion_rate: float,
    average_score: float | None,
    average_time_seconds: float | None,
    total: int,
    exceeded_student_count: int,
    modules: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return paper_analysis.build_radar(
        completion_rate=completion_rate,
        average_score=average_score,
        average_time_seconds=average_time_seconds,
        total=total,
        exceeded_student_count=exceeded_student_count,
        modules=modules,
    )


def _analysis_attempt_clause(
    user: dict[str, Any],
    publication_id: str | None,
    *,
    attempt_alias: str = "sa",
    class_id: str | None = None,
) -> tuple[str, list[str]]:
    return paper_analysis.analysis_attempt_clause(
        user,
        publication_id,
        attempt_alias=attempt_alias,
        class_id=class_id,
        attempt_access_clause_fn=_attempt_access_clause,
    )


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
        con.execute("BEGIN")
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
              sa.*, sa.rowid AS snapshot_order,
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
            f"SELECT ans.attempt_id, ans.question_id, ans.score, ans.answer_payload, ans.is_correct, "
            f"sa.score AS attempt_score FROM student_answers ans "
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
    question_read_context = FrozenQuestionReadContext()
    question_data = None
    if project_root is not None:
        try:
            question_data = _analysis_question_maps(
                root, project_root, paper, user, publication_id, class_id, question_read_context,
                snapshot_rows=sorted(attempt_rows, key=lambda row: row["snapshot_order"]),
            )
        except (FileNotFoundError, ValueError):
            question_data = ([], {}, {})
    for row in attempt_rows:
        attempt = row_to_dict(row) or {}
        if project_root is not None:
            _questions, _by_id, score_by_id = _question_maps_for_attempt(
                root,
                project_root,
                paper,
                attempt,
                read_context=question_read_context,
            )
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
        read_context=question_read_context,
        question_data=question_data,
        answer_rows=answer_rows,
    )
    questions = _build_question_report(
        root,
        paper_id=paper_id,
        project_root=project_root,
        paper=paper,
        user=user,
        publication_id=publication_id,
        class_id=class_id,
        read_context=question_read_context,
        question_data=question_data,
        answer_rows=answer_rows,
    )
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
    read_context: FrozenQuestionReadContext | None = None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
    attempt_payload = attempt if attempt.get("exam_id") else {**attempt, "exam_id": paper.get("exam_id")}
    questions, _answer_keys = _load_attempt_question_payloads(
        project_root,
        attempt_payload,
        root=root,
        connection=connection,
        read_context=read_context,
    )
    if (
        read_context is not None
        and str(attempt.get("question_payload_json") or "")
        and int(attempt.get("question_payload_version") or 1) >= 3
        and all(not _is_placeholder_question(item) for item in questions)
    ):
        return read_context.question_maps(
            attempt.get("question_payload_json"),
            attempt.get("answer_key_json"),
            questions,
            _answer_keys,
            include_correct_answer=True,
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
    source_exam_id: str | None = None,
    source_batch_id: str | None = None,
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
        source_exam_id=source_exam_id,
        source_batch_id=source_batch_id,
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
    return _attempt_scan_payloads_for_attempts(root, [attempt_id], include_content=include_content)[attempt_id]


def _attempt_scan_payloads_for_attempts(
    root: Path,
    attempt_ids: Sequence[str],
    *,
    include_content: bool = False,
    chunk_size: int = 500,
) -> dict[str, list[dict[str, Any]]]:
    ids = list(dict.fromkeys(attempt_ids))
    grouped: dict[str, list[dict[str, Any]]] = {attempt_id: [] for attempt_id in ids}
    if not ids:
        return grouped
    content_column = ", content" if include_content else ""
    with connect(root) as con:
        rows = []
        for start in range(0, len(ids), chunk_size):
            chunk = ids[start : start + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            rows.extend(con.execute(
                f"SELECT attempt_id, page_index, file_name, mime_type, file_size{content_column} "
                f"FROM attempt_scan_images WHERE attempt_id IN ({placeholders}) ORDER BY attempt_id, page_index",
                chunk,
            ).fetchall())
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
        grouped[str(row["attempt_id"])].append(payload)
    return grouped


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
    init_platform_db(root)
    paper = get_paper(root, paper_id)
    _ensure_paper_access(paper, user)
    return teacher_queries.list_paper_submissions_query(
        root,
        project_root,
        paper_id=paper_id,
        paper=paper,
        user=user,
        question_maps_for_attempt=_question_maps_for_attempt,
        answer_public_payload=_answer_public_payload,
        attempt_scan_payloads=_attempt_scan_payloads,
        attempt_scan_payloads_for_attempts=_attempt_scan_payloads_for_attempts,
        attempt_status_group=_attempt_status_group,
    )


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
    return teacher_queries.find_paper_submissions_query(
        root,
        paper_id=paper_id,
        user=user,
        student_query=student_query,
        status=status,
        grading_status=grading_status,
        limit=limit,
    )


def list_teacher_class_students(root: Path, *, class_id: str, user: dict[str, Any]) -> list[dict[str, Any]]:
    init_platform_db(root)
    _validate_publish_classes(root, user, [class_id])
    return teacher_queries.list_teacher_class_students_query(root, class_id=class_id)


def resolve_teacher_class_student(
    root: Path,
    *,
    class_id: str,
    user: dict[str, Any],
    student_id: str | None = None,
    student_query: str | None = None,
) -> dict[str, Any]:
    students = list_teacher_class_students(root, class_id=class_id, user=user)
    return teacher_queries.resolve_teacher_class_student_query(
        students,
        student_id=student_id,
        student_query=student_query,
    )


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
    init_platform_db(root)
    return teacher_queries.teacher_student_profile_query(
        root,
        class_id=class_id,
        user=user,
        student_id=student_id,
        student_query=student_query,
        date_from=date_from,
        date_to=date_to,
        resolve_student=resolve_teacher_class_student,
        attempt_status_group=_attempt_status_group,
        score_percent=_score_percent,
    )


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
    _verify_context=None,
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
        if _verify_context:
            _verify_context(con)
        initial_revisions = load_answer_revisions(con, [attempt_id])
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
        if _verify_context:
            with connect(root) as con:
                _verify_context(con)
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
            if _verify_context:
                with connect(root) as con:
                    _verify_context(con)
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
        con.execute("BEGIN IMMEDIATE")
        if _verify_context:
            _verify_context(con)
        current_revisions = load_answer_revisions(con, [attempt_id])
        for item in generated:
            key = (attempt_id, item["question_id"])
            if current_revisions.get(key, 0) != initial_revisions.get(key, 0):
                continue
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
