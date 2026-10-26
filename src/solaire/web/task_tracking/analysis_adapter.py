"""Adapter for mapping edu_analysis job lifecycle and records to TaskProjection."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from solaire.common.actor_context import actor
from solaire.web.project_scope import project_scope_id
from .contract import create_or_update_projection
from .models import TaskEvent, TaskProjectionRecord, normalize_owner

logger = logging.getLogger(__name__)

_ACTIVE_ANALYSIS_JOB_IDS: set[str] = set()


def mark_analysis_job_active(job_id: str) -> None:
    _ACTIVE_ANALYSIS_JOB_IDS.add(job_id)


def mark_analysis_job_inactive(job_id: str) -> None:
    _ACTIVE_ANALYSIS_JOB_IDS.discard(job_id)


def is_analysis_job_active(job_id: str) -> bool:
    return job_id in _ACTIVE_ANALYSIS_JOB_IDS


def project_analysis_job(
    project_root: Path,
    job: dict[str, Any],
    *,
    owner: str | None = None,
    event_version: int | None = None,
) -> TaskProjectionRecord | None:
    """Safely project an edu_analysis job dictionary to the unified TaskProjection store.

    Guarantees no side-effects on job execution and catches any exceptions.
    """
    try:
        job_id = str(job["job_id"])
        raw_status = str(job.get("status", "running"))
        kind = str(job.get("kind", "builtin"))

        # Determine owner: from job record, argument, or current actor context
        effective_owner = (
            owner
            or job.get("owner")
            or (normalize_owner(actor.get()) if is_analysis_job_active(job_id) else "local")
        )

        title = f"分析任务 ({kind})"
        if kind == "builtin":
            builtin_id = job.get("builtin_id")
            title = f"内置分析 ({builtin_id})" if builtin_id else "内置分析任务"
        elif kind == "script":
            script_id = job.get("script_id")
            title = f"脚本分析 ({script_id})" if script_id else "脚本分析任务"

        error_summary = None
        if job.get("error") or job.get("error_code"):
            error_summary = {
                "error": str(job.get("error", "")),
                "error_code": str(job.get("error_code", "runtime_error")),
            }

        progress = None
        if raw_status == "running":
            if is_analysis_job_active(job_id):
                stage = "分析计算中"
                progress = None
                effective_status = "running"
            else:
                # Interrupted / process-loss job from prior execution
                stage = "需核对/不可恢复"
                progress = None
                effective_status = "failed"
                if not error_summary:
                    error_summary = {
                        "error": "分析任务已中断或执行进程已结束，不可自动恢复，需重新核对配置",
                        "error_code": "interrupted",
                    }
        elif raw_status == "succeeded":
            stage = "分析完成"
            progress = 1.0
            effective_status = "succeeded"
        elif raw_status == "failed":
            err_code = job.get("error_code")
            stage = f"分析失败 ({err_code})" if err_code else "分析失败"
            progress = None
            effective_status = "failed"
        else:
            stage = "需核对/不可恢复"
            effective_status = "failed"

        if event_version is None:
            if effective_status == "running":
                event_version = 1
            else:
                event_version = 2

        # Result summary contains minimal metadata only, not heavy analysis tables or charts
        result_summary = {
            "job_id": job_id,
            "kind": kind,
            "output_ref": job.get("output_ref"),
            "exam_id": job.get("exam_id"),
            "batch_id": job.get("batch_id"),
            "duration_ms": job.get("duration_ms"),
        }

        # Analysis jobs are read-only / deterministic calculations;
        # they must not be blindly replayed without re-submitting with fresh parameters
        is_retryable = False

        event = TaskEvent(
            task_id=job_id,
            task_type="analysis",
            owner=effective_owner,
            project_scope=project_scope_id(project_root),
            source_id=job_id,
            attempt=1,
            status=effective_status if effective_status in {"queued", "running", "succeeded", "failed", "cancelled"} else "failed",
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
        logger.warning("Failed to project analysis job %s: %s", job.get("job_id"), exc)
        return None
