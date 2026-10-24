"""request_context."""

from __future__ import annotations

import contextvars
from pathlib import Path
from typing import Any
from fastapi import Request
from solaire.web import state
from solaire.web.actor_scope import teacher_graph_root
from solaire.web.auth_api import extract_session_token, require_platform_root
from solaire.web.auth_service import get_session_user
from solaire.web.public_access import enforce_public_access
from solaire.web.project_layout import ensure_project_layout

_graph_request_user: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "graph_request_user",
    default=None,
)


def _teacher_graph_root(content_root: Path, user: dict[str, Any] | None) -> Path:
    return teacher_graph_root(content_root, user)


def _require_root() -> Path:
    r = state.get_content_root()
    ensure_project_layout(r)
    return _teacher_graph_root(r, _graph_request_user.get())


async def bind_request_context(request: Request, call_next):
    rejection = await enforce_public_access(request)
    if rejection is not None:
        return rejection
    token = None
    user: dict[str, Any] | None = None
    if request.url.path.startswith("/api/"):
        token = extract_session_token(
            authorization=request.headers.get("authorization"),
            x_solaire_session=request.headers.get("x-solaire-session"),
        )
        if token:
            try:
                user = get_session_user(require_platform_root(), token)
            except Exception:
                user = None
    ctx_token = _graph_request_user.set(user if request.url.path.startswith('/api/graph') else None)
    from solaire.common.actor_context import actor
    actor_token = actor.set(user or getattr(request.state, 'platform_user', None))
    try:
        return await call_next(request)
    finally:
        actor.reset(actor_token)
        _graph_request_user.reset(ctx_token)
