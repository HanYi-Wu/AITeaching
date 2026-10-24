"""Owner-scoped export status and retry endpoints."""

from fastapi import APIRouter, Query

from solaire.common.actor_context import actor
from solaire.web.export_tasks import ExportTaskService
from solaire.web.request_context import _require_root
from solaire.web.schemas.exams import ExamExportBody
from solaire.web.schemas.export_tasks import ExportTaskCreateBody, ExportTaskList, ExportTaskView

router = APIRouter()


@router.post("/api/exam/export-tasks", response_model=ExportTaskView, status_code=202)
def export_task_create(body: ExportTaskCreateBody):
    payload = ExamExportBody.model_validate(body.model_dump(exclude={"format", "request_key"}))
    return ExportTaskService(_require_root()).submit(payload, format=body.format, user=actor.get(), request_key=body.request_key)


@router.get("/api/exam/export-tasks", response_model=ExportTaskList)
def export_task_list(limit: int = Query(20, ge=1, le=100)):
    return {"tasks": ExportTaskService(_require_root()).list(user=actor.get(), limit=limit)}


@router.get("/api/exam/export-tasks/{task_id}", response_model=ExportTaskView)
def export_task_get(task_id: str):
    return ExportTaskService(_require_root()).get(task_id, user=actor.get())


@router.post("/api/exam/export-tasks/{task_id}/retry", response_model=ExportTaskView, status_code=202)
def export_task_retry(task_id: str):
    return ExportTaskService(_require_root()).retry(task_id, user=actor.get())
