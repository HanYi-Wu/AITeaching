"""Teacher knowledge-graph management adapter."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.teacher_tool_helpers import _actor, _ok, _required, _run
from solaire.knowledge_forge import (
    detach_file_link,
    get_taxonomy,
    rename_graph,
    set_taxonomy,
    unbind_question_from_node,
)
from solaire.web.actor_scope import teacher_graph_root

def tool_graph_rename(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (
            rename_graph(
                teacher_graph_root(ctx.project_root, ctx.platform_user),
                _required(args, "slug"),
                _required(args, "display_name"),
            ),
            {"ok": True},
        )[1]
    )

def tool_graph_get_taxonomy(ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    return _run(lambda: get_taxonomy(teacher_graph_root(ctx.project_root, ctx.platform_user)))

def tool_graph_set_taxonomy(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def action() -> dict[str, Any]:
        subjects = args.get("subjects")
        levels = args.get("levels")
        set_taxonomy(
            teacher_graph_root(ctx.project_root, ctx.platform_user),
            subjects=[str(x) for x in subjects] if isinstance(subjects, list) else None,
            levels=[str(x) for x in levels] if isinstance(levels, list) else None,
        )
        return {"ok": True}

    return _run(action)

def tool_graph_unbind_question(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (
            unbind_question_from_node(
                teacher_graph_root(ctx.project_root, ctx.platform_user),
                {
                    "question_qualified_id": _required(args, "question_qualified_id"),
                    "node_id": _required(args, "node_id"),
                },
                graph=str(args.get("graph") or "").strip() or None,
            ),
            {"ok": True},
        )[1]
    )

def tool_graph_detach_resource(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (
            detach_file_link(
                teacher_graph_root(ctx.project_root, ctx.platform_user),
                _required(args, "link_id"),
                graph=str(args.get("graph") or "").strip() or None,
            ),
            {"ok": True},
        )[1]
    )
