"""Unified tool registry: lookup, selection, and OpenAI function schemas."""

from __future__ import annotations

import difflib
from bisect import bisect_left, insort
from collections.abc import Iterable
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.tool_definitions import (
    SUBTASK_TOOL_NAME,
    TOOLS,
    RegisteredTool,
    subtask_tool_schema,
)


class ToolContractError(ValueError):
    """Base exception for tool registry contract violations."""


class DuplicateToolError(ToolContractError):
    """Raised when registering a tool whose name is already registered."""


class MissingHandlerError(ToolContractError):
    """Raised when a tool is registered without a valid callable handler."""


class InvalidToolSchemaError(ToolContractError):
    """Raised when a tool schema or parameter definition violates contract rules."""


def validate_registered_tool(tool: RegisteredTool) -> None:
    """Validate that a tool definition conforms to registry contract expectations.

    Contract rules:
      1. Instance must be a RegisteredTool.
      2. Tool name must be a non-empty string without whitespace.
      3. Handler must be non-None and callable.
      4. parameters_schema must be a dict with top-level 'type': 'object'.
      5. If properties are defined, they must be a dict.
      6. If required properties are declared, they must exist in properties.
      7. Description must be a non-empty string.
      8. Risk must be a valid ToolRisk enum instance.
    """
    if not isinstance(tool, RegisteredTool):
        raise ToolContractError(f"Expected RegisteredTool instance, got {type(tool).__name__}")

    if not isinstance(tool.name, str) or not tool.name.strip():
        raise InvalidToolSchemaError(f"Tool {tool!r}: name must be a non-empty string")

    if any(c.isspace() for c in tool.name):
        raise InvalidToolSchemaError(f"Tool '{tool.name}': name cannot contain whitespace")

    if tool.handler is None:
        raise MissingHandlerError(f"Tool '{tool.name}': handler is missing (None)")

    if not callable(tool.handler):
        raise MissingHandlerError(f"Tool '{tool.name}': handler is not callable ({type(tool.handler).__name__})")

    if not isinstance(tool.parameters_schema, dict):
        raise InvalidToolSchemaError(
            f"Tool '{tool.name}': parameters_schema must be a dict, got {type(tool.parameters_schema).__name__}"
        )

    schema_type = tool.parameters_schema.get("type")
    if schema_type != "object":
        raise InvalidToolSchemaError(
            f"Tool '{tool.name}': parameters_schema['type'] must be 'object', got {schema_type!r}"
        )

    properties = tool.parameters_schema.get("properties")
    if properties is not None and not isinstance(properties, dict):
        raise InvalidToolSchemaError(
            f"Tool '{tool.name}': parameters_schema['properties'] must be a dict if defined"
        )

    required = tool.parameters_schema.get("required")
    if required is not None:
        if not isinstance(required, (list, tuple, set)):
            raise InvalidToolSchemaError(
                f"Tool '{tool.name}': parameters_schema['required'] must be a sequence"
            )
        props_keys = properties.keys() if isinstance(properties, dict) else set()
        for field_name in required:
            if not isinstance(field_name, str):
                raise InvalidToolSchemaError(
                    f"Tool '{tool.name}': required item {field_name!r} must be a string"
                )
            if field_name not in props_keys:
                raise InvalidToolSchemaError(
                    f"Tool '{tool.name}': required property '{field_name}' is not defined in schema properties"
                )

    if not isinstance(tool.description, str) or not tool.description.strip():
        raise InvalidToolSchemaError(f"Tool '{tool.name}': description must be a non-empty string")

    from solaire.agent_layer.models import ToolRisk

    if not isinstance(tool.risk, ToolRisk):
        raise InvalidToolSchemaError(
            f"Tool '{tool.name}': risk must be a ToolRisk enum instance, got {tool.risk!r}"
        )


def build_tool_registry(tools: Iterable[RegisteredTool]) -> dict[str, RegisteredTool]:
    """Validate and build an indexed tool lookup dictionary.

    Ensures no tool names are duplicated and all tools satisfy the registry contract.
    """
    catalog: dict[str, RegisteredTool] = {}
    for tool in tools:
        validate_registered_tool(tool)
        if tool.name in catalog:
            raise DuplicateToolError(f"Duplicate tool registration: '{tool.name}' is already registered")
        catalog[tool.name] = tool
    return catalog


