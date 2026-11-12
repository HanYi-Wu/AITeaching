"""Read-only school permission graph data.

The graph is a projection of the existing management permission catalog,
school-role assignments, and access-mode rules. It does not create or mutate
authorization records.
"""

from __future__ import annotations

import math
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from solaire.web.management.access import (
    BASE_PERMISSIONS,
    IMPLIED_PERMISSIONS,
    PERMISSION_CATALOG,
    _LEARNING_PROGRESS_ROUTE_PERMISSIONS,
    _PAPER_ROUTE_PERMISSIONS,
    _SCHOOL_ROUTE_PERMISSIONS,
    _expand_permissions,
    _permissions_from_json,
)
from solaire.web.platform_db import connect, init_platform_db, row_to_dict


MAX_PAGE_SIZE = 100
MAX_ROLES = 500
_BASE_ROLE_ID = "system:base"
_FULL_ROLE_ID = "system:full"


# These are the ten school-workspace navigation entries. Their permission
# mapping is presentation metadata; authorization remains in access.py.
_MENU_DEFINITIONS: tuple[tuple[str, str, str, str], ...] = (
    ("overview", "总览", "基础", "school.overview.read"),
    ("teachers", "教师", "名册", "school.teachers.read"),
    ("classes", "班级", "名册", "school.classes.read"),
    ("students", "学生", "名册", "school.students.read"),
    ("assignments", "分配", "管理", "school.assignments.read"),
    ("ai", "AI", "管理", "school.ai.read"),
    ("audit", "操作日志", "管理", "school.audit.read"),
    ("access", "权限管理", "管理", "school.access.read"),
    ("settings", "参数字典", "管理", "school.settings.read"),
    ("activity", "管理活动", "管理", "school.activity.read"),
)


def _route_permissions() -> dict[str, set[tuple[str, str]]]:
    """Return exact method/path pairs, never a methods x paths product."""
    routes: dict[str, set[tuple[str, str]]] = {key: set() for key in PERMISSION_CATALOG}

    for table in (
        _SCHOOL_ROUTE_PERMISSIONS,
        _PAPER_ROUTE_PERMISSIONS,
        _LEARNING_PROGRESS_ROUTE_PERMISSIONS,
    ):
        for (method, path), permission in table.items():
            routes.setdefault(permission, set()).add((method, f"/api{path}"))

    # Management APIs enforce their permissions directly in their route
    # handlers, so they do not appear in management_route_guard's maps.
    direct_routes: tuple[tuple[str, str, str], ...] = (
        ("GET", "/api/school/management/access", "school.access.read"),
        ("GET", "/api/school/management/permission-graph", "school.access.read"),
        ("GET", "/api/school/management/options", "school.options.read"),
        ("GET", "/api/school/management/audit-events", "school.audit.read"),
        ("GET", "/api/school/management/activity", "school.activity.read"),
        ("GET", "/api/school/management/settings", "school.settings.read"),
        ("GET", "/api/school/management/dictionaries", "school.settings.read"),
        ("PATCH", "/api/school/management/settings", "school.settings.manage"),
        ("POST", "/api/school/management/dictionaries", "school.settings.manage"),
        ("PATCH", "/api/school/management/dictionaries/{item_id}", "school.settings.manage"),
        ("GET", "/api/school/management/roles", "school.roles.manage"),
        ("POST", "/api/school/management/roles", "school.roles.manage"),
        ("PATCH", "/api/school/management/roles/{role_id}", "school.roles.manage"),
        ("GET", "/api/school/management/users", "school.roles.manage"),
        ("GET", "/api/school/management/users/{user_id}/access", "school.roles.manage"),
        ("PATCH", "/api/school/management/users/{user_id}/access", "school.roles.manage"),
    )
    for method, path, permission in direct_routes:
        routes.setdefault(permission, set()).add((method, path))
    return routes


def _catalog_with_routes() -> list[dict[str, Any]]:
    routes = _route_permissions()
    result: list[dict[str, Any]] = []
    for key, descriptor in PERMISSION_CATALOG.items():
        result.append({
            **descriptor,
            "routes": [
                {"method": method, "path": path}
                for method, path in sorted(routes.get(key, set()))
            ],
        })
    return result


