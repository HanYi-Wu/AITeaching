"""Common definitions and builder helpers for tool schemas."""



from __future__ import annotations



from collections.abc import Callable

from dataclasses import dataclass

from typing import Any



from solaire.agent_layer.models import InvocationContext, ToolResult, ToolRisk

from solaire.agent_layer.tools import analysis_tools



ToolHandler = Callable[[InvocationContext, dict[str, Any]], ToolResult]


def compose_tool_catalog(groups, order):
    """Reject duplicate or unlisted schemas before indexing erases their origin."""
    by_name = {}
    for group in groups:
        for tool in group:
            if tool.name in by_name:
                raise ValueError(f"Duplicate tool schema: {tool.name}")
            by_name[tool.name] = tool
    if len(order) != len(set(order)) or set(by_name) != set(order):
        raise ValueError("Tool schema catalog and selection order do not match.")
    return [by_name[name] for name in order]



_S = {"type": "string"}





@dataclass

class RegisteredTool:

    name: str

    description: str

    parameters_schema: dict[str, Any]

    handler: ToolHandler

    risk: ToolRisk = ToolRisk.WRITE

    ui_label: str | None = None

    requires_confirmation_override: bool | None = None

    allegro_auto_add: bool = False

    vivace_fast_review: bool = False

    action_label: str | None = None



    def validate(self) -> None:

        """Validate this tool definition against registry contract rules."""

        from solaire.agent_layer.registry import validate_registered_tool



        validate_registered_tool(self)





def _fn(

    name: str,

    description: str,

    parameters: dict[str, Any],

    handler: ToolHandler,

    *,

    risk: ToolRisk = ToolRisk.WRITE,

    ui_label: str | None = None,

    requires_confirmation_override: bool | None = None,

    allegro_auto_add: bool = False,

    vivace_fast_review: bool = False,

    action_label: str | None = None,

) -> RegisteredTool:

    return RegisteredTool(

        name=name,

        description=description,

        parameters_schema=parameters,

        handler=handler,

        risk=risk,

        ui_label=ui_label,

        requires_confirmation_override=requires_confirmation_override,

        allegro_auto_add=allegro_auto_add,

        vivace_fast_review=vivace_fast_review,

        action_label=action_label,

    )





def _analysis(

    name: str,

    description: str,

    parameters: dict[str, Any],

    *,

    risk: ToolRisk = ToolRisk.WRITE,

    ui_label: str | None = None,

    allegro_auto_add: bool = False,

    vivace_fast_review: bool = False,

    action_label: str | None = None,

) -> RegisteredTool:

    return _fn(

        name,

        description,

        parameters,

        lambda ctx, args: analysis_tools.run_analysis_tool(ctx, name, args),

        risk=risk,

        ui_label=ui_label,

        allegro_auto_add=allegro_auto_add,

        vivace_fast_review=vivace_fast_review,

        action_label=action_label,

    )





def _teacher_schema(
    properties: dict[str, Any] | None = None,
    required: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": dict(properties) if properties else {},
        "required": list(required) if required is not None else [],
        "additionalProperties": False,
    }
