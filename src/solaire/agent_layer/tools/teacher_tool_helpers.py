"""Common helper utilities for teacher tool adapters."""

from __future__ import annotations

from typing import Any, Callable

from solaire.agent_layer.models import InvocationContext, ToolResult

def _ok(**data: Any) -> ToolResult:
    return ToolResult(status="succeeded", data=data)

def _run(fn: Callable[[], dict[str, Any] | list[Any] | None]) -> ToolResult:
    try:
        value = fn()
        if value is None:
            return _ok(ok=True)
        if isinstance(value, dict):
            return ToolResult(status="succeeded", data=value)
        return _ok(items=value)
    except FileNotFoundError as exc:
        return ToolResult(status="failed", error_code="not_found", error_message=str(exc))
    except PermissionError as exc:
        return ToolResult(status="failed", error_code="permission_denied", error_message=str(exc))
    except (TypeError, ValueError) as exc:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(exc))
    except OSError as exc:
        return ToolResult(status="failed", error_code="io_error", error_message=str(exc))

def _required(args: dict[str, Any], key: str) -> str:
    value = str(args.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value

def _actor(ctx: InvocationContext) -> dict[str, Any]:
    user = ctx.platform_user or {}
    if str(user.get("role") or "") not in {"teacher", "admin"} or not user.get("id"):
        raise PermissionError("This operation requires an authenticated teacher or admin")
    return user
