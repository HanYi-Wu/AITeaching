"""Tool failure classification, idempotency boundaries, and safe recovery."""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any

from solaire.agent_layer.models import ToolRisk
from solaire.agent_layer.registry import get_registered_tool

logger = logging.getLogger(__name__)

MAX_READ_RETRIES: int = 2


class FailureCategory(str, Enum):
    READ_TRANSIENT = "read_transient"
    READ_FATAL = "read_fatal"
    WRITE_NON_IDEMPOTENT = "write_non_idempotent"
    AUTH_POLICY_VIOLATION = "auth_policy_violation"
    CANCELLED = "cancelled"


def is_tool_ai_powered(tool_name: str) -> bool:
    """Determine if a tool relies on AI invocation."""
    if tool_name in ("agent.run_subtask", "agent.run_tool_pipeline"):
        return True
    if "ai_" in tool_name or "generate" in tool_name or "grading" in tool_name:
        return True
    return False


def get_tool_risk(tool_name: str) -> ToolRisk:
    """Retrieve risk level for a registered tool."""
    rt = get_registered_tool(tool_name)
    if rt is not None and hasattr(rt, "risk"):
        return rt.risk
    if tool_name in ("agent.run_subtask", "agent.run_tool_pipeline"):
        return ToolRisk.WRITE
    return ToolRisk.WRITE


def is_idempotent_tool_call(tool_name: str, args: dict[str, Any]) -> bool:
    """Check if tool call provides verifiable idempotency proof."""
    risk = get_tool_risk(tool_name)
    if risk == ToolRisk.READ:
        return True
    for token_key in ("idempotency_token", "idempotency_key", "client_mutation_id", "nonce"):
        if args.get(token_key):
            return True
    return False


def classify_tool_failure(
    tool_name: str,
    error: Exception | str,
    *,
    error_code: str | None = None,
) -> FailureCategory:
    """Classify tool failure into recoverable vs dangerous-to-replay categories."""
    risk = get_tool_risk(tool_name)
    err_str = str(error)

    if (
        "用户账号已被禁用" in err_str
        or "School AI" in err_str
        or error_code in ("user_inactive", "school_ai_disabled", "permission_denied")
    ):
        return FailureCategory.AUTH_POLICY_VIOLATION

    if "cancelled" in err_str.lower() or error_code == "cancelled":
        return FailureCategory.CANCELLED

    if risk == ToolRisk.READ:
        if any(
            keyword in err_str.lower()
            for keyword in ("timeout", "connection reset", "temporarily unavailable", "ioerror", "temporary")
        ):
            return FailureCategory.READ_TRANSIENT
        return FailureCategory.READ_FATAL

    return FailureCategory.WRITE_NON_IDEMPOTENT


def wrap_write_failure_payload(
    tool_name: str,
    args: dict[str, Any],
    original_error: str,
    original_code: str | None = None,
) -> dict[str, Any]:
    """Wrap write failure without idempotency token into an explicit check-required state."""
    has_idempotency = is_idempotent_tool_call(tool_name, args)
    if has_idempotency:
        return {
            "tool": tool_name,
            "error": original_error,
            "error_code": original_code or "write_failed",
            "idempotent": True,
        }

    return {
        "tool": tool_name,
        "error": f"写入操作失败且缺少幂等性证据，已暂停自动重放以防止重复写入: {original_error}",
        "error_code": "write_interrupted_requires_verification",
        "needs_verification": True,
        "idempotent": False,
        "action_required": "请核对数据状态后决定是否重新执行该操作",
    }
