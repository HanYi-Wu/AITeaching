"""Exam validation and PDF/Word export adapter."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.common.security import assert_within_project
from solaire.exam_compiler.facade import SelectedSection, load_template
from solaire.web.exam_service import (
    VALIDATE_EXAM_NAME,
    discard_build_yaml_backup,
    export_pdfs,
    find_export_conflict,
    restore_build_yaml_from_backup,
    run_validate,
    run_validate_with_checks,
    snapshot_build_yaml_before_export,
    write_build_exam_yaml,
    write_exam_yaml,
)
from solaire.web.exam_workspace_service import (
    exam_id_from_labels,
    mark_exported,
    save_exam_workspace_after_export_failure,
    workspace_dir,
)
from solaire.web.export_lock import ExportBusyError, project_export_lock
from solaire.web.export_policy import assert_destination_owner

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
                    required_count=int(s["required_count"]) if s.get("required_count") is not None else None,
                )
            )
    return out

def tool_validate_paper(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    from solaire.agent_layer.tools import exam_tools
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
        extra = getattr(exam_tools, 'run_validate_with_checks', run_validate_with_checks)(
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
    try:
        with project_export_lock(ctx.project_root):
            return _export_paper_locked(ctx, args)
    except ExportBusyError as exc:
        return ToolResult(status="failed", error_code="export_busy", error_message=str(exc))

def _export_paper_locked(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    from solaire.agent_layer.tools import exam_tools
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

    teacher_id = None
    if ctx.platform_user and ctx.platform_user.get("role") == "teacher":
        teacher_id = str(ctx.platform_user.get("id") or "").strip()
        if not teacher_id:
            return ToolResult(status="failed", error_code="permission_denied", error_message="教师身份缺失，不能导出试卷。")
    try:
        dest_dir = workspace_dir(root, mark_id)
        getattr(exam_tools, 'assert_destination_owner', assert_destination_owner)(root, dest_dir, teacher_id)
    except HTTPException as exc:
        return ToolResult(status="failed", error_code="permission_denied" if exc.status_code == 403 else "invalid_arguments", error_message=str(exc.detail))
    except (PermissionError, ValueError) as exc:
        return ToolResult(status="failed", error_code="permission_denied", error_message=str(exc))

    def _failure_snapshot(exc: BaseException) -> None:
        try:
            getattr(exam_tools, 'save_exam_workspace_after_export_failure', save_exam_workspace_after_export_failure)(
                root,
                template_ref=template_ref,
                template_path=template_path,
                export_label=export_label,
                subject=subject,
                selected_items=snapshot_items,
            )
        except Exception:
            pass

    backup = getattr(exam_tools, 'snapshot_build_yaml_before_export', snapshot_build_yaml_before_export)(root)
    try:
        conflict = getattr(exam_tools, 'find_export_conflict', find_export_conflict)(root, export_label, subject)
        if conflict.get("conflict") and conflict.get("existing_exam_id"):
            ex_id = str(conflict["existing_exam_id"])
            if ex_id != mark_id and not allow_replace:
                getattr(exam_tools, 'discard_build_yaml_backup', discard_build_yaml_backup)(backup)
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
        if teacher_id:
            metadata["owner_teacher_id"] = teacher_id
        exam_yaml = getattr(exam_tools, 'write_build_exam_yaml', write_build_exam_yaml)(
            root,
            exam_id="agent_export",
            template_ref=template_ref,
            template_relative=template_path,
            metadata=metadata,
            selected_items=sections,
        )
        prepared = getattr(exam_tools, 'run_validate', run_validate)(root, exam_yaml)
        template = prepared.template if prepared is not None else getattr(exam_tools, 'load_template', load_template)(tpl)
        exam_dir, s_name, t_name = getattr(exam_tools, 'export_pdfs', export_pdfs)(
            root,
            exam_yaml=exam_yaml,
            export_label=export_label,
            subject=subject,
            template=template,
            dest_dir=dest_dir,
            **({"prepared": prepared} if prepared is not None else {}),
        )
    except ValueError as e:
        getattr(exam_tools, 'restore_build_yaml_from_backup', restore_build_yaml_from_backup)(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="validation_failed", error_message=str(e))
    except FileNotFoundError as e:
        getattr(exam_tools, 'restore_build_yaml_from_backup', restore_build_yaml_from_backup)(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="not_found", error_message=str(e))
    except RuntimeError as e:
        getattr(exam_tools, 'restore_build_yaml_from_backup', restore_build_yaml_from_backup)(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="runtime_error", error_message=str(e))
    except Exception as e:
        getattr(exam_tools, 'restore_build_yaml_from_backup', restore_build_yaml_from_backup)(root, backup)
        _failure_snapshot(e)
        return ToolResult(status="failed", error_code="runtime_error", error_message=str(e))
    else:
        getattr(exam_tools, 'discard_build_yaml_backup', discard_build_yaml_backup)(backup)

    try:
        getattr(exam_tools, 'mark_exported', mark_exported)(root, mark_id)
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
