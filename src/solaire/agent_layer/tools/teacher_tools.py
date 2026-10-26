"""Teacher capability tools that bridge agent chat to existing web services."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.teacher_capabilities import capability_manifest, get_capability
from solaire.agent_layer.tools.teacher_content_adapter import (
    tool_bank_delete_collection,
    tool_bank_delete_item,
    tool_bank_rename_collection,
    tool_content_folder_create,
    tool_content_folder_update,
    tool_content_folders,
    tool_content_item_tags,
    tool_content_move_item,
    tool_content_tag_save,
    tool_content_tags,
)
from solaire.agent_layer.tools.teacher_grading_adapter import (
    tool_paper_ai_grade_pending,
    tool_paper_complete_grading,
    tool_paper_find_submissions,
    tool_paper_manual_grade,
    tool_paper_submissions,
)
from solaire.agent_layer.tools.teacher_graph_adapter import (
    tool_graph_detach_resource,
    tool_graph_get_taxonomy,
    tool_graph_rename,
    tool_graph_set_taxonomy,
    tool_graph_unbind_question,
)
from solaire.agent_layer.tools.teacher_paper_adapter import (
    _practice_settings,
    tool_paper_analyze,
    tool_paper_folder_analyze,
    tool_paper_list,
    tool_paper_offline_upload_guide,
    tool_paper_practice_history,
    tool_paper_publications,
    tool_paper_publish_reinforcement_practice,
    tool_paper_publish_wrong_question_practice,
    tool_paper_revoke_publication,
    tool_paper_update_delivery,
    tool_paper_update_publication,
)
from solaire.agent_layer.tools.teacher_tool_helpers import (
    _actor,
    _ok,
    _required,
    _run,
)
from solaire.agent_layer.tools.teacher_workspace_adapter import (
    _template_path,
    _template_root,
    _validate_template_file,
    _write_template,
    tool_exam_workspace_copy,
    tool_exam_workspace_delete,
    tool_exam_workspace_get,
    tool_exam_workspace_list,
    tool_exam_workspace_save,
    tool_template_create,
    tool_template_delete,
    tool_template_get,
    tool_template_list,
    tool_template_rename,
    tool_template_update,
)
from solaire.web.paper_service import (
    get_teacher_student_profile,
    list_teacher_classes,
)
from solaire.web.platform_db import default_platform_root

def tool_list_capabilities(_ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    return ToolResult(status="succeeded", data=capability_manifest())

def tool_operation_guide(_ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    capability_id = str(args.get("capability_id") or "").strip()
    item = get_capability(capability_id)
    if item is None:
        return ToolResult(status="failed", error_code="not_found", error_message="Unknown teacher capability")
    if item.guide is None:
        return _ok(
            capability_id=item.id,
            mode=item.mode,
            tool_name=item.tool_name,
            message="This operation can be completed directly through AI chat.",
        )
    return _ok(
        capability_id=item.id,
        mode=item.mode,
        guide={
            "prerequisites": list(item.guide.prerequisites),
            "steps": list(item.guide.steps),
            "safety_note": item.guide.safety_note,
        },
    )

def tool_teacher_student_profile(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def invoke() -> dict[str, Any]:
        class_id = str(args.get("class_id") or "").strip()
        if not class_id:
            matches: set[str] = set()
            for klass in list_teacher_classes(default_platform_root(), _actor(ctx)):
                try:
                    profile = get_teacher_student_profile(
                        default_platform_root(),
                        class_id=str(klass["id"]),
                        user=_actor(ctx),
                        student_id=str(args.get("student_id") or "") or None,
                        student_query=str(args.get("student_query") or "") or None,
                        date_from=str(args.get("date_from") or "") or None,
                        date_to=str(args.get("date_to") or "") or None,
                    )
                except ValueError:
                    continue
                matches.add(str(klass["id"]))
                if len(matches) == 1:
                    selected = profile
            if not matches:
                raise ValueError("未在教师已分配班级中找到该学生")
            if len(matches) > 1:
                raise ValueError("该学生属于多个已分配班级，请同时提供 class_id")
            return selected
        return get_teacher_student_profile(
            default_platform_root(),
            class_id=class_id,
            user=_actor(ctx),
            student_id=str(args.get("student_id") or "") or None,
            student_query=str(args.get("student_query") or "") or None,
            date_from=str(args.get("date_from") or "") or None,
            date_to=str(args.get("date_to") or "") or None,
        )

    return _run(invoke)
