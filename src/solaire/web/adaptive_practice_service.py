"""Per-student wrong-question and AI reinforcement publication services."""

from __future__ import annotations

import json
import math
import re
import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.student_service import _load_attempt_question_payloads


MIN_REINFORCEMENT_HISTORY = 3
PRACTICE_KINDS = {"wrong_questions", "reinforcement"}
SUBMISSION_MODES = {"online", "image_manual", "image_ai"}


def _new_id() -> str:
    return uuid.uuid4().hex


def _ensure_teacher(user: dict[str, Any]) -> None:
    if user.get("role") not in {"teacher", "admin"}:
        raise PermissionError("Only teachers and admins can publish adaptive practice")


def _ensure_class_access(root: Path, user: dict[str, Any], class_id: str) -> dict[str, Any]:
    _ensure_teacher(user)
    with connect(root) as con:
        if user.get("role") == "teacher":
            row = con.execute(
                """
                SELECT c.* FROM classes c
                JOIN teacher_class_assignments tca ON tca.class_id = c.id
                WHERE c.id = ? AND tca.teacher_id = ?
                LIMIT 1
                """,
                (class_id, str(user["id"])),
            ).fetchone()
        else:
            row = con.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
    klass = row_to_dict(row)
    if klass is None:
        raise PermissionError("Teacher is not assigned to this class")
    return klass


