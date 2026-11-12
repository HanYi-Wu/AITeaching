"""Server-side permissions for school management accounts.

Platform roles stay fixed (admin/school/teacher/student). School-specific
access is an additional scope for users whose platform role is ``school``.
"""

from __future__ import annotations

import json
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException, Request

from solaire.web.auth_api import current_platform_user
from solaire.web.platform_db import connect, init_platform_db, row_to_dict


def _permission(
    key: str,
    label: str,
    group: str,
    description: str,
    methods: tuple[str, ...],
    paths: tuple[str, ...],
    *,
    assignable: bool = True,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "group": group,
        "description": description,
        "assignable": assignable,
        "methods": list(methods),
        "paths": list(paths),
    }


PERMISSION_CATALOG: dict[str, dict[str, Any]] = {
    "school.overview.read": _permission(
        "school.overview.read", "查看总览", "基础", "查看学校端汇总概览。", ("GET",),
        ("/api/school/ai/capabilities",), assignable=False,
    ),
    "school.access.read": _permission(
        "school.access.read", "查看我的权限", "基础", "查看当前账号的权限范围。", ("GET",),
        ("/api/school/management/access",), assignable=False,
    ),
    "school.options.read": _permission(
        "school.options.read", "读取管理选项", "基础", "读取学校管理界面所需的选项。", ("GET",),
        ("/api/school/management/options",), assignable=False,
    ),
    "school.teachers.read": _permission(
        "school.teachers.read", "查看教师", "账号", "查看本校教师账号和状态。", ("GET",),
        ("/api/school/teachers",),
    ),
    "school.teachers.manage": _permission(
        "school.teachers.manage", "管理教师", "账号", "创建、导入、编辑、停用或重置教师账号。", ("GET", "POST", "PATCH"),
        ("/api/school/teachers", "/api/school/teachers/import", "/api/school/teachers/import-file", "/api/school/teachers/bulk-status", "/api/school/teachers/{teacher_id}", "/api/school/teachers/{teacher_id}/reset-password", "/api/school/teachers/template.xlsx"),
    ),
    "school.teachers.export": _permission(
        "school.teachers.export", "导出教师", "账号", "导出本校教师账号清单。", ("GET",),
        ("/api/school/teachers/export.xlsx",),
    ),
    "school.classes.read": _permission(
        "school.classes.read", "查看班级", "组织", "查看本校班级。", ("GET",),
        ("/api/school/classes",),
    ),
    "school.classes.manage": _permission(
        "school.classes.manage", "管理班级", "组织", "创建、导入、编辑或删除班级。", ("GET", "POST", "PATCH", "DELETE"),
        ("/api/school/classes", "/api/school/classes/import", "/api/school/classes/import-file", "/api/school/classes/{class_id}", "/api/school/classes/template.xlsx", "/api/school/all/template.xlsx"),
    ),
    "school.students.read": _permission(
        "school.students.read", "查看学生", "账号", "查看本校学生账号和状态。", ("GET",),
        ("/api/school/students",),
    ),
    "school.students.manage": _permission(
        "school.students.manage", "管理学生", "账号", "创建、导入、编辑、转班、停用或重置学生账号。", ("GET", "POST", "PATCH"),
        ("/api/school/students", "/api/school/students/import", "/api/school/students/import-file", "/api/school/students/bulk-status", "/api/school/students/{student_id}", "/api/school/students/{student_id}/class-transfer", "/api/school/students/{student_id}/reset-password", "/api/school/students/template.xlsx"),
    ),
    "school.students.export": _permission(
        "school.students.export", "导出学生账号", "账号", "导出学生账号信息。", ("GET",),
        ("/api/school/students/export.xlsx",),
    ),
    "school.assignments.read": _permission(
        "school.assignments.read", "查看教师分配", "组织", "查看教师班级分配。", ("GET",),
        ("/api/school/teacher-class-assignments",),
    ),
    "school.assignments.manage": _permission(
        "school.assignments.manage", "管理教师分配", "组织", "创建、导入或移除教师班级分配。", ("GET", "POST", "DELETE"),
        ("/api/school/teacher-class-assignments", "/api/school/teacher-class-assignments/import-file", "/api/school/teacher-class-assignments/template.xlsx"),
    ),
    "school.ai.read": _permission(
        "school.ai.read", "查看学校 AI 状态", "AI", "查看学校 AI 的可用状态。", ("GET",),
        ("/api/school/ai-settings",),
    ),
    "school.ai.manage": _permission(
        "school.ai.manage", "使用学校 AI", "AI", "使用学校 AI 助手或导入审核；该功能会读取并可能写入学校名册。", ("GET", "POST", "PATCH"),
        ("/api/school/ai-settings", "/api/school/ai/chat", "/api/school/ai/import-review", "/api/school/ai/import-file"),
    ),
    "school.reports.read": _permission(
        "school.reports.read", "查看考试报告", "考试", "查看本校试卷、发布记录和分析报告。", ("GET",),
        ("/api/papers", "/api/papers/{paper_id}/analysis", "/api/papers/{paper_id}/publications", "/api/papers/{paper_id}/submissions", "/api/papers/{paper_id}/attempts/{attempt_id}/scan-images/{page_index}", "/api/learning-progress/teacher/publications", "/api/learning-progress/teacher/comparison"),
    ),
    "school.reports.export": _permission(
        "school.reports.export", "导出考试报告", "考试", "导出本校考试分析报告。", ("GET",),
        ("/api/papers/{paper_id}/analysis.xlsx", "/api/papers/{paper_id}/analysis.pdf", "/api/school/papers/{paper_id}/export-options"),
    ),
    "school.audit.read": _permission(
        "school.audit.read", "查看操作记录", "安全", "查看本校范围内的操作记录。", ("GET",),
        ("/api/school/management/audit-events",),
    ),
    "school.activity.read": _permission(
        "school.activity.read", "查看使用趋势", "安全", "查看本校的管理使用趋势。", ("GET",),
        ("/api/school/management/activity",),
    ),
    "school.settings.read": _permission(
        "school.settings.read", "查看管理设置", "设置", "查看本校管理设置和字典。", ("GET",),
        ("/api/school/management/settings", "/api/school/management/dictionaries"),
    ),
    "school.settings.manage": _permission(
        "school.settings.manage", "管理学校设置", "设置", "修改本校管理设置和字典。", ("GET", "POST", "PATCH"),
        ("/api/school/management/settings", "/api/school/management/dictionaries", "/api/school/management/dictionaries/{item_id}"),
    ),
    "school.roles.manage": _permission(
        "school.roles.manage", "管理校内角色", "权限", "管理本校角色并为学校账号分配角色。", ("GET", "POST", "PATCH"),
        ("/api/school/management/roles", "/api/school/management/roles/{role_id}", "/api/school/management/users", "/api/school/management/users/{user_id}/access"),
        assignable=False,
    ),
}

