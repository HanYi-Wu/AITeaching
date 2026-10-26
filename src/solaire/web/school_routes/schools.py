"""School entity management and root admin creation routes."""

from __future__ import annotations

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.school_routes.common import _raise_api_error, _require_admin
from solaire.web.school_schemas import SchoolCreateBody, UserCreateBody
from solaire.web.school_service import create_school, create_school_user, get_school, query_schools

router = APIRouter()


@router.get("/schools")
def schools_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    return query_schools(root, q=q, status=status, page=page, page_size=page_size)


@router.post("/schools")
def schools_create(
    body: SchoolCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    try:
        school = create_school(root, name=body.name)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"school": school}


@router.post("/schools/{school_id}/school-users")
def school_users_create(
    school_id: str,
    body: UserCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    try:
        school = get_school(root, school_id=school_id)
        created = create_school_user(
            root,
            school_id=school_id,
            username=body.username,
            password=body.password,
            display_name=body.display_name,
            email=body.email,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"school": school, "user": created}
