"""Student-side online exam services."""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from solaire.exam_compiler.loaders.questions import load_all_questions
from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.web.auth_service import utc_now
from solaire.web.exam_service import _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.library_discovery import discover_question_library_refs
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.result_service import _flatten_questions


PROCTOR_EVENT_TYPES = {
    "visibility_hidden",
    "window_blur",
    "fullscreen_exit",
    "copy",
    "paste",
    "context_menu",
}
MAX_ANSWERS_PER_REQUEST = 200
MAX_ANSWER_TEXT_LENGTH = 100_000
MAX_IMAGES_PER_ANSWER = 10
MAX_IMAGE_DATA_URL_LENGTH = 5_000_000
MAX_ANSWER_BATCH_BYTES = 20_000_000
MAX_PROCTOR_EVENTS_PER_ATTEMPT = 1_000
MAX_PROCTOR_EVENTS_PER_MINUTE = 120


def _new_id() -> str:
    return uuid.uuid4().hex


def _parse_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _publication_availability(row: dict[str, Any]) -> tuple[bool, str | None]:
    status = str(row.get("publication_status") or row.get("status") or "")
    if status != "published":
        return False, "Publication is not open"
    now = datetime.now(UTC)
    start_at = _parse_datetime(row.get("start_at"))
    if start_at is not None and now < start_at:
        return False, "Publication has not started"
    end_at = _parse_datetime(row.get("end_at"))
    if end_at is not None and now > end_at:
        return False, "Publication has ended"
    return True, None


def _time_limit_exceeded(row: dict[str, Any]) -> bool:
    limit_minutes = int(row.get("time_limit_minutes") or 0)
    if limit_minutes <= 0:
        return False
    started_at = _parse_datetime(row.get("started_at"))
    if started_at is None:
        return False
    return datetime.now(UTC) > started_at + timedelta(minutes=limit_minutes)


def _remaining_seconds(row: dict[str, Any]) -> int | None:
    limit_minutes = int(row.get("time_limit_minutes") or 0)
    if limit_minutes <= 0:
        return None
    started_at = _parse_datetime(row.get("started_at"))
    if started_at is None:
        return limit_minutes * 60
    return max(0, int((started_at + timedelta(minutes=limit_minutes) - datetime.now(UTC)).total_seconds()))


def _ensure_attempt_can_collect(row: dict[str, Any]) -> None:
    can_answer, reason = _publication_availability(row)
    if not can_answer:
        raise ValueError(reason or "Publication is not open")
    if _time_limit_exceeded(row):
        raise ValueError("Time limit exceeded")


def _ensure_attempt_can_submit(row: dict[str, Any]) -> None:
    can_submit, reason = _publication_availability(row)
    if not can_submit:
        raise ValueError(reason or "Publication is not open")


