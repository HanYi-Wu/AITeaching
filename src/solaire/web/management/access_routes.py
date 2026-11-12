"""Role catalog and school-account access management routes."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import closing
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.auth_service import _public_user, utc_now
from solaire.web.management.access import (
    PERMISSION_CATALOG,
    get_management_access,
    management_role_dict,
    require_permission,
)
from solaire.web.management.graph import build_permission_graph
from solaire.web.platform_db import connect, init_platform_db, row_to_dict


router = APIRouter(tags=["management_access"])


class ManagementRoleCreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    permissions: list[str] = Field(default_factory=list, max_length=100)
    status: Literal["active", "disabled"] = "active"

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("角色名称不能为空")
        return clean


class ManagementRoleUpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[str] | None = Field(default=None, max_length=100)
    status: Literal["active", "disabled"] | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        if not clean:
            raise ValueError("角色名称不能为空")
        return clean


class ManagementUserAccessBody(BaseModel):
    mode: Literal["full", "custom"]
    role_ids: list[str] = Field(default_factory=list, max_length=100)


def _school_id_for_full_account(user: dict[str, Any], root) -> str:
    if user.get("role") != "school":
        raise HTTPException(status_code=403, detail="仅学校端管理员可管理本校角色")
    school_id = str(user.get("school_id") or "")
    if not school_id:
        raise HTTPException(status_code=403, detail="学校账号未绑定学校")
    require_permission(user, "school.roles.manage", root)
    return school_id


def _school_id_for_admin(user: dict[str, Any], school_id: str, root) -> str:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅平台管理员可管理学校访问权限")
    init_platform_db(root)
    with closing(connect(root)) as con:
        exists = con.execute("SELECT 1 FROM schools WHERE id = ?", (school_id,)).fetchone()
    if exists is None:
        raise HTTPException(status_code=404, detail="学校不存在")
    return school_id


def _target_school_id(user: dict[str, Any], root, requested_school_id: str | None) -> str:
    if requested_school_id is not None:
        return _school_id_for_admin(user, requested_school_id, root)
    return _school_id_for_full_account(user, root)


def _public_school_user(root, school_id: str, user_id: str) -> dict[str, Any]:
    init_platform_db(root)
    with closing(connect(root)) as con:
        row = con.execute(
            "SELECT * FROM users WHERE id = ? AND school_id = ? AND role = 'school'",
            (user_id, school_id),
        ).fetchone()
    data = row_to_dict(row)
    if data is None:
        # Do not reveal whether an ID exists under another school.
        raise HTTPException(status_code=404, detail="学校端账号不存在")
    return _public_user(data)


def _role_payloads(root, school_id: str) -> list[dict[str, Any]]:
    init_platform_db(root)
    with closing(connect(root)) as con:
        rows = con.execute(
            """
            SELECT r.*,
                   (SELECT COUNT(*) FROM management_user_roles link WHERE link.role_id = r.id) AS user_count
            FROM management_roles r
            WHERE r.school_id = ?
            ORDER BY r.name COLLATE NOCASE, r.id
            """,
            (school_id,),
        ).fetchall()
    return [management_role_dict(row_to_dict(row) or {}, user_count=int(row["user_count"] or 0)) for row in rows]


def _validate_role_permissions(permissions: list[str]) -> list[str]:
    invalid = sorted({permission for permission in permissions if permission not in PERMISSION_CATALOG})
    if invalid:
        raise HTTPException(status_code=400, detail=f"未知权限：{', '.join(invalid)}")
    not_assignable = sorted({permission for permission in permissions if not PERMISSION_CATALOG[permission]["assignable"]})
    if not_assignable:
        raise HTTPException(status_code=400, detail="此权限仅由系统或完整学校管理员提供，不能加入自定义角色")
    return sorted(set(permissions))


def _find_role(root, school_id: str, role_id: str) -> dict[str, Any]:
    init_platform_db(root)
    with closing(connect(root)) as con:
        row = con.execute(
            """
            SELECT r.*,
                   (SELECT COUNT(*) FROM management_user_roles link WHERE link.role_id = r.id) AS user_count
            FROM management_roles r WHERE r.id = ? AND r.school_id = ?
            """,
            (role_id, school_id),
        ).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise HTTPException(status_code=404, detail="校内角色不存在")
    return management_role_dict(data, user_count=int(data.get("user_count") or 0))


def _create_role(root, school_id: str, body: ManagementRoleCreateBody) -> dict[str, Any]:
    init_platform_db(root)
    role_id = uuid.uuid4().hex
    now = utc_now()
    permissions = _validate_role_permissions(body.permissions)
    try:
        with closing(connect(root)) as con, con:
            con.execute(
                """
                INSERT INTO management_roles
                  (id, school_id, name, description, status, permissions_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    role_id,
                    school_id,
                    body.name.strip(),
                    body.description.strip(),
                    body.status,
                    json.dumps(permissions, ensure_ascii=False),
                    now,
                    now,
                ),
            )
    except sqlite3.IntegrityError as error:
        if "management_roles.school_id, management_roles.name" in str(error):
            raise HTTPException(status_code=409, detail="本校已有同名角色") from error
        raise HTTPException(status_code=400, detail="无法创建角色") from error
    return _find_role(root, school_id, role_id)