def register_tool(tool: RegisteredTool, *, replace: bool = False) -> None:
    """Register a new tool into the global registry with contract validation.

    Raises:
        DuplicateToolError: If tool.name is already registered and replace is False.
        MissingHandlerError: If tool handler is missing or not callable.
        InvalidToolSchemaError: If parameters_schema or metadata violates contract.
    """
    validate_registered_tool(tool)
    existed = tool.name in _TOOL_BY_NAME
    if not replace and existed:
        raise DuplicateToolError(f"Duplicate tool registration: '{tool.name}' is already registered")
    _TOOL_BY_NAME[tool.name] = tool
    if not existed:
        insort(_ALL_TOOL_NAMES, tool.name)


def unregister_tool(name: str) -> RegisteredTool | None:
    """Unregister a tool from the global registry (useful for testing or dynamic cleanup)."""
    removed = _TOOL_BY_NAME.pop(name, None)
    if removed is not None:
        index = bisect_left(_ALL_TOOL_NAMES, name)
        if index < len(_ALL_TOOL_NAMES) and _ALL_TOOL_NAMES[index] == name:
            del _ALL_TOOL_NAMES[index]
    return removed


_TOOL_BY_NAME: dict[str, RegisteredTool] = build_tool_registry(TOOLS)
_ALL_TOOL_NAMES: list[str] = sorted(_TOOL_BY_NAME.keys())
HOST_CONTROL_TOOL_NAMES = frozenset({"analysis.save_script", "analysis.run_script"})


def _names_starting(prefix: str) -> tuple[str, ...]:
    return tuple(sorted(t.name for t in TOOLS if t.name.startswith(prefix)))


