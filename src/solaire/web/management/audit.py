"""Management audit events and activity summaries.

Audit records deliberately store only server-defined operation metadata. Request
bodies, query strings, headers, and response bodies are never copied here.
"""

from __future__ import annotations

import logging
import re
import sqlite3
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Request, Response

from solaire.web.platform_db import connect

logger = logging.getLogger(__name__)
SHANGHAI = ZoneInfo("Asia/Shanghai")
_SAFE_RESOURCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:_-]{0,127}$")


@dataclass(frozen=True)
class AuditAction:
    key: str
    label: str
    route_path: str
    method: str
    resource_type: str
    resource_param: str | None = None
    target_school_param: str | None = None


# Keep this list explicit. Adding a mutation to the activity metric requires a
# deliberate, reviewed entry; ordinary reads and authentication are absent.
_ACTION_ROWS = (
    ("admin.update.upload", "上传系统更新包", "POST", "/admin/system/update-package", "system_update", None, None),
    ("admin.update.schedule", "预约系统更新", "POST", "/admin/system/update-package/schedule", "system_update", None, None),
    ("admin.update.github", "预约 GitHub 更新", "POST", "/admin/system/update-package/github", "system_update", None, None),
    ("admin.update.package.discard", "结束更新任务并清理暂存包", "DELETE", "/admin/system/update-package/{package_id}", "system_update", "package_id", None),
    ("admin.update.rollback", "申请版本回滚", "POST", "/admin/system/update-package/rollback", "system_update", None, None),
    ("admin.extension.install", "安装主机扩展", "POST", "/system/extensions/{ext_id}/install", "host_extension", "ext_id", None),
    ("admin.extension.path.update", "修改主机扩展路径", "PUT", "/system/extensions/{ext_id}/manual-path", "host_extension", "ext_id", None),
    ("admin.extension.path.clear", "清除主机扩展路径", "DELETE", "/system/extensions/{ext_id}/manual-path", "host_extension", "ext_id", None),
    ("admin.school.create", "创建学校", "POST", "/schools", "school", None, None),
    ("admin.school_account.create", "创建学校账号", "POST", "/schools/{school_id}/school-users", "school_account", None, "school_id"),
    ("admin.school_account.update", "更新学校账号", "PATCH", "/schools/{school_id}/school-users/{user_id}", "school_account", "user_id", "school_id"),
    ("admin.school_account.reset_password", "重置学校账号密码", "POST", "/schools/{school_id}/school-users/{user_id}/reset-password", "school_account", "user_id", "school_id"),
    ("school.ai.settings.update", "更新学校 AI 设置", "PATCH", "/school/ai-settings", "school_settings", None, None),
    ("school.ai.chat", "使用学校管理助手", "POST", "/school/ai/chat", "school_ai_assistant", None, None),
    ("school.ai.import_file", "通过 AI 导入学校数据", "POST", "/school/ai/import-file", "school_data", None, None),
    ("school.class.create", "创建班级", "POST", "/school/classes", "class", None, None),
    ("school.class.update", "更新班级", "PATCH", "/school/classes/{class_id}", "class", "class_id", None),
    ("school.class.delete", "删除班级", "DELETE", "/school/classes/{class_id}", "class", "class_id", None),
    ("school.class.import", "导入班级", "POST", "/school/classes/import", "class", None, None),
    ("school.class.import_file", "导入班级文件", "POST", "/school/classes/import-file", "class", None, None),
    ("school.teacher.create", "创建教师", "POST", "/school/teachers", "teacher", None, None),
    ("school.teacher.update", "更新教师", "PATCH", "/school/teachers/{teacher_id}", "teacher", "teacher_id", None),
    ("school.teacher.status", "批量更新教师状态", "POST", "/school/teachers/bulk-status", "teacher", None, None),
    ("school.teacher.import", "导入教师", "POST", "/school/teachers/import", "teacher", None, None),
    ("school.teacher.import_file", "导入教师文件", "POST", "/school/teachers/import-file", "teacher", None, None),
    ("school.teacher.reset_password", "重置教师密码", "POST", "/school/teachers/{teacher_id}/reset-password", "teacher", "teacher_id", None),
    ("school.teacher.export", "导出教师", "GET", "/school/teachers/export.xlsx", "teacher", None, None),
    ("school.student.update", "更新学生", "PATCH", "/school/students/{student_id}", "student", "student_id", None),
    ("school.student.status", "批量更新学生状态", "POST", "/school/students/bulk-status", "student", None, None),
    ("school.student.import", "导入学生", "POST", "/school/students/import", "student", None, None),
    ("school.student.import_file", "导入学生文件", "POST", "/school/students/import-file", "student", None, None),
    ("school.student.class_transfer", "转移学生班级", "POST", "/school/students/{student_id}/class-transfer", "student", "student_id", None),
    ("school.student.reset_password", "重置学生密码", "POST", "/school/students/{student_id}/reset-password", "student", "student_id", None),
    ("school.student.export", "导出学生", "GET", "/school/students/export.xlsx", "student", None, None),
    ("school.assignment.create", "分配教师班级", "POST", "/school/teacher-class-assignments", "teacher_class_assignment", None, None),
    ("school.assignment.delete", "移除教师班级分配", "DELETE", "/school/teacher-class-assignments", "teacher_class_assignment", None, None),
    ("school.assignment.import_file", "导入教师班级分配", "POST", "/school/teacher-class-assignments/import-file", "teacher_class_assignment", None, None),
    ("admin.management.settings.update", "更新平台管理设置", "PATCH", "/admin/management/settings", "management_settings", None, None),
    ("school.management.settings.update", "更新学校管理设置", "PATCH", "/school/management/settings", "management_settings", None, None),
    ("admin.management.dictionary.create", "新增平台字典项", "POST", "/admin/management/dictionaries", "dictionary_item", None, None),
    ("school.management.dictionary.create", "新增学校字典项", "POST", "/school/management/dictionaries", "dictionary_item", None, None),
    ("admin.management.dictionary.update", "更新平台字典项", "PATCH", "/admin/management/dictionaries/{item_id}", "dictionary_item", "item_id", None),
    ("school.management.dictionary.update", "更新学校字典项", "PATCH", "/school/management/dictionaries/{item_id}", "dictionary_item", "item_id", None),
    ("school.management.role.create", "创建管理角色", "POST", "/school/management/roles", "management_role", None, None),
    ("school.management.role.update", "更新管理角色", "PATCH", "/school/management/roles/{role_id}", "management_role", "role_id", None),
    ("school.management.user_access.update", "更新账号权限", "PATCH", "/school/management/users/{user_id}/access", "management_user_access", "user_id", None),
    ("admin.management.role.create", "创建学校管理角色", "POST", "/admin/schools/{school_id}/management/roles", "management_role", None, "school_id"),
    ("admin.management.role.update", "更新学校管理角色", "PATCH", "/admin/schools/{school_id}/management/roles/{role_id}", "management_role", "role_id", "school_id"),
    ("admin.management.user_access.update", "更新学校账号权限", "PATCH", "/admin/schools/{school_id}/management/users/{user_id}/access", "management_user_access", "user_id", "school_id"),
    ("school.reports.export.xlsx", "导出考试分析表格", "GET", "/papers/{paper_id}/analysis.xlsx", "paper_report", "paper_id", None),
    ("school.reports.export.pdf", "导出考试分析报告", "GET", "/papers/{paper_id}/analysis.pdf", "paper_report", "paper_id", None),
)