BASE_PERMISSIONS = frozenset({"school.overview.read", "school.access.read", "school.options.read"})

IMPLIED_PERMISSIONS: dict[str, frozenset[str]] = {
    "school.teachers.manage": frozenset({"school.teachers.read"}),
    "school.teachers.export": frozenset({"school.teachers.read"}),
    "school.classes.manage": frozenset({"school.classes.read"}),
    "school.students.manage": frozenset({"school.students.read", "school.classes.read"}),
    "school.students.export": frozenset({"school.students.read"}),
    "school.assignments.manage": frozenset({"school.assignments.read", "school.teachers.read", "school.classes.read"}),
    # AI chat and import review operate on the school roster. Granting AI
    # access therefore also grants the corresponding roster management scope.
    "school.ai.manage": frozenset({
        "school.ai.read",
        "school.teachers.manage",
        "school.classes.manage",
        "school.students.manage",
        "school.assignments.manage",
    }),
    "school.reports.export": frozenset({"school.reports.read"}),
    "school.settings.manage": frozenset({"school.settings.read"}),
}


def _expand_permissions(permissions: set[str] | frozenset[str]) -> set[str]:
    expanded = {key for key in permissions if key in PERMISSION_CATALOG}
    pending = list(expanded)
    while pending:
        key = pending.pop()
        for implied in IMPLIED_PERMISSIONS.get(key, ()):
            if implied not in expanded:
                expanded.add(implied)
                pending.append(implied)
    return expanded


def _permissions_from_json(raw: Any) -> set[str]:
    try:
        value = json.loads(str(raw or "[]"))
    except (TypeError, json.JSONDecodeError):
        return set()
    if not isinstance(value, list):
        return set()
    return {item for item in value if isinstance(item, str) and item in PERMISSION_CATALOG}


def management_role_dict(row: dict[str, Any], *, user_count: int | None = None) -> dict[str, Any]:
    result = {
        "id": str(row["id"]),
        "school_id": str(row["school_id"]),
        "name": str(row["name"]),
        "description": str(row.get("description") or ""),
        "status": str(row.get("status") or "active"),
        "permissions": sorted(_permissions_from_json(row.get("permissions_json"))),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or ""),
    }
    if user_count is not None:
        result["user_count"] = int(user_count)
    return result


