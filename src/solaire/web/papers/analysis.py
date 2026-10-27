"""Question, module, class, and radar calculations for paper analysis."""

from __future__ import annotations

import json
from contextlib import nullcontext
from collections.abc import Callable
from pathlib import Path
from typing import Any

from solaire.web.papers.visibility import attempt_access_clause
from solaire.web.papers.frozen_question_reads import FrozenQuestionReadContext
from solaire.web.platform_db import connect, row_to_dict


def risk_level(value: float | None) -> str:
    if value is None:
        return "no_data"
    if value < 60:
        return "high"
    if value < 75:
        return "medium"
    return "low"


def analysis_attempt_clause(
    user: dict[str, Any],
    publication_id: str | None,
    *,
    attempt_alias: str = "sa",
    class_id: str | None = None,
    attempt_access_clause_fn: Callable[..., tuple[str, list[str]]] = attempt_access_clause,
) -> tuple[str, list[str]]:
    clause, params = attempt_access_clause_fn(user, attempt_alias=attempt_alias)
    if publication_id:
        clause = f"({clause}) AND {attempt_alias}.publication_id = ?"
        params = [*params, publication_id]
    if class_id:
        clause = (
            f"({clause}) AND EXISTS (SELECT 1 FROM publication_classes filter_pc "
            f"JOIN class_students filter_cs ON filter_cs.class_id = filter_pc.class_id "
            f"JOIN exam_publications filter_ep ON filter_ep.id = filter_pc.publication_id "
            f"WHERE filter_pc.publication_id = {attempt_alias}.publication_id "
            f"AND filter_ep.recipient_scope = 'class' "
            f"AND filter_pc.class_id = ? AND filter_cs.student_id = "
            f"{attempt_alias}.student_id)"
        )
        params = [*params, class_id]
    return clause, params