ACTION_CATALOG: tuple[dict[str, str], ...] = tuple(
    {"key": row[0], "label": row[1]} for row in _ACTION_ROWS
)
_ACTION_BY_ROUTE: dict[tuple[str, str], AuditAction] = {
    (row[2], row[3]): AuditAction(
        key=row[0],
        label=row[1],
        method=row[2],
        route_path=row[3],
        resource_type=row[4],
        resource_param=row[5],
        target_school_param=row[6],
    )
    for row in _ACTION_ROWS
}
_ACTION_BY_KEY = {row[0]: row[1] for row in _ACTION_ROWS}


def _route_template(request: Request) -> str | None:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if not isinstance(path, str):
        return None
    if path.startswith("/api/"):
        path = path[4:]
    elif path == "/api":
        path = "/"
    return path


def action_for_request(request: Request) -> AuditAction | None:
    path = _route_template(request)
    if path is None:
        return None
    return _ACTION_BY_ROUTE.get((request.method.upper(), path))


def _safe_id(value: Any) -> str | None:
    candidate = str(value or "").strip()
    return candidate if _SAFE_RESOURCE_ID.fullmatch(candidate) else None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def record_request_event(
    root: Path,
    request: Request,
    response: Response,
    user: dict[str, Any] | None,
) -> None:
    """Record one whitelisted management request without reading payload data."""
    action = action_for_request(request)
    if action is None or not isinstance(user, dict):
        return
    role = str(user.get("role") or "")
    actor_id = _safe_id(user.get("id"))
    if role not in {"admin", "school"} or actor_id is None:
        return

    status = int(getattr(response, "status_code", 500))
    outcome = "success" if 200 <= status < 400 else "denied" if status in {401, 403} else "failure"
    path_params = request.scope.get("path_params") or {}
    # Path parameters are caller-controlled until the route completes. Keep a
    # resource identifier only after a successful response, when the audited
    # route has validated the target (including deletes).
    resource_id = (
        _safe_id(path_params.get(action.resource_param))
        if outcome == "success" and action.resource_param
        else None
    )
    actor_school_id = _safe_id(user.get("school_id"))

    # A school actor is always scoped to their own authenticated school. An
    # admin target is attached only after an authorized successful response;
    # rejected cross-school requests therefore cannot create target-school logs.
    school_id = actor_school_id if role == "school" else None
    if role == "admin" and outcome == "success" and action.target_school_param:
        school_id = _safe_id(path_params.get(action.target_school_param))

    actor_name = str(user.get("display_name") or user.get("username") or "管理账号").strip()[:200]
    request_id = uuid.uuid4().hex
    try:
        with closing(connect(root)) as con, con:
            if role == "admin" and outcome == "success" and action.key in {
                "school.reports.export.xlsx",
                "school.reports.export.pdf",
            } and resource_id:
                target = con.execute("SELECT school_id FROM paper_records WHERE id = ?", (resource_id,)).fetchone()
                if target:
                    school_id = _safe_id(target["school_id"])
            con.execute(
                """
                INSERT INTO management_audit_events
                  (id, occurred_at, actor_id, actor_role, actor_name,
                   actor_school_id, school_id, action, resource_type,
                   resource_id, outcome, affected_count, request_id,
                   http_status, method, route_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
                """,
                (
                    request_id,
                    _utc_now_iso(),
                    actor_id,
                    role,
                    actor_name,
                    actor_school_id,
                    school_id,
                    action.key,
                    action.resource_type,
                    resource_id,
                    outcome,
                    request_id,
                    status,
                    action.method,
                    action.route_path,
                ),
            )
    except Exception:
        # Auditing must never change the result of a completed business action.
        logger.exception("Failed to write management audit event")