def _load_school_roles(root: Path, *, school_id: str, user_id: str) -> list[dict[str, Any]]:
    with closing(connect(root)) as con:
        rows = con.execute(
            """
            SELECT r.*,
                   (SELECT COUNT(*) FROM management_user_roles count_link WHERE count_link.role_id = r.id) AS user_count
            FROM management_user_roles link
            JOIN management_roles r ON r.id = link.role_id
            WHERE link.user_id = ? AND r.school_id = ?
            ORDER BY r.name COLLATE NOCASE, r.id
            """,
            (user_id, school_id),
        ).fetchall()
    return [management_role_dict(row_to_dict(row) or {}, user_count=int(row["user_count"] or 0)) for row in rows]


def get_management_access(
    root: Path,
    user: dict[str, Any],
    *,
    allow_inactive: bool = False,
) -> dict[str, Any]:
    """Return current effective access, reading custom grants fresh from SQLite."""
    role = str(user.get("role") or "")
    actor_id = str(user.get("id") or "")
    catalog = [dict(item) for item in PERMISSION_CATALOG.values()]
    if role == "admin":
        return {
            "role": "admin",
            "school_id": None,
            "full_access": True,
            "effective_permissions": sorted(PERMISSION_CATALOG),
            "catalog": catalog,
            "assigned_roles": [],
        }
    if role != "school":
        return {
            "role": role,
            "school_id": user.get("school_id"),
            "full_access": False,
            "effective_permissions": [],
            "catalog": catalog,
            "assigned_roles": [],
        }

    school_id = str(user.get("school_id") or "")
    if not actor_id or not school_id:
        raise HTTPException(status_code=403, detail="School account is not bound to a school")
    init_platform_db(root)
    with closing(connect(root)) as con:
        row = con.execute(
            "SELECT role, school_id, school_access_mode, status FROM users WHERE id = ?",
            (actor_id,),
        ).fetchone()
    if (
        row is None
        or row["role"] != "school"
        or row["school_id"] != school_id
        or (row["status"] != "active" and not allow_inactive)
    ):
        raise HTTPException(status_code=403, detail="School account is no longer active")

    mode = "custom" if row["school_access_mode"] == "custom" else "full"
    assigned_roles = _load_school_roles(root, school_id=school_id, user_id=actor_id)
    if mode == "full":
        effective = set(PERMISSION_CATALOG)
    else:
        direct = set(BASE_PERMISSIONS)
        for assigned in assigned_roles:
            if assigned["status"] == "active":
                direct.update(assigned["permissions"])
        direct.discard("school.roles.manage")
        effective = _expand_permissions(direct)

    return {
        "role": "school",
        "school_id": school_id,
        "full_access": mode == "full",
        "effective_permissions": sorted(effective),
        "catalog": catalog,
        "assigned_roles": assigned_roles,
    }


def has_permission(user: dict[str, Any], permission: str, root: Path | None = None) -> bool:
    if permission not in PERMISSION_CATALOG:
        return False
    if user.get("role") == "admin":
        return True
    if root is None:
        from solaire.web.auth_api import require_platform_root

        root = require_platform_root()
    access = get_management_access(root, user)
    return permission in access["effective_permissions"]


def require_permission(user: dict[str, Any], permission: str, root: Path | None = None) -> None:
    if permission not in PERMISSION_CATALOG:
        raise RuntimeError(f"Unknown management permission: {permission}")
    if has_permission(user, permission, root):
        return
    raise HTTPException(status_code=403, detail="当前账号没有执行此操作的权限")


