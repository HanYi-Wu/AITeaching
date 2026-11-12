"""School entity management and root admin creation routes."""

from __future__ import annotations

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.school_routes.common import _raise_api_error, _require_admin
from solaire.web.school_schemas import (
    SchoolCreateBody,
    SchoolUserResetPasswordBody,
    SchoolUserUpdateBody,
    UserCreateBody,
)
from solaire.web.school_service import (
    create_school,
    create_school_user,
    get_school,
    query_school_users,
    query_schools,
    reset_school_user_password,
    update_school_user,
)

router = APIRouter()


def _raise_school_user_api_error(error: Exception) -> None:
    if isinstance(error, ValueError) and "not found" in str(error).lower():
        detail = "学校不存在" if str(error) == "school not found" else "学校端账号不存在"
        raise HTTPException(status_code=404, detail=detail) from error
    if isinstance(error, sqlite3.IntegrityError) and "users.username" in str(error):
        raise HTTPException(status_code=409, detail="用户名已被占用，请换一个用户名") from error
    if isinstance(error, sqlite3.IntegrityError):
        _raise_api_error(error)
    if isinstance(error, ValueError):
        if "用户名已被占用" in str(error) or "username already exists" in str(error).lower():
            raise HTTPException(status_code=409, detail="用户名已被占用，请换一个用户名") from error
        _raise_api_error(error)
    raise error


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
        _raise_school_user_api_error(e)
    return {"school": school, "user": created}


@router.get("/schools/{school_id}/school-users")
def school_users_list(
    school_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    try:
        get_school(root, school_id=school_id)
        return query_school_users(root, school_id=school_id, q=q, status=status, page=page, page_size=page_size)
    except ValueError as error:
        _raise_school_user_api_error(error)


@router.patch("/schools/{school_id}/school-users/{user_id}")
def school_users_update(
    school_id: str,
    user_id: str,
    body: SchoolUserUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    try:
        get_school(root, school_id=school_id)
        updated = update_school_user(
            root,
            school_id=school_id,
            user_id=user_id,
            username=body.username,
            display_name=body.display_name,
            email=body.email,
            status=body.status,
        )
    except (ValueError, sqlite3.IntegrityError) as error:
        _raise_school_user_api_error(error)
    return {"user": updated}


@router.post("/schools/{school_id}/school-users/{user_id}/reset-password")
def school_users_reset_password(
    school_id: str,
    user_id: str,
    body: SchoolUserResetPasswordBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    try:
        get_school(root, school_id=school_id)
        updated = reset_school_user_password(
            root,
            school_id=school_id,
            user_id=user_id,
            password=body.password,
        )
    except (ValueError, sqlite3.IntegrityError) as error:
        _raise_school_user_api_error(error)
    return {"user": updated}