def list_practice_history(root: Path, *, class_id: str, user: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    _ensure_class_access(root, user, class_id)
    params: list[Any] = [class_id]
    teacher_clause = ""
    if user.get("role") == "teacher":
        teacher_clause = "AND ep.teacher_id = ?"
        params.append(str(user["id"]))
    with connect(root) as con:
        rows = con.execute(
            f"""
            SELECT ep.id, ep.paper_id, ep.title, ep.created_at, ep.status, ep.practice_kind,
                   pr.subject,
                   COUNT(DISTINCT CASE WHEN sa.status = 'submitted' THEN sa.student_id END) AS submitted_student_count,
                   SUM(CASE WHEN ans.is_correct = 0 THEN 1 ELSE 0 END) AS wrong_answer_count
            FROM exam_publications ep
            JOIN publication_classes pc ON pc.publication_id = ep.id
            JOIN paper_records pr ON pr.id = ep.paper_id
            LEFT JOIN student_attempts sa ON sa.publication_id = ep.id
            LEFT JOIN student_answers ans ON ans.attempt_id = sa.id
            WHERE pc.class_id = ? AND ep.status IN ('published', 'closed') {teacher_clause}
            GROUP BY ep.id, ep.paper_id, ep.title, ep.created_at, ep.status, ep.practice_kind, pr.subject
            ORDER BY ep.created_at DESC, ep.id DESC
            """,
            tuple(params),
        ).fetchall()
    publications = [
        {
            **(row_to_dict(row) or {}),
            "submitted_student_count": int(row["submitted_student_count"] or 0),
            "wrong_answer_count": int(row["wrong_answer_count"] or 0),
        }
        for row in rows
    ]
    return {
        "class_id": class_id,
        "publication_count": len(publications),
        "minimum_reinforcement_history": MIN_REINFORCEMENT_HISTORY,
        "eligible_for_reinforcement": len(publications) >= MIN_REINFORCEMENT_HISTORY,
        "publications": publications,
    }


def _validate_sources(
    root: Path,
    *,
    class_id: str,
    source_publication_ids: list[str],
    user: dict[str, Any],
) -> list[dict[str, Any]]:
    history = list_practice_history(root, class_id=class_id, user=user)["publications"]
    by_id = {str(item["id"]): item for item in history}
    clean_ids = list(dict.fromkeys(str(item).strip() for item in source_publication_ids if str(item).strip()))
    missing = [item for item in clean_ids if item not in by_id]
    if missing:
        raise PermissionError("Selected publication does not belong to this teacher and class")
    return [by_id[item] for item in clean_ids]


def _class_students(root: Path, class_id: str) -> list[dict[str, Any]]:
    with connect(root) as con:
        rows = con.execute(
            """
            SELECT s.* FROM students s
            JOIN class_students cs ON cs.student_id = s.id
            WHERE cs.class_id = ? AND s.status = 'active'
            ORDER BY s.student_no, s.id
            """,
            (class_id,),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def _wrong_questions_for_student(
    root: Path,
    project_root: Path,
    *,
    student_id: str,
    source_publication_ids: list[str],
) -> list[dict[str, Any]]:
    wrong: list[dict[str, Any]] = []
    with connect(root) as con:
        for publication_id in source_publication_ids:
            row = con.execute(
                """
                SELECT sa.*, pr.exam_id
                FROM student_attempts sa
                JOIN exam_publications ep ON ep.id = sa.publication_id
                JOIN paper_records pr ON pr.id = ep.paper_id
                WHERE sa.publication_id = ? AND sa.student_id = ? AND sa.status = 'submitted'
                """,
                (publication_id, student_id),
            ).fetchone()
            attempt = row_to_dict(row)
            if attempt is None:
                continue
            answer_rows = con.execute(
                "SELECT question_id FROM student_answers WHERE attempt_id = ? AND is_correct = 0 ORDER BY responded_at",
                (str(attempt["id"]),),
            ).fetchall()
            if not answer_rows:
                continue
            questions, answer_keys = _load_attempt_question_payloads(project_root, attempt)
            by_id = {str(item.get("question_id")): item for item in questions}
            for answer_row in answer_rows:
                qid = str(answer_row["question_id"])
                question = by_id.get(qid)
                answer = answer_keys.get(qid)
                if question is None or answer is None:
                    continue
                wrong.append({**question, "answer": answer, "source_publication_id": publication_id})
    return wrong


def _source_questions_for_student(
    root: Path,
    project_root: Path,
    *,
    student_id: str,
    source_publication_ids: list[str],
) -> list[dict[str, Any]]:
    """Load frozen source questions for an all-correct student.

    Reinforcement still needs a knowledge/difficulty anchor when the selected
    history contains no wrong answers.  Per-attempt snapshots are used so a
    later edit to the source exam cannot change the generated practice.
    """
    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    with connect(root) as con:
        for publication_id in source_publication_ids:
            row = con.execute(
                """
                SELECT sa.*, pr.exam_id
                FROM student_attempts sa
                JOIN exam_publications ep ON ep.id = sa.publication_id
                JOIN paper_records pr ON pr.id = ep.paper_id
                WHERE sa.publication_id = ? AND sa.student_id = ? AND sa.status = 'submitted'
                """,
                (publication_id, student_id),
            ).fetchone()
            attempt = row_to_dict(row)
            if attempt is None:
                return []
            questions, answer_keys = _load_attempt_question_payloads(project_root, attempt)
            eligible_questions = [
                question
                for question in questions
                if str(question.get("question_id") or "").strip() in answer_keys
            ]
            question_ids = [str(question.get("question_id") or "").strip() for question in eligible_questions]
            if not question_ids:
                return []
            placeholders = ", ".join("?" for _ in question_ids)
            answer_rows = con.execute(
                f"SELECT question_id, is_correct FROM student_answers "
                f"WHERE attempt_id = ? AND question_id IN ({placeholders})",
                (str(attempt["id"]), *question_ids),
            ).fetchall()
            graded = {str(answer_row["question_id"]): answer_row["is_correct"] for answer_row in answer_rows}
            if any(graded.get(question_id) != 1 for question_id in question_ids):
                return []
            for question in eligible_questions:
                qid = str(question.get("question_id") or "").strip()
                answer = answer_keys.get(qid)
                key = (publication_id, qid)
                if not qid or answer is None or key in seen:
                    continue
                seen.add(key)
                sources.append({**question, "answer": answer, "source_publication_id": publication_id})
    return sources


def _extract_json(value: str) -> dict[str, Any] | None:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return data if isinstance(data, dict) else None


def _extract_generated_payload(response: Any) -> dict[str, Any] | None:
    for tool_call in getattr(response, "tool_calls", None) or []:
        function = tool_call.get("function") if isinstance(tool_call, dict) else None
        if not isinstance(function, dict) or function.get("name") != "submit_reinforcement_questions":
            continue
        arguments = function.get("arguments")
        if isinstance(arguments, dict):
            parsed = arguments
        elif isinstance(arguments, str):
            parsed = _extract_json(arguments)
        else:
            parsed = None
        if isinstance(parsed, dict):
            return parsed
    parsed = _extract_json(str(getattr(response, "content", None) or ""))
    if parsed is not None and not isinstance(parsed.get("questions"), list):
        alias = parsed.get("wrong_questions")
        if isinstance(alias, list):
            parsed = {key: value for key, value in parsed.items() if key != "wrong_questions"}
            parsed["questions"] = alias
    return parsed


def _validate_generated_questions(result: dict[str, Any], *, student_id: str, requested_count: int) -> dict[str, Any]:
    raw_questions = result.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise ValueError("AI did not return any reinforcement questions")
    if len(raw_questions) != requested_count:
        raise ValueError(f"AI must return exactly {requested_count} reinforcement questions")
    supported_types = {"single_choice", "multiple_choice", "choice", "judge", "fill", "short_answer", "essay"}
    questions: list[dict[str, Any]] = []
    answer_keys: dict[str, str] = {}
    for index, raw in enumerate(raw_questions[:requested_count], start=1):
        if not isinstance(raw, dict):
            raise ValueError("AI reinforcement question is invalid")
        qtype = str(raw.get("type") or "").strip()
        content = str(raw.get("content") or "").strip()
        answer = str(raw.get("answer") or "").strip()
        if not qtype or not content or not answer:
            raise ValueError("AI reinforcement question is missing type, content, or answer")
        if qtype not in supported_types:
            raise ValueError(f"AI reinforcement question type is unsupported: {qtype}")
        if len(content) > 10_000 or len(answer) > 2_000:
            raise ValueError("AI reinforcement question text is too long")
        options = raw.get("options")
        if qtype in {"single_choice", "multiple_choice", "choice", "judge"} and not isinstance(options, dict):
            raise ValueError("AI choice question is missing options")
        if isinstance(options, dict):
            if len(options) < 2 or len(options) > 20:
                raise ValueError("AI choice question has an invalid option count")
            if any(len(str(key)) > 20 or len(str(value)) > 2_000 for key, value in options.items()):
                raise ValueError("AI choice option is too long")
        if isinstance(options, dict) and qtype in {"single_choice", "choice", "judge"}:
            if answer not in {str(key) for key in options}:
                raise ValueError("AI choice answer does not exist in options")
        if isinstance(options, dict) and qtype == "multiple_choice":
            option_keys = {str(key) for key in options}
            compact_answer = re.sub(r"[^0-9A-Za-z]", "", answer)
            answer_keys_set = set(compact_answer) if all(len(key) == 1 for key in option_keys) else {answer}
            if not answer_keys_set or not answer_keys_set.issubset(option_keys):
                raise ValueError("AI choice answer does not exist in options")
        qid = str(raw.get("question_id") or f"reinforcement/{student_id}/{index}").strip()
        if qid in answer_keys:
            raise ValueError("AI returned duplicate question IDs")
        try:
            score_per_item = float(raw.get("score_per_item") or 5)
        except (TypeError, ValueError) as exc:
            raise ValueError("AI reinforcement question score is invalid") from exc
        if not math.isfinite(score_per_item) or score_per_item <= 0 or score_per_item > 100:
            raise ValueError("AI reinforcement question score is invalid")
        payload = {
            "question_id": qid,
            "header": str(raw.get("header") or f"举一反三 {index}"),
            "section_id": str(raw.get("section_id") or "practice"),
            "score_per_item": score_per_item,
            "type": qtype,
            "content": content,
            "options": options if isinstance(options, dict) else None,
        }
        questions.append(payload)
        answer_keys[qid] = answer
    if not questions:
        raise ValueError("AI did not return a valid reinforcement question")
    return {"questions": questions, "answer_keys": answer_keys}


async def generate_reinforcement_questions(
    *,
    project_root: Path,
    student: dict[str, Any],
    wrong_questions: list[dict[str, Any]],
    question_count: int,
) -> dict[str, Any]:
    # Keep this import local: importing the agent package registers teacher tools,
    # which themselves import this service.
    from solaire.agent_layer.llm.router import ModelRouter, load_llm_settings

    settings = load_llm_settings(project_root)
    if not settings.api_key:
        raise ValueError("AI provider is not configured; reinforcement practice was not published")
    adapter = ModelRouter(settings=settings).main()
    compact_sources = [
        {
            "type": item.get("type"),
            "content": item.get("content"),
            "options": item.get("options"),
            "answer": item.get("answer"),
            "score_per_item": item.get("score_per_item"),
        }
        for item in wrong_questions[:30]
    ]
    response = await adapter.chat(
        [
            {
                "role": "system",
                "content": (
                    "你是严谨的中学教师。优先根据学生历史错题生成同知识点、同难度但数值或情境不同的举一反三题；"
                    "如果学生全部答对，则根据所选历史试卷的题目生成同知识点相关变式题。"
                    "必须调用 submit_reinforcement_questions 工具提交结果。每题必须含 "
                    "type/content/options/answer/score_per_item，不得照抄原题。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"student": student.get("display_name"), "question_count": question_count, "wrong_questions": compact_sources},
                    ensure_ascii=False,
                ),
            },
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "submit_reinforcement_questions",
                    "description": "提交给学生的举一反三题，只能在所有题目生成完毕后调用一次。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "questions": {
                                "type": "array",
                                "minItems": question_count,
                                "maxItems": question_count,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "question_id": {"type": "string"},
                                        "type": {"type": "string"},
                                        "content": {"type": "string"},
                                        "options": {
                                            "type": "object",
                                            "additionalProperties": {"type": "string"},
                                        },
                                        "answer": {"type": "string"},
                                        "score_per_item": {"type": "number"},
                                    },
                                    "required": ["type", "content", "options", "answer", "score_per_item"],
                                    "additionalProperties": False,
                                },
                            }
                        },
                        "required": ["questions"],
                        "additionalProperties": False,
                    },
                },
            }
        ],
        temperature=0.35,
        max_tokens=max(4000, question_count * 800),
    )
    parsed = _extract_generated_payload(response)
    if parsed is None:
        raise ValueError("AI returned malformed JSON; reinforcement practice was not published")
    return {
        **parsed,
        "provider": str(settings.provider),
        "model": settings.main_model,
        "usage": response.usage,
    }


