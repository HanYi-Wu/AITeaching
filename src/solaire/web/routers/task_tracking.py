"""Unified task tracking read and controlled-operation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from solaire.common.actor_context import actor
from solaire.web.request_context import _require_root
from solaire.web.schemas.task_tracking import (
    TaskProjectionListView,
    TaskProjectionView,
)
from solaire.web.task_tracking import (
    get_project_scope_id,
    get_task_projection,
    list_task_projections,
    normalize_owner,
    retry_source_task,
)

router = APIRouter()


@router.get("/api/tasks", response_model=TaskProjectionListView)
def task_list(
    task_type: str | None = Query(None, description="任务类型过滤 (如 export, analysis, agent)"),
    status: str | None = Query(None, description="状态过滤 (如 queued, running, succeeded, failed)"),
    limit: int = Query(50, ge=1, le=100),
):
    """List task status projections for the current actor and active project."""
    root = _require_root()
    user = actor.get()
    owner = normalize_owner(user)
    scope = get_project_scope_id(root)

    projs = list_task_projections(
        root,
        owner=owner,
        project_scope=scope,
        task_type=task_type,
        status=status,
        limit=limit,
    )
    return TaskProjectionListView(
        tasks=[TaskProjectionView.model_validate(p) for p in projs],
        total=len(projs),
        project_scope=scope,
    )


@router.get("/api/tasks/{task_id}", response_model=TaskProjectionView)
def task_get(task_id: str):
    """Retrieve detailed task projection under authenticated owner and project isolation."""
    root = _require_root()
    user = actor.get()
    owner = normalize_owner(user)
    scope = get_project_scope_id(root)

    proj = get_task_projection(root, task_id, owner=owner, project_scope=scope)
    if proj is None:
        raise HTTPException(status_code=404, detail="任务不存在。")
    return TaskProjectionView.model_validate(proj)


@router.post("/api/tasks/{task_id}/retry", response_model=TaskProjectionView, status_code=202)
def task_retry(task_id: str):
    """Execute a controlled retry by delegating directly to authoritative source service."""
    root = _require_root()
    user = actor.get()
    updated = retry_source_task(root, task_id, user=user)
    return TaskProjectionView.model_validate(updated)