def _merge_unique(*groups: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    out: list[str] = []
    for g in groups:
        for n in g:
            if n not in seen:
                seen.add(n)
                out.append(n)
    return tuple(out)


_ALL_ANALYSIS = _names_starting("analysis.")
_ALL_BANK = _names_starting("bank.")
_ALL_GRAPH = _names_starting("graph.")
_ALL_EXAM = _names_starting("exam.")
_ALL_TEMPLATE = _names_starting("template.")
_ALL_PAPER = _names_starting("paper.")
_ALL_TEACHER = _names_starting("teacher.")
_ALL_FILE = _names_starting("file.")
_ALL_DOC = _names_starting("doc.")
_ALL_MEMORY = _names_starting("memory.")
_WEB_FETCH: tuple[str, ...] = ("web.fetch",)

_AGENT_CORE: tuple[str, ...] = (
    "agent.switch_focus",
    "agent.activate_skill",
    "agent.read_skill_reference",
    "agent.enter_plan_mode",
    "agent.exit_plan_mode",
    "agent.set_task_plan",
    "agent.update_task_step",
)
_SUBTASK_PIPELINE: tuple[str, ...] = ("agent.run_subtask", "agent.run_tool_pipeline")
_FILE_RO: tuple[str, ...] = ("file.read", "file.list", "file.search")

_GENERAL_DOMAIN: tuple[str, ...] = (
    "bank.legacy_answer_candidates",
    "bank.adapt_answers",
    "bank.organize",
    "bank.create_items",
    "exam.workspace_list",
    "exam.workspace_delete",
    "paper.update_publication",
    "analysis.list_datasets",
    "analysis.list_builtins",
    "analysis.run_builtin",
    "analysis.get_job",
    "exam.list_templates",
    "graph.list_nodes",
    "graph.search_nodes",
    "bank.search_items",
    "bank.get_item",
    "paper.list",
    "paper.analyze",
    "paper.find_submissions",
    "paper.submissions",
    "exam.ai_grade_submission",
)

_COMPOSE_GRAPH: tuple[str, ...] = ("graph.list_nodes", "graph.list_relations", "graph.search_nodes")

_BANK_GRAPH: tuple[str, ...] = (
    "graph.bind_question",
    "graph.batch_bind_questions",
    "graph.list_nodes",
    "graph.search_nodes",
)

_ANALYSIS_FOCUS = _merge_unique(
    _AGENT_CORE,
    _ALL_TEACHER,
    _FILE_RO,
    _SUBTASK_PIPELINE,
    _ALL_MEMORY,
    _WEB_FETCH,
    _ALL_ANALYSIS,
    _ALL_PAPER,
    ("exam.ai_grade_submission",),
)
_BANK_FOCUS = _merge_unique(_AGENT_CORE, _ALL_TEACHER, _FILE_RO, _SUBTASK_PIPELINE, _WEB_FETCH, _ALL_BANK, _BANK_GRAPH)
_GRAPH_FOCUS = _merge_unique(_AGENT_CORE, _ALL_TEACHER, _FILE_RO, _SUBTASK_PIPELINE, _WEB_FETCH, _ALL_GRAPH, _ALL_BANK)
_COMPOSE_FOCUS = _merge_unique(
    _AGENT_CORE,
    _ALL_TEACHER,
    _FILE_RO,
    _SUBTASK_PIPELINE,
    _WEB_FETCH,
    _ALL_MEMORY,
    _ALL_EXAM,
    _ALL_TEMPLATE,
    _ALL_PAPER,
    _ALL_BANK,
    _COMPOSE_GRAPH,
    ("file.write", "file.edit"),
)
_DOC_FOCUS = _merge_unique(_AGENT_CORE, _ALL_TEACHER, _FILE_RO, _SUBTASK_PIPELINE, _WEB_FETCH, _ALL_FILE, _ALL_DOC)
_TEMPLATE_FOCUS = _merge_unique(_AGENT_CORE, _ALL_TEACHER, _FILE_RO, _ALL_TEMPLATE, _ALL_EXAM)
_PAPER_FOCUS = _merge_unique(_AGENT_CORE, _ALL_TEACHER, _FILE_RO, _ALL_PAPER, _ALL_EXAM, _ALL_ANALYSIS)
_GENERAL_FOCUS = _merge_unique(_AGENT_CORE, _ALL_TEACHER, _FILE_RO, _WEB_FETCH, _GENERAL_DOMAIN)


def get_registered_tool(tool_name: str) -> RegisteredTool | None:
    if tool_name == SUBTASK_TOOL_NAME:
        return subtask_tool_schema()
    return _TOOL_BY_NAME.get(tool_name)


def tool_name_matches_patterns(name: str, patterns: Iterable[str]) -> bool:
    for pat in patterns:
        if pat.endswith("*"):
            base = pat[:-1]
            if base and name.startswith(base):
                return True
        elif name == pat:
            return True
    return False


def resolve_effective_tool_scope(
    *,
    skill_id: str | None,
    session_focus: str | None,
) -> str:
    """用于选择工具集的聚焦域；不得从 App 当前界面推导。"""
    if skill_id and skill_id.strip():
        return (session_focus or "").strip() or "general"
    return (session_focus or "").strip() or "general"


# 聚焦态工具预设（显式工具名，避免通配导致 schema 抖动）
FOCUS_PRESETS: dict[str, tuple[str, ...]] = {
    "general": _GENERAL_FOCUS,
    "analysis": _ANALYSIS_FOCUS,
    "bank": _BANK_FOCUS,
    "graph": _GRAPH_FOCUS,
    "compose": _COMPOSE_FOCUS,
    "template": _TEMPLATE_FOCUS,
    "paper": _PAPER_FOCUS,
    "doc_process": _DOC_FOCUS,
}


def select_tools_for_turn(
    *,
    skill_id: str | None,
    include_subtask: bool,
    current_focus: str | None = None,
    project_root: Any = None,
    plan_mode_active: bool = False,
) -> list[RegisteredTool]:
    """选择本轮可用工具。**不得**传入或依据 App 当前页面。"""
    from solaire.agent_layer import skills as skills_mod

    focus_key = resolve_effective_tool_scope(skill_id=skill_id, session_focus=current_focus)
    patterns: tuple[str, ...] | None = None
    if skill_id:
        sk = skills_mod.get_skill(skill_id.strip(), project_root)
        if sk:
            patterns = sk.tool_patterns
    if patterns is None:
        patterns = FOCUS_PRESETS.get(focus_key) or FOCUS_PRESETS["general"]

    picked: list[RegisteredTool] = []
    seen: set[str] = set()
    for t in TOOLS:
        if not tool_name_matches_patterns(t.name, patterns):
            continue
        if t.name in seen:
            continue
        seen.add(t.name)
        picked.append(t)
    if include_subtask:
        st = subtask_tool_schema()
        if st.name not in seen:
            picked.append(st)
            seen.add(st.name)
    # 计划模式：暴露写入/编辑工具以落盘计划文件
    if plan_mode_active:
        for _plan_tool in ("file.write", "file.edit"):
            if _plan_tool not in seen:
                pt = _TOOL_BY_NAME.get(_plan_tool)
                if pt:
                    picked.append(pt)
                    seen.add(_plan_tool)
    return picked


SUBAGENT_EXCLUDED_NAMES: frozenset[str] = frozenset(
    {
        "agent.enter_plan_mode",
        "agent.exit_plan_mode",
        "agent.switch_focus",
        "agent.set_task_plan",
        "agent.update_task_step",
        "agent.run_subtask",
        "agent.run_tool_pipeline",
        "agent.activate_skill",
        "file.write",
        "file.edit",
    }
)


def tools_for_subagent(*, allowed_prefixes: list[str] | None) -> list[RegisteredTool]:
    tools = [t for t in all_registered_tools(include_subtask=False) if t.name not in SUBAGENT_EXCLUDED_NAMES]
    if allowed_prefixes:
        pfx = tuple(allowed_prefixes)

        def _ok(name: str) -> bool:
            return any(name.startswith(x.rstrip("*")) or name.startswith(x) for x in pfx)

        tools = [t for t in tools if _ok(t.name)]
    return tools


def all_registered_tools(include_subtask: bool = True) -> list[RegisteredTool]:
    if include_subtask:
        return [*TOOLS, subtask_tool_schema()]
    return list(TOOLS)


def openai_tools_payload(tools: list[RegisteredTool] | None = None) -> list[dict[str, Any]]:
    tlist = tools or all_registered_tools()
    out: list[dict[str, Any]] = []
    for t in tlist:
        out.append(
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters_schema,
                },
            }
        )
    return out


