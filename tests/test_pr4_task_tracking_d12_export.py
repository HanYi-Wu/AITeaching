"""Tests for D12: Export task lifecycle adapter to unified task projection."""

import json
import uuid
from pathlib import Path
from unittest.mock import patch
import pytest

from solaire.web import export_tasks
from solaire.web.export_tasks import ExportTaskService
from solaire.web.schemas.exams import ExamExportBody
from solaire.web.task_tracking import get_task_projection


class ManualExecutor:
    def __init__(self):
        self.pending = []

    def submit(self, fn, *args):
        self.pending.append((fn, args))

    def run_all(self):
        while self.pending:
            fn, args = self.pending.pop(0)
            fn(*args)

    def close(self):
        for _, args in self.pending:
            args[-1].close()


def _minimal_exam_body() -> ExamExportBody:
    return ExamExportBody(
        template_ref="test",
        template_path="templates/test.yaml",
        selected_items=[],
        export_label="期末统考A卷",
        subject="数学",
    )


def test_export_task_lifecycle_projects_to_unified_store(tmp_path: Path, monkeypatch):
    pool = ManualExecutor()
    service = ExportTaskService(tmp_path, executor=pool)
    user = {"role": "teacher", "id": "t_d12_1", "status": "active"}

    monkeypatch.setattr(
        export_tasks.auth_service, "get_user_profile", lambda *args: dict(user)
    )
    monkeypatch.setattr(
        export_tasks.export_workflow,
        "export_exam",
        lambda *args, **kwargs: {"ok": True, "filename": "exam.pdf", "format": "pdf"},
    )

    # 1. Submit export task -> status queued
    created = service.submit(_minimal_exam_body(), format="pdf", user=user)
    assert created["id"]
    task_id = created["id"]

    # Check projection in TaskProjectionStore -> queued
    proj_queued = get_task_projection(tmp_path, task_id, owner="teacher:t_d12_1")
    assert proj_queued is not None
    assert proj_queued.task_id == task_id
    assert proj_queued.task_type == "export"
    assert proj_queued.owner == "teacher:t_d12_1"
    assert proj_queued.source_id == task_id
    assert proj_queued.attempt == 1
    assert proj_queued.status == "queued"
    assert "期末统考A卷" in (proj_queued.title or "")

    # 2. Run worker -> status succeeded
    pool.run_all()
    proj_finished = get_task_projection(tmp_path, task_id, owner="teacher:t_d12_1")
    assert proj_finished is not None
    assert proj_finished.status == "succeeded"
    assert proj_finished.progress == 1.0
    assert proj_finished.stage == "导出完成"
    assert proj_finished.result_summary == {
        "format": "pdf",
        "filename": "exam.pdf",
        "file_path": None,
        "download_url": None,
    }


def test_export_service_responses_exact_field_compatibility(tmp_path: Path, monkeypatch):
    pool = ManualExecutor()
    service = ExportTaskService(tmp_path, executor=pool)
    user = {"role": "teacher", "id": "t_compat", "status": "active"}

    monkeypatch.setattr(
        export_tasks.auth_service, "get_user_profile", lambda *args: dict(user)
    )

    view = service.submit(_minimal_exam_body(), format="pdf", user=user)
    expected_fields = {
        "id",
        "format",
        "status",
        "created_at",
        "updated_at",
        "attempt",
        "exam_workspace_id",
        "export_label",
        "subject",
        "result",
        "error",
    }
    assert set(view.keys()) == expected_fields

    got = service.get(view["id"], user=user)
    assert set(got.keys()) == expected_fields
    assert got["id"] == view["id"]

    listed = service.list(user=user)
    assert len(listed) >= 1
    assert set(listed[0].keys()) == expected_fields
    pool.close()


def test_historical_export_tasks_are_queryable_via_projection(tmp_path: Path):
    service = ExportTaskService(tmp_path)
    user = {"role": "teacher", "id": "t_legacy", "status": "active"}

    legacy_id = uuid.uuid4().hex
    with service._connect() as db:
        db.execute(
            """
            INSERT INTO export_tasks (
                id, owner, format, request_json, request_key, status,
                created_at, updated_at, attempt, result_json, error_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                legacy_id,
                "teacher:t_legacy",
                "pdf",
                json.dumps({"export_label": "历史归档考试"}),
                None,
                "succeeded",
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:01:00Z",
                1,
                json.dumps({"filename": "legacy.pdf", "file_path": "/tmp/legacy.pdf"}),
                None,
            ),
        )

    # Initially not in task-projections.sqlite3
    initial_proj = get_task_projection(tmp_path, legacy_id, owner="teacher:t_legacy")
    assert initial_proj is None

    # Service.get will trigger lazy projection of historical row
    res = service.get(legacy_id, user=user)
    assert res["id"] == legacy_id

    # Now projection is queryable in unified store
    proj = get_task_projection(tmp_path, legacy_id, owner="teacher:t_legacy")
    assert proj is not None
    assert proj.task_id == legacy_id
    assert proj.status == "succeeded"
    assert proj.result_summary == {
        "format": "pdf",
        "filename": "legacy.pdf",
        "file_path": "/tmp/legacy.pdf",
        "download_url": None,
    }


def test_interrupted_recovery_and_retry_projection(tmp_path: Path, monkeypatch):
    pool = ManualExecutor()
    service = ExportTaskService(tmp_path, executor=pool)
    user = {"role": "teacher", "id": "t_retry", "status": "active"}

    monkeypatch.setattr(
        export_tasks.auth_service, "get_user_profile", lambda *args: dict(user)
    )

    task_id = uuid.uuid4().hex
    with service._connect() as db:
        db.execute(
            """
            INSERT INTO export_tasks (
                id, owner, format, request_json, request_key, status,
                created_at, updated_at, attempt, error_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                "teacher:t_retry",
                "pdf",
                json.dumps(_minimal_exam_body().model_dump(mode="json")),
                None,
                "failed",
                "2026-10-27T00:00:00Z",
                "2026-10-27T00:01:00Z",
                1,
                json.dumps({"status": 503, "detail": "导出进程已中断，可重试此任务。"}),
            ),
        )

    # Sync to projection via get
    service.get(task_id, user=user)
    proj1 = get_task_projection(tmp_path, task_id, owner="teacher:t_retry")
    assert proj1 is not None
    assert proj1.status == "failed"
    assert proj1.is_retryable is True
    assert proj1.attempt == 1

    # Retry the failed export task
    service.retry(task_id, user=user)
    proj2 = get_task_projection(tmp_path, task_id, owner="teacher:t_retry")
    assert proj2 is not None
    assert proj2.attempt == 2
    assert proj2.status == "queued"
    pool.close()


def test_projection_failure_does_not_break_export_service(tmp_path: Path):
    pool = ManualExecutor()
    service = ExportTaskService(tmp_path, executor=pool)
    user = {"role": "teacher", "id": "t_fault", "status": "active"}

    # Even if project_export_task raises or fails internally
    with patch(
        "solaire.web.export_tasks.project_export_task",
        side_effect=RuntimeError("Database write error"),
    ):
        view = service.submit(_minimal_exam_body(), format="pdf", user=user)
        assert view["id"]
        assert view["status"] == "queued"
    pool.close()
