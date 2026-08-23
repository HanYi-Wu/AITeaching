"""Exam / template tools via exam_compiler facade + web exam_service glue."""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.common.security import assert_within_project
from solaire.exam_compiler.facade import SelectedSection, load_template
from solaire.web.platform_db import connect, default_platform_root, init_platform_db, row_to_dict
from solaire.web.exam_service import (
    VALIDATE_EXAM_NAME,
    discard_build_yaml_backup,
    export_pdfs,
    find_export_conflict,
    restore_build_yaml_from_backup,
    run_validate,
    run_validate_with_checks,
    write_build_exam_yaml,
    write_exam_yaml,
    snapshot_build_yaml_before_export,
)
from solaire.web.paper_service import publish_online_paper, resolve_paper_attempt, suggest_ai_grades_for_attempt
from solaire.web.exam_workspace_service import (
    exam_id_from_labels,
    mark_exported,
    save_exam_workspace_after_export_failure,
    workspace_dir,
)


def _sections_from_args(args: dict[str, Any]) -> list[SelectedSection]:
    raw = args.get("selected_items") or []
    out: list[SelectedSection] = []
    for s in raw:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("section_id") or "").strip()
        qids = s.get("question_ids") or []
        if sid and isinstance(qids, list):
            spi = s.get("score_per_item")
            score_per_item: float | None
            try:
                score_per_item = float(spi) if spi is not None else None
            except (TypeError, ValueError):
                score_per_item = None
            so = s.get("score_overrides")
            score_overrides: dict[str, float] | None = None
            if isinstance(so, dict) and so:
                try:
                    score_overrides = {str(k): float(v) for k, v in so.items()}
                except (TypeError, ValueError):
                    score_overrides = None
            out.append(
                SelectedSection(
                    section_id=sid,
                    question_ids=[str(x) for x in qids],
                    score_per_item=score_per_item,
                    score_overrides=score_overrides,
                )
            )
    return out


