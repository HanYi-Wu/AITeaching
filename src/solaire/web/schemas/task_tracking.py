"""Pydantic schemas for the unified task tracking HTTP API."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict


class TaskProjectionView(BaseModel):
    """Client-facing read projection for a task."""

    model_config = ConfigDict(from_attributes=True)

    task_id: str
    owner: str
    project_scope: str
    task_type: str
    source_id: str | None = None
    attempt: int = 1
    status: str
    event_version: int = 1
    progress: float | None = None
    stage: str | None = None
    title: str | None = None
    result_summary: dict[str, Any] | None = None
    error_summary: dict[str, Any] | None = None
    is_retryable: bool = False
    created_at: str
    updated_at: str


class TaskProjectionListView(BaseModel):
    """Paged or bounded list of task projections."""

    tasks: list[TaskProjectionView]
    total: int
    project_scope: str
