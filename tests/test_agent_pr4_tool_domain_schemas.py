"""Regression tests for Task D02: Domain-specific schema partitioning and compatibility."""

from __future__ import annotations

from solaire.agent_layer.models import ToolRisk
from solaire.agent_layer.tools.analysis_schemas import ANALYSIS_TOOLS
from solaire.agent_layer.tools.bank_schemas import BANK_TOOLS
from solaire.agent_layer.tools.base_schemas import BASE_TOOLS
from solaire.agent_layer.tools.doc_file_schemas import DOC_FILE_TOOLS
from solaire.agent_layer.tools.exam_schemas import EXAM_TOOLS
from solaire.agent_layer.tools.grading_schemas import GRADING_TOOLS
from solaire.agent_layer.tools.graph_schemas import GRAPH_TOOLS
from solaire.agent_layer.tools.tool_definitions import (
    SUBTASK_TOOL_NAME,
    TOOLS,
    RegisteredTool,
    subtask_tool_schema,
)


def test_domain_schemas_direct_imports() -> None:
    """Each domain schema module can be imported independently with correct counts."""
    assert len(ANALYSIS_TOOLS) == 7
    assert len(BANK_TOOLS) == 17
    assert len(GRAPH_TOOLS) == 22
    assert len(EXAM_TOOLS) == 29
    assert len(GRADING_TOOLS) == 4
    assert len(DOC_FILE_TOOLS) == 8
    assert len(BASE_TOOLS) == 16

    # Verify domain prefix cohesion
    assert all(t.name.startswith("analysis.") for t in ANALYSIS_TOOLS)
    assert all(t.name.startswith("bank.") or t.name.startswith("content.") for t in BANK_TOOLS)
    assert all(t.name.startswith("graph.") for t in GRAPH_TOOLS)
    assert all(
        t.name.startswith("exam.") or t.name.startswith("template.") or t.name.startswith("paper.")
        for t in EXAM_TOOLS
    )
    assert all(t.name in {
        "exam.ai_grade_submission",
        "paper.ai_grade_pending",
        "paper.manual_grade",
        "paper.complete_grading",
    } for t in GRADING_TOOLS)
    assert all(t.name.startswith("doc.") or t.name.startswith("file.") for t in DOC_FILE_TOOLS)
    assert all(
        t.name.startswith("agent.") or t.name.startswith("memory.") or t.name.startswith("web.") or t.name.startswith("teacher.")
        for t in BASE_TOOLS
    )


def test_domain_schemas_partition_is_complete_and_disjoint() -> None:
    """The 7 domain modules form a strict partition of all 103 tools in TOOLS."""
    all_domain_lists = [
        ANALYSIS_TOOLS,
        BANK_TOOLS,
        GRAPH_TOOLS,
        EXAM_TOOLS,
        GRADING_TOOLS,
        DOC_FILE_TOOLS,
        BASE_TOOLS,
    ]

    total_names: list[str] = []
    for group in all_domain_lists:
        group_names = [t.name for t in group]
        assert len(group_names) == len(set(group_names)), "No duplicates within domain group"
        total_names.extend(group_names)

    assert len(total_names) == 103
    assert len(set(total_names)) == 103, "No duplicates across domain groups"

    tools_names = [t.name for t in TOOLS]
    assert set(total_names) == set(tools_names), "Domain modules match TOOLS set exactly"
    assert len(TOOLS) == 103


def test_legacy_tool_definitions_compatibility() -> None:
    """Unified tool_definitions entrypoint preserves legacy exports, order, and schemas."""
    assert SUBTASK_TOOL_NAME == "agent.run_subtask"
    st = subtask_tool_schema()
    assert isinstance(st, RegisteredTool)
    assert st.name == SUBTASK_TOOL_NAME
    assert st.risk == ToolRisk.WRITE
    st.validate()

    # All tools in legacy TOOLS must pass validation
    for t in TOOLS:
        t.validate()
        assert isinstance(t.parameters_schema, dict)
        assert t.parameters_schema.get("type") == "object"
        assert t.description.strip()
        assert callable(t.handler)


def test_domain_schema_field_consistency() -> None:
    """Check that parameters_schema preserves JSON Schema semantics and non-empty metadata."""
    for t in TOOLS:
        schema = t.parameters_schema
        assert schema.get("type") == "object"
        assert "properties" in schema
        assert isinstance(schema["properties"], dict)
        if "required" in schema:
            assert isinstance(schema["required"], list)
            for r in schema["required"]:
                assert r in schema["properties"], f"Required parameter '{r}' missing in properties for {t.name}"
