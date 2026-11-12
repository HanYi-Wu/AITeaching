"""Authenticated management defaults and dictionary endpoints."""

from __future__ import annotations

import sqlite3
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.management.access import require_permission
from solaire.web.management import settings
from solaire.web.school_routes.common import _require_admin, _require_school

router = APIRouter()


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_page_size: Literal[10, 20, 50] | None = None
    activity_default_days: Literal[7, 30, 90] | None = None


class DictionaryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Literal["subjects", "grades"]
    value: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(default=0, ge=-9999, le=9999, strict=True)
    status: Literal["active", "disabled"] = "active"


class DictionaryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Literal["subjects", "grades"] | None = None
    value: str | None = Field(default=None, min_length=1, max_length=80)
    label: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=-9999, le=9999, strict=True)
    status: Literal["active", "disabled"] | None = None


def _school(request: Request, user: dict[str, Any], permission: str) -> str | None:
    if request.url.path.startswith("/api/admin/"):
        _require_admin(user)
        return None
    school_id = _require_school(user)
    require_permission(user, permission, root=require_platform_root())
    return school_id


def _error(error: Exception) -> None:
    if isinstance(error, sqlite3.IntegrityError):
        raise HTTPException(409, "该字典值已存在，请编辑已有条目") from error
    if isinstance(error, ValueError):
        message = str(error)
        if message in {"school not found", "dictionary item not found"}:
            raise HTTPException(404, "学校或字典条目不存在") from error
        raise HTTPException(400, message) from error
    raise error


@router.get("/admin/management/settings")
@router.get("/school/management/settings")
def read_settings(request: Request, user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    school_id = _school(request, user, "school.settings.read")
    return settings.get_settings(require_platform_root(), school_id=school_id)


@router.patch("/admin/management/settings")
@router.patch("/school/management/settings")
def write_settings(
    request: Request, body: SettingsPatch, user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _school(request, user, "school.settings.manage")
    try:
        return settings.update_settings(require_platform_root(), school_id=school_id, changes=body.model_dump(exclude_unset=True))
    except (ValueError, sqlite3.IntegrityError) as error:
        _error(error)


@router.get("/admin/management/dictionaries")
@router.get("/school/management/dictionaries")
def read_dictionary(
    request: Request, user: Annotated[dict[str, Any], Depends(current_platform_user)],
    category: Literal["subjects", "grades"] = "subjects",
) -> dict[str, Any]:
    school_id = _school(request, user, "school.settings.read")
    return settings.list_dictionary(require_platform_root(), school_id=school_id, category=category)


@router.post("/admin/management/dictionaries")
@router.post("/school/management/dictionaries")
def create_item(
    request: Request, body: DictionaryCreate, user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _school(request, user, "school.settings.manage")
    try:
        return {"item": settings.create_dictionary_item(require_platform_root(), school_id=school_id, values=body.model_dump())}
    except (ValueError, sqlite3.IntegrityError) as error:
        _error(error)


@router.patch("/admin/management/dictionaries/{item_id}")
@router.patch("/school/management/dictionaries/{item_id}")
def update_item(
    request: Request, item_id: str, body: DictionaryPatch, user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _school(request, user, "school.settings.manage")
    changes = body.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "字典字段不能为空")
    try:
        return {"item": settings.update_dictionary_item(require_platform_root(), school_id=school_id, item_id=item_id, changes=changes)}
    except (ValueError, sqlite3.IntegrityError) as error:
        _error(error)


@router.get("/admin/management/options")
@router.get("/school/management/options")
def read_options(request: Request, user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    school_id = _school(request, user, "school.options.read")
    return settings.get_options(require_platform_root(), school_id=school_id)
