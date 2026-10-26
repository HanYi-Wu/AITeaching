"""Regression tests for Task D01: tool catalog composition and contract validation."""

from __future__ import annotations

from pathlib import Path
import pytest

from solaire.agent_layer.models import InvocationContext, ToolResult, ToolRisk
from solaire.agent_layer.registry import (
    DuplicateToolError,
    InvalidToolSchemaError,
    MissingHandlerError,
    ToolContractError,
    all_registered_tools,
    build_tool_registry,
    get_registered_tool,
    invoke_registered_tool,
    register_tool,
    unregister_tool,
    validate_registered_tool,
)
from solaire.agent_layer.tools.tool_definitions import (
    TOOLS,
    RegisteredTool,
    subtask_tool_schema,
)


def _dummy_handler(ctx: InvocationContext, args: dict) -> ToolResult:
    return ToolResult(status="succeeded", data={"result": "executed"})


def test_registered_tool_catalog_integrity() -> None:
    """Verify that all default registered tools pass contract validation without omission."""
    assert len(TOOLS) > 0
    names = [t.name for t in TOOLS]
    assert len(names) == len(set(names)), "Default TOOLS must have unique names"

    for tool in TOOLS:
        tool.validate()

    subtask = subtask_tool_schema()
    subtask.validate()

    all_tools = all_registered_tools(include_subtask=True)
    assert len(all_tools) == len(TOOLS) + 1
    assert any(t.name == subtask.name for t in all_tools)


def test_duplicate_tool_registration_rejected() -> None:
    """Registering a duplicate tool name raises DuplicateToolError identifying the tool."""
    tool1 = RegisteredTool(
        name="custom.test_tool",
        description="A test tool",
        parameters_schema={"type": "object", "properties": {"q": {"type": "string"}}},
        handler=_dummy_handler,
        risk=ToolRisk.READ,
    )
    tool2 = RegisteredTool(
        name="custom.test_tool",
        description="Another tool with identical name",
        parameters_schema={"type": "object", "properties": {}},
        handler=_dummy_handler,
        risk=ToolRisk.WRITE,
    )

    with pytest.raises(DuplicateToolError) as exc_info:
        build_tool_registry([tool1, tool2])
    assert "custom.test_tool" in str(exc_info.value)
    assert "already registered" in str(exc_info.value)


def test_missing_handler_rejected() -> None:
    """Tools with None or non-callable handler raise MissingHandlerError."""
    tool_none = RegisteredTool(
        name="custom.missing_handler",
        description="Missing handler tool",
        parameters_schema={"type": "object", "properties": {}},
        handler=None,  # type: ignore[arg-type]
    )
    with pytest.raises(MissingHandlerError) as exc_info:
        validate_registered_tool(tool_none)
    assert "custom.missing_handler" in str(exc_info.value)
    assert "handler is missing" in str(exc_info.value)

    tool_non_callable = RegisteredTool(
        name="custom.bad_handler",
        description="Non callable handler tool",
        parameters_schema={"type": "object", "properties": {}},
        handler="not_callable",  # type: ignore[arg-type]
    )
    with pytest.raises(MissingHandlerError) as exc_info:
        validate_registered_tool(tool_non_callable)
    assert "custom.bad_handler" in str(exc_info.value)
    assert "not callable" in str(exc_info.value)


def test_schema_contract_validation_rejects_inconsistencies() -> None:
    """Schema checks catch invalid types, non-object schemas, and undeclared required params."""
    # 1. Non-dict schema
    tool_bad_dict = RegisteredTool(
        name="custom.bad_schema_dict",
        description="Bad schema",
        parameters_schema="invalid",  # type: ignore[arg-type]
        handler=_dummy_handler,
    )
    with pytest.raises(InvalidToolSchemaError) as exc_info:
        validate_registered_tool(tool_bad_dict)
    assert "parameters_schema must be a dict" in str(exc_info.value)

    # 2. Type not 'object'
    tool_bad_type = RegisteredTool(
        name="custom.bad_schema_type",
        description="Bad schema type",
        parameters_schema={"type": "array"},
        handler=_dummy_handler,
    )
    with pytest.raises(InvalidToolSchemaError) as exc_info:
        validate_registered_tool(tool_bad_type)
    assert "must be 'object'" in str(exc_info.value)

    # 3. Required param not in properties
    tool_missing_prop = RegisteredTool(
        name="custom.missing_prop",
        description="Required param missing in properties",
        parameters_schema={
            "type": "object",
            "properties": {"foo": {"type": "string"}},
            "required": ["foo", "bar"],
        },
        handler=_dummy_handler,
    )
    with pytest.raises(InvalidToolSchemaError) as exc_info:
        validate_registered_tool(tool_missing_prop)
    assert "required property 'bar' is not defined in schema properties" in str(exc_info.value)

    # 4. Empty name or whitespace
    tool_empty_name = RegisteredTool(
        name="   ",
        description="Empty name",
        parameters_schema={"type": "object", "properties": {}},
        handler=_dummy_handler,
    )
    with pytest.raises(InvalidToolSchemaError):
        validate_registered_tool(tool_empty_name)

    tool_space_name = RegisteredTool(
        name="bad tool name",
        description="Space name",
        parameters_schema={"type": "object", "properties": {}},
        handler=_dummy_handler,
    )
    with pytest.raises(InvalidToolSchemaError) as exc_info:
        validate_registered_tool(tool_space_name)
    assert "cannot contain whitespace" in str(exc_info.value)

    # 5. Non-RegisteredTool instance
    with pytest.raises(ToolContractError):
        validate_registered_tool("not_a_tool")  # type: ignore[arg-type]


def test_dynamic_register_and_unregister_lifecycle(tmp_path: Path) -> None:
    """Dynamic tool registration validates contracts and updates lookup structures."""
    temp_tool_name = "custom.dynamic_sample"
    try:
        tool = RegisteredTool(
            name=temp_tool_name,
            description="Dynamic sample tool",
            parameters_schema={
                "type": "object",
                "properties": {"value": {"type": "integer"}},
                "required": ["value"],
            },
            handler=_dummy_handler,
            risk=ToolRisk.READ,
        )
        register_tool(tool)

        # Confirm registered
        assert get_registered_tool(temp_tool_name) is tool

        # Duplicate register fails
        with pytest.raises(DuplicateToolError):
            register_tool(tool)

        # Can invoke through registry
        ctx = InvocationContext(session_id="test", project_root=tmp_path)
        res = invoke_registered_tool(temp_tool_name, {"value": 1}, ctx)
        assert res.status == "succeeded"
        assert res.data["result"] == "executed"
    finally:
        unregister_tool(temp_tool_name)
        assert get_registered_tool(temp_tool_name) is None
