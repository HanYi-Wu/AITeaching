"""Adapter for mapping ExportTaskService lifecycle and database records to TaskProjection."""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

from solaire.web.project_scope import project_scope_id
from .contract import create_or_update_projection
from .models import TaskEvent, TaskProjectionRecord

logger = logging.getLogger(__name__)


def row_to_dict(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    if isinstance(row, sqlite3.Row):
        return {key: row[key] for key in row.keys()}
    return dict(row)


def project_export_task(
    project_root: Path,
    row: sqlite3.Row | dict[str, Any],
    *,
    progress: float | None = None,
    stage: str | None = None,
    event_version: int | None = None,
) -> TaskProjectionRecord | None:
    """Safely project an export task row to the unified TaskProjection store.

    Guarantees no exceptions are raised to callers so that export lifecycle is never disrupted.
    """
    try:
        data = row_to_dict(row)
        task_id = str(data["id"])
        owner = str(data["owner"])
        status = str(data.get("status", "queued"))
        attempt = int(data.get("attempt", 1))

        # Parse request payload for metadata
        title = "试卷导出"
        format_name = str(data.get("format", "pdf")).upper()
        if data.get("request_json"):
            try:
                req_obj = json.loads(data["request_json"])
                if isinstance(req_obj, dict):
                    label = req_obj.get("export_label") or req_obj.get("subject") or req_obj.get("exam_workspace_id")
                    if label:
                        title = f"试卷导出 ({label})"
                    else:
                        title = f"试卷导出 ({format_name})"
            except Exception:
                pass

        # Determine version and stage if not provided
        if event_version is None:
            if status == "queued":
                event_version = 1
            elif status == "running":
                event_version = 2
            else:
                event_version = 3

        if stage is None:
            if status == "queued":
                stage = "排队中"
            elif status == "running":
                stage = "导出处理中"
            elif status == "succeeded":
                stage = "导出完成"
            elif status == "failed":
                stage = "导出失败"

        if progress is None:
            if status == "queued":
                progress = 0.0
            elif status == "running":
                progress = 0.5
            elif status == "succeeded":
                progress = 1.0
            else:
                progress = None

        # Minimal result summary
        result_summary = None
        if data.get("result_json"):
            try:
                res_obj = json.loads(data["result_json"])
                if isinstance(res_obj, dict):
                    result_summary = {
                        "format": res_obj.get("format") or data.get("format"),
                        "filename": res_obj.get("filename"),
                        "file_path": res_obj.get("file_path"),
                        "download_url": res_obj.get("download_url"),
                    }
            except Exception:
                pass

        # Error summary
        error_summary = None
        if data.get("error_json"):
            try:
                err_obj = json.loads(data["error_json"])
                if isinstance(err_obj, dict):
                    error_summary = {
                        "status": err_obj.get("status", 500),
                        "detail": str(err_obj.get("detail", "导出任务失败")),
                    }
            except Exception:
                pass

        # An export task can be retried if failed
        is_retryable = status == "failed"

        event = TaskEvent(
            task_id=task_id,
            task_type="export",
            owner=owner,
            project_scope=project_scope_id(project_root),
            source_id=task_id,
            attempt=attempt,
            status=status if status in {"queued", "running", "succeeded", "failed", "cancelled"} else "queued",
            event_version=event_version,
            progress=progress,
            stage=stage,
            title=title,
            result_summary=result_summary,
            error_summary=error_summary,
            is_retryable=is_retryable,
        )

        return create_or_update_projection(project_root, event)
    except Exception as exc:
        logger.warning("Failed to project export task %s: %s", row.get("id") if isinstance(row, dict) else "?", exc)
        return None