def _menus() -> list[dict[str, str]]:
    return [
        {
            "id": menu_id,
            "label": label,
            # The frontend uses this stable pageOption id for navigation.
            "section": menu_id,
            "permission": permission,
            "group": section,
        }
        for menu_id, label, section, permission in _MENU_DEFINITIONS
    ]


def _effective_for_user(
    user: dict[str, Any],
    links: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    """Return effective permissions and active custom-role IDs for a user."""
    if user["status"] != "active":
        return [], []
    if user["mode"] == "full":
        return sorted(PERMISSION_CATALOG), []

    direct = set(BASE_PERMISSIONS)
    active_role_ids: list[str] = []
    for link in links:
        if link["status"] != "active":
            continue
        direct.update(_permissions_from_json(link.get("permissions_json")))
        active_role_ids.append(str(link["id"]))
    # The existing evaluator explicitly reserves this permission to full
    # school accounts, even if a database row was edited outside the API.
    direct.discard("school.roles.manage")
    return sorted(_expand_permissions(direct)), active_role_ids


def _role_effective_permissions(row: dict[str, Any]) -> list[str]:
    if row["status"] != "active":
        return []
    direct = _permissions_from_json(row.get("permissions_json"))
    direct.discard("school.roles.manage")
    return sorted(_expand_permissions(direct))


def _user_record(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "username": str(row["username"]),
        "display_name": str(row["display_name"]),
        "status": str(row["status"]),
        "mode": "custom" if row.get("school_access_mode") == "custom" else "full",
        "role_ids": [],
        "effective_permissions": [],
    }


def _role_record(row: dict[str, Any], *, user_count: int) -> dict[str, Any]:
    permissions = sorted(_permissions_from_json(row.get("permissions_json")))
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "status": str(row.get("status") or "active"),
        "builtin": False,
        "kind": "custom",
        "permissions": permissions,
        "effective_permissions": _role_effective_permissions(row),
        "user_count": int(user_count),
    }


def _schoolwide_reachable_permissions(con, school_id: str) -> set[str]:
    """Compute reachability from a bounded permission set, not all user rows."""
    has_active_full_user = con.execute(
        """SELECT 1 FROM users
           WHERE school_id = ? AND role = 'school' AND status = 'active'
             AND school_access_mode != 'custom' LIMIT 1""",
        (school_id,),
    ).fetchone()
    if has_active_full_user is not None:
        return set(PERMISSION_CATALOG)

    has_active_custom_user = con.execute(
        """SELECT 1 FROM users
           WHERE school_id = ? AND role = 'school' AND status = 'active'
             AND school_access_mode = 'custom' LIMIT 1""",
        (school_id,),
    ).fetchone()
    if has_active_custom_user is None:
        return set()

    direct = set(BASE_PERMISSIONS)
    rows = con.execute(
        """SELECT DISTINCT r.permissions_json
           FROM management_roles r
           JOIN management_user_roles link ON link.role_id = r.id
           JOIN users u ON u.id = link.user_id
           WHERE r.school_id = ? AND r.status = 'active'
             AND u.school_id = ? AND u.role = 'school'
             AND u.status = 'active' AND u.school_access_mode = 'custom'""",
        (school_id, school_id),
    )
    for row in rows:
        direct.update(_permissions_from_json(row["permissions_json"]))
    direct.discard("school.roles.manage")
    return _expand_permissions(direct)


