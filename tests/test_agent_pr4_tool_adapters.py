"""Regression tests for Task D03: Teacher and Exam handler adapter extraction and parity."""

from __future__ import annotations

from pathlib import Path
import pytest

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools import (
    exam_export_adapter,
    exam_grading_adapter,
    exam_publish_adapter,
    exam_tools,
    teacher_content_adapter,
    teacher_grading_adapter,
    teacher_graph_adapter,
    teacher_paper_adapter,
    teacher_tools,
    teacher_workspace_adapter,
)


def test_teacher_adapter_exports_and_parity() -> None:
    """Verify that teacher_tools preserves backwards-compatible facade exports for all adapters."""
    # Paper adapter
    assert teacher_tools.tool_paper_list is teacher_paper_adapter.tool_paper_list
    assert teacher_tools.tool_paper_analyze is teacher_paper_adapter.tool_paper_analyze
    assert teacher_tools.tool_paper_publications is teacher_paper_adapter.tool_paper_publications
    assert teacher_tools.tool_paper_folder_analyze is teacher_paper_adapter.tool_paper_folder_analyze
    assert teacher_tools.tool_paper_practice_history is teacher_paper_adapter.tool_paper_practice_history
    assert teacher_tools.tool_paper_publish_wrong_question_practice is teacher_paper_adapter.tool_paper_publish_wrong_question_practice
    assert teacher_tools.tool_paper_publish_reinforcement_practice is teacher_paper_adapter.tool_paper_publish_reinforcement_practice
    assert teacher_tools.tool_paper_update_delivery is teacher_paper_adapter.tool_paper_update_delivery
    assert teacher_tools.tool_paper_update_publication is teacher_paper_adapter.tool_paper_update_publication
    assert teacher_tools.tool_paper_revoke_publication is teacher_paper_adapter.tool_paper_revoke_publication

    # Grading adapter
    assert teacher_tools.tool_paper_submissions is teacher_grading_adapter.tool_paper_submissions
    assert teacher_tools.tool_paper_find_submissions is teacher_grading_adapter.tool_paper_find_submissions
    assert teacher_tools.tool_paper_ai_grade_pending is teacher_grading_adapter.tool_paper_ai_grade_pending
    assert teacher_tools.tool_paper_manual_grade is teacher_grading_adapter.tool_paper_manual_grade
    assert teacher_tools.tool_paper_complete_grading is teacher_grading_adapter.tool_paper_complete_grading

    # Workspace & Template adapter
    assert teacher_tools.tool_template_list is teacher_workspace_adapter.tool_template_list
    assert teacher_tools.tool_template_get is teacher_workspace_adapter.tool_template_get
    assert teacher_tools.tool_template_create is teacher_workspace_adapter.tool_template_create
    assert teacher_tools.tool_template_update is teacher_workspace_adapter.tool_template_update
    assert teacher_tools.tool_template_rename is teacher_workspace_adapter.tool_template_rename
    assert teacher_tools.tool_template_delete is teacher_workspace_adapter.tool_template_delete
    assert teacher_tools.tool_exam_workspace_list is teacher_workspace_adapter.tool_exam_workspace_list
    assert teacher_tools.tool_exam_workspace_get is teacher_workspace_adapter.tool_exam_workspace_get
    assert teacher_tools.tool_exam_workspace_save is teacher_workspace_adapter.tool_exam_workspace_save
    assert teacher_tools.tool_exam_workspace_delete is teacher_workspace_adapter.tool_exam_workspace_delete
    assert teacher_tools.tool_exam_workspace_copy is teacher_workspace_adapter.tool_exam_workspace_copy

    # Content adapter
    assert teacher_tools.tool_content_folders is teacher_content_adapter.tool_content_folders
    assert teacher_tools.tool_content_folder_create is teacher_content_adapter.tool_content_folder_create
    assert teacher_tools.tool_content_folder_update is teacher_content_adapter.tool_content_folder_update
    assert teacher_tools.tool_content_move_item is teacher_content_adapter.tool_content_move_item
    assert teacher_tools.tool_content_tags is teacher_content_adapter.tool_content_tags
    assert teacher_tools.tool_content_tag_save is teacher_content_adapter.tool_content_tag_save
    assert teacher_tools.tool_content_item_tags is teacher_content_adapter.tool_content_item_tags
    assert teacher_tools.tool_bank_delete_item is teacher_content_adapter.tool_bank_delete_item

    # Graph adapter
    assert teacher_tools.tool_graph_rename is teacher_graph_adapter.tool_graph_rename
    assert teacher_tools.tool_graph_get_taxonomy is teacher_graph_adapter.tool_graph_get_taxonomy
    assert teacher_tools.tool_graph_set_taxonomy is teacher_graph_adapter.tool_graph_set_taxonomy
    assert teacher_tools.tool_graph_unbind_question is teacher_graph_adapter.tool_graph_unbind_question
    assert teacher_tools.tool_graph_detach_resource is teacher_graph_adapter.tool_graph_detach_resource


def test_exam_adapter_exports_and_parity() -> None:
    """Verify that exam_tools preserves backwards-compatible facade exports for exam adapters."""
    assert exam_tools.tool_validate_paper is exam_export_adapter.tool_validate_paper
    assert exam_tools.tool_export_paper is exam_export_adapter.tool_export_paper
    assert exam_tools.tool_publish_online_paper is exam_publish_adapter.tool_publish_online_paper
    assert exam_tools.tool_ai_grade_submission is exam_grading_adapter.tool_ai_grade_submission
    assert exam_tools._platform_actor is exam_publish_adapter._platform_actor


def test_server_side_authorization_enforced(tmp_path: Path) -> None:
    """Restricted operations enforce server-side auth checking without leaking privileges."""
    ctx_unauth = InvocationContext(session_id="unauth", project_root=tmp_path, platform_user=None)

    # 1. Online paper publication requires active teacher/admin
    res_pub = exam_publish_adapter.tool_publish_online_paper(ctx_unauth, {"paper_id": "p1"})
    assert res_pub.status == "failed"
    assert res_pub.error_code == "platform_user_required"

    # Also callable through facade
    res_pub_facade = exam_tools.tool_publish_online_paper(ctx_unauth, {"paper_id": "p1"})
    assert res_pub_facade.status == "failed"
    assert res_pub_facade.error_code == "platform_user_required"

    # 2. AI grading requires active teacher/admin
    res_grade = exam_grading_adapter.tool_ai_grade_submission(ctx_unauth, {"paper_id": "p1", "attempt_id": "a1"})
    assert res_grade.status == "failed"
    assert res_grade.error_code == "platform_user_required"

    res_grade_facade = exam_tools.tool_ai_grade_submission(ctx_unauth, {"paper_id": "p1", "attempt_id": "a1"})
    assert res_grade_facade.status == "failed"
    assert res_grade_facade.error_code == "platform_user_required"