def _update_role(root, school_id: str, role_id: str, body: ManagementRoleUpdateBody) -> dict[str, Any]:
    init_platform_db(root)
    updates: list[str] = []
    values: list[Any] = []
    fields = body.model_fields_set
    if "name" in fields:
        if body.name is None:
            raise HTTPException(status_code=400, detail="角色名称不能为空")
        updates.append("name = ?")
        values.append(body.name)
    if "description" in fields:
        updates.append("description = ?")
        values.append((body.description or "").strip())
    if "permissions" in fields:
        if body.permissions is None:
            raise HTTPException(status_code=400, detail="角色权限不能为空")
        updates.append("permissions_json = ?")
        values.append(json.dumps(_validate_role_permissions(body.permissions), ensure_ascii=False))
    if "status" in fields:
        if body.status is None:
            raise HTTPException(status_code=400, detail="角色状态不能为空")
        updates.append("status = ?")
        values.append(body.status)
    if not updates:
        raise HTTPException(status_code=400, detail="请至少修改一个角色字段")
    updates.append("updated_at = ?")
    values.append(utc_now())
    values.extend([role_id, school_id])
    try:
        with closing(connect(root)) as con, con:
            cursor = con.execute(
                f"UPDATE management_roles SET {', '.join(updates)} WHERE id = ? AND school_id = ?",
                tuple(values),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="校内角色不存在")
    except sqlite3.IntegrityError as error:
        if "management_roles.school_id, management_roles.name" in str(error):
            raise HTTPException(status_code=409, detail="本校已有同名角色") from error
        raise HTTPException(status_code=400, detail="无法更新角色") from error
    return _find_role(root, school_id, role_id)


def _list_school_users(root, school_id: str, *, q: str | None, status: str | None, page: int, page_size: int) -> dict[str, Any]:
    init_platform_db(root)
    clean_page = max(1, page)
    clean_page_size = min(100, max(1, page_size))
    where = ["school_id = ?", "role = 'school'"]
    params: list[Any] = [school_id]
    if status and status != "all":
        if status not in {"active", "disabled"}:
            raise HTTPException(status_code=400, detail="账号状态无效")
        where.append("status = ?")
        params.append(status)
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        where.append("(lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(COALESCE(email, '')) LIKE ?)")
        params.extend([term, term, term])
    where_sql = " AND ".join(where)
    offset = (clean_page - 1) * clean_page_size
    with closing(connect(root)) as con:
        total = int(con.execute(f"SELECT COUNT(*) FROM users WHERE {where_sql}", tuple(params)).fetchone()[0])
        rows = con.execute(
            f"SELECT * FROM users WHERE {where_sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            (*params, clean_page_size, offset),
        ).fetchall()
    total_pages = max(1, (total + clean_page_size - 1) // clean_page_size)
    return {
        "users": [_public_user(row_to_dict(row) or {}) for row in rows],
        "total": total,
        "page": clean_page,
        "page_size": clean_page_size,
        "total_pages": total_pages,
    }


def _update_user_access(root, actor: dict[str, Any], school_id: str, user_id: str, body: ManagementUserAccessBody) -> dict[str, Any]:
    init_platform_db(root)
    role_ids = sorted(set(body.role_ids))
    if body.mode == "full" and role_ids:
        raise HTTPException(status_code=400, detail="完整权限账号不能同时分配自定义角色")

    try:
        with closing(connect(root)) as con, con:
            con.execute("BEGIN IMMEDIATE")
            target = con.execute(
                "SELECT id, role, school_id, school_access_mode FROM users WHERE id = ? AND role = 'school' AND school_id = ?",
                (user_id, school_id),
            ).fetchone()
            if target is None:
                raise HTTPException(status_code=404, detail="学校端账号不存在")
            if (
                actor.get("role") == "school"
                and str(actor.get("id") or "") == user_id
                and target["school_access_mode"] == "full"
                and body.mode == "custom"
            ):
                raise HTTPException(status_code=400, detail="不能将自己的完整权限改为自定义权限")

            if body.mode == "custom" and role_ids:
                placeholders = ",".join("?" for _ in role_ids)
                rows = con.execute(
                    f"SELECT id, status FROM management_roles WHERE school_id = ? AND id IN ({placeholders})",
                    (school_id, *role_ids),
                ).fetchall()
                if len(rows) != len(role_ids):
                    raise HTTPException(status_code=404, detail="一个或多个校内角色不存在")
                if any(row["status"] != "active" for row in rows):
                    raise HTTPException(status_code=400, detail="不能分配已停用的校内角色")

            con.execute("DELETE FROM management_user_roles WHERE user_id = ?", (user_id,))
            if body.mode == "custom" and role_ids:
                con.executemany(
                    "INSERT INTO management_user_roles(user_id, role_id) VALUES (?, ?)",
                    [(user_id, role_id) for role_id in role_ids],
                )
            con.execute(
                "UPDATE users SET school_access_mode = ?, updated_at = ? WHERE id = ? AND school_id = ? AND role = 'school'",
                (body.mode, utc_now(), user_id, school_id),
            )
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=400, detail="无法分配校内角色") from error

    user_data = _public_school_user(root, school_id, user_id)
    access = get_management_access(root, user_data, allow_inactive=True)
    return {"user": user_data, "access": access}


