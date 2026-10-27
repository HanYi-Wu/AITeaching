"""Frozen exam question reads and stable public snapshot identities."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from solaire.exam_compiler.loaders.questions import load_all_questions
from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.web.papers.frozen_question_reads import FrozenQuestionReadContext
from solaire.web.exam_service import _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.library_discovery import discover_question_library_refs
from solaire.web.platform_db import connect
from solaire.web.result_service import _flatten_questions


def _normalize_exam_question_refs(
    project_root: Path,
    exam_yaml: Path,
    refs: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Keep old exported exams publishable after their exam.yaml moved under exams/."""
    exam_dir = exam_yaml.resolve().parent
    resource_root = (project_root / "resource").resolve()
    normalized_refs: list[tuple[str, str]] = []
    for namespace, raw_path in refs:
        path = Path(raw_path)
        if path.is_absolute() or (exam_dir / path).resolve().is_dir():
            normalized_refs.append((namespace, raw_path))
            continue

        clean = raw_path.replace("\\", "/").lstrip("./")
        marker = "resource/"
        if marker in clean and resource_root.is_dir():
            suffix = clean.split(marker, 1)[1]
            candidate: Path | None = (resource_root / suffix).resolve()
            try:
                candidate.relative_to(resource_root)
            except ValueError:
                candidate = None
            if candidate is not None and candidate.is_dir():
                rel = os.path.relpath(candidate, exam_dir).replace("\\", "/")
                normalized_refs.append((namespace, rel))
                continue
        normalized_refs.append((namespace, raw_path))
    return normalized_refs