def _parse_iso_date(value: str | None, field: str) -> date | None:
    if value is None or value == "":
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{field} must be YYYY-MM-DD")
    return parsed


def _utc_boundary(day: date) -> str:
    return datetime.combine(day, time.min, tzinfo=SHANGHAI).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _date_conditions(
    date_from: str | None,
    date_to: str | None,
    *,
    column: str = "e.occurred_at",
) -> tuple[list[str], list[Any]]:
    start = _parse_iso_date(date_from, "date_from")
    end = _parse_iso_date(date_to, "date_to")
    if start and end and start > end:
        raise ValueError("date_from must be on or before date_to")
    clauses: list[str] = []
    params: list[Any] = []
    if start:
        clauses.append(f"{column} >= ?")
        params.append(_utc_boundary(start))
    if end:
        clauses.append(f"{column} < ?")
        params.append(_utc_boundary(end + timedelta(days=1)))
    return clauses, params


def list_audit_events(
    root: Path,
    *,
    school_id: str | None = None,
    q: str | None = None,
    action: str | None = None,
    outcome: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> dict[str, Any]:
    if action and action not in _ACTION_BY_KEY:
        raise ValueError("unknown action")
    if outcome and outcome not in {"success", "denied", "failure"}:
        raise ValueError("unknown outcome")
    clauses, params = _date_conditions(date_from, date_to)
    if school_id:
        clauses.append("e.school_id = ?")
        params.append(school_id)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append("(e.actor_name LIKE ? ESCAPE '\\' OR e.resource_id LIKE ? ESCAPE '\\')")
        params.extend((f"%{escaped}%", f"%{escaped}%"))
    if action:
        clauses.append("e.action = ?")
        params.append(action)
    if outcome:
        clauses.append("e.outcome = ?")
        params.append(outcome)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    offset = (page - 1) * page_size
    with closing(connect(root)) as con:
        total = int(con.execute(f"SELECT COUNT(*) FROM management_audit_events e{where}", params).fetchone()[0])
        rows = con.execute(
            f"""
            SELECT e.*, s.name AS school_name
            FROM management_audit_events e
            LEFT JOIN schools s ON s.id=e.school_id
            {where}
            ORDER BY e.occurred_at DESC, e.id DESC
            LIMIT ? OFFSET ?
            """,
            (*params, page_size, offset),
        ).fetchall()
    events: list[dict[str, Any]] = []
    for row in rows:
        event = {key: row[key] for key in row.keys()}
        event["action_label"] = _ACTION_BY_KEY.get(str(event.get("action")), "其他管理操作")
        events.append(event)
    return {
        "events": events,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "actions": list(ACTION_CATALOG),
    }


def _load_school_rows(con: sqlite3.Connection, school_id: str | None) -> list[dict[str, str]]:
    if school_id:
        row = con.execute("SELECT id, name FROM schools WHERE id = ?", (school_id,)).fetchone()
        return [{"school_id": str(row["id"]), "school_name": str(row["name"])}] if row else []
    return [
        {"school_id": str(row["id"]), "school_name": str(row["name"])}
        for row in con.execute("SELECT id, name FROM schools ORDER BY name, id").fetchall()
    ]


def get_management_activity(
    root: Path,
    *,
    days: int = 30,
    school_id: str | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    if days not in {7, 30, 90}:
        raise ValueError("days must be 7, 30, or 90")
    end_day = today or datetime.now(SHANGHAI).date()
    start_day = end_day - timedelta(days=days - 1)
    date_from = start_day.isoformat()
    date_to = end_day.isoformat()
    start_utc = _utc_boundary(start_day)
    end_utc = _utc_boundary(end_day + timedelta(days=1))
    with closing(connect(root)) as con:
        school_rows = _load_school_rows(con, school_id)
        scope_clause = " AND e.school_id = ?" if school_id else ""
        scope_params: tuple[Any, ...] = (school_id,) if school_id else ()
        rows = con.execute(
            """
            SELECT substr(e.occurred_at, 1, 10) AS utc_day,
                   e.occurred_at, e.actor_id, e.school_id
            FROM management_audit_events e
            WHERE e.outcome='success'
              AND e.actor_role IN ('admin','school')
              AND e.action IN (%s)
              AND e.occurred_at >= ? AND e.occurred_at < ?%s
            """ % (",".join("?" for _ in _ACTION_BY_KEY), scope_clause),
            (*_ACTION_BY_KEY.keys(), start_utc, end_utc, *scope_params),
        ).fetchall()
        coverage_clauses = ["action IN (" + ",".join("?" for _ in _ACTION_BY_KEY) + ")"]
        coverage_params: list[Any] = list(_ACTION_BY_KEY.keys())
        if school_id:
            coverage_clauses.append("school_id = ?")
            coverage_params.append(school_id)
        coverage_row = con.execute(
            "SELECT MIN(occurred_at) FROM management_audit_events WHERE " + " AND ".join(coverage_clauses),
            coverage_params,
        ).fetchone()

    columns = [(start_day + timedelta(days=offset)).isoformat() for offset in range(days)]
    counts_by_day = {column: 0 for column in columns}
    accounts_by_day: dict[str, set[str]] = {column: set() for column in columns}
    school_counts = {row["school_id"]: 0 for row in school_rows}
    school_accounts: dict[str, set[str]] = {row["school_id"]: set() for row in school_rows}
    total_accounts: set[str] = set()
    active_school_ids: set[str] = set()
    for row in rows:
        try:
            occurred = datetime.fromisoformat(str(row["occurred_at"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        day_key = occurred.astimezone(SHANGHAI).date().isoformat()
        if day_key not in counts_by_day:
            continue
        counts_by_day[day_key] += 1
        actor_id = str(row["actor_id"] or "")
        if actor_id:
            accounts_by_day[day_key].add(actor_id)
            total_accounts.add(actor_id)
        row_school_id = str(row["school_id"] or "")
        if row_school_id:
            active_school_ids.add(row_school_id)
            if row_school_id in school_counts:
                school_counts[row_school_id] += 1
                if actor_id:
                    school_accounts[row_school_id].add(actor_id)

    day_items = [
        {"date": day_key, "operation_count": counts_by_day[day_key], "active_accounts": len(accounts_by_day[day_key])}
        for day_key in columns
    ]
    school_items = [
        {
            **school,
            "operation_count": school_counts[school["school_id"]],
            "active_accounts": len(school_accounts[school["school_id"]]),
        }
        for school in school_rows
    ]
    # Fill each cell from the same timezone-normalized events used for day totals.
    by_school_day: dict[tuple[str, str], int] = {}
    for row in rows:
        try:
            occurred = datetime.fromisoformat(str(row["occurred_at"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        day_key = occurred.astimezone(SHANGHAI).date().isoformat()
        row_school_id = str(row["school_id"] or "")
        if day_key in counts_by_day and row_school_id in school_counts:
            by_school_day[(row_school_id, day_key)] = by_school_day.get((row_school_id, day_key), 0) + 1
    matrix = [
        [by_school_day.get((school["school_id"], day_key), 0) for day_key in columns]
        for school in school_rows
    ]
    coverage_started_at = str(coverage_row[0]) if coverage_row and coverage_row[0] else None
    if coverage_started_at:
        started_local_date = datetime.fromisoformat(coverage_started_at.replace("Z", "+00:00")).astimezone(SHANGHAI).date().isoformat()
        coverage_description = f"管理操作从 {started_local_date} 起记录；仅统计成功的管理操作。此前历史未纳入活动统计。"
    else:
        coverage_description = "当前范围尚无管理操作记录；历史数据未纳入活动统计。"
    return {
        "metric": "management_activity",
        "timezone": "Asia/Shanghai",
        "date_from": date_from,
        "date_to": date_to,
        "summary": {
            "operation_count": sum(counts_by_day.values()),
            "active_accounts": len(total_accounts),
            "active_schools": len(active_school_ids),
        },
        "days": day_items,
        "schools": school_items,
        "heatmap": {"rows": school_rows, "columns": columns, "matrix": matrix},
        "coverage": {"started_at": coverage_started_at, "description": coverage_description},
    }