def _publish_personalized(
    root: Path,
    *,
    class_id: str,
    user: dict[str, Any],
    title: str,
    subject: str,
    practice_kind: str,
    source_publication_ids: list[str],
    assignments: list[dict[str, Any]],
    start_at: str | None,
    end_at: str | None,
    show_results_immediately: bool,
    submission_mode: str,
    max_screen_switches: int,
    time_limit_minutes: int | None,
) -> dict[str, Any]:
    if practice_kind not in PRACTICE_KINDS:
        raise ValueError("Unsupported practice kind")
    clean_submission_mode = str(submission_mode or "").strip()
    if clean_submission_mode not in SUBMISSION_MODES:
        raise ValueError("submission_mode must be online, image_manual, or image_ai")
    if not assignments:
        raise ValueError("No students have eligible source questions in the selected history")
    now = utc_now()
    paper_id = _new_id()
    publication_id = _new_id()
    with connect(root) as con:
        con.execute(
            """
            INSERT INTO paper_records
              (id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'online', ?, ?, 'published', ?, ?)
            """,
            (paper_id, f"adaptive/{paper_id}", title, subject, str(user["id"]), user.get("school_id"), now, now),
        )
        con.execute(
            """
            INSERT INTO exam_publications
              (id, paper_id, teacher_id, title, start_at, end_at, show_results_immediately,
               submission_mode, max_screen_switches, time_limit_minutes, practice_kind,
               source_publication_ids_json, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
            """,
            (
                publication_id,
                paper_id,
                str(user["id"]),
                title,
                start_at,
                end_at,
                1 if show_results_immediately else 0,
                clean_submission_mode,
                max(0, int(max_screen_switches or 0)),
                max(0, int(time_limit_minutes or 0)) or None,
                practice_kind,
                json.dumps(source_publication_ids),
                now,
                now,
            ),
        )
        con.execute("INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)", (publication_id, class_id))
        for assignment in assignments:
            con.execute(
                """
                INSERT INTO student_attempts
                  (id, publication_id, student_id, status, question_payload_json, answer_key_json,
                   practice_metadata_json, question_payload_version)
                VALUES (?, ?, ?, 'not_started', ?, ?, ?, 3)
                """,
                (
                    _new_id(),
                    publication_id,
                    assignment["student_id"],
                    json.dumps(assignment["questions"], ensure_ascii=False),
                    json.dumps(assignment["answer_keys"], ensure_ascii=False),
                    json.dumps(
                        {
                            "kind": practice_kind,
                            "source_count": len(source_publication_ids),
                            "source_publication_ids": source_publication_ids,
                        },
                        ensure_ascii=False,
                    ),
                ),
            )
    publication = {
        "id": publication_id,
        "paper_id": paper_id,
        "title": title,
        "class_ids": [class_id],
        "practice_kind": practice_kind,
        "source_publication_ids": source_publication_ids,
        "status": "published",
        "submission_mode": clean_submission_mode,
        "max_screen_switches": max(0, int(max_screen_switches or 0)),
        "time_limit_minutes": max(0, int(time_limit_minutes or 0)) or None,
    }
    return {"publication": publication, "assigned_student_count": len(assignments)}


