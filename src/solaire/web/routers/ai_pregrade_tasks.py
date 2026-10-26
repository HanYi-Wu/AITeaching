"""Router for asynchronous AI pregrade jobs and status queries."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from solaire.web.ai_pregrade_tasks import AiPregradeTaskService
from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.papers.api_support import require_content_project_root

router = APIRouter(tags=["AI Pregrade Tasks"])


class AiPregradeTaskCreateBody(BaseModel):
    attempt_id: str | None = Field(default=None, description="可选特定答卷ID")
    max_attempts: int = Field(default=5, ge=1, le=20, description="最大批改答卷数")
    max_questions_total: int = Field(default=50, ge=1, le=100, description="最大批话题量")


class AiPregradeTaskView(BaseModel):
    task_id: str
    task_type: str = "ai_pregrade"
    owner: str
    project_scope: str
    status: str
    progress: float | None = None
    stage: str | None = None
    created_at: str
    updated_at: str
    result_summary: dict[str, Any] | None = None
    error_summary: dict[str, Any] | None = None


@router.post(
    "/api/papers/{paper_id}/ai-grade-tasks",
    response_model=AiPregradeTaskView,
    status_code=202,
)
def submit_paper_ai_grade_task(
    paper_id: str,
    body: AiPregradeTaskCreateBody,
    user: dict[str, Any] = Depends(current_platform_user),
) -> dict[str, Any]:
    """Submit an asynchronous AI pregrade task for pending attempts on a paper."""
    root = require_platform_root()
    project_root = require_content_project_root()
    service = AiPregradeTaskService(root, project_root)
    return service.submit(
        paper_id=paper_id,
        user=user,
        attempt_id=body.attempt_id,
        max_attempts=body.max_attempts,
        max_questions_total=body.max_questions_total,
    )


@router.post(
    "/api/papers/{paper_id}/attempts/{attempt_id}/ai-grade-task",
    response_model=AiPregradeTaskView,
    status_code=202,
)
def submit_attempt_ai_grade_task(
    paper_id: str,
    attempt_id: str,
    user: dict[str, Any] = Depends(current_platform_user),
) -> dict[str, Any]:
    """Submit an asynchronous AI pregrade task for a single attempt."""
    root = require_platform_root()
    project_root = require_content_project_root()
    service = AiPregradeTaskService(root, project_root)
    return service.submit(
        paper_id=paper_id,
        user=user,
        attempt_id=attempt_id,
    )


@router.get(
    "/api/papers/{paper_id}/ai-grade-tasks/{task_id}",
    response_model=AiPregradeTaskView,
)
def get_paper_ai_grade_task(
    paper_id: str,
    task_id: str,
    user: dict[str, Any] = Depends(current_platform_user),
) -> dict[str, Any]:
    """Query current status and results of an AI pregrade task."""
    root = require_platform_root()
    project_root = require_content_project_root()
    service = AiPregradeTaskService(root, project_root)
    return service.get(task_id, user=user)
