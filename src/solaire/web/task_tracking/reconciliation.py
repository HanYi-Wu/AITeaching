"""Reconcile display state with existing sources without executing or retrying work."""
from .contract import create_or_update_projection, get_task_projection
from .models import TaskEvent, ACTIVE_STATUSES
from .live_tasks import is_live


def reconcile_task(root, record, user):
    if record.status not in ACTIVE_STATUSES:
        return record
    if not record.source_id:
        return record
    if record.task_type == "export":
        from solaire.web.export_tasks import ExportTaskService
        ExportTaskService(root).get(record.source_id, user=user)
        return get_task_projection(root, record.task_id, record.owner) or record
    if record.task_type == "analysis":
        from solaire.edu_analysis.core import load_job
        from .analysis_adapter import project_analysis_job
        job = load_job(root, record.source_id)
        return project_analysis_job(root, job, owner=record.owner) or record
    if record.task_type in {"agent", "ai_pregrade"} and not is_live(root, record.task_id):
        if record.task_type == "agent" and record.stage == "awaiting_confirmation":
            return record
        event = TaskEvent(**{key: value for key, value in record.model_dump().items()
                             if key not in {"created_at", "updated_at"}})
        event = event.model_copy(update={"status": "failed", "event_version": record.event_version + 1,
            "progress": None, "stage": "执行已中断，请核对结果",
            "error_summary": {"code": "interrupted_requires_verification",
                              "detail": "执行进程已结束；未自动重放写入，请核对结果后重新发起。"},
            "is_retryable": False})
        return create_or_update_projection(root, event)
    return record