def publish_wrong_question_practice(
    root: Path,
    project_root: Path,
    *,
    class_id: str,
    source_publication_id: str,
    user: dict[str, Any],
    title: str,
    max_questions_per_student: int = 20,
    **settings: Any,
) -> dict[str, Any]:
    clean_source_id = str(source_publication_id).strip()
    sources = _validate_sources(
        root,
        class_id=class_id,
        source_publication_ids=[clean_source_id],
        user=user,
    )
    if len(sources) != 1:
        raise ValueError("Select one historical publication")
    students = _class_students(root, class_id)
    assignments: list[dict[str, Any]] = []
    for student in students:
        wrong = _wrong_questions_for_student(
            root,
            project_root,
            student_id=str(student["id"]),
            source_publication_ids=[clean_source_id],
        )
        if not wrong:
            continue
        questions: list[dict[str, Any]] = []
        keys: dict[str, str] = {}
        limit = max(1, min(100, int(max_questions_per_student or 20)))
        for item in wrong[:limit]:
            qid = str(item["question_id"])
            keys[qid] = str(item["answer"])
            questions.append({key: value for key, value in item.items() if key not in {"answer", "source_publication_id"}})
        assignments.append({"student_id": student["id"], "questions": questions, "answer_keys": keys})
    result = _publish_personalized(
        root,
        class_id=class_id,
        user=user,
        title=title.strip() or "历史错题巩固",
        subject=str(sources[0].get("subject") or "综合"),
        practice_kind="wrong_questions",
        source_publication_ids=[clean_source_id],
        assignments=assignments,
        **settings,
    )
    result["skipped_student_count"] = len(students) - len(assignments)
    return result


