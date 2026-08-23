"""Security boundary for browser deployments exposed through a reverse proxy."""

from __future__ import annotations

import hmac
import ipaddress
import os
import threading
import time
from collections import defaultdict, deque
from collections.abc import Iterable
from pathlib import PurePosixPath
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from solaire.web.auth_api import extract_session_token, require_platform_root
from solaire.web.auth_service import get_session_user

DEFAULT_ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "tauri://localhost",
    "https://tauri.localhost",
)
PUBLIC_API_PATHS = frozenset(
    {
        "/api/health",
        "/api/platform/status",
        "/api/auth/login",
        "/api/auth/bootstrap-admin",
    }
)

_HOST_CONTROL_EXACT = frozenset(
    {
        "/api/project/open",
        "/api/project/create",
        "/api/project/close",
        "/api/project/pick-open",
        "/api/project/pick-parent",
        "/api/recent-projects",
        "/api/recent-projects/remove",
        "/api/system/tex-install",
    }
)
_HOST_CONTROL_PREFIXES = (
    "/api/analysis/scripts",
    "/api/analysis/folder-scripts",
    "/api/analysis/jobs/script",
    "/api/analysis/tools",
)
_STUDENT_ALLOWED_EXACT = frozenset({"/api/auth/me", "/api/auth/logout", "/api/auth/profile", "/api/auth/account"})
_STUDENT_RESOURCE_EXTENSIONS = frozenset({".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"})
_SCHOOL_ALLOWED_EXACT = frozenset({"/api/auth/me", "/api/auth/logout", "/api/auth/profile", "/api/auth/account"})

_login_attempts: dict[str, deque[float]] = defaultdict(deque)
_login_lock = threading.Lock()


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def public_mode_enabled() -> bool:
    return _env_flag("SOLAIRE_PUBLIC_MODE")


def allowed_origins(raw: str | None = None) -> list[str]:
    """Return explicit CORS origins; wildcard origins are rejected."""
    value = os.environ.get("SOLAIRE_ALLOWED_ORIGINS", "") if raw is None else raw
    configured = [item.strip().rstrip("/") for item in value.split(",") if item.strip()]
    if "*" in configured:
        raise RuntimeError("SOLAIRE_ALLOWED_ORIGINS must not contain '*'")
    return list(dict.fromkeys([*DEFAULT_ALLOWED_ORIGINS, *configured]))


def reset_login_rate_limiter() -> None:
    with _login_lock:
        _login_attempts.clear()


def _rate_limit_value(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def _login_rate_limited(client_key: str, now: float | None = None) -> bool:
    current = time.monotonic() if now is None else now
    limit = _rate_limit_value("SOLAIRE_LOGIN_RATE_LIMIT", 10, 1)
    window = _rate_limit_value("SOLAIRE_LOGIN_RATE_WINDOW_SECONDS", 60, 1)
    with _login_lock:
        attempts = _login_attempts[client_key]
        cutoff = current - window
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if len(attempts) >= limit:
            return True
        attempts.append(current)
    return False


def _is_host_control(path: str, method: str) -> bool:
    if path in _HOST_CONTROL_EXACT:
        return True
    if any(path.startswith(prefix) for prefix in _HOST_CONTROL_PREFIXES):
        return True
    if path.startswith("/api/system/extensions") and method != "GET":
        return True
    if path.startswith("/api/exams/") and path.endswith(("/open-pdf", "/open-docx")):
        return True
    if path in {
        "/api/agent/llm-settings",
        "/api/agent/safety-mode",
        "/api/agent/prompt-overrides",
    } and method != "GET":
        return True
    return False


def student_request_allowed(path: str, method: str) -> bool:
    if path in _STUDENT_ALLOWED_EXACT:
        return True
    if path.startswith("/api/student/"):
        return True
    if method == "GET" and path.startswith("/api/help/"):
        return True
    if method == "GET" and path.startswith("/api/resource/"):
        return PurePosixPath(path).suffix.lower() in _STUDENT_RESOURCE_EXTENSIONS
    return False


def school_request_allowed(path: str, method: str) -> bool:
    if path in _SCHOOL_ALLOWED_EXACT:
        return True
    if path.startswith("/api/school/"):
        return True
    if method != "GET":
        return False
    if path == "/api/papers":
        return True
    parts = path.split("/")
    return (
        len(parts) == 5
        and parts[1:3] == ["api", "papers"]
        and parts[4] in {"analysis", "analysis.pdf", "analysis.xlsx"}
    )


def _json_error(status_code: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail})


def _authenticated_user(request: Request) -> dict[str, Any] | None:
    token = extract_session_token(
        authorization=request.headers.get("authorization"),
        x_solaire_session=request.headers.get("x-solaire-session"),
    )
    if not token:
        return None
    try:
        return get_session_user(require_platform_root(), token)
    except Exception:
        return None


def _client_address(request: Request) -> str:
    """Trust forwarded client metadata only when FastAPI's direct peer is loopback."""
    peer = request.client.host if request.client else "unknown"
    try:
        peer_is_loopback = ipaddress.ip_address(peer).is_loopback
    except ValueError:
        peer_is_loopback = False
    if not peer_is_loopback:
        return peer
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if forwarded:
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return peer


def _host_control_authorized(request: Request, user: dict[str, Any]) -> bool:
    if user.get("role") != "admin":
        return False
    configured = os.environ.get("SOLAIRE_CONTROL_TOKEN", "")
    supplied = request.headers.get("x-solaire-control-token", "")
    return bool(configured and supplied and hmac.compare_digest(configured, supplied))


async def enforce_public_access(request: Request) -> JSONResponse | None:
    """Return a rejection response, or ``None`` when the request may continue."""
    if not public_mode_enabled() or not request.url.path.startswith("/api"):
        return None
    if request.method == "OPTIONS":
        return None

    path = request.url.path.rstrip("/") or "/"
    if path in {"/api/auth/login", "/api/auth/bootstrap-admin"}:
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        username = str(payload.get("username") or "").strip().casefold() if isinstance(payload, dict) else ""
        client_key = f"{_client_address(request)}:{username or '-'}"
        if _login_rate_limited(client_key):
            return _json_error(429, "Too many authentication attempts; try again later")
    if path in PUBLIC_API_PATHS:
        return None

    user = _authenticated_user(request)
    if user is None:
        return _json_error(401, "Authentication required")
    request.state.platform_user = user
    request.state.host_control_authorized = _host_control_authorized(request, user)
    role = user.get("role")
    if role == "student" and not student_request_allowed(path, request.method):
        return _json_error(403, "Student role cannot access this endpoint")
    if role == "school" and not school_request_allowed(path, request.method):
        return _json_error(403, "School role cannot access this endpoint")
    if role not in {"admin", "teacher", "school", "student"}:
        return _json_error(403, "Unsupported platform role")

    if _is_host_control(path, request.method):
        if user.get("role") != "admin":
            return _json_error(403, "Administrator role required")
        configured = os.environ.get("SOLAIRE_CONTROL_TOKEN", "")
        if not configured:
            return _json_error(503, "Host control is disabled")
        if not request.state.host_control_authorized:
            return _json_error(403, "Local control token required")
    return None


def redact_project_root(payload: dict[str, Any]) -> dict[str, Any]:
    if public_mode_enabled() and "root" in payload:
        return {**payload, "root": ""}
    return payload
