"""Teacher-facing submission, class, and student read models."""

from __future__ import annotations

from contextlib import closing

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from solaire.web.papers.frozen_question_reads import FrozenQuestionReadContext
from solaire.web.papers.grading_versions import answer_grading_version, load_answer_revisions
from solaire.web.papers.visibility import attempt_access_clause
from solaire.web.platform_db import connect, row_to_dict


def _weak_question_definition_key(
    question: dict[str, Any] | None,
    *,
    answer_key_known: bool,
    answer_key: Any,
) -> str | None:
    if question is None:
        return None
    question_id = str(question.get("question_id") or "").strip()
    content = str(question.get("content") or "").strip()
    question_type = str(question.get("type") or "").strip()
    if not content or content == question_id or question_type in {"", "unknown"}:
        return None
    try:
        definition = {
            "content": question.get("content"),
            "group_material": question.get("group_material", question.get("material")),
            "type": question.get("type"),
            "options": question.get("options"),
            "score_per_item": float(question.get("score_per_item") or 0.0),
            "answer_key_known": answer_key_known,
            "answer_key": str(answer_key) if answer_key_known else None,
        }
        return json.dumps(
            definition,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError, OverflowError):
        return None


def list_paper_submissions_query(
    root: Path,
    project_root: Path,
    *,
    paper_id: str,
    paper: dict[str, Any],
    user: dict[str, Any],
    question_maps_for_attempt: Callable[..., Any],
    answer_public_payload: Callable[..., dict[str, Any]],
    attempt_scan_payloads: Callable[..., list[dict[str, Any]]],
    attempt_status_group: Callable[[dict[str, Any]], str],
    attempt_scan_payloads_for_attempts: Callable[..., Mapping[str, list[dict[str, Any]]]] | None = None,
) -> list[dict[str, Any]]:
    access_clause, access_params = attempt_access_clause(user)
    with closing(connect(root)) as con, con:
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
            ORDER BY sa.submitted_at DESC, s.display_name, s.student_no, sa.id
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
            ORDER BY ans.responded_at, ans.question_id, ans.id
            """,
            (paper_id, *access_params),
        ).fetchall()
        revisions = load_answer_revisions(con, [str(row["id"]) for row in attempt_rows])

    attempts = [row_to_dict(row) or {} for row in attempt_rows]
    read_context = FrozenQuestionReadContext()
    maps_by_attempt: dict[str, tuple[dict[str, dict[str, Any]], dict[str, int]]] = {}
    max_score_by_attempt: dict[str, float] = {}
    for attempt in attempts:
        questions, by_id, score_by_id = question_maps_for_attempt(
            root,
            project_root,
            paper,
            attempt,
            read_context=read_context,
        )
        attempt_id = str(attempt.get("id"))
        maps_by_attempt[attempt_id] = (
            by_id,
            {str(item.get("question_id")): index for index, item in enumerate(questions)},
        )
        max_score_by_attempt[attempt_id] = round(sum(score_by_id.values()), 2)

    answers_by_attempt: dict[str, list[dict[str, Any]]] = {}
    for row in answer_rows:
        answer = row_to_dict(row) or {}
        attempt_id = str(answer.get("attempt_id"))
        question_id = str(answer.get("question_id") or "")
        by_id, _order_index = maps_by_attempt.get(attempt_id, ({}, {}))
        public_answer = answer_public_payload(answer, by_id.get(question_id))
        public_answer["grading_version"] = answer_grading_version(
            attempt_id, question_id, by_id.get(question_id), answer, revisions.get((attempt_id, question_id), 0),
        )
        answers_by_attempt.setdefault(attempt_id, []).append(public_answer)

    scans_by_attempt: Mapping[str, list[dict[str, Any]]] | None = None
    if attempt_scan_payloads_for_attempts is not None and attempts:
        attempt_ids = [str(attempt["id"]) for attempt in attempts if attempt.get("id") is not None]
        scans_by_attempt = attempt_scan_payloads_for_attempts(root, attempt_ids, include_content=False)

    submissions: list[dict[str, Any]] = []
    for attempt in attempts:
        attempt_id = str(attempt.get("id"))
        attempt_answers = answers_by_attempt.get(attempt_id, [])
        if scans_by_attempt is not None:
            scan_images = list(scans_by_attempt.get(attempt_id) or [])
        else:
            scan_images = attempt_scan_payloads(root, attempt_id, include_content=False)
        by_id, order_index = maps_by_attempt.get(attempt_id, ({}, {}))
        if attempt_status_group(attempt) == "completed":
            answered_ids = {str(item.get("question_id") or "") for item in attempt_answers}
            for question_id, question in by_id.items():
                if question_id not in answered_ids:
                    missing = {"question_id": question_id, "answer_payload": "{}", "grading_status": "pending"}
                    public_answer = answer_public_payload(missing, question)
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


def find_paper_submissions_query(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    student_query: str | None = None,
    status: str | None = None,
    grading_status: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    clean_limit = max(1, min(int(limit or 20), 100))
    clean_query = str(student_query or "").strip()
    clean_status = str(status or "").strip()
    clean_grading = str(grading_status or "").strip()
    clauses = ["ep.paper_id = ?"]
    params: list[Any] = [paper_id]
    access_clause, access_params = attempt_access_clause(user)
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

    with closing(connect(root)) as con, con:
        # CTE locates the top bounded attempts first, avoiding wide full-table joins over answers
        rows = con.execute(
            f"""
            WITH matched_attempts AS (
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
                sa.submitted_at
              FROM student_attempts sa
              JOIN exam_publications ep ON ep.id = sa.publication_id
              JOIN students s ON s.id = sa.student_id
              LEFT JOIN users u ON u.id = s.user_id
              WHERE {' AND '.join(clauses)}
              ORDER BY sa.submitted_at DESC, s.display_name, s.student_no, sa.id
              LIMIT ?
            )
            SELECT
              ma.attempt_id,
              ma.publication_id,
              ma.paper_id,
              ma.student_id,
              ma.student_no,
              ma.student_name,
              ma.account_username,
              ma.status,
              ma.submission_mode,
              ma.score,
              ma.max_score,
              ma.submitted_at,
              COUNT(ans.id) AS answer_count,
              SUM(CASE WHEN ans.id IS NOT NULL AND COALESCE(ans.grading_status, 'pending') = 'pending' THEN 1 ELSE 0 END) AS pending_answer_count,
              SUM(CASE WHEN ans.id IS NOT NULL AND ans.ai_suggested_score IS NOT NULL THEN 1 ELSE 0 END) AS ai_suggested_count,
              SUM(CASE WHEN ans.id IS NOT NULL AND ans.grading_status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed_answer_count
            FROM matched_attempts ma
            LEFT JOIN student_answers ans ON ans.attempt_id = ma.attempt_id
            GROUP BY ma.attempt_id
            ORDER BY ma.submitted_at DESC, ma.student_name, ma.student_no, ma.attempt_id
            """,
            tuple(params),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def list_teacher_class_students_query(root: Path, *, class_id: str) -> list[dict[str, Any]]:
    with closing(connect(root)) as con, con:
        rows = con.execute(
            """
            SELECT s.id, s.student_no, s.display_name, s.email, s.status,
                   u.username AS account_username
            FROM class_students cs
            JOIN students s ON s.id = cs.student_id
            LEFT JOIN users u ON u.id = s.user_id
            WHERE cs.class_id = ?
            ORDER BY s.student_no, s.display_name, s.id
            """,
            (class_id,),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def resolve_teacher_class_student_query(
    students: list[dict[str, Any]],
    *,
    student_id: str | None = None,
    student_query: str | None = None,
) -> dict[str, Any]:
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


def teacher_student_profile_query(
    root: Path,
    *,
    class_id: str,
    user: dict[str, Any],
    student_id: str | None = None,
    student_query: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    resolve_student: Callable[..., dict[str, Any]],
    attempt_status_group: Callable[[dict[str, Any]], str],
    score_percent: Callable[[object, object], float | None],
) -> dict[str, Any]:
    student = resolve_student(
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
    if user.get("role") == "teacher":
        date_clause += " AND ep.teacher_id = ?"
        date_params += (str(user["id"]),)
    with closing(connect(root)) as con, con:
        attempt_rows = con.execute(
            f"""
            SELECT sa.id AS attempt_id, sa.status, sa.score, sa.max_score, sa.started_at,
                   sa.submitted_at, sa.time_spent_seconds, ep.id AS publication_id,
                   ep.submission_mode, pr.id AS paper_id, pr.exam_id, pr.title, COALESCE(ep.subject, pr.subject) AS subject,
                   (SELECT COUNT(*) FROM attempt_scan_images asi WHERE asi.attempt_id = sa.id) AS scan_image_count,
                   (SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id) AS integrity_event_count,
                   (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id) AS answer_count,
                   (SELECT COUNT(*) FROM student_answers aa WHERE aa.attempt_id = sa.id AND aa.score IS NULL) AS unscored_answer_count,
                   sa.question_payload_json, sa.answer_key_json, sa.grading_completed_at
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.student_id = ?
              AND EXISTS (
                SELECT 1 FROM publication_classes pc
                WHERE pc.publication_id = ep.id AND pc.class_id = ?
              )
              {date_clause}
            ORDER BY COALESCE(sa.submitted_at, sa.started_at, ep.created_at) DESC, sa.id
            """,
            (sid, class_id, *date_params),
        ).fetchall()
        weak_rows = con.execute(
            f"""
            SELECT sa.id AS attempt_id, pr.id AS paper_id, pr.title AS paper_title, ans.question_id,
                   ans.is_correct, ans.score,
                   COALESCE(sa.submitted_at, sa.started_at, ep.created_at) AS snapshot_seen_at
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
            ORDER BY pr.title, ans.question_id, snapshot_seen_at, sa.id
            """,
            (sid, class_id, *date_params),
        ).fetchall()
    recent = [row_to_dict(row) or {} for row in attempt_rows]
    snapshot_by_attempt: dict[str, tuple[Any, Any]] = {
        str(item["attempt_id"]): (item.get("question_payload_json"), item.get("answer_key_json"))
        for item in recent
        if item.get("attempt_id") is not None
    }
    read_context = FrozenQuestionReadContext()
    weak_groups: dict[tuple[str, str, str | None], dict[str, Any]] = {}
    versions_by_question: dict[tuple[str, str], dict[str, int]] = {}
    for row in weak_rows:
        paper_key = str(row["paper_id"])
        question_key = str(row["question_id"])
        attempt_id = str(row["attempt_id"])
        question_payload_json, answer_key_json = snapshot_by_attempt.get(attempt_id, (None, None))
        try:
            frozen = read_context.first_question(question_payload_json, question_key)
        except (TypeError, ValueError):
            frozen = None
        answer_key_known = False
        answer_key = None
        try:
            answer_key_known, answer_key = read_context.first_answer_key(
                answer_key_json,
                question_key,
            )
        except (TypeError, ValueError):
            pass
        definition_key = _weak_question_definition_key(
            frozen,
            answer_key_known=answer_key_known,
            answer_key=answer_key,
        )
        question_group_key = (paper_key, question_key)
        question_versions = versions_by_question.setdefault(question_group_key, {})
        question_version = None
        if definition_key is not None:
            if definition_key not in question_versions:
                question_versions[definition_key] = len(question_versions) + 1
            question_version = question_versions[definition_key]
        key = (paper_key, question_key, definition_key)
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
                "_definition_key": definition_key,
                "_question_version": question_version,
            },
        )
        group["attempt_count"] += 1
        if row["is_correct"] == 0:
            group["wrong_count"] += 1
        question_score = float(frozen.get("score_per_item") or 0.0) if frozen is not None else 0.0
        if frozen is not None:
            group["header"] = frozen.get("header")
            group["content"] = frozen.get("content")
            group["section_id"] = frozen.get("section_id")
            group["tags"] = list(frozen.get("tags") or [])
        if row["score"] is not None and question_score > 0:
            group["score_percentages"].append(float(row["score"]) / question_score * 100)
    weak_questions = []
    for group in weak_groups.values():
        if int(group["wrong_count"]) <= 0:
            continue
        version_key = (str(group["paper_id"]), str(group["question_id"]))
        version_count = len(versions_by_question.get(version_key, {}))
        definition_key = group.pop("_definition_key")
        question_version = group.pop("_question_version")
        group["question_version"] = question_version
        if definition_key is None:
            group["question_version_count"] = None
            group["question_version_label"] = "历史题目内容不可用"
        else:
            group["question_version_count"] = version_count
            group["question_version_label"] = (
                f"历史版本 {question_version}" if version_count > 1 else None
            )
        percentages_for_question = group.pop("score_percentages")
        group["average_score_percent"] = (
            round(sum(percentages_for_question) / len(percentages_for_question), 2)
            if percentages_for_question
            else None
        )
        weak_questions.append(group)
    weak_questions.sort(
        key=lambda item: (-int(item["wrong_count"]), -int(item["attempt_count"]), item["paper_title"], item["question_id"])
    )
    submitted = [item for item in recent if attempt_status_group(item) == "completed"]
    percentages = []
    for item in submitted:
        if not item.get("grading_completed_at"):
            continue
        percent = score_percent(item.get("score"), item.get("max_score"))
        if percent is not None:
            percentages.append(percent)
    question_counts: dict[str, int] = {}
    for item in recent:
        try:
            question_counts[str(item.get("attempt_id"))] = read_context.question_count(
                item.get("question_payload_json")
            )
        except (TypeError, ValueError):
            question_counts[str(item.get("attempt_id"))] = 0
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
                **{k: v for k, v in item.items() if k != "answer_key_json"},
                "score_percent": (
                    score_percent(item.get("score"), item.get("max_score"))
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