def tool_list_templates(ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    root = ctx.project_root
    templates_dir = root / "templates"
    if not templates_dir.is_dir():
        return ToolResult(status="succeeded", data={"templates": []})
    out: list[dict[str, Any]] = []
    for p in sorted(templates_dir.rglob("*.yaml")):
        rel = p.relative_to(root).as_posix()
        try:
            t = load_template(p)
        except Exception as e:
            out.append({"id": None, "path": rel, "error": str(e)})
            continue
        md = dict(t.metadata_defaults) if t.metadata_defaults else {}
        out.append(
            {
                "id": t.template_id,
                "path": rel,
                "layout": t.layout,
                "latex_base": t.latex_base,
                "metadata_defaults": md,
                "sections": [
                    {
                        "section_id": s.section_id,
                        "type": s.type,
                        "required_count": s.required_count,
                        "score_per_item": s.score_per_item,
                    }
                    for s in t.sections
                ],
            }
        )
    return ToolResult(status="succeeded", data={"templates": [x for x in out if x.get("id")]})


def tool_template_preview(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    root = ctx.project_root
    rel = str(args.get("template_path") or "").strip()
    if not rel:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="template_path required")
    p = (root / rel).resolve()
    assert_within_project(root, p)
    if not p.is_file():
        return ToolResult(status="failed", error_code="not_found", error_message="模板文件不存在")
    try:
        t = load_template(p)
    except Exception as e:
        return ToolResult(status="failed", error_code="runtime_error", error_message=str(e))
    return ToolResult(
        status="succeeded",
        data={
            "id": t.template_id,
            "path": rel,
            "sections": [s.model_dump(mode="json") for s in t.sections],
            "metadata_defaults": dict(t.metadata_defaults) if t.metadata_defaults else {},
        },
    )


def tool_validate_paper(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    root = ctx.project_root
    template_ref = str(args.get("template_ref") or "").strip()
    template_path = str(args.get("template_path") or "").strip()
    if not template_ref or not template_path:
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="template_ref 与 template_path 必填",
        )
    include_latex_check = bool(args.get("include_latex_check"))
    include_math_static = args.get("include_math_static")
    if include_math_static is None:
        include_math_static = True
    else:
        include_math_static = bool(include_math_static)
    tpl = (root / template_path).resolve()
    try:
        assert_within_project(root, tpl)
    except Exception as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    sections = _sections_from_args(args)
    exam_yaml = write_exam_yaml(
        root,
        yaml_basename=VALIDATE_EXAM_NAME,
        exam_id="validate",
        template_ref=template_ref,
        template_relative=template_path,
        metadata={},
        selected_items=sections,
    )
    try:
        extra = run_validate_with_checks(
            root,
            exam_yaml,
            include_latex_check=include_latex_check,
            include_math_static=include_math_static,
        )
    except ValueError as e:
        return ToolResult(status="failed", error_code="validation_failed", error_message=str(e))
    data: dict[str, Any] = {
        "ok": True,
        "exam_yaml": exam_yaml.relative_to(root).as_posix(),
        "structure_ok": extra.get("structure_ok"),
        "math_warnings": extra.get("math_warnings") or [],
    }
    if include_latex_check:
        data["latex_ok"] = extra.get("latex_ok")
        data["latex_error_excerpt"] = extra.get("latex_error_excerpt")
    else:
        data["latex_ok"] = None
        data["latex_note"] = "未进行版式编译试跑；导出前可开启 include_latex_check。"
    return ToolResult(status="succeeded", data=data)


def tool_export_paper(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    root = ctx.project_root
    template_ref = str(args.get("template_ref") or "").strip()
    template_path = str(args.get("template_path") or "").strip()
    export_label = str(args.get("export_label") or "").strip()
    subject = str(args.get("subject") or "").strip()
    allow_replace = bool(args.get("allow_replace_conflicting_export"))
    if not all([template_ref, template_path, export_label, subject]):
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="template_ref、template_path、export_label、subject 必填",
        )
    tpl = (root / template_path).resolve()
    try:
        assert_within_project(root, tpl)
    except Exception as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    if not tpl.is_file():
        return ToolResult(status="failed", error_code="not_found", error_message="模板文件不存在")

    try:
        mark_id = exam_id_from_labels(export_label, subject)
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))

    sections = _sections_from_args(args)
    snapshot_items = [s.model_dump(mode="json", exclude_none=True) for s in sections]

    def _failure_snapshot(exc: BaseException) -> None:
        try:
            save_exam_workspace_after_export_failure(
                root,
                template_ref=template_ref,
                template_path=template_path,
                export_label=export_label,
                subject=subject,
                selected_items=snapshot_items,
            )
        except Exception:
            pass

    backup = snapshot_build_yaml_before_export(root)
    try:
        conflict = find_export_conflict(root, export_label, subject)
        if conflict.get("conflict") and conflict.get("existing_exam_id"):
            ex_id = str(conflict["existing_exam_id"])
            if ex_id != mark_id and not allow_replace:
                discard_build_yaml_backup(backup)
                return ToolResult(
                    status="failed",
                    error_code="export_conflict",
                    error_message=(
                        "已存在相同试卷说明与学科的其它考试目录。"
                        "若确认仍要导出，请在参数中启用允许替换冲突目录。"
                    ),
                )

        title = args.get("metadata_title") or export_label
        metadata: dict[str, Any] = {
            "title": str(title),
            "subject": subject,
            "export_label": export_label,
        }
        exam_yaml = write_build_exam_yaml(
            root,
            exam_id="agent_export",
            template_ref=template_ref,
            template_relative=template_path,
            metadata=metadata,
            selected_items=sections,
        )
        run_validate(root, exam_yaml)
        template = load_template(tpl)
        dest_dir = workspace_dir(root, mark_id)
        exam_dir, s_name, t_name = export_pdfs(
            root,
            exam_yaml=exam_yaml,
            export_label=export_label,
            subject=subject,
            template=template,
            dest_dir=dest_dir,
        )
    except ValueError as e:
        restore_build_yaml_from_backup(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="validation_failed", error_message=str(e))
    except FileNotFoundError as e:
        restore_build_yaml_from_backup(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="not_found", error_message=str(e))
    except RuntimeError as e:
        restore_build_yaml_from_backup(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="runtime_error", error_message=str(e))
    except Exception as e:
        restore_build_yaml_from_backup(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="runtime_error", error_message=str(e))
    else:
        discard_build_yaml_backup(backup)

    try:
        mark_exported(root, mark_id)
    except Exception:
        pass

    rel = exam_dir.relative_to(root).as_posix()
    return ToolResult(
        status="succeeded",
        data={
            "ok": True,
            "exam_dir": rel,
            "student_pdf": s_name,
            "teacher_pdf": t_name,
        },
    )


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


