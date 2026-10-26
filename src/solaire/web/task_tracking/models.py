"""Domain models and value types for durable, owner-isolated task projections."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator

TaskStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
TERMINAL_STATUSES: frozenset[str] = frozenset({"succeeded", "failed", "cancelled"})
ACTIVE_STATUSES: frozenset[str] = frozenset({"queued", "running"})


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_progress(val: Any) -> float | None:
    """Validate and normalize progress to a finite float in [0.0, 1.0] or None.

    Raises:
        ValueError: If value is non-numeric, a boolean, or not a finite number.
    """
    if val is None:
        return None
    if isinstance(val, bool):
        raise ValueError("Progress value cannot be a boolean.")
    if not isinstance(val, (int, float)):
        raise ValueError(f"Progress must be numeric, got {type(val).__name__}.")
    if not math.isfinite(val):
        raise ValueError("Progress must be a finite number.")

    f = float(val)
    if f < 0.0:
        return 0.0
    if f > 1.0:
        if f <= 100.0:
            return round(f / 100.0, 4)
        return 1.0
    return round(f, 4)


def normalize_owner(user: dict[str, Any] | None | str) -> str:
    """Derive standard owner string from actor dictionary or raw string."""
    if isinstance(user, str):
        cleaned = user.strip()
        return cleaned if cleaned else "local"
    if user is None:
        return "local"
    role = user.get("role")
    user_id = user.get("id")
    if role and user_id:
        return f"{role}:{user_id}"
    return "local"


class TaskProjectionRecord(BaseModel):
    """Immutable view of a durable task projection record."""

    task_id: str
    owner: str
    project_scope: str
    task_type: str
    source_id: str | None = None
    attempt: int = 1
    status: str = "queued"
    event_version: int = 1
    progress: float | None = None
    stage: str | None = None
    title: str | None = None
    result_summary: dict[str, Any] | None = None
    error_summary: dict[str, Any] | None = None
    is_retryable: bool = False
    created_at: str
    updated_at: str

    @field_validator("progress", mode="before")
    @classmethod
    def validate_record_progress(cls, v: Any) -> float | None:
        return normalize_progress(v)


class TaskEvent(BaseModel):
    """Input event to establish or transition a task projection."""

    task_id: str = Field(..., min_length=1, max_length=128)
    task_type: str = Field(..., min_length=1, max_length=64)
    owner: str = Field(..., min_length=1, max_length=128)
    project_scope: str = Field(..., min_length=1, max_length=128)
    source_id: str | None = Field(default=None, max_length=128)
    attempt: int = Field(default=1, ge=1)
    status: TaskStatus = "queued"
    event_version: int = Field(default=1, ge=1)
    progress: float | None = None
    stage: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, max_length=200)
    result_summary: dict[str, Any] | None = None
    error_summary: dict[str, Any] | None = None
    is_retryable: bool = False

    @field_validator("progress", mode="before")
    @classmethod
    def validate_event_progress(cls, v: Any) -> float | None:
        return normalize_progress(v)