def build_permission_graph(
    root: Path,
    school_id: str,
    *,
    page: int = 1,
    page_size: int = 100,
    q: str | None = None,
    self_user_id: str | None = None,
    school_actor_id: str | None = None,
) -> dict[str, Any]:
    """Build a school-scoped, read-only graph for a page of accounts.

    ``self_user_id`` explicitly restricts the result to that account.
    ``school_actor_id`` derives full-versus-self-only scope from the actor's
    current database row, avoiding a stale full-mode decision widening scope.
    If both are provided, they must identify the same account and the explicit
    self-only restriction takes precedence.
    """
    init_platform_db(root)
    clean_page = max(1, int(page))
    clean_page_size = min(MAX_PAGE_SIZE, max(1, int(page_size)))
    clean_q = (q or "").strip()
    menus = _menus()
    catalog = _catalog_with_routes()
    implications = [
        {"source": source, "target": target}
        for source, targets in sorted(IMPLIED_PERMISSIONS.items())
        for target in sorted(targets)
    ]

    with closing(connect(root)) as con:
        con.execute("BEGIN")
        school_row = con.execute(
            "SELECT id, name FROM schools WHERE id = ?", (school_id,)
        ).fetchone()
        if school_row is None:
            raise HTTPException(status_code=404, detail="学校不存在")
        school = {"id": str(school_row["id"]), "name": str(school_row["name"])}

        actor_row = None
        if school_actor_id is not None:
            if self_user_id is not None and self_user_id != school_actor_id:
                raise HTTPException(status_code=400, detail="权限图账号范围冲突")
            actor_row = con.execute(
                """SELECT id, school_id, role, username, display_name, status,
                          school_access_mode
                   FROM users WHERE id = ? AND school_id = ? AND role = 'school'""",
                (school_actor_id, school_id),
            ).fetchone()
            if actor_row is None or actor_row["status"] != "active":
                raise HTTPException(status_code=403, detail="学校账号不再有效")
            if self_user_id is not None:
                # An explicit self-only request is never widened by a full
                # mode actor context.
                pass
            elif actor_row["school_access_mode"] == "custom":
                self_user_id = school_actor_id
            elif actor_row["school_access_mode"] != "custom":
                self_user_id = None

        self_only = self_user_id is not None
        if self_only:
            row = actor_row if self_user_id == school_actor_id and actor_row is not None else con.execute(
                """SELECT id, school_id, role, username, display_name, status,
                          school_access_mode
                   FROM users WHERE id = ? AND school_id = ? AND role = 'school'""",
                (self_user_id, school_id),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=403, detail="学校账号不属于此学校")
            user_rows = [row]
            total = 1
            clean_page = 1
        else:
            where = ["u.school_id = ?", "u.role = 'school'"]
            params: list[Any] = [school_id]
            if clean_q:
                term = f"%{clean_q.lower()}%"
                where.append(
                    "(u.id = ? OR lower(u.username) LIKE ? OR lower(u.display_name) LIKE ? "
                    "OR lower(COALESCE(u.email, '')) LIKE ?)"
                )
                params.extend((clean_q, term, term, term))
            where_sql = " AND ".join(where)
            total = int(con.execute(
                f"SELECT COUNT(*) FROM users u WHERE {where_sql}", tuple(params)
            ).fetchone()[0])
            offset = (clean_page - 1) * clean_page_size
            user_rows = con.execute(
                f"""SELECT u.id, u.school_id, u.role, u.username, u.display_name,
                           u.status, u.school_access_mode
                    FROM users u WHERE {where_sql}
                    ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?""",
                (*params, clean_page_size, offset),
            ).fetchall()

        users = [_user_record(row_to_dict(row) or {}) for row in user_rows]
        user_ids = [item["id"] for item in users]

        # Fetch page assignments and their same-school role definitions in one
        # join. Full-mode assignments are deliberately ignored below.
        links_by_user: dict[str, list[dict[str, Any]]] = {user_id: [] for user_id in user_ids}
        role_rows_by_id: dict[str, dict[str, Any]] = {}
        if user_ids:
            placeholders = ",".join("?" for _ in user_ids)
            rows = con.execute(
                f"""SELECT link.user_id, r.id, r.school_id, r.name, r.status,
                           r.permissions_json, r.created_at, r.updated_at
                    FROM management_user_roles link
                    JOIN management_roles r ON r.id = link.role_id
                    WHERE link.user_id IN ({placeholders}) AND r.school_id = ?
                    ORDER BY r.name COLLATE NOCASE, r.id""",
                (*user_ids, school_id),
            ).fetchall()
            for raw in rows:
                row = row_to_dict(raw) or {}
                user_id = str(row["user_id"])
                role_id = str(row["id"])
                role_rows_by_id.setdefault(role_id, row)
                links_by_user[user_id].append(row)

        # Keep the role matrix bounded. Roles assigned to this page are
        # preferred so their edges are resolvable when the school has many
        # unrelated role definitions.
        assigned_role_ids_ordered = list(role_rows_by_id)
        if self_only:
            if users[0]["mode"] == "full":
                assigned_role_ids_ordered = []
            selected_role_ids_ordered = assigned_role_ids_ordered[:MAX_ROLES]
            roles_truncated = len(assigned_role_ids_ordered) > MAX_ROLES
        else:
            total_custom_roles = int(con.execute(
                "SELECT COUNT(*) FROM management_roles WHERE school_id = ?",
                (school_id,),
            ).fetchone()[0])
            roles_truncated = total_custom_roles > MAX_ROLES
            role_list_rows = con.execute(
                """SELECT id, school_id, name, status, permissions_json,
                          created_at, updated_at
                   FROM management_roles WHERE school_id = ?
                   ORDER BY name COLLATE NOCASE, id LIMIT ?""",
                (school_id, MAX_ROLES + 1),
            ).fetchall()
            listed_ids = [str(row["id"]) for row in role_list_rows]
            for raw in role_list_rows:
                row = row_to_dict(raw) or {}
                role_rows_by_id.setdefault(str(row["id"]), row)
            selected_role_ids_ordered = list(dict.fromkeys(
                [*assigned_role_ids_ordered, *listed_ids]
            ))[:MAX_ROLES]
            if len(assigned_role_ids_ordered) > MAX_ROLES:
                roles_truncated = True
        selected_role_ids_ordered = sorted(
            selected_role_ids_ordered,
            key=lambda role_id: (str(role_rows_by_id[role_id].get("name") or "").casefold(), role_id),
        )

        role_user_counts: dict[str, int] = {}
        if selected_role_ids_ordered and not self_only:
            role_placeholders = ",".join("?" for _ in selected_role_ids_ordered)
            count_rows = con.execute(
                f"""SELECT link.role_id, COUNT(DISTINCT u.id) AS user_count
                    FROM management_user_roles link
                    JOIN management_roles r ON r.id = link.role_id
                    JOIN users u ON u.id = link.user_id
                    WHERE r.school_id = ? AND u.school_id = ? AND u.role = 'school'
                      AND u.school_access_mode = 'custom'
                      AND link.role_id IN ({role_placeholders})
                    GROUP BY link.role_id""",
                (school_id, school_id, *selected_role_ids_ordered),
            ).fetchall()
            role_user_counts = {
                str(row["role_id"]): int(row["user_count"] or 0)
                for row in count_rows
            }

        active_role_ids_by_user: dict[str, set[str]] = {}
        for user in users:
            links = links_by_user[user["id"]] if user["mode"] == "custom" else []
            user["role_ids"] = sorted(str(link["id"]) for link in links)
            effective, active_role_ids = _effective_for_user(user, links)
            user["effective_permissions"] = effective
            active_role_ids_by_user[user["id"]] = set(active_role_ids)

        roles: list[dict[str, Any]] = []
        if self_only:
            base_user_count = int(users[0]["mode"] == "custom")
            full_user_count = int(users[0]["mode"] == "full")
        else:
            modes = con.execute(
                """SELECT school_access_mode, COUNT(*) AS account_count FROM users
                   WHERE school_id = ? AND role = 'school' GROUP BY school_access_mode""",
                (school_id,),
            ).fetchall()
            mode_counts = {
                str(row["school_access_mode"]): int(row["account_count"] or 0)
                for row in modes
            }
            base_user_count = mode_counts.get("custom", 0)
            full_user_count = mode_counts.get("full", 0)

        if not self_only or users[0]["mode"] == "custom":
            roles.append({
                "id": _BASE_ROLE_ID,
                "name": "基础访问",
                "status": "active",
                "builtin": True,
                "kind": "base",
                "permissions": sorted(BASE_PERMISSIONS),
                "effective_permissions": sorted(_expand_permissions(BASE_PERMISSIONS)),
                "user_count": int(base_user_count),
            })
        if not self_only or users[0]["mode"] == "full":
            roles.append({
                "id": _FULL_ROLE_ID,
                "name": "完整学校管理",
                "status": "active",
                "builtin": True,
                "kind": "full",
                "permissions": sorted(PERMISSION_CATALOG),
                "effective_permissions": sorted(PERMISSION_CATALOG),
                "user_count": int(full_user_count),
            })

        for role_id in selected_role_ids_ordered:
            row = role_rows_by_id.get(role_id)
            if row is None:
                continue
            if self_only:
                user_count = 1 if any(
                    role_id in user["role_ids"] for user in users
                ) else 0
            else:
                user_count = role_user_counts.get(role_id, 0)
            roles.append(_role_record(row, user_count=user_count))

        assignments: list[dict[str, Any]] = []
        returned_role_ids = {role["id"] for role in roles}
        for user in users:
            builtin_role_id = _FULL_ROLE_ID if user["mode"] == "full" else _BASE_ROLE_ID
            assignments.append({
                "user_id": user["id"],
                "role_id": builtin_role_id,
                "active": user["status"] == "active",
                "source": "builtin",
            })
            if user["mode"] != "custom":
                # Full mode supersedes even stale links present in the join.
                continue
            for link in links_by_user[user["id"]]:
                role_id = str(link["id"])
                if role_id not in returned_role_ids:
                    # The target node is outside the 500-role coverage window.
                    # role_ids still preserves the relationship for diagnosis.
                    continue
                assignments.append({
                    "user_id": user["id"],
                    "role_id": role_id,
                    "active": user["status"] == "active" and link["status"] == "active",
                    "source": "assigned",
                })

        if self_only:
            summary_user_count = 1
            summary_role_count = len(roles)
            unused_roles = 0
            has_effective_custom_role = (
                users[0]["mode"] == "custom"
                and bool(active_role_ids_by_user[users[0]["id"]])
            )
            unassigned_users = int(
                users[0]["mode"] == "custom" and not has_effective_custom_role
            )
            reachable = set(users[0]["effective_permissions"])
        else:
            summary_user_count = int(con.execute(
                "SELECT COUNT(*) FROM users WHERE school_id = ? AND role = 'school'",
                (school_id,),
            ).fetchone()[0])
            summary_role_count = total_custom_roles + 2
            unused_roles = int(con.execute(
                """SELECT COUNT(*) FROM management_roles r
                   WHERE r.school_id = ? AND NOT EXISTS (
                     SELECT 1 FROM management_user_roles link
                     JOIN users u ON u.id = link.user_id
                     WHERE link.role_id = r.id AND u.school_id = ?
                       AND u.role = 'school' AND u.school_access_mode = 'custom'
                   )""",
                (school_id, school_id),
            ).fetchone()[0])
            unassigned_users = int(con.execute(
                """SELECT COUNT(*) FROM users u
                   WHERE u.school_id = ? AND u.role = 'school'
                     AND u.school_access_mode = 'custom'
                     AND NOT EXISTS (
                       SELECT 1 FROM management_user_roles link
                       JOIN management_roles r ON r.id = link.role_id
                       WHERE link.user_id = u.id AND r.school_id = ?
                         AND r.status = 'active' AND u.status = 'active'
                     )""",
                (school_id, school_id),
            ).fetchone()[0])
            reachable = _schoolwide_reachable_permissions(con, school_id)

        unreachable_menus = sum(
            1 for menu in menus if menu["permission"] not in reachable
        )
        total_pages = max(1, math.ceil(total / clean_page_size))
        return {
            "school": school,
            "self_only": self_only,
            "users": users,
            "roles": roles,
            "menus": menus,
            "catalog": catalog,
            "assignments": assignments,
            "implications": implications,
            "summary": {
                "user_count": summary_user_count,
                "role_count": summary_role_count,
                "menu_count": len(menus),
                "unused_roles": unused_roles,
                "unassigned_users": unassigned_users,
                "unreachable_menus": unreachable_menus,
            },
            "page": clean_page,
            "page_size": clean_page_size,
            "total": total,
            "total_pages": total_pages,
            "coverage": {
                "returned_users": len(users),
                "total_users": summary_user_count,
                "roles_truncated": roles_truncated,
            },
        }


__all__ = ["build_permission_graph"]
