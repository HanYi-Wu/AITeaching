"""Controlled source operations for task projections.

Delegates operations such as retry to the authoritative source service
while rigorously verifying the actor, owner, project, and permissions.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from fastapi import HTTPException

from .contract import get_task_projection, normalize_owner
from .models import TaskProjectionRecord


def retry_source_task(
    project_root: Path,
    task_id: str,
    user: dict[str, Any] | None,
) -> TaskProjectionRecord:
    """Delegate task retry to authoritative domain service under caller permissions."""
    owner = normalize_owner(user)
    proj = get_task_projection(project_root, task_id, owner=owner)

    if proj is None:
        raise HTTPException(status_code=404, detail="任务不存在。")

    if not proj.is_retryable or not proj.source_id:
        if proj.task_type == "analysis":
            raise HTTPException(
                status_code=400,
                detail="分析任务为只读计算，不支持直接重试，请使用新参数重新发起分析。",
            )
        raise HTTPException(
            status_code=400,
            detail="该任务当前不支持重试或不可安全恢复。",
        )

    if proj.task_type == "export":
        # Check permissions in line with ExportTaskService
        if user is not None:
            if (
                user.get("role") not in {"teacher", "admin"}
                or user.get("status") != "active"
                or not user.get("id")
            ):
                raise HTTPException(status_code=403, detail="教师或管理员权限不足。")

        # Lazy import to avoid circular dependency
        from solaire.web.export_tasks import ExportTaskService

        service = ExportTaskService(project_root)
        service.retry(proj.source_id, user=user)

        updated_proj = get_task_projection(project_root, task_id, owner=owner)
        if updated_proj is None:
            raise HTTPException(status_code=500, detail="重试后未找到更新的任务投影。")
        return updated_proj

    raise HTTPException(
        status_code=400,
        detail=f"任务类型 '{proj.task_type}' 不支持重试操作。",
    )