def _student_for_user(root: Path, user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "student":
        raise PermissionError("Student role required")
    init_platform_db(root)
    with connect(root) as con:
        row = con.execute(
            """
            SELECT s.*, u.username AS account_username
            FROM students s
            JOIN users u ON u.id = s.user_id
            WHERE s.user_id = ? AND s.status = 'active' AND u.status = 'active'
            """,
            (str(user["id"]),),
        ).fetchone()
    student = row_to_dict(row)
    if student is None:
        raise PermissionError("Active student profile required")
    return student


def _normalise_answer(value: object, qtype: str | None = None) -> str:
    text = str(value or "").strip()
    if qtype in {"single_choice", "multiple_choice", "choice", "judge"}:
        chars = [ch for ch in text.upper() if ch.isalnum()]
        if qtype in {"multiple_choice"}:
            return "".join(sorted(dict.fromkeys(chars)))
        return "".join(chars)
    return " ".join(text.split()).lower()


def _score_percent(score: object, max_score: object) -> float | None:
    if score is None:
        return None
    try:
        raw = float(score)
        max_raw = float(max_score or 0)
    except (TypeError, ValueError):
        return None
    if max_raw <= 0:
        return round(raw, 2)
    return round(raw / max_raw * 100, 2)


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
        }
        if isinstance(record, QuestionItem):
            payload.update(
                {
                    "type": record.type,
                    "content": record.content,
                    "options": record.options if record.options else None,
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
    return questions, answer_keys


def _is_placeholder_question(payload: dict[str, Any]) -> bool:
    question_id = str(payload.get("question_id") or "").strip()
    content = str(payload.get("content") or "").strip()
    return not content or content == question_id or str(payload.get("type") or "").strip() in {"", "unknown"}


def _load_attempt_question_payloads(
    project_root: Path,
    attempt: dict[str, Any],
    *,
    root: Path | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    raw_questions = attempt.get("question_payload_json")
    raw_answers = attempt.get("answer_key_json")
    if raw_questions:
        try:
            questions = json.loads(str(raw_questions))
            answer_keys = json.loads(str(raw_answers or "{}"))
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
        if has_placeholder or needs_legacy_score_repair:
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
                or payload_version < 2
            )
            if root is not None and attempt.get("id") and needs_update:
                with connect(root) as con:
                    con.execute(
                        """
                        UPDATE student_attempts
                        SET question_payload_json = ?, answer_key_json = ?,
                            max_score = CASE WHEN status = 'submitted' THEN ? ELSE max_score END,
                            question_payload_version = 2
                        WHERE id = ? AND question_payload_json = ?
                        """,
                        (repaired_json, answers_json, canonical_max, str(attempt["id"]), str(raw_questions)),
                    )
            return repaired_questions, repaired_answers
        return questions, normalized_answers
    return _load_exam_question_payloads(project_root, str(attempt["exam_id"]))


def _saved_answer_payloads(root: Path, attempt_id: str) -> list[dict[str, Any]]:
    with connect(root) as con:
        rows = con.execute(
            "SELECT question_id, answer_payload FROM student_answers WHERE attempt_id = ? ORDER BY responded_at, question_id",
            (attempt_id,),
        ).fetchall()
    saved: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(str(row["answer_payload"] or "{}"))
        except json.JSONDecodeError:
            payload = {}
        images = payload.get("images")
        saved.append(
            {
                "question_id": str(row["question_id"]),
                "answer": payload.get("answer"),
                "images": images if isinstance(images, list) else [],
            }
        )
    return saved


def _ensure_assigned_attempt(root: Path, publication_id: str, student_id: str) -> dict[str, Any]:
    with connect(root) as con:
        publication = con.execute(
            """
            SELECT ep.*, pr.exam_id, pr.title AS paper_title, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id
            FROM exam_publications ep
            JOIN paper_records pr ON pr.id = ep.paper_id
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN class_students cs ON cs.class_id = pc.class_id
            WHERE ep.id = ? AND cs.student_id = ? AND ep.status IN ('published', 'paused', 'closed')
            LIMIT 1
            """,
            (publication_id, student_id),
        ).fetchone()
        if publication is None:
            raise PermissionError("No assigned publication for this student")
        if publication["practice_kind"]:
            assigned = con.execute(
                "SELECT 1 FROM student_attempts WHERE publication_id = ? AND student_id = ?",
                (publication_id, student_id),
            ).fetchone()
            if assigned is None:
                raise PermissionError("No personalized practice assigned for this student")
        else:
            con.execute(
                """
                INSERT OR IGNORE INTO student_attempts (id, publication_id, student_id, status)
                VALUES (?, ?, ?, 'not_started')
                """,
                (_new_id(), publication_id, student_id),
            )
        row = con.execute(
            """
            SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
                   ep.submission_mode, ep.max_screen_switches, ep.start_at, ep.end_at, ep.time_limit_minutes,
                   pr.exam_id, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id, pr.title AS paper_title,
                   COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'), 0) AS screen_switch_count
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.publication_id = ? AND sa.student_id = ?
            """,
            (publication_id, student_id),
        ).fetchone()
    attempt = row_to_dict(row)
    if attempt is None:
        raise RuntimeError("failed to create student attempt")
    return attempt


def _attempt_for_student(root: Path, attempt_id: str, student_id: str) -> dict[str, Any]:
    with connect(root) as con:
        attempt = _attempt_for_student_in_connection(con, attempt_id, student_id)
    return attempt


def _attempt_for_student_in_connection(con: Any, attempt_id: str, student_id: str) -> dict[str, Any]:
    row = con.execute(
        """
        SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
               ep.submission_mode, ep.max_screen_switches, ep.start_at, ep.end_at, ep.time_limit_minutes,
               pr.exam_id, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id, pr.title AS paper_title,
               COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'), 0) AS screen_switch_count
        FROM student_attempts sa
        JOIN exam_publications ep ON ep.id = sa.publication_id
        JOIN paper_records pr ON pr.id = ep.paper_id
        WHERE sa.id = ? AND sa.student_id = ?
        """,
        (attempt_id, student_id),
    ).fetchone()
    attempt = row_to_dict(row)
    if attempt is None:
        raise PermissionError("No permission for this attempt")
    return attempt


def _attempt_payload(row: dict[str, Any]) -> dict[str, Any]:
    results_released = bool(row.get("grading_completed_at"))
    payload = {
        "id": row["id"],
        "publication_id": row["publication_id"],
        "paper_id": row["paper_id"],
        "exam_id": row["exam_id"],
        "title": row.get("title") or row.get("paper_title"),
        "subject": row.get("subject"),
        "status": row.get("status"),
        "started_at": row.get("started_at"),
        "submitted_at": row.get("submitted_at"),
        "score": row.get("score") if results_released else None,
        "max_score": row.get("max_score") if results_released else None,
        "score_percent": _score_percent(row.get("score"), row.get("max_score")) if results_released else None,
        "time_spent_seconds": int(row.get("time_spent_seconds") or 0),
        # A stored/AI score is only a draft until a teacher explicitly finishes
        # the whole submission.  Publication timing must never expose it early.
        "show_results": results_released,
        "results_released": results_released,
        "grading_completed_at": row.get("grading_completed_at"),
        "submission_mode": row.get("submission_mode") or "online",
        "publication_status": row.get("publication_status"),
        "start_at": row.get("start_at"),
        "end_at": row.get("end_at"),
        "time_limit_minutes": int(row["time_limit_minutes"]) if row.get("time_limit_minutes") is not None else None,
        "can_answer": _publication_availability(row)[0]
        and (not _time_limit_exceeded(row) or str(row.get("status")) == "in_progress"),
        "remaining_seconds": _remaining_seconds(row),
    }
    if row.get("practice_metadata_json"):
        try:
            metadata = json.loads(str(row["practice_metadata_json"]))
        except json.JSONDecodeError:
            metadata = None
        if isinstance(metadata, dict):
            payload["practice_metadata"] = metadata
    return payload


def list_student_papers(root: Path, project_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    student = _student_for_user(root, user)
    student_id = str(student["id"])
    with connect(root) as con:
        pub_rows = con.execute(
            """
            SELECT DISTINCT ep.id
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN class_students cs ON cs.class_id = pc.class_id
            WHERE cs.student_id = ? AND ep.status IN ('published', 'paused', 'closed')
              AND (
                ep.practice_kind IS NULL
                OR EXISTS (
                  SELECT 1 FROM student_attempts assigned
                  WHERE assigned.publication_id = ep.id AND assigned.student_id = cs.student_id
                )
              )
            ORDER BY ep.created_at DESC
            """,
            (student_id,),
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in pub_rows:
        attempt = _ensure_assigned_attempt(root, str(row["id"]), student_id)
        payload = _attempt_payload(attempt)
        try:
            questions, _answers = _load_attempt_question_payloads(project_root, attempt, root=root)
            question_count = len(questions)
        except Exception:
            question_count = 0
        payload.update(
            {
                "publication_id": attempt["publication_id"],
                "attempt_id": attempt["id"],
                "question_count": question_count,
            }
        )
        items.append(payload)
    return items


def start_student_publication(
    root: Path,
    project_root: Path,
    *,
    publication_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _ensure_assigned_attempt(root, publication_id, str(student["id"]))
    if str(attempt.get("status")) != "submitted":
        if str(attempt.get("status")) == "in_progress" and _time_limit_exceeded(attempt):
            # Let a student recover the frozen questions and saved draft after a
            # browser crash; the zero-second client timer will atomically submit it.
            _ensure_attempt_can_submit(attempt)
        else:
            _ensure_attempt_can_collect(attempt)
    now = utc_now()
    if str(attempt.get("status")) == "not_started":
        with connect(root) as con:
            con.execute(
                "UPDATE student_attempts SET status = 'in_progress', started_at = ? WHERE id = ?",
                (now, attempt["id"]),
            )
        attempt = _attempt_for_student(root, str(attempt["id"]), str(student["id"]))
    questions, _answers = _load_attempt_question_payloads(project_root, attempt, root=root)
    return {
        "attempt": _attempt_payload(attempt),
        "questions": questions,
        "saved_answers": _saved_answer_payloads(root, str(attempt["id"])),
    }


def save_student_answers(
    root: Path,
    project_root: Path,
    *,
    attempt_id: str,
    user: dict[str, Any],
    answers: list[dict[str, Any]],
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    initial_attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    questions, _answer_keys = _load_attempt_question_payloads(project_root, initial_attempt, root=root)
    _validate_answer_batch(answers, {str(item.get("question_id")) for item in questions})
    now = utc_now()
    rows, cleared_question_ids = _prepare_answer_mutations(attempt_id, answers, now)
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        attempt = _attempt_for_student_in_connection(con, attempt_id, str(student["id"]))
        if str(attempt.get("status")) == "submitted":
            raise ValueError("Attempt already submitted")
        _ensure_attempt_can_collect(attempt)
        _write_answer_mutations(con, attempt_id, rows, cleared_question_ids)
    return {"answer_count": len(rows)}


def _prepare_answer_mutations(
    attempt_id: str,
    answers: list[dict[str, Any]],
    now: str,
) -> tuple[list[tuple[object, ...]], list[str]]:
    rows: list[tuple[object, ...]] = []
    cleared_question_ids: list[str] = []
    for answer in answers:
        qid = str(answer.get("question_id") or "").strip()
        if not qid:
            continue
        payload: dict[str, Any] = {}
        if "answer" in answer:
            raw_answer = answer.get("answer")
            if raw_answer is not None and str(raw_answer).strip():
                payload["answer"] = raw_answer
        images = answer.get("images")
        if isinstance(images, list):
            clean_images = [
                {
                    "name": str(item.get("name") or "image") if isinstance(item, dict) else "image",
                    "mime_type": str(item.get("mime_type") or "") if isinstance(item, dict) else "",
                    "data_url": str(item.get("data_url") or "") if isinstance(item, dict) else "",
                }
                for item in images
                if isinstance(item, dict) and str(item.get("data_url") or "").strip()
            ]
            if clean_images:
                payload["images"] = clean_images
        if not payload:
            cleared_question_ids.append(qid)
            continue
        rows.append((_new_id(), attempt_id, qid, json.dumps(payload, ensure_ascii=False), now))
    return rows, cleared_question_ids


def _validate_answer_batch(answers: list[dict[str, Any]], allowed_question_ids: set[str]) -> None:
    if len(answers) > MAX_ANSWERS_PER_REQUEST:
        raise ValueError("Too many answers in one request")
    serialized_size = len(json.dumps(answers, ensure_ascii=False).encode("utf-8"))
    if serialized_size > MAX_ANSWER_BATCH_BYTES:
        raise ValueError("Answer payload is too large")
    seen: set[str] = set()
    for item in answers:
        qid = str(item.get("question_id") or "").strip()
        if qid not in allowed_question_ids:
            raise ValueError(f"Question does not belong to this attempt: {qid or '(empty)'}")
        if qid in seen:
            raise ValueError(f"Duplicate answer for question: {qid}")
        seen.add(qid)
        answer = item.get("answer")
        if answer is not None and len(str(answer)) > MAX_ANSWER_TEXT_LENGTH:
            raise ValueError("Answer text is too large")
        images = item.get("images")
        if images is None:
            continue
        if not isinstance(images, list) or len(images) > MAX_IMAGES_PER_ANSWER:
            raise ValueError("Too many answer images")
        for image in images:
            if not isinstance(image, dict):
                raise ValueError("Answer image is invalid")
            if len(str(image.get("data_url") or "")) > MAX_IMAGE_DATA_URL_LENGTH:
                raise ValueError("Answer image is too large")


def _write_answer_mutations(
    con: Any,
    attempt_id: str,
    rows: list[tuple[object, ...]],
    cleared_question_ids: list[str],
) -> None:
    if cleared_question_ids:
        con.executemany(
            "DELETE FROM student_answers WHERE attempt_id = ? AND question_id = ?",
            [(attempt_id, question_id) for question_id in cleared_question_ids],
        )
    if rows:
        con.executemany(
            """
            INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, responded_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(attempt_id, question_id) DO UPDATE SET
              answer_payload = excluded.answer_payload,
              responded_at = excluded.responded_at,
              is_correct = NULL,
              score = NULL,
              grading_status = 'pending',
              feedback = NULL,
              ai_suggested_score = NULL,
              ai_feedback = NULL,
              ai_ocr_text = NULL,
              graded_by = NULL,
              graded_at = NULL
            """,
            rows,
        )


def record_student_proctor_event(
    root: Path,
    *,
    attempt_id: str,
    user: dict[str, Any],
    event_type: str,
    duration_ms: int | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    if str(attempt.get("status")) != "in_progress":
        raise ValueError("Proctor events require an in-progress attempt")
    now = utc_now()
    event_id = _new_id()
    clean_type = event_type.strip() or "unknown"
    if clean_type not in PROCTOR_EVENT_TYPES:
        raise ValueError(f"Unsupported proctor event type: {clean_type}")
    clean_duration = int(duration_ms or 0)
    if clean_duration < 0 or clean_duration > 86_400_000:
        raise ValueError("Proctor event duration is out of range")
    payload_json = json.dumps(payload or {}, ensure_ascii=False, sort_keys=True)
    if len(payload_json.encode("utf-8")) > 4096:
        raise ValueError("Proctor event payload is too large")
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        current = _attempt_for_student_in_connection(con, attempt_id, str(student["id"]))
        if str(current.get("status")) != "in_progress":
            raise ValueError("Proctor events require an in-progress attempt")
        total_count = int(
            con.execute("SELECT COUNT(*) FROM proctor_events WHERE attempt_id = ?", (attempt_id,)).fetchone()[0]
        )
        if total_count >= MAX_PROCTOR_EVENTS_PER_ATTEMPT:
            raise ValueError("Proctor event limit exceeded")
        recent_count = int(
            con.execute(
                "SELECT COUNT(*) FROM proctor_events WHERE attempt_id = ? AND datetime(occurred_at) >= datetime('now', '-1 minute')",
                (attempt_id,),
            ).fetchone()[0]
        )
        if recent_count >= MAX_PROCTOR_EVENTS_PER_MINUTE:
            raise ValueError("Proctor event rate limit exceeded")
        previous = con.execute(
            """
            SELECT * FROM proctor_events
            WHERE attempt_id = ? AND event_type = ? AND payload_json = ?
            ORDER BY occurred_at DESC LIMIT 1
            """,
            (attempt_id, clean_type, payload_json),
        ).fetchone()
        previous_payload = row_to_dict(previous)
        if previous_payload is not None:
            occurred_at = _parse_datetime(previous_payload.get("occurred_at"))
            if occurred_at is not None and (datetime.now(UTC) - occurred_at).total_seconds() < 2:
                previous_payload["deduplicated"] = True
                return previous_payload
        con.execute(
            """
            INSERT INTO proctor_events (
              id, attempt_id, student_id, publication_id, event_type, occurred_at, duration_ms, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                attempt_id,
                student["id"],
                attempt["publication_id"],
                clean_type,
                now,
                clean_duration,
                payload_json,
            ),
        )
        row = con.execute("SELECT * FROM proctor_events WHERE id = ?", (event_id,)).fetchone()
    event = row_to_dict(row)
    if event is None:
        raise RuntimeError("failed to record proctor event")
    return event


def submit_student_attempt(
    root: Path,
    project_root: Path,
    *,
    attempt_id: str,
    user: dict[str, Any],
    time_spent_seconds: int | None = None,
    answers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    student = _student_for_user(root, user)
    attempt = _attempt_for_student(root, attempt_id, str(student["id"]))
    if str(attempt.get("status")) == "submitted":
        return _attempt_payload(attempt)
    # An expired timer blocks further answer edits, but the client must still be
    # able to finalize the saved answers when its countdown reaches zero.
    _ensure_attempt_can_submit(attempt)
    questions, answer_keys = _load_attempt_question_payloads(project_root, attempt, root=root)
    if answers is not None:
        _validate_answer_batch(answers, {str(item.get("question_id")) for item in questions})
    qtype_by_id = {str(q["question_id"]): str(q.get("type") or "") for q in questions}
    score_by_id = {str(q["question_id"]): float(q.get("score_per_item") or 0) for q in questions}
    max_score = round(sum(score_by_id.values()), 2)

    now = utc_now()
    submitted_rows, cleared_question_ids = _prepare_answer_mutations(attempt_id, answers or [], now)
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        attempt = _attempt_for_student_in_connection(con, attempt_id, str(student["id"]))
        if str(attempt.get("status")) == "submitted":
            return _attempt_payload(attempt)
        _ensure_attempt_can_submit(attempt)
        if answers is not None:
            _write_answer_mutations(con, attempt_id, submitted_rows, cleared_question_ids)
        answer_rows = con.execute(
            "SELECT * FROM student_answers WHERE attempt_id = ?",
            (attempt_id,),
        ).fetchall()
        answers: dict[str, Any] = {}
        for row in answer_rows:
            try:
                payload = json.loads(str(row["answer_payload"] or "{}"))
            except json.JSONDecodeError:
                payload = {}
            answers[str(row["question_id"])] = payload.get("answer")

        scored_any = False
        total = 0.0
        for qid, raw_answer in answers.items():
            expected = answer_keys.get(qid)
            qtype = qtype_by_id.get(qid)
            if expected is None or raw_answer is None or str(raw_answer).strip() == "":
                is_correct = None
                score = None
            else:
                is_correct_bool = _normalise_answer(raw_answer, qtype) == _normalise_answer(expected, qtype)
                is_correct = 1 if is_correct_bool else 0
                score = score_by_id.get(qid, 0.0) if is_correct_bool else 0.0
                total += float(score)
                scored_any = True
            con.execute(
                "UPDATE student_answers SET is_correct = ?, score = ?, grading_status = ? WHERE attempt_id = ? AND question_id = ?",
                (is_correct, score, "auto_scored" if score is not None else "pending", attempt_id, qid),
            )
        submitted_at = _parse_datetime(now) or datetime.now(UTC)
        started_at = _parse_datetime(attempt.get("started_at"))
        if started_at is None:
            authoritative_time_spent = 0
        else:
            authoritative_time_spent = max(0, int((submitted_at - started_at).total_seconds()))
            time_limit_seconds = max(0, int(attempt.get("time_limit_minutes") or 0)) * 60
            if time_limit_seconds:
                authoritative_time_spent = min(authoritative_time_spent, time_limit_seconds)
        final_score: float | None = round(total, 2) if scored_any else None
        if not attempt.get("started_at"):
            con.execute("UPDATE student_attempts SET started_at = ? WHERE id = ?", (now, attempt_id))
        con.execute(
            """
            UPDATE student_attempts
            SET status = 'submitted', submitted_at = ?, score = ?, max_score = ?, time_spent_seconds = ?
            WHERE id = ?
            """,
            (now, final_score, max_score, authoritative_time_spent, attempt_id),
        )
    return _attempt_payload(_attempt_for_student(root, attempt_id, str(student["id"])))


def list_student_results(root: Path, project_root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    student = _student_for_user(root, user)
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT sa.*, ep.title, ep.description, ep.status AS publication_status, ep.show_results_immediately,
                   ep.submission_mode, ep.max_screen_switches, ep.start_at, ep.end_at, ep.time_limit_minutes,
                   pr.exam_id, COALESCE(ep.subject, pr.subject) AS subject, pr.id AS paper_id, pr.title AS paper_title,
                   COALESCE((SELECT COUNT(*) FROM proctor_events pe WHERE pe.attempt_id = sa.id AND pe.event_type = 'visibility_hidden'), 0) AS screen_switch_count,
                   COALESCE((SELECT SUM(duration_ms) FROM proctor_events pe WHERE pe.attempt_id = sa.id), 0) AS screen_switch_duration_ms
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records pr ON pr.id = ep.paper_id
            WHERE sa.student_id = ? AND (sa.status = 'submitted' OR sa.submitted_at IS NOT NULL)
            ORDER BY sa.submitted_at DESC
            """,
            (str(student["id"]),),
        ).fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        attempt = row_to_dict(row) or {}
        payload = _attempt_payload(attempt)
        show_results = bool(payload["show_results"])
        question_order: list[str] = []
        question_by_id: dict[str, dict[str, Any]] = {}
        try:
            questions, _answer_keys = _load_attempt_question_payloads(project_root, attempt, root=root)
            question_order = [str(q["question_id"]) for q in questions]
            question_by_id = {str(q["question_id"]): q for q in questions}
        except Exception:
            pass
        with connect(root) as con:
            answer_rows = con.execute(
                "SELECT * FROM student_answers WHERE attempt_id = ?",
                (attempt["id"],),
            ).fetchall()
        answers: list[dict[str, Any]] = []
        correct_count = 0
        wrong_count = 0
        for answer_row in answer_rows:
            answer = row_to_dict(answer_row) or {}
            try:
                answer_payload = json.loads(str(answer.get("answer_payload") or "{}"))
            except json.JSONDecodeError:
                answer_payload = {}
            is_correct_raw = answer.get("is_correct")
            is_correct = None if is_correct_raw is None else bool(is_correct_raw)
            if is_correct is True:
                correct_count += 1
            elif is_correct is False:
                wrong_count += 1
            item = {
                "question_id": answer.get("question_id"),
                "answer": answer_payload.get("answer"),
                "images": answer_payload.get("images") if isinstance(answer_payload.get("images"), list) else [],
                "score": answer.get("score") if show_results else None,
                "is_correct": is_correct if show_results else None,
                "feedback": answer.get("feedback") if show_results else None,
                "responded_at": answer.get("responded_at"),
            }
            question = question_by_id.get(str(answer.get("question_id") or ""), {})
            if show_results:
                item.update(
                    {
                        "header": question.get("header"),
                        "content": question.get("content"),
                        "type": question.get("type"),
                        "options": question.get("options"),
                        "section_id": question.get("section_id"),
                        "score_per_item": question.get("score_per_item"),
                        "tags": question.get("tags") or [],
                    }
                )
            answers.append(item)
        order_index = {qid: index for index, qid in enumerate(question_order)}
        answers.sort(key=lambda item: order_index.get(str(item.get("question_id")), 999999))
        payload.update(
            {
                "attempt_id": attempt["id"],
                "publication_id": attempt["publication_id"],
                "answers": answers if show_results else [],
                "analysis": {
                    "correct_count": correct_count if show_results else None,
                    "wrong_count": wrong_count if show_results else None,
                    "answered_count": len(answer_rows),
                    "average_time_per_question_seconds": (
                        round(int(attempt.get("time_spent_seconds") or 0) / max(1, len(question_order)), 1)
                        if show_results and question_order
                        else None
                    ),
                },
            }
        )
        results.append(payload)
    return results
