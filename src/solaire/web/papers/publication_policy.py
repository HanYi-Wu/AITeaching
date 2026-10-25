"""Validation and lifecycle rules for paper publications."""

from __future__ import annotations

from solaire.web.student_service import _publication_datetime


DELIVERY_MODES = {"offline", "online"}
PUBLICATION_STATUSES = {"draft", "published", "paused", "closed", "revoked"}
SUBMISSION_MODES = {"online", "image_manual", "image_ai"}


def normalize_schedule(start_at, end_at):
    start, end = _publication_datetime(start_at), _publication_datetime(end_at)
    if start and end and end <= start:
        raise ValueError("结束时间必须晚于开始时间")
    return start.isoformat() if start else None, end.isoformat() if end else None


def normalize_delivery_mode(delivery_mode: str) -> str:
    clean_mode = delivery_mode.strip()
    if clean_mode not in DELIVERY_MODES:
        raise ValueError("delivery_mode must be offline or online")
    return clean_mode


def normalize_publication_status(status: str) -> str:
    clean_status = status.strip() or "published"
    if clean_status not in PUBLICATION_STATUSES:
        raise ValueError("invalid publication status")
    return clean_status


def ensure_publication_status_transition(current_status: str, requested_status: str | None) -> None:
    if requested_status is not None and current_status == "revoked" and requested_status != "revoked":
        raise ValueError("已撤回的发布不能直接恢复，请重新发布并重新校验接收人")


def normalize_submission_mode(submission_mode: str) -> str:
    clean_submission_mode = submission_mode.strip() or "online"
    if clean_submission_mode not in SUBMISSION_MODES:
        raise ValueError("submission_mode must be online, image_manual, or image_ai")
    return clean_submission_mode


def normalize_time_limit(time_limit_minutes, *, empty_as_zero: bool = False) -> int | None:
    if empty_as_zero:
        time_limit_minutes = time_limit_minutes or 0
    return max(0, int(time_limit_minutes)) or None