def tool_descriptions_for_prompt(tools: list[RegisteredTool] | None = None) -> str:
    tlist = tools or all_registered_tools()
    # Descriptions and argument schemas already travel in the tools field.
    return "工具参数与说明见 tools 定义。多题创建优先 bank.create_items，一次确认整批；不要重复读取无变化数据。\n" + ", ".join(t.name for t in tlist)


def invoke_registered_tool(name: str, args: dict[str, Any], ctx: InvocationContext) -> ToolResult:
    if ctx.public_mode and not ctx.host_control_authorized and name in HOST_CONTROL_TOOL_NAMES:
        return ToolResult(
            status="failed",
            error_code="host_control_required",
            error_message="Public deployments require administrator host-control authorization for this tool",
        )
    if name == SUBTASK_TOOL_NAME:
        return ToolResult(status="failed", error_code="internal", error_message="subtask not invokable here")
    rt = _TOOL_BY_NAME.get(name)
    if rt is None:
        # Suggest close matches to help the model self-correct
        close = difflib.get_close_matches(name, _ALL_TOOL_NAMES, n=3, cutoff=0.5)
        hint = ""
        if close:
            hint = f" 您可能想使用: {', '.join(close)}。"
        return ToolResult(
            status="failed",
            error_code="unknown_tool",
            error_message=f"未知工具: {name}。{hint}请检查工具名拼写（注意使用点号 . 而非下划线 _ 分隔）。",
        )
    from solaire.common.actor_context import actor
    token = actor.set(ctx.platform_user)
    try:
        from solaire.agent_layer.task_tracker import verify_authoritative_actor_and_policy
        from solaire.agent_layer.failure_recovery import is_tool_ai_powered
        verify_authoritative_actor_and_policy(
            ctx.platform_root or ctx.project_root, ctx.platform_user,
            is_ai_call=is_tool_ai_powered(name),
        )
        return rt.handler(ctx, args)
    except PermissionError as exc:
        return ToolResult(status="failed", error_code="permission_denied", error_message=str(exc))
    except OSError as exc:
        return ToolResult(status="failed", error_code="io_error", error_message=str(exc))
    finally:
        actor.reset(token)
