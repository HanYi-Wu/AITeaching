"""Publication workflows for wrong-question and AI reinforcement adaptive practices."""

from __future__ import annotations

from contextlib import closing
import json
import sys
from pathlib import Path
from typing import Any

from solaire.web.adaptive.generation import (
    _validate_generated_questions,
    generate_reinforcement_questions as _default_generate_reinforcement_questions,
)
from solaire.web.adaptive.policies import (
    MIN_REINFORCEMENT_HISTORY,
    PRACTICE_KINDS,
    SUBMISSION_MODES,
    _class_students,
    _new_id,
    _validate_sources,
)
from solaire.web.adaptive.selection import (
    _source_questions_for_student,
    _wrong_questions_for_student,
)
from solaire.web.auth_service import utc_now
from solaire.web.learning_progress.source_reads import load_online_source_read_context
from solaire.web.platform_db import connect


def _resolve_generate_reinforcement_questions():
    mod = sys.modules.get("solaire.web.adaptive_practice_service")
    if mod and hasattr(mod, "generate_reinforcement_questions"):
        return getattr(mod, "generate_reinforcement_questions")
    return _default_generate_reinforcement_questions


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
    project_root: Path | None = None,
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
    with closing(connect(root)) as con, con:
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
        from solaire.web.learning_progress.sources import (
            freeze_question_bindings,
            load_graph_question_binding_snapshot,
        )

        graph_snapshot = load_graph_question_binding_snapshot(project_root) if project_root else None

        for assignment in assignments:
            questions = freeze_question_bindings(
                project_root,
                assignment["questions"],
                graph_snapshot=graph_snapshot,
            )
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
                    json.dumps(questions, ensure_ascii=False),
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
        from solaire.web.learning_progress.baselines import freeze_personalized_baseline

        freeze_personalized_baseline(
            con,
            project_root=project_root,
            publication_id=publication_id,
            practice_kind=practice_kind,
            source_publication_ids=source_publication_ids,
            assignments=assignments,
            captured_at=now,
            graph_snapshot=graph_snapshot,
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
    with closing(connect(root)) as con, con:
        read_context = load_online_source_read_context(
            con,
            source_publication_ids=[clean_source_id],
            student_ids=[str(student["id"]) for student in students],
        )
    assignments: list[dict[str, Any]] = []
    for student in students:
        wrong = _wrong_questions_for_student(
            root,
            project_root,
            student_id=str(student["id"]),
            source_publication_ids=[clean_source_id],
            read_context=read_context,
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
    del read_context
    result = _publish_personalized(
        root,
        class_id=class_id,
        user=user,
        title=title.strip() or "历史错题巩固",
        subject=str(sources[0].get("subject") or "综合"),
        practice_kind="wrong_questions",
        source_publication_ids=[clean_source_id],
        assignments=assignments,
        project_root=project_root,
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
    with closing(connect(root)) as con, con:
        read_context = load_online_source_read_context(
            con,
            source_publication_ids=clean_ids,
            student_ids=[str(student["id"]) for student in students],
        )
    generator_fn = _resolve_generate_reinforcement_questions()
    for student in students:
        wrong = _wrong_questions_for_student(
            root,
            project_root,
            student_id=str(student["id"]),
            source_publication_ids=clean_ids,
            read_context=read_context,
        )
        if not wrong:
            wrong = _source_questions_for_student(
                root,
                project_root,
                student_id=str(student["id"]),
                source_publication_ids=clean_ids,
                read_context=read_context,
            )
        if not wrong:
            continue
        generated = await generator_fn(
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
    del read_context
    result = _publish_personalized(
        root,
        class_id=class_id,
        user=user,
        title=title.strip() or "专项巩固",
        subject=str(sources[0].get("subject") or "综合"),
        practice_kind="reinforcement",
        source_publication_ids=clean_ids,
        assignments=assignments,
        project_root=project_root,
        **settings,
    )
    result["skipped_student_count"] = len(students) - len(assignments)
    result["generation"] = {"provider": provider, "model": model, "total_tokens": total_tokens}
    return result
