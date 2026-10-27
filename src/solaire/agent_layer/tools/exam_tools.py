"""Exam / template tools via exam_compiler facade + web exam_service glue."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.exam_export_adapter import (
    _export_paper_locked,
    _sections_from_args,
    tool_export_paper,
    tool_validate_paper,
)
from solaire.agent_layer.tools.exam_grading_adapter import (
    tool_ai_grade_submission,
)
from solaire.agent_layer.tools.exam_publish_adapter import (
    _class_candidates,
    _paper_candidates,
    _platform_actor,
    _resolve_class_ids,
    _resolve_folder_and_students,
    _resolve_paper_id,
    _split_name_terms,
    tool_publish_online_paper,
)
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
from solaire.web.paper_service import (
    publish_online_paper,
    resolve_paper_attempt,
    suggest_ai_grades_for_attempt,
)
from solaire.web.platform_db import (
    connect,
    default_platform_root,
    init_platform_db,
    row_to_dict,
)

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