def tool_publish_online_paper(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    actor = _platform_actor(ctx)
    if actor is None:
        return ToolResult(
            status="failed",
            error_code="platform_user_required",
            error_message="需要先创建管理员或教师账号，才能通过 AI 发布线上试卷。",
        )
    paper_id = str(args.get("paper_id") or "").strip()
    class_ids = [str(item).strip() for item in (args.get("class_ids") or []) if str(item).strip()]
    if not paper_id or not class_ids:
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="paper_id 和 class_ids 不能为空。",
        )
    try:
        publication = publish_online_paper(
            default_platform_root(),
            paper_id=paper_id,
            user=actor,
            class_ids=class_ids,
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
    except (ValueError, PermissionError, FileNotFoundError) as e:
        return ToolResult(status="failed", error_code="publish_failed", error_message=str(e))
    return ToolResult(
        status="succeeded",
        data={"publication": publication},
        summary_for_llm=f"已发布试卷到 {len(class_ids)} 个班级。",
    )


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
    try:
        publication = publish_online_paper(
            platform_root,
            paper_id=paper_id,
            user=actor,
            class_ids=class_ids,
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
        summary_for_llm=f"Published paper to {len(class_ids)} class(es).",
    )


def tool_ai_grade_submission(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    actor = _platform_actor(ctx)
    if actor is None:
        return ToolResult(
            status="failed",
            error_code="platform_user_required",
            error_message="需要先创建管理员或教师账号，才能通过 AI 批改提交。",
        )
    paper_id = str(args.get("paper_id") or "").strip()
    attempt_id = str(args.get("attempt_id") or "").strip()
    student_query = str(args.get("student_query") or "").strip()
    if not paper_id or (not attempt_id and not student_query):
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="paper_id 和 attempt_id 不能为空。",
        )
    raw_qids = args.get("question_ids")
    question_ids = [str(item).strip() for item in raw_qids if str(item).strip()][:50] if isinstance(raw_qids, list) else None
    try:
        attempt = resolve_paper_attempt(
            default_platform_root(),
            paper_id=paper_id,
            user=actor,
            attempt_id=attempt_id or None,
            student_query=student_query or None,
            require_submitted=True,
        )
        if question_ids is None:
            with connect(default_platform_root()) as con:
                rows = con.execute(
                    """
                    SELECT question_id
                    FROM student_answers
                    WHERE attempt_id = ? AND COALESCE(grading_status, 'pending') = 'pending'
                    ORDER BY responded_at, question_id
                    """,
                    (str(attempt["id"]),),
                ).fetchall()
            question_ids = [str(row["question_id"]) for row in rows][:50]
            if not question_ids:
                return ToolResult(
                    status="succeeded",
                    data={
                        "attempt_id": attempt.get("id"),
                        "student_no": attempt.get("student_no"),
                        "student_name": attempt.get("student_name"),
                        "suggestions": [],
                    },
                    summary_for_llm="该答卷没有待预批改题目，未覆盖教师已审核结果。",
                )
        suggestions = suggest_ai_grades_for_attempt(
            default_platform_root(),
            ctx.project_root,
            paper_id=paper_id,
            attempt_id=str(attempt["id"]),
            user=actor,
            question_ids=question_ids,
        )
    except (ValueError, PermissionError, FileNotFoundError) as e:
        return ToolResult(status="failed", error_code="ai_grade_failed", error_message=str(e))
    return ToolResult(
        status="succeeded",
        data={
            "attempt_id": attempt.get("id"),
            "student_no": attempt.get("student_no"),
            "student_name": attempt.get("student_name"),
            "suggestions": suggestions,
        },
        summary_for_llm=f"已生成 {len(suggestions)} 条 AI 批改建议，等待教师审核。",
    )
