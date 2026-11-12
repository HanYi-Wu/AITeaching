"""Read-only management audit and activity endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.management.audit import get_management_activity, list_audit_events

router = APIRouter()


def _require_admin(user: dict) -> None:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")


def _require_school_permission(user: dict, permission: str, root) -> str:
    if user.get("role") != "school":
        raise HTTPException(status_code=403, detail="School role required")
    school_id = str(user.get("school_id") or "").strip()
    if not school_id:
        raise HTTPException(status_code=403, detail="School account is not bound to a school")
    from solaire.web.management.access import require_permission

    require_permission(user, permission, root=root)
    return school_id


def _audit_response(**kwargs):
    try:
        return list_audit_events(**kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _validate_activity_days(days: int) -> int:
    if days not in {7, 30, 90}:
        raise HTTPException(status_code=422, detail="days must be 7, 30, or 90")
    return days


@router.get("/admin/management/audit-events")
def admin_audit_events(
    user: Annotated[dict, Depends(current_platform_user)],
    school_id: str | None = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
    action: str | None = None,
    outcome: Literal["success", "denied", "failure"] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    _require_admin(user)
    return _audit_response(
        root=require_platform_root(),
        school_id=school_id,
        q=q,
        action=action,
        outcome=outcome,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )


@router.get("/school/management/audit-events")
def school_audit_events(
    user: Annotated[dict, Depends(current_platform_user)],
    school_id: str | None = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
    action: str | None = None,
    outcome: Literal["success", "denied", "failure"] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    root = require_platform_root()
    bound_school_id = _require_school_permission(user, "school.audit.read", root)
    if school_id and school_id != bound_school_id:
        raise HTTPException(status_code=403, detail="School scope cannot be changed")
    return _audit_response(
        root=root,
        school_id=bound_school_id,
        q=q,
        action=action,
        outcome=outcome,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )


@router.get("/admin/management/activity")
def admin_management_activity(
    user: Annotated[dict, Depends(current_platform_user)],
    days: Annotated[int, Query(ge=7, le=90)] = 30,
    school_id: str | None = None,
):
    _require_admin(user)
    return get_management_activity(require_platform_root(), days=_validate_activity_days(days), school_id=school_id)


@router.get("/school/management/activity")
def school_management_activity(
    user: Annotated[dict, Depends(current_platform_user)],
    days: Annotated[int, Query(ge=7, le=90)] = 30,
    school_id: str | None = None,
):
    root = require_platform_root()
    bound_school_id = _require_school_permission(user, "school.activity.read", root)
    if school_id and school_id != bound_school_id:
        raise HTTPException(status_code=403, detail="School scope cannot be changed")
    return get_management_activity(root, days=_validate_activity_days(days), school_id=bound_school_id)