@router.get("/school/management/access")
def school_management_access(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    require_permission(user, "school.access.read", root)
    return get_management_access(root, user)


@router.get("/admin/management/access")
def admin_management_access(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅平台管理员可查看管理权限")
    return get_management_access(require_platform_root(), user)


@router.get("/school/management/permission-graph")
def school_management_permission_graph(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: Annotated[str | None, Query(max_length=120)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
) -> dict[str, Any]:
    root = require_platform_root()
    if user.get("role") != "school":
        raise HTTPException(status_code=403, detail="仅学校端账号可查看权限图")
    school_id = str(user.get("school_id") or "")
    if not school_id:
        raise HTTPException(status_code=403, detail="学校账号未绑定学校")
    require_permission(user, "school.access.read", root)
    return build_permission_graph(
        root,
        school_id,
        q=q,
        page=page,
        page_size=page_size,
        school_actor_id=str(user.get("id") or ""),
    )


@router.get("/admin/schools/{school_id}/management/permission-graph")
def admin_management_permission_graph(
    school_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: Annotated[str | None, Query(max_length=120)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_admin(user, school_id, root)
    return build_permission_graph(
        root,
        school_id,
        q=q,
        page=page,
        page_size=page_size,
    )


@router.get("/school/management/roles")
def school_management_roles_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_full_account(user, root)
    return {"roles": _role_payloads(root, school_id)}


@router.post("/school/management/roles", status_code=201)
def school_management_roles_create(
    body: ManagementRoleCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_full_account(user, root)
    return {"role": _create_role(root, school_id, body)}


@router.patch("/school/management/roles/{role_id}")
def school_management_roles_update(
    role_id: str,
    body: ManagementRoleUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_full_account(user, root)
    return {"role": _update_role(root, school_id, role_id, body)}


@router.get("/school/management/users")
def school_management_users_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_full_account(user, root)
    return _list_school_users(root, school_id, q=q, status=status, page=page, page_size=page_size)


@router.get("/school/management/users/{user_id}/access")
def school_management_user_access_get(
    user_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_full_account(user, root)
    target = _public_school_user(root, school_id, user_id)
    return {"user": target, "access": get_management_access(root, target, allow_inactive=True)}


@router.patch("/school/management/users/{user_id}/access")
def school_management_user_access_update(
    user_id: str,
    body: ManagementUserAccessBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_full_account(user, root)
    return _update_user_access(root, user, school_id, user_id, body)


@router.get("/admin/schools/{school_id}/management/roles")
def admin_management_roles_list(
    school_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_admin(user, school_id, root)
    return {"roles": _role_payloads(root, school_id)}


@router.post("/admin/schools/{school_id}/management/roles", status_code=201)
def admin_management_roles_create(
    school_id: str,
    body: ManagementRoleCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_admin(user, school_id, root)
    return {"role": _create_role(root, school_id, body)}


@router.patch("/admin/schools/{school_id}/management/roles/{role_id}")
def admin_management_roles_update(
    school_id: str,
    role_id: str,
    body: ManagementRoleUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_admin(user, school_id, root)
    return {"role": _update_role(root, school_id, role_id, body)}


@router.get("/admin/schools/{school_id}/management/users/{user_id}/access")
def admin_management_user_access_get(
    school_id: str,
    user_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_admin(user, school_id, root)
    target = _public_school_user(root, school_id, user_id)
    return {"user": target, "access": get_management_access(root, target, allow_inactive=True)}


@router.patch("/admin/schools/{school_id}/management/users/{user_id}/access")
def admin_management_user_access_update(
    school_id: str,
    user_id: str,
    body: ManagementUserAccessBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    school_id = _school_id_for_admin(user, school_id, root)
    return _update_user_access(root, user, school_id, user_id, body)


__all__ = ["router"]
