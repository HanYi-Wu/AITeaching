"""Tool call validation layer: name correction, argument parsing, schema checks.

Placed between LLM output and tool execution to catch and correct hallucinations
before they become unrecoverable errors.
"""

from __future__ import annotations

import difflib
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from solaire.agent_layer.tools.tool_definitions import RegisteredTool


@dataclass
class ValidatedToolCall:
    tool_name: str  # corrected name (may differ from raw_name)
    arguments: dict[str, Any]
    is_valid: bool
    error_code: str | None = None
    error_message: str | None = None
    suggestion: str | None = None  # corrective hint for the model
    raw_name: str = ""
    raw_arguments: Any = None

    def error_payload(self) -> dict[str, Any]:
        """Build a ToolResult-compatible error dict for draft_tool_results."""
        payload: dict[str, Any] = {}
        if self.error_message:
            payload["error"] = self.error_message
        if self.error_code:
            payload["error_code"] = self.error_code
        if self.suggestion:
            payload["suggestion"] = self.suggestion
        return payload


class ToolCatalog:
    """Compiled name index for a stable set of tool definitions.

    Building this once per draft turn avoids rebuilding the same dictionary
    and sorting the same candidate names for every tool call. The input may be
    any iterable; duplicate names keep the previous validator's last-entry
    wins behavior.
    """

    __slots__ = ("_by_name", "_names", "_name_set")

    def __init__(self, tools: Iterable[RegisteredTool]) -> None:
        by_name = {tool.name: tool for tool in tools}
        self._by_name = by_name
        self._names = tuple(sorted(by_name))
        self._name_set = frozenset(by_name)

    @property
    def names(self) -> tuple[str, ...]:
        return self._names

    def get(self, name: str) -> RegisteredTool | None:
        return self._by_name.get(name)

    def __len__(self) -> int:
        return len(self._by_name)


def compile_tool_catalog(tools: Iterable[RegisteredTool] | ToolCatalog) -> ToolCatalog:
    """Return a reusable index, preserving an already compiled catalog."""
    return tools if isinstance(tools, ToolCatalog) else ToolCatalog(tools)


def _normalize_name(name: str) -> str:
    """Swap underscores and dots both ways, keeping both variants for matching."""
    return name.replace("_", ".")


def _match_name(
    raw: str,
    candidates: Sequence[str],
    candidate_set: frozenset[str] | set[str] | None = None,
) -> tuple[str | None, str | None]:
    """Try to match raw tool name against candidates.

    Returns (corrected_name_or_None, suggestion_or_None).
    """
    names = candidate_set if candidate_set is not None else set(candidates)
    # 1. Exact match
    if raw in names:
        return raw, None

    # 2. Dot/underscore normalization
    normalized = _normalize_name(raw)
    if normalized != raw and normalized in names:
        return normalized, f"工具名 '{raw}' 已自动纠正为 '{normalized}'"

    # 3. difflib close matches (edit distance)
    close = difflib.get_close_matches(raw, candidates, n=3, cutoff=0.6)
    if close:
        if len(close) == 1 and close[0] != raw:
            return close[0], f"工具名 '{raw}' 已自动纠正为 '{close[0]}'（最相似匹配）"
        suggestion = f"工具 '{raw}' 未找到。您可能想使用: {', '.join(close)}"
        return None, suggestion

    # 4. No match — list available tools (truncated)
    preview = candidates[:20]
    hint = f"可用工具（部分）: {', '.join(preview)}"
    if len(candidates) > 20:
        hint += f" …（共 {len(candidates)} 个）"
    return None, f"未知工具 '{raw}'。{hint}"


def _name_matches(raw: str, candidates: list[str]) -> tuple[str | None, str | None]:
    """Compatibility wrapper for callers/tests that pass a plain name list."""
    return _match_name(raw, candidates)


def _check_required_params(
    arguments: dict[str, Any],
    schema: dict[str, Any],
) -> tuple[bool, str | None]:
    """Check that all required parameters are present in arguments."""
    required = schema.get("required")
    if not isinstance(required, list) or not required:
        return True, None
    missing = [k for k in required if k not in arguments]
    if missing:
        return False, f"缺少必填参数: {', '.join(missing)}"
    return True, None


def validate_tool_call(
    tool_name: str,
    raw_arguments: Any,
    available_tools: Iterable[RegisteredTool] | ToolCatalog,
) -> ValidatedToolCall:
    """Validate and correct a single tool call from the LLM.

    Three-stage pipeline:
      1. Name resolution (exact → normalize → fuzzy → reject)
      2. Argument parsing (preserves raw on error)
      3. Schema validation (required params)

    Returns ValidatedToolCall; check .is_valid before executing.
    When invalid, .error_payload() builds a result suitable for
    draft_tool_results so the model sees a clear error in the next turn.
    """
    catalog = compile_tool_catalog(available_tools)
    candidate_names = catalog.names

    # --- Stage 1: Name resolution ---
    corrected, suggestion = _match_name(tool_name, candidate_names, catalog._name_set)

    if corrected is None:
        return ValidatedToolCall(
            tool_name=tool_name,
            arguments={},
            is_valid=False,
            error_code="unknown_tool",
            error_message=suggestion or f"未知工具: {tool_name}",
            suggestion=suggestion,
            raw_name=tool_name,
            raw_arguments=raw_arguments,
        )

    rt = catalog.get(corrected)
    # A corrected name always comes from the catalog; keep a defensive guard in
    # case a custom catalog implementation is introduced later.
    if rt is None:
        return ValidatedToolCall(
            tool_name=tool_name,
            arguments={},
            is_valid=False,
            error_code="unknown_tool",
            error_message=f"未知工具: {tool_name}",
            raw_name=tool_name,
            raw_arguments=raw_arguments,
        )

    # --- Stage 2: Argument parsing ---
    if isinstance(raw_arguments, dict):
        parsed = raw_arguments
        parse_err = None
    elif isinstance(raw_arguments, str):
        if not raw_arguments.strip():
            parsed = {}
            parse_err = None
        else:
            try:
                parsed = json.loads(raw_arguments)
                parse_err = None
            except json.JSONDecodeError as e:
                snippet = raw_arguments[:200]
                parse_err = f"JSON 解析失败: {e}. 原始输入片段: {snippet}"
                parsed = {}
    else:
        parsed = {}
        parse_err = None

    if parse_err:
        return ValidatedToolCall(
            tool_name=corrected,
            arguments=parsed,
            is_valid=False,
            error_code="invalid_arguments",
            error_message=parse_err,
            suggestion=f"请检查 '{corrected}' 的参数是否为合法 JSON。",
            raw_name=tool_name,
            raw_arguments=raw_arguments,
        )

    # --- Stage 3: Schema validation ---
    ok, missing_err = _check_required_params(parsed, rt.parameters_schema)
    if not ok and missing_err:
        return ValidatedToolCall(
            tool_name=corrected,
            arguments=parsed,
            is_valid=False,
            error_code="missing_required",
            error_message=missing_err,
            suggestion=f"工具 '{corrected}' {missing_err}。请补充后重新调用。",
            raw_name=tool_name,
            raw_arguments=raw_arguments,
        )

    return ValidatedToolCall(
        tool_name=corrected,
        arguments=parsed,
        is_valid=True,
        raw_name=tool_name,
        raw_arguments=raw_arguments,
        suggestion=suggestion,  # non-None when auto-corrected (informational)
    )
