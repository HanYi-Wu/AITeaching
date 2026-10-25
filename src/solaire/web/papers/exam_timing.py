"""Server-authoritative publication windows and examination timers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Any


def _parse_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)

def _publication_availability(row: dict[str, Any]) -> tuple[bool, str | None]:
    status = str(row.get("publication_status") or row.get("status") or "")
    if status != "published":
        return False, "Publication is not open"
    now = datetime.now(UTC)
    start_at = _publication_datetime(row.get("start_at"))
    if start_at is not None and now < start_at:
        return False, "Publication has not started"
    end_at = _publication_datetime(row.get("end_at"))
    if end_at is not None and now >= end_at:
        return False, "Publication has ended"
    return True, None

def _publication_datetime(value: object) -> datetime | None:
    """Legacy datetime-local values are Chinese wall time, not UTC."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('考试时间格式无效') from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone(timedelta(hours=8)))
    return parsed.astimezone(UTC)

def _time_limit_exceeded(row: dict[str, Any]) -> bool:
    limit_minutes = int(row.get("time_limit_minutes") or 0)
    if limit_minutes <= 0:
        return False
    started_at = _parse_datetime(row.get("started_at"))
    if started_at is None:
        return False
    return datetime.now(UTC) > started_at + timedelta(minutes=limit_minutes)

def _remaining_seconds(row: dict[str, Any]) -> int | None:
    limit_minutes = int(row.get("time_limit_minutes") or 0)
    if limit_minutes <= 0:
        return None
    started_at = _parse_datetime(row.get("started_at"))
    if started_at is None:
        return limit_minutes * 60
    return max(0, int((started_at + timedelta(minutes=limit_minutes) - datetime.now(UTC)).total_seconds()))

def _ensure_attempt_can_collect(row: dict[str, Any]) -> None:
    can_answer, reason = _publication_availability(row)
    if not can_answer:
        raise ValueError(reason or "Publication is not open")
    if _time_limit_exceeded(row):
        raise ValueError("Time limit exceeded")

def _ensure_attempt_can_submit(row: dict[str, Any]) -> None:
    can_submit, reason = _publication_availability(row)
    if not can_submit:
        raise ValueError(reason or "Publication is not open")
