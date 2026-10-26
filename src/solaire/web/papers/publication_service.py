"""Atomic creation of paper publications and their recipient snapshots."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Callable

from solaire.web.auth_service import utc_now
from solaire.web.papers.publication_policy import (
    normalize_schedule,
    normalize_submission_mode,
    normalize_time_limit,
)
from solaire.web.papers.repository import clean_subject, clean_title, get_paper_record
from solaire.web.papers.visibility import ensure_paper_access
from solaire.web.platform_db import connect, init_platform_db, row_to_dict
from solaire.web.papers.snapshots import _load_exam_question_payloads


def _new_id() -> str:
    return uuid.uuid4().hex


def _validate_publish_classes_with_connection(
    con: sqlite3.Connection,
    user: dict[str, Any],
    class_ids: list[str],
) -> list[str]:
    clean_ids = [cid.strip() for cid in class_ids if cid.strip()]
    if not clean_ids:
        raise ValueError("at least one class is required")
    unique_ids = list(dict.fromkeys(clean_ids))
    role = user.get("role")
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


def validate_publish_classes(root: Path, user: dict[str, Any], class_ids: list[str]) -> list[str]:
    with connect(root) as con:
        return _validate_publish_classes_with_connection(con, user, class_ids)


def paper_exam_question_payloads(
    project_root: Path,
    paper: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    return _load_exam_question_payloads(project_root, str(paper.get("exam_id") or ""))


def ensure_publishable_paper(project_root: Path | None, paper: dict[str, Any]) -> None:
    if project_root is None:
        raise ValueError("发布试卷必须加载题目内容，请提供试卷所在的项目目录")
    questions, _answer_keys = paper_exam_question_payloads(project_root, paper)
    if len(questions) <= 0:
        raise ValueError("paper must contain at least one question before publish")


def _published_class_rows(
    con: sqlite3.Connection,
    *,
    paper_id: str,
    class_ids: list[str],
) -> list[sqlite3.Row]:
    if not class_ids:
        return []
    placeholders = ",".join("?" for _ in class_ids)
    return con.execute(
        f"""
        SELECT c.name, c.id
        FROM exam_publications ep
        JOIN publication_classes pc ON pc.publication_id = ep.id
        JOIN classes c ON c.id = pc.class_id
        WHERE ep.paper_id = ?
          AND ep.status <> 'revoked'
          AND ep.recipient_scope = 'class'
          AND pc.class_id IN ({placeholders})
        ORDER BY c.name
        """,
        (paper_id, *class_ids),
    ).fetchall()


def _raise_class_publication_conflict(rows: list[sqlite3.Row]) -> None:
    if rows:
        class_names = ", ".join(str(row["name"] or row["id"]) for row in rows)
        raise ValueError(f"paper already published to class: {class_names}")


def _ensure_class_not_already_published_with_connection(
    con: sqlite3.Connection,
    *,
    paper_id: str,
    class_ids: list[str],
) -> None:
    _raise_class_publication_conflict(
        _published_class_rows(con, paper_id=paper_id, class_ids=class_ids),
    )


def ensure_class_not_already_published(root: Path, *, paper_id: str, class_ids: list[str]) -> None:
    with connect(root) as con:
        _ensure_class_not_already_published_with_connection(
            con,
            paper_id=paper_id,
            class_ids=class_ids,
        )


def _validate_publish_subject_with_connection(
    con: sqlite3.Connection,
    *,
    user: dict[str, Any],
    subject: str | None,
    paper_subject: object,
) -> str:
    clean_subject_value = str(subject or "").strip()
    if user.get("role") == "teacher":
        allowed_subjects = [
            str(row["subject"])
            for row in con.execute(
                "SELECT subject FROM teacher_subjects WHERE teacher_id = ? ORDER BY subject",
                (str(user["id"]),),
            ).fetchall()
        ]
        if not clean_subject_value and len(allowed_subjects) == 1:
            clean_subject_value = allowed_subjects[0]
        if not clean_subject_value and len(allowed_subjects) > 1:
            raise ValueError("已设置多个学科，发布时必须选择本次试卷所属学科")
        if clean_subject_value and allowed_subjects and clean_subject_value not in allowed_subjects:
            raise ValueError("所选学科不在教师个人学科设置中")
    if not clean_subject_value:
        clean_subject_value = clean_subject(paper_subject)
    return clean_subject_value


def _student_folder_conflicts(
    con: sqlite3.Connection,
    *,
    folder_id: str,
    student_ids: list[str],
) -> list[sqlite3.Row]:
    if not folder_id or not student_ids:
        return []
    placeholders = ",".join("?" for _ in student_ids)
    return con.execute(
        f"""SELECT DISTINCT s.display_name, s.student_no, ep.title
            FROM student_attempts sa JOIN exam_publications ep ON ep.id=sa.publication_id
            JOIN students s ON s.id=sa.student_id
            WHERE ep.folder_id=? AND ep.status<>'revoked' AND sa.student_id IN ({placeholders})
            ORDER BY s.student_no LIMIT 10""",
        (folder_id, *student_ids),
    ).fetchall()


def _raise_student_folder_conflict(rows: list[sqlite3.Row]) -> None:
    if rows:
        detail = "、".join(f"{row['display_name']}({row['student_no']})" for row in rows)
        raise ValueError(f"该试卷文件夹已有发放记录：{detail}；请选择其他文件夹或接收人")


def _map_publication_trigger_error(
    root: Path,
    *,
    paper_id: str,
    class_ids: list[str],
    folder_id: str | None,
    student_ids: list[str],
    error: sqlite3.IntegrityError,
) -> None:
    if str(error) == "paper already published to class":
        with connect(root) as con:
            _ensure_class_not_already_published_with_connection(
                con,
                paper_id=paper_id,
                class_ids=class_ids,
            )
        raise ValueError("paper already published to class") from error
    if str(error) == "student already assigned in paper folder":
        with connect(root) as con:
            conflicts = _student_folder_conflicts(
                con,
                folder_id=str(folder_id or ""),
                student_ids=student_ids,
            )
        _raise_student_folder_conflict(conflicts)
        raise ValueError("该试卷文件夹已有发放记录") from error


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
    id_factory: Callable[[], str] | None = None,
) -> dict[str, Any]:
    start_at, end_at = normalize_schedule(start_at, end_at)
    init_platform_db(root)
    if user.get("role") not in {"admin", "teacher"}:
        raise PermissionError("Only teachers and admins can publish papers")
    selected_class_ids = validate_publish_classes(root, user, class_ids)
    selected_student_ids = list(dict.fromkeys(str(item).strip() for item in (student_ids or []) if str(item).strip()))
    if selected_student_ids and len(selected_class_ids) != 1:
        raise ValueError("指定学生发布时须选择一个班级")
    paper = get_paper_record(root, paper_id)
    if paper is None:
        raise ValueError("paper not found")
    ensure_paper_access(paper, user)
    ensure_publishable_paper(project_root, paper)
    if not selected_student_ids:
        ensure_class_not_already_published(root, paper_id=paper_id, class_ids=selected_class_ids)
    clean_submission_mode = normalize_submission_mode(submission_mode)
    clean_max_screen_switches = max(0, int(max_screen_switches or 0))
    clean_time_limit_minutes = normalize_time_limit(time_limit_minutes, empty_as_zero=True)
    clean_subject_value = str(subject or "").strip()
    with connect(root) as con:
        clean_subject_value = _validate_publish_subject_with_connection(
            con,
            user=user,
            subject=clean_subject_value,
            paper_subject=paper.get("subject"),
        )
    now = utc_now()
    publication_id = (id_factory or _new_id)()
    teacher_id = str(user["id"])
    clean_description = description.strip() if description and description.strip() else None
    effective_folder_id = folder_id or str(paper.get("folder_id") or "")

    frozen_questions: list[dict[str, Any]] = []
    frozen_answer_keys: dict[str, str] = {}
    student_ids_to_assign: list[str] = []
    try:
        with connect(root) as con:
            # Lock before authoritative rechecks so concurrent publishers serialize
            # their duplicate check and every write in the same transaction.
            con.execute("BEGIN IMMEDIATE")
            current_row = con.execute(
                "SELECT * FROM paper_records WHERE id = ?",
                (paper_id,),
            ).fetchone()
            current_paper = row_to_dict(current_row)
            if current_paper is None:
                raise ValueError("paper not found")
            ensure_paper_access(current_paper, user)
            selected_class_ids = _validate_publish_classes_with_connection(
                con,
                user,
                selected_class_ids,
            )
            if not selected_student_ids:
                _ensure_class_not_already_published_with_connection(
                    con,
                    paper_id=paper_id,
                    class_ids=selected_class_ids,
                )
            clean_subject_value = _validate_publish_subject_with_connection(
                con,
                user=user,
                subject=subject,
                paper_subject=current_paper.get("subject"),
            )
            if project_root is None:
                raise ValueError("发布试卷必须加载题目内容，请提供试卷所在的项目目录")
            frozen_questions, frozen_answer_keys = paper_exam_question_payloads(project_root, current_paper)
            if len(frozen_questions) <= 0:
                raise ValueError("paper must contain at least one question before publish")
            frozen_questions_json = json.dumps(frozen_questions, ensure_ascii=False)
            frozen_answer_keys_json = json.dumps(frozen_answer_keys, ensure_ascii=False) if frozen_questions else None
            publication_title = clean_title(title, str(current_paper["title"]))
            effective_folder_id = folder_id
            if effective_folder_id:
                folder = con.execute(
                    "SELECT kind, owner_teacher_id FROM content_folders WHERE id=? AND scope='paper'",
                    (effective_folder_id,),
                ).fetchone()
                if folder is None or folder["owner_teacher_id"] != teacher_id:
                    raise PermissionError("试卷文件夹不存在或无权使用")
                folder_kind = str(folder["kind"])
            else:
                effective_folder_id = str(current_paper.get("folder_id") or "")
                folder = con.execute("SELECT kind FROM content_folders WHERE id=?", (effective_folder_id,)).fetchone()
                folder_kind = str(folder["kind"]) if folder else "category"
            existing_folder = con.execute(
                "SELECT folder_id FROM exam_publications WHERE paper_id=? LIMIT 1",
                (paper_id,),
            ).fetchone()
            if existing_folder and existing_folder["folder_id"] and existing_folder["folder_id"] != effective_folder_id:
                raise ValueError("该试卷已有发布记录，不能改绑其他文件夹；请移动整个文件夹")
            if selected_student_ids and folder_kind != "paper":
                raise ValueError("指定学生发布须选择试卷文件夹")
            if selected_student_ids:
                placeholders = ",".join("?" for _ in selected_student_ids)
                rows = con.execute(
                    f"SELECT student_id FROM class_students WHERE class_id=? AND student_id IN ({placeholders})",
                    (selected_class_ids[0], *selected_student_ids),
                ).fetchall()
                if len(rows) != len(selected_student_ids):
                    raise ValueError("指定学生不全部属于所选班级")
            else:
                rows = con.execute(
                    f"SELECT DISTINCT student_id FROM class_students WHERE class_id IN ({','.join('?' for _ in selected_class_ids)})",
                    tuple(selected_class_ids),
                ).fetchall()
            student_ids_to_assign = [str(row["student_id"]) for row in rows]
            if folder_kind == "paper" and student_ids_to_assign:
                conflicts = _student_folder_conflicts(
                    con,
                    folder_id=effective_folder_id,
                    student_ids=student_ids_to_assign,
                )
                _raise_student_folder_conflict(conflicts)
            con.execute(
                """
                INSERT INTO exam_publications (
                  id, paper_id, teacher_id, title, description, subject, start_at, end_at,
                  show_results_immediately, randomize_questions, randomize_answers,
                  submission_mode, max_screen_switches, time_limit_minutes, folder_id, recipient_scope, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
                """,
                (
                    publication_id,
                    paper_id,
                    teacher_id,
                    publication_title,
                    clean_description,
                    clean_subject_value,
                    start_at,
                    end_at,
                    1 if show_results_immediately else 0,
                    1 if randomize_questions else 0,
                    1 if randomize_answers else 0,
                    clean_submission_mode,
                    clean_max_screen_switches,
                    clean_time_limit_minutes,
                    effective_folder_id or None,
                    "student" if selected_student_ids else "class",
                    now,
                    now,
                ),
            )
            con.executemany(
                "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
                [(publication_id, class_id) for class_id in selected_class_ids],
            )
            con.executemany(
                """
                INSERT OR IGNORE INTO student_attempts
                  (id, publication_id, student_id, status, question_payload_json, answer_key_json, question_payload_version)
                VALUES (?, ?, ?, 'not_started', ?, ?, 3)
                """,
                [
                    (
                        (id_factory or _new_id)(),
                        publication_id,
                        str(row["student_id"]),
                        frozen_questions_json,
                        frozen_answer_keys_json,
                    )
                    for row in rows
                ],
            )
            con.execute(
                "UPDATE paper_records SET delivery_mode='online', status='published', folder_id=?, updated_at=? WHERE id=?",
                (effective_folder_id or None, now, paper_id),
            )
            row = con.execute("SELECT * FROM exam_publications WHERE id = ?", (publication_id,)).fetchone()
    except sqlite3.IntegrityError as error:
        _map_publication_trigger_error(
            root,
            paper_id=paper_id,
            class_ids=selected_class_ids,
            folder_id=effective_folder_id,
            student_ids=student_ids_to_assign,
            error=error,
        )
        raise
    publication = row_to_dict(row)
    if publication is None:
        raise RuntimeError("failed to publish paper")
    publication["class_ids"] = selected_class_ids
    publication["attempt_count"] = len(rows)
    publication["student_ids"] = selected_student_ids
    publication["submission_mode"] = clean_submission_mode
    publication["max_screen_switches"] = clean_max_screen_switches
    publication["time_limit_minutes"] = clean_time_limit_minutes
    return publication
