"""Shared platform-actor scoping used by HTTP routes and agent tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.project_layout import ensure_project_layout
from solaire.web.security import safe_filename_component


def teacher_graph_root(content_root: Path, user: dict[str, Any] | None) -> Path:
    """Return the private graph root for a teacher; other roles use the shared root."""
    if not user or user.get("role") != "teacher":
        return content_root
    teacher_id = safe_filename_component(str(user.get("id") or "teacher"))
    root = content_root / ".solaire" / "teacher_graphs" / teacher_id
    ensure_project_layout(root)
    return root