async def publish_reinforcement_practice(
    root: Path,
    project_root: Path,
    *,
    class_id: str,
    source_publication_ids: list[str],
    user: dict[str, Any],
    title: str,
    questions_per_student: int = 5,
    **settings: Any,
) -> dict[str, Any]:
    clean_ids = list(dict.fromkeys(str(item).strip() for item in source_publication_ids if str(item).strip()))
    if len(clean_ids) < MIN_REINFORCEMENT_HISTORY:
        raise ValueError(f"Reinforcement practice requires at least {MIN_REINFORCEMENT_HISTORY} historical publications")
    sources = _validate_sources(root, class_id=class_id, source_publication_ids=clean_ids, user=user)
    if len(sources) < MIN_REINFORCEMENT_HISTORY:
        raise ValueError(f"Reinforcement practice requires at least {MIN_REINFORCEMENT_HISTORY} valid historical publications")
    assignments: list[dict[str, Any]] = []
    total_tokens = 0
    provider: str | None = None
    model: str | None = None
    students = _class_students(root, class_id)
    for student in students:
        wrong = _wrong_questions_for_student(
            root,
            project_root,
            student_id=str(student["id"]),
            source_publication_ids=clean_ids,
        )
        if not wrong:
            wrong = _source_questions_for_student(
                root,
                project_root,
                student_id=str(student["id"]),
                source_publication_ids=clean_ids,
            )
        if not wrong:
            continue
        generated = await generate_reinforcement_questions(
            project_root=project_root,
            student=student,
            wrong_questions=wrong,
            question_count=max(1, min(20, int(questions_per_student or 5))),
        )
        validated = _validate_generated_questions(
            generated,
            student_id=str(student["id"]),
            requested_count=max(1, min(20, int(questions_per_student or 5))),
        )
        assignments.append({"student_id": student["id"], **validated})
        usage = generated.get("usage") if isinstance(generated.get("usage"), dict) else {}
        total_tokens += int(usage.get("total_tokens") or 0)
        provider = str(generated.get("provider") or provider or "") or None
        model = str(generated.get("model") or model or "") or None
    result = _publish_personalized(
        root,
        class_id=class_id,
        user=user,
        title=title.strip() or "专项巩固",
        subject=str(sources[0].get("subject") or "综合"),
        practice_kind="reinforcement",
        source_publication_ids=clean_ids,
        assignments=assignments,
        **settings,
    )
    result["skipped_student_count"] = len(students) - len(assignments)
    result["generation"] = {"provider": provider, "model": model, "total_tokens": total_tokens}
    return result