def analysis_question_maps(
    root: Path,
    project_root: Path,
    paper: dict[str, Any],
    user: dict[str, Any],
    publication_id: str | None,
    class_id: str | None = None,
    *,
    attempt_clause_fn: Callable[..., tuple[str, list[str]]],
    question_maps_fn: Callable[[Path, dict[str, Any]], tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]],
    read_context: FrozenQuestionReadContext | None = None,
    snapshot_rows: list[Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
    # Published snapshots, not the editable source, define historical exam content.
    clause, params = attempt_clause_fn(user, publication_id, class_id=class_id)
    if snapshot_rows is None:
        with connect(root) as con:
            snapshot_rows = con.execute(
                f"SELECT sa.question_payload_json FROM student_attempts sa "
                f"JOIN exam_publications ep ON ep.id=sa.publication_id WHERE ep.paper_id=? AND {clause} ORDER BY sa.rowid",
                (paper["id"], *params),
            ).fetchall()
    by_id: dict[str, dict[str, Any]] = {}
    for row in snapshot_rows:
        if read_context is not None:
            try:
                _questions, snapshot_by_id, _scores = read_context.first_questions(
                    row["question_payload_json"]
                )
            except (TypeError, json.JSONDecodeError):
                continue
            for question_id, question in snapshot_by_id.items():
                by_id.setdefault(question_id, question)
            continue
        try:
            payload = json.loads(row["question_payload_json"] or "[]")
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(payload, list):
            for question in payload:
                if isinstance(question, dict) and question.get("question_id"):
                    by_id.setdefault(str(question["question_id"]), question)
    if by_id:
        return list(by_id.values()), by_id, {
            qid: float(question.get("score_per_item") or 0)
            for qid, question in by_id.items()
        }
    return question_maps_fn(project_root, paper)


def build_module_report(
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
    question_maps_fn: Callable[..., Any],
    attempt_clause_fn: Callable[..., tuple[str, list[str]]],
    json_payload_fn: Callable[[object], dict[str, Any]],
    risk_level_fn: Callable[[float | None], str],
    read_context: FrozenQuestionReadContext | None = None,
    question_data: tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]] | None = None,
    answer_rows: list[Any] | None = None,
) -> list[dict[str, Any]]:
    if project_root is None:
        return []
    try:
        question_map_args = (root, project_root, paper, user, publication_id, class_id)
        if question_data is not None:
            questions, _by_id, score_by_id = question_data
        elif read_context is None:
            questions, _by_id, score_by_id = question_maps_fn(*question_map_args)
        else:
            questions, _by_id, score_by_id = question_maps_fn(*question_map_args, read_context)
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

    access_clause, access_params = attempt_clause_fn(user, publication_id, class_id=class_id)
    if answer_rows is None:
        with connect(root) as con:
            answer_rows = con.execute(
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

    for row in answer_rows:
        question_id = str(row["question_id"] or "")
        module_id = question_module.get(question_id)
        if not module_id:
            continue
        item = modules[module_id]
        payload = json_payload_fn(row["answer_payload"])
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
        item["risk_level"] = risk_level_fn(average_score_percent)
        out.append(item)
    return sorted(out, key=lambda value: str(value.get("module_id") or ""))


def build_question_report(
    root: Path,
    *,
    paper_id: str,
    project_root: Path | None,
    paper: dict[str, Any],
    user: dict[str, Any],
    publication_id: str | None = None,
    class_id: str | None = None,
    question_maps_fn: Callable[..., Any],
    attempt_clause_fn: Callable[..., tuple[str, list[str]]],
    json_payload_fn: Callable[[object], dict[str, Any]],
    risk_level_fn: Callable[[float | None], str],
    read_context: FrozenQuestionReadContext | None = None,
    question_data: tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]] | None = None,
    answer_rows: list[Any] | None = None,
) -> list[dict[str, Any]]:
    if project_root is None:
        return []
    try:
        question_map_args = (root, project_root, paper, user, publication_id, class_id)
        if question_data is not None:
            questions, _by_id, score_by_id = question_data
        elif read_context is None:
            questions, _by_id, score_by_id = question_maps_fn(*question_map_args)
        else:
            questions, _by_id, score_by_id = question_maps_fn(*question_map_args, read_context)
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

    access_clause, access_params = attempt_clause_fn(user, publication_id, class_id=class_id)
    if answer_rows is None:
        with connect(root) as con:
            answer_rows = con.execute(
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

    for row in answer_rows:
        question_id = str(row["question_id"] or "")
        item = reports.get(question_id)
        if item is None:
            continue
        payload = json_payload_fn(row["answer_payload"])
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
        item["risk_level"] = risk_level_fn(
            average_score_percent if average_score_percent is not None else accuracy_rate
        )
        out.append(item)
    out = sorted(out, key=lambda value: int(value.get("_order") or 0))
    for item in out:
        item.pop("_order", None)
    return out


def build_class_report(
    root: Path,
    *,
    paper_id: str,
    user: dict[str, Any],
    publication_id: str | None = None,
    class_id: str | None = None,
    attempt_clause_fn: Callable[..., tuple[str, list[str]]],
    attempt_status_group_fn: Callable[[dict[str, Any]], str],
    score_percent_fn: Callable[[object, object], float | None],
    connection: Any = None,
) -> list[dict[str, Any]]:
    access_clause, access_params = attempt_clause_fn(user, publication_id, class_id=class_id)
    with (nullcontext(connection) if connection is not None else connect(root)) as con:
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
        class_key = str(row["class_id"] or "")
        if not class_key:
            continue
        item = classes.setdefault(
            class_key,
            {
                "class_id": class_key,
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
        status_group = attempt_status_group_fn(row_to_dict(row) or {})
        if status_group == "completed":
            item["completed_count"] = int(item["completed_count"]) + 1
        elif status_group == "in_progress":
            item["in_progress_count"] = int(item["in_progress_count"]) + 1
        else:
            item["not_started_count"] = int(item["not_started_count"]) + 1
        score_percent = (
            score_percent_fn(row["score"], row["max_score"])
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


def build_radar(
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
