"""Public contract and entrypoints for task tracking projections.

Frozen for G13 consumption.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.web.project_scope import project_scope_id
from .models import (
    ACTIVE_STATUSES,
    TERMINAL_STATUSES,
    TaskEvent,
    TaskProjectionRecord,
    TaskStatus,
    normalize_owner,
    normalize_progress,
)
from .store import TaskProjectionStore


def get_project_scope_id(project_root: Path) -> str:
    """Return normalized, stable project scope string for project directory."""
    return project_scope_id(project_root)


def create_or_update_projection(project_root: Path, event: TaskEvent) -> TaskProjectionRecord:
    """Persist or transition a task projection according to event versioning."""
    store = TaskProjectionStore(project_root)
    return store.record_event(event)


def get_task_projection(
    project_root: Path,
    task_id: str,
    owner: str,
    project_scope: str | None = None,
) -> TaskProjectionRecord | None:
    """Retrieve a projection by task_id or source_id under owner isolation."""
    store = TaskProjectionStore(project_root)
    scope = project_scope or get_project_scope_id(project_root)
    return store.get_projection(task_id, owner=owner, project_scope=scope)


def list_task_projections(
    project_root: Path,
    owner: str,
    project_scope: str | None = None,
    *,
    task_type: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[TaskProjectionRecord]:
    """List projections belonging to the owner and project scope."""
    store = TaskProjectionStore(project_root)
    scope = project_scope or get_project_scope_id(project_root)
    return store.list_projections(
        owner=owner,
        project_scope=scope,
        task_type=task_type,
        status=status,
        limit=limit,
    )
