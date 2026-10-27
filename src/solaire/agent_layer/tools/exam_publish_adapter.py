"""Online paper publication and recipient resolution adapter."""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.web.paper_service import publish_online_paper
from solaire.web.platform_db import connect, default_platform_root, row_to_dict

def _platform_actor(ctx: InvocationContext) -> dict[str, Any] | None:
    actor = ctx.platform_user
    if not actor or actor.get("role") not in {"admin", "teacher"} or actor.get("status") != "active":
        return None
    return dict(actor)

def _split_name_terms(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw = [str(item) for item in value]
    else:
        raw = re.split(r"[,，、;\s]+", str(value))
    return [item.strip() for item in raw if item.strip()]

def _paper_candidates(root: Path, actor: dict[str, Any]) -> list[dict[str, Any]]:
    role = str(actor.get("role") or "")
    params: list[object] = []
    where = ["status <> 'deleted'"]
    if role == "teacher":
        where.append("(owner_teacher_id IS NULL OR owner_teacher_id = ?)")
        params.append(str(actor.get("id") or ""))
        if actor.get("school_id"):
            where.append("(school_id IS NULL OR school_id = ?)")
            params.append(str(actor.get("school_id")))
    elif role == "school":
        where.append("(school_id IS NULL OR school_id = ?)")
        params.append(str(actor.get("school_id") or ""))
    sql = f"""
        SELECT id, exam_id, title, subject, delivery_mode, status, owner_teacher_id, school_id
        FROM paper_records
        WHERE {' AND '.join(where)}
        ORDER BY updated_at DESC, created_at DESC
    """
    with connect(root) as con:
        rows = con.execute(sql, tuple(params)).fetchall()
    return [row_to_dict(row) or {} for row in rows]

def _resolve_paper_id(root: Path, actor: dict[str, Any], args: dict[str, Any]) -> tuple[str | None, str | None]:
    candidates = _paper_candidates(root, actor)
    paper_id = str(args.get("paper_id") or "").strip()
    if paper_id:
        if any(str(item.get("id")) == paper_id for item in candidates):
            return paper_id, None
        return None, f"paper_id not found or not visible: {paper_id}"

    terms: list[str] = []
    for key in ("paper_title", "exam_id"):
        terms.extend(_split_name_terms(args.get(key)))
    terms = list(dict.fromkeys(terms))
    if not terms:
        available = ", ".join(str(item.get("title") or item.get("exam_id")) for item in candidates[:8])
        return None, f"Need paper_id, exam_id, or paper_title. Available papers: {available or 'none'}"

    matches = candidates
    for term in terms:
        needle = term.lower()
        exact = [
            item
            for item in matches
            if needle
            in {
                str(item.get("id") or "").lower(),
                str(item.get("exam_id") or "").lower(),
                str(item.get("title") or "").lower(),
            }
        ]
        if exact:
            matches = exact
            continue
        matches = [
            item
            for item in matches
            if needle in str(item.get("exam_id") or "").lower()
            or needle in str(item.get("title") or "").lower()
            or needle in str(item.get("subject") or "").lower()
        ]
    if len(matches) == 1:
        return str(matches[0]["id"]), None
    if not matches:
        available = ", ".join(str(item.get("title") or item.get("exam_id")) for item in candidates[:8])
        return None, f"No visible paper matched {', '.join(terms)}. Available papers: {available or 'none'}"
    options = ", ".join(f"{item.get('title')}({item.get('exam_id')})" for item in matches[:8])
    return None, f"Paper name is ambiguous. Please choose one: {options}"

def _class_candidates(root: Path, actor: dict[str, Any]) -> list[dict[str, Any]]:
    role = str(actor.get("role") or "")
    params: list[object] = []
    if role == "teacher":
        sql = """
            SELECT DISTINCT c.id, c.name, c.grade, c.school_id
            FROM teacher_class_assignments tca
            JOIN classes c ON c.id = tca.class_id
            WHERE tca.teacher_id = ?
            ORDER BY c.grade, c.name
        """
        params.append(str(actor.get("id") or ""))
    elif actor.get("school_id"):
        sql = """
            SELECT id, name, grade, school_id
            FROM classes
            WHERE school_id = ?
            ORDER BY grade, name
        """
        params.append(str(actor.get("school_id")))
    else:
        sql = "SELECT id, name, grade, school_id FROM classes ORDER BY grade, name"
    with connect(root) as con:
        rows = con.execute(sql, tuple(params)).fetchall()
    return [row_to_dict(row) or {} for row in rows]

def _resolve_class_ids(root: Path, actor: dict[str, Any], args: dict[str, Any]) -> tuple[list[str], str | None]:
    explicit = [str(item).strip() for item in (args.get("class_ids") or []) if str(item).strip()]
    if explicit:
        return list(dict.fromkeys(explicit)), None

    terms = _split_name_terms(args.get("class_names"))
    if not terms:
        available = ", ".join(str(item.get("name") or item.get("id")) for item in _class_candidates(root, actor)[:8])
        return [], f"Need class_ids or class_names. Available classes: {available or 'none'}"

    candidates = _class_candidates(root, actor)
    resolved: list[str] = []
    for term in terms:
        needle = term.lower()
        exact = [
            item
            for item in candidates
            if needle in {str(item.get("id") or "").lower(), str(item.get("name") or "").lower()}
        ]
        matches = exact or [item for item in candidates if needle in str(item.get("name") or "").lower()]
        if len(matches) == 1:
            resolved.append(str(matches[0]["id"]))
            continue
        if not matches:
            available = ", ".join(str(item.get("name") or item.get("id")) for item in candidates[:8])
            return [], f"No class matched {term}. Available classes: {available or 'none'}"
        options = ", ".join(f"{item.get('name')}({item.get('id')})" for item in matches[:8])
        return [], f"Class name is ambiguous for {term}. Please choose one: {options}"
    return list(dict.fromkeys(resolved)), None

def _resolve_folder_and_students(root: Path, actor: dict[str, Any], args: dict[str, Any], class_ids: list[str]) -> tuple[str | None, list[str], str | None]:
    folder_id = str(args.get("folder_id") or "").strip() or None
    folder_name = str(args.get("folder_name") or "").strip()
    if not folder_id and folder_name:
        with connect(root) as con:
            rows = con.execute("SELECT id, name FROM content_folders WHERE owner_teacher_id=? AND scope='paper' AND name LIKE ?",
                (str(actor.get("id")), f"%{folder_name}%")).fetchall()
        exact = [row for row in rows if str(row["name"]) == folder_name]
        matches = exact or rows
        if len(matches) != 1:
            return None, [], "文件夹名称不唯一或不存在，请先用 content.folders 选择文件夹 ID"
        folder_id = str(matches[0]["id"])
    student_ids = [str(item).strip() for item in (args.get("student_ids") or []) if str(item).strip()]
    student_names = _split_name_terms(args.get("student_names"))
    if student_names:
        if len(class_ids) != 1:
            return folder_id, [], "按学生姓名发布时须先确定一个班级"
        with connect(root) as con:
            rows = con.execute("SELECT s.id, s.student_no, s.display_name FROM students s JOIN class_students cs ON cs.student_id=s.id WHERE cs.class_id=?", (class_ids[0],)).fetchall()
        for term in student_names:
            exact = [row for row in rows if term in {str(row["id"]), str(row["student_no"]), str(row["display_name"])}]
            matches = exact or [row for row in rows if term in str(row["display_name"])]
            if len(matches) != 1:
                return folder_id, [], f"学生「{term}」不唯一或不在班级中，请用学号或学生 ID 指定"
            student_ids.append(str(matches[0]["id"]))
    return folder_id, list(dict.fromkeys(student_ids)), None

def tool_publish_online_paper(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    actor = _platform_actor(ctx)
    if actor is None:
        return ToolResult(
            status="failed",
            error_code="platform_user_required",
            error_message="A teacher or admin account is required before publishing an online paper.",
        )
    platform_root = default_platform_root()
    paper_id, paper_error = _resolve_paper_id(platform_root, actor, args)
    class_ids, class_error = _resolve_class_ids(platform_root, actor, args)
    if paper_error or class_error or not paper_id or not class_ids:
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message=paper_error or class_error or "paper and class are required",
        )
    folder_id, student_ids, recipient_error = _resolve_folder_and_students(platform_root, actor, args, class_ids)
    if recipient_error:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=recipient_error)
    if not folder_id:
        return ToolResult(status="failed", error_code="folder_required", error_message="发布前须指定文件夹，请先调用 content.folders，必要时调用 content.folder_create。")
    try:
        publication = publish_online_paper(
            platform_root,
            paper_id=paper_id,
            user=actor,
            class_ids=class_ids,
            student_ids=student_ids,
            folder_id=folder_id,
            project_root=ctx.project_root,
            title=str(args.get("title") or "").strip() or None,
            description=str(args.get("description") or "").strip() or None,
            start_at=str(args.get("start_at") or "").strip() or None,
            end_at=str(args.get("end_at") or "").strip() or None,
            submission_mode=str(args.get("submission_mode") or "online"),
            max_screen_switches=int(args.get("max_screen_switches") or 0),
            time_limit_minutes=int(args.get("time_limit_minutes") or 0) or None,
            show_results_immediately=bool(args.get("show_results_immediately")),
            subject=str(args.get("subject") or "").strip() or None,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        return ToolResult(status="failed", error_code="publish_failed", error_message=str(e))
    return ToolResult(
        status="succeeded",
        data={"publication": publication},
        summary_for_llm=f"已发布到 {len(student_ids)} 名指定学生。" if student_ids else f"已发布到 {len(class_ids)} 个班级。",
    )