def _load_exam_question_payloads(project_root: Path, exam_id: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    exam_dir = workspace_dir(project_root, exam_id)
    exam_yaml = exam_dir / "exam.yaml"
    if not exam_yaml.is_file():
        raise FileNotFoundError(f"exam.yaml not found for: {exam_id}")

    exam = _load_exam_config(exam_yaml)
    flattened = _flatten_questions(exam)
    loaded = None
    refs = [(ref.namespace, ref.path) for ref in exam.question_libraries]
    if not refs:
        refs = [
            (str(ref["namespace"]), str(ref["path"]))
            for ref in discover_question_library_refs(project_root)
        ]
    if refs:
        refs = _normalize_exam_question_refs(project_root, exam_yaml, refs)
        loaded = load_all_questions(exam_yaml, refs)

    questions: list[dict[str, Any]] = []
    answer_keys: dict[str, str] = {}
    unresolved: list[str] = []
    for item in flattened:
        qid = item.question_id
        record = loaded.by_qualified.get(qid) if loaded is not None else None
        payload: dict[str, Any] = {
            "question_id": qid,
            "header": item.csv_header(),
            "section_id": item.section_id,
            "score_per_item": float(item.score_per_item),
            "type": "unknown",
            "content": qid,
            "options": None,
            "analysis": None,
        }
        if isinstance(record, QuestionItem):
            payload.update(
                {
                    "type": record.type,
                    "content": record.content,
                    "options": record.options if record.options else None,
                    "analysis": record.analysis,
                }
            )
            answer_keys[qid] = record.answer
        elif isinstance(record, QuestionGroupRecord):
            payload.update({"type": "group", "content": record.material, "options": None})
        else:
            unresolved.append(qid)
        questions.append(payload)
    if unresolved:
        preview = "、".join(unresolved[:3])
        suffix = " 等" if len(unresolved) > 3 else ""
        raise ValueError(f"题目内容未找到：{preview}{suffix}。请检查题库后重新发布试卷")
    from solaire.web.learning_progress.sources import freeze_question_bindings

    return freeze_question_bindings(project_root, questions), answer_keys


def _is_placeholder_question(payload: dict[str, Any]) -> bool:
    question_id = str(payload.get("question_id") or "").strip()
    content = str(payload.get("content") or "").strip()
    return not content or content == question_id or str(payload.get("type") or "").strip() in {"", "unknown"}


def _load_attempt_question_payloads(
    project_root: Path,
    attempt: dict[str, Any],
    *,
    root: Path | None = None,
    connection: sqlite3.Connection | None = None,
    read_context: FrozenQuestionReadContext | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    raw_questions = attempt.get("question_payload_json")
    raw_answers = attempt.get("answer_key_json")
    if raw_questions:
        try:
            if read_context is None:
                questions = json.loads(str(raw_questions))
                answer_keys = json.loads(str(raw_answers or "{}"))
            else:
                questions, answer_keys = read_context.load_payload(raw_questions, raw_answers)
        except json.JSONDecodeError as exc:
            raise ValueError("Personalized question payload is invalid") from exc
        if not isinstance(questions, list) or not all(isinstance(item, dict) for item in questions):
            raise ValueError("Personalized question payload is invalid")
        if not isinstance(answer_keys, dict):
            raise ValueError("Personalized answer key is invalid")
        normalized_answers = {str(key): str(value) for key, value in answer_keys.items()}
        has_placeholder = any(_is_placeholder_question(item) for item in questions)
        practice_metadata = str(attempt.get("practice_metadata_json") or "").strip()
        is_personalized = practice_metadata not in {"", "null", "{}"}
        payload_version = int(attempt.get("question_payload_version") or 1)
        needs_legacy_score_repair = not is_personalized and payload_version < 2
        needs_legacy_analysis_repair = not is_personalized and payload_version < 3
        if has_placeholder or needs_legacy_score_repair or needs_legacy_analysis_repair:
            try:
                source_questions, source_answers = _load_exam_question_payloads(
                    project_root,
                    str(attempt["exam_id"]),
                )
            except (FileNotFoundError, ValueError):
                if has_placeholder:
                    raise
                return questions, normalized_answers
            source_by_id = {str(item.get("question_id")): item for item in source_questions}
            repaired_questions: list[dict[str, Any]] = []
            repaired_answers = dict(normalized_answers)
            for item in questions:
                question_id = str(item.get("question_id") or "")
                source = source_by_id.get(question_id)
                if _is_placeholder_question(item):
                    if source is None:
                        raise ValueError(f"题目内容未找到：{question_id}")
                    repaired = dict(source)
                    for frozen_key in ("header", "section_id"):
                        if item.get(frozen_key) is not None:
                            repaired[frozen_key] = item[frozen_key]
                else:
                    repaired = dict(item)
                    if source is not None and needs_legacy_score_repair:
                        repaired["score_per_item"] = source.get("score_per_item", item.get("score_per_item"))
                    if source is not None and needs_legacy_analysis_repair:
                        repaired["analysis"] = source.get("analysis", item.get("analysis"))
                repaired_questions.append(repaired)
                if question_id in source_answers and (has_placeholder or question_id not in repaired_answers):
                    repaired_answers[question_id] = source_answers[question_id]
            repaired_json = json.dumps(repaired_questions, ensure_ascii=False)
            answers_json = json.dumps(repaired_answers, ensure_ascii=False)
            canonical_max = round(
                sum(float(item.get("score_per_item") or 0.0) for item in repaired_questions),
                2,
            )
            current_max = float(attempt.get("max_score") or 0.0)
            needs_update = (
                repaired_questions != questions
                or repaired_answers != normalized_answers
                or (attempt.get("status") == "submitted" and current_max != canonical_max)
                or payload_version < 3
            )
            if attempt.get("id") and needs_update:
                update_sql = """
                    UPDATE student_attempts
                    SET question_payload_json = ?, answer_key_json = ?,
                        max_score = CASE WHEN status = 'submitted' THEN ? ELSE max_score END,
                        question_payload_version = 3
                    WHERE id = ? AND question_payload_json = ?
                    """
                update_params = (
                    repaired_json,
                    answers_json,
                    canonical_max,
                    str(attempt["id"]),
                    str(raw_questions),
                )
                if connection is not None:
                    connection.execute(update_sql, update_params)
                elif root is not None:
                    with connect(root) as con:
                        con.execute(update_sql, update_params)
            return repaired_questions, repaired_answers
        return questions, normalized_answers
    return _load_exam_question_payloads(project_root, str(attempt["exam_id"]))


def public_snapshot_identity(questions: list[dict[str, Any]]) -> str:
    """Identify effective student-visible questions without hashing answer secrets."""
    public_questions = [
        {key: value for key, value in question.items()
         if key not in {"analysis", "answer", "correct_answer"}}
        for question in questions
    ]
    canonical = json.dumps(public_questions, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"), allow_nan=False)
    return "questions-v1:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def project_scope_identity(project_root: Path) -> str:
    canonical = os.path.normcase(str(project_root.resolve()))
    return "project-v1:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
