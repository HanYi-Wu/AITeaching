from __future__ import annotations

from solaire.agent_layer.registry import get_registered_tool, select_tools_for_turn


def test_teacher_ai_tools_include_online_publish_and_grading() -> None:
    publish_tool = get_registered_tool("exam.publish_online_paper")
    grade_tool = get_registered_tool("exam.ai_grade_submission")

    assert publish_tool is not None
    assert grade_tool is not None
    assert "submission_mode" in publish_tool.parameters_schema["properties"]
    assert "question_ids" in grade_tool.parameters_schema["properties"]


def test_compose_focus_exposes_publish_and_analysis_focus_exposes_ai_grading() -> None:
    compose_names = {
        tool.name
        for tool in select_tools_for_turn(
            skill_id=None,
            include_subtask=False,
            current_focus="compose",
            project_root=None,
        )
    }
    analysis_names = {
        tool.name
        for tool in select_tools_for_turn(
            skill_id=None,
            include_subtask=False,
            current_focus="analysis",
            project_root=None,
        )
    }

    assert "exam.publish_online_paper" in compose_names
    assert "exam.ai_grade_submission" in analysis_names
