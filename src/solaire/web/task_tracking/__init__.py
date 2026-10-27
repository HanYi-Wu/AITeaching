"""Unified task tracking projection package.

Provides durable, owner-isolated task status projections for export,
analysis, and agent tasks.
"""

from __future__ import annotations

from .contract import (
    create_or_update_projection,
    get_project_scope_id,
    get_task_projection,
    list_task_projections,
)
from .models import (
    ACTIVE_STATUSES,
    TERMINAL_STATUSES,
    TaskEvent,
    TaskProjectionRecord,
    TaskStatus,
    normalize_owner,
    normalize_progress,
)
from .source_operations import retry_source_task
from .store import TaskProjectionStore

__all__ = [
    "ACTIVE_STATUSES",
    "TERMINAL_STATUSES",
    "TaskEvent",
    "TaskProjectionRecord",
    "TaskProjectionStore",
    "TaskStatus",
    "create_or_update_projection",
    "get_project_scope_id",
    "get_task_projection",
    "list_task_projections",
    "normalize_owner",
    "normalize_progress",
    "retry_source_task",
]