_SCHOOL_ROUTE_PERMISSIONS: dict[tuple[str, str], str] = {
    ("GET", "/school/ai/capabilities"): "school.overview.read",
    ("GET", "/school/teachers"): "school.teachers.read",
    ("GET", "/school/teachers/template.xlsx"): "school.teachers.manage",
    ("GET", "/school/teachers/export.xlsx"): "school.teachers.export",
    ("POST", "/school/teachers"): "school.teachers.manage",
    ("POST", "/school/teachers/import"): "school.teachers.manage",
    ("POST", "/school/teachers/import-file"): "school.teachers.manage",
    ("PATCH", "/school/teachers/{teacher_id}"): "school.teachers.manage",
    ("POST", "/school/teachers/bulk-status"): "school.teachers.manage",
    ("POST", "/school/teachers/{teacher_id}/reset-password"): "school.teachers.manage",
    ("GET", "/school/classes"): "school.classes.read",
    ("GET", "/school/classes/template.xlsx"): "school.classes.manage",
    ("POST", "/school/classes"): "school.classes.manage",
    ("POST", "/school/classes/import"): "school.classes.manage",
    ("POST", "/school/classes/import-file"): "school.classes.manage",
    ("PATCH", "/school/classes/{class_id}"): "school.classes.manage",
    ("DELETE", "/school/classes/{class_id}"): "school.classes.manage",
    ("GET", "/school/all/template.xlsx"): "school.classes.manage",
    ("GET", "/school/teacher-class-assignments/template.xlsx"): "school.assignments.manage",
    ("POST", "/school/teacher-class-assignments/import-file"): "school.assignments.manage",
    ("GET", "/school/teacher-class-assignments"): "school.assignments.read",
    ("POST", "/school/teacher-class-assignments"): "school.assignments.manage",
    ("DELETE", "/school/teacher-class-assignments"): "school.assignments.manage",
    ("GET", "/school/students"): "school.students.read",
    ("GET", "/school/students/{student_id}/class-transfer"): "school.students.manage",
    ("POST", "/school/students/{student_id}/class-transfer"): "school.students.manage",
    ("GET", "/school/students/template.xlsx"): "school.students.manage",
    ("POST", "/school/students/import"): "school.students.manage",
    ("PATCH", "/school/students/{student_id}"): "school.students.manage",
    ("POST", "/school/students/bulk-status"): "school.students.manage",
    ("POST", "/school/students/{student_id}/reset-password"): "school.students.manage",
    ("POST", "/school/students/import-file"): "school.students.manage",
    ("GET", "/school/students/export.xlsx"): "school.students.export",
    ("GET", "/school/papers/{paper_id}/export-options"): "school.reports.export",
    ("GET", "/school/ai-settings"): "school.ai.read",
    ("PATCH", "/school/ai-settings"): "school.ai.manage",
    ("POST", "/school/ai/chat"): "school.ai.manage",
    ("POST", "/school/ai/import-review"): "school.ai.manage",
    ("POST", "/school/ai/import-file"): "school.ai.manage",
}

_PAPER_ROUTE_PERMISSIONS: dict[tuple[str, str], str] = {
    ("GET", "/papers"): "school.reports.read",
    ("GET", "/papers/{paper_id}/analysis"): "school.reports.read",
    ("GET", "/papers/{paper_id}/analysis.xlsx"): "school.reports.export",
    ("GET", "/papers/{paper_id}/analysis.pdf"): "school.reports.export",
    ("GET", "/papers/{paper_id}/publications"): "school.reports.read",
    ("GET", "/papers/{paper_id}/submissions"): "school.reports.read",
    ("GET", "/papers/{paper_id}/attempts/{attempt_id}/scan-images/{page_index}"): "school.reports.read",
}

_LEARNING_PROGRESS_ROUTE_PERMISSIONS: dict[tuple[str, str], str] = {
    ("GET", "/learning-progress/teacher/publications"): "school.reports.read",
    ("GET", "/learning-progress/teacher/comparison"): "school.reports.read",
}


def management_route_guard(
    request: Request,
    user: dict[str, Any] = Depends(current_platform_user),
) -> None:
    """Apply the fine-grained catalog to school-facing legacy API routes."""
    if user.get("role") != "school":
        return

    route = request.scope.get("route")
    path = str(getattr(route, "path", request.url.path))
    if path.startswith("/api/"):
        path = path[4:]
    method = request.method.upper()
    permission = (
        _SCHOOL_ROUTE_PERMISSIONS.get((method, path))
        or _PAPER_ROUTE_PERMISSIONS.get((method, path))
        or _LEARNING_PROGRESS_ROUTE_PERMISSIONS.get((method, path))
    )
    if permission:
        require_permission(user, permission)
        return

    # The dependency is attached only to the legacy school, paper, and
    # learning-progress routers. Fail closed for newly added school routes.
    if path.startswith((
        "/school/",
        "/papers",
        "/learning-progress/",
        "/teacher/",
        "/organizer/",
        "/tools/",
    )):
        raise HTTPException(status_code=403, detail="学校账号没有此接口的管理权限")


__all__ = [
    "BASE_PERMISSIONS",
    "PERMISSION_CATALOG",
    "get_management_access",
    "has_permission",
    "management_role_dict",
    "management_route_guard",
    "require_permission",
]
