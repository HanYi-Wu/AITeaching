from __future__ import annotations

from pathlib import Path

from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.models import ToolRisk
from solaire.agent_layer.registry import FOCUS_PRESETS, get_registered_tool, select_tools_for_turn
from solaire.agent_layer.teacher_capabilities import TEACHER_CAPABILITIES, capability_manifest
from solaire.knowledge_forge import create_graph, get_taxonomy
from solaire.web.actor_scope import teacher_graph_root


def _teacher() -> dict[str, str]:
    return {"id": "teacher-1", "role": "teacher", "school_id": "school-1", "username": "teacher"}


def test_every_teacher_capability_is_executable_or_has_a_complete_manual_guide() -> None:
    assert TEACHER_CAPABILITIES
    areas = {item.area for item in TEACHER_CAPABILITIES}
    assert {"knowledge_graph", "question_bank", "exam", "paper", "system"} <= areas

    for item in TEACHER_CAPABILITIES:
        if item.mode == "ai_tool":
            assert item.tool_name, item.id
            assert get_registered_tool(item.tool_name) is not None, item.tool_name
        else:
            assert item.guide is not None, item.id
            assert item.guide.prerequisites, item.id
            assert len(item.guide.steps) >= 3, item.id
            assert item.guide.safety_note.strip(), item.id


def test_manifest_is_serializable_and_exposes_manual_safety_guidance() -> None:
    manifest = capability_manifest()
    assert manifest["summary"]["total"] == len(TEACHER_CAPABILITIES)
    assert manifest["summary"]["manual_required"] >= 1
    manual = next(item for item in manifest["capabilities"] if item["mode"] == "manual_required")
    assert len(manual["guide"]["steps"]) >= 3


def test_every_executable_capability_is_reachable_from_an_agent_focus() -> None:
    exposed = {
        tool.name
        for focus in FOCUS_PRESETS
        for tool in select_tools_for_turn(
            skill_id=None,
            include_subtask=False,
            current_focus=focus,
            project_root=None,
        )
    }
    expected = {item.tool_name for item in TEACHER_CAPABILITIES if item.mode == "ai_tool"}
    assert expected <= exposed
    assert {"teacher.list_capabilities", "teacher.operation_guide"} <= {
        tool.name
        for tool in select_tools_for_turn(
            skill_id=None,
            include_subtask=False,
            current_focus="general",
            project_root=None,
        )
    }


def test_graph_rename_and_taxonomy_tools_use_authenticated_teacher_scope(tmp_path: Path) -> None:
    teacher = _teacher()
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", platform_user=teacher)
    root = teacher_graph_root(tmp_path, teacher)
    slug = create_graph(root, "Old name", "old-name")

    renamed = get_registered_tool("graph.rename_graph")
    assert renamed is not None
    result = renamed.handler(ctx, {"slug": slug, "display_name": "New name"})
    assert result.status == "succeeded"

    taxonomy = get_registered_tool("graph.set_taxonomy")
    assert taxonomy is not None
    result = taxonomy.handler(ctx, {"subjects": ["New name", "Physics"], "levels": ["Grade 7"]})
    assert result.status == "succeeded"
    assert get_taxonomy(root)["levels"] == ["Grade 7"]


def test_operation_guide_tool_returns_a_complete_manual_flow(tmp_path: Path) -> None:
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", platform_user=_teacher())
    tool = get_registered_tool("teacher.operation_guide")
    assert tool is not None
    result = tool.handler(ctx, {"capability_id": "configure_ai_provider"})
    assert result.status == "succeeded"
    assert len(result.data["guide"]["steps"]) >= 3
    assert result.data["guide"]["safety_note"]


def test_template_tools_reject_invalid_content_and_missing_update_target(tmp_path: Path) -> None:
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", platform_user=_teacher())
    create = get_registered_tool("template.create")
    update = get_registered_tool("template.update")
    assert create is not None and update is not None

    invalid = create.handler(ctx, {"path": "broken.yaml", "content": "title: incomplete"})
    missing = update.handler(ctx, {"path": "missing.yaml", "content": "title: incomplete"})

    assert invalid.status == "failed"
    assert not (tmp_path / "templates" / "broken.yaml").exists()
    assert missing.status == "failed"
    assert not (tmp_path / "templates" / "missing.yaml").exists()


def test_adaptive_practice_capabilities_are_registered_with_safe_risk_boundaries() -> None:
    history = get_registered_tool("paper.practice_history")
    wrong = get_registered_tool("paper.publish_wrong_question_practice")
    reinforcement = get_registered_tool("paper.publish_reinforcement_practice")

    assert history is not None and history.risk == ToolRisk.READ
    assert wrong is not None and wrong.risk == ToolRisk.WRITE
    assert reinforcement is not None and reinforcement.risk == ToolRisk.WRITE
    assert history.parameters_schema["required"] == ["class_id"]
    assert wrong.parameters_schema["required"] == ["class_id", "source_publication_id", "title"]
    assert reinforcement.parameters_schema["required"] == ["class_id", "source_publication_ids", "title"]
    assert reinforcement.parameters_schema["properties"]["source_publication_ids"]["minItems"] == 3
    assert wrong.parameters_schema["properties"]["max_questions_per_student"] == {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
    }

    capability_tools = {item.tool_name for item in TEACHER_CAPABILITIES if item.mode == "ai_tool"}
    assert {
        "paper.practice_history",
        "paper.publish_wrong_question_practice",
        "paper.publish_reinforcement_practice",
    } <= capability_tools
