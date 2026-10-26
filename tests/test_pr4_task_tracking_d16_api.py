"""Tests for D16: Unified read-only query and source-controlled retry API."""

import json
import uuid
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from solaire.edu_analysis import core
from solaire.web import export_tasks
from solaire.web.schemas.exams import ExamExportBody
from solaire.web.task_tracking import (
    TaskEvent,
    create_or_update_projection,
    get_project_scope_id,
    get_task_projection,
)


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


@pytest.fixture
def auth_user():
    return {"id": "teacher-d16", "role": "teacher", "status": "active"}


@pytest.fixture
def exam_body():
    return ExamExportBody(
        template_ref="test",
        template_path="templates/test.yaml",
        selected_items=[],
        export_label="期末统考测试卷",
        subject="物理",
    )


def test_task_list_and_get_endpoints(tmp_path: Path, monkeypatch, web_client: TestClient, auth_user, exam_body):
    pool = ManualExecutor()
    monkeypatch.setattr(export_tasks, "_executor", pool)
    monkeypatch.setattr(
        export_tasks.auth_service, "get_user_profile", lambda *args: dict(auth_user)
    )

    # 1. Create an export task through existing endpoint
    resp = web_client.post("/api/exam/export-tasks", json=exam_body.model_dump())
    assert resp.status_code == 202
    task_id = resp.json()["id"]

    # 2. Query via new unified /api/tasks endpoint
    list_resp = web_client.get("/api/tasks")
    assert list_resp.status_code == 200
    data = list_resp.json()
    assert "tasks" in data
    assert data["total"] >= 1
    assert data["project_scope"].startswith("project:")

    matching = [t for t in data["tasks"] if t["task_id"] == task_id]
    assert len(matching) == 1
    task_view = matching[0]
    assert task_view["task_type"] == "export"
    assert task_view["status"] == "queued"
    assert task_view["owner"] == "local"  # Without public mode, default is local

    # 3. Query detail via /api/tasks/{task_id}
    detail_resp = web_client.get(f"/api/tasks/{task_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["task_id"] == task_id
    assert detail["task_type"] == "export"
    assert detail["status"] == "queued"
    assert "期末统考测试卷" in (detail["title"] or "")
    pool.close()


def test_task_list_filters(tmp_path: Path, monkeypatch, web_client: TestClient):
    root = tmp_path.resolve()
    scope = get_project_scope_id(root)

    # Manually project one export task and one analysis task
    create_or_update_projection(
        root,
        TaskEvent(
            task_id="filter_exp_1",
            task_type="export",
            owner="local",
            project_scope=scope,
            status="queued",
            event_version=1,
        ),
    )
    create_or_update_projection(
        root,
        TaskEvent(
            task_id="filter_ana_1",
            task_type="analysis",
            owner="local",
            project_scope=scope,
            status="succeeded",
            event_version=2,
        ),
    )

    # Filter by task_type=export
    resp_exp = web_client.get("/api/tasks?task_type=export")
    assert resp_exp.status_code == 200
    tasks_exp = resp_exp.json()["tasks"]
    assert any(t["task_id"] == "filter_exp_1" for t in tasks_exp)
    assert not any(t["task_id"] == "filter_ana_1" for t in tasks_exp)

    # Filter by task_type=analysis
    resp_ana = web_client.get("/api/tasks?task_type=analysis")
    assert resp_ana.status_code == 200
    tasks_ana = resp_ana.json()["tasks"]
    assert any(t["task_id"] == "filter_ana_1" for t in tasks_ana)
    assert not any(t["task_id"] == "filter_exp_1" for t in tasks_ana)

    # Filter by status=succeeded
    resp_succ = web_client.get("/api/tasks?status=succeeded")
    assert resp_succ.status_code == 200
    tasks_succ = resp_succ.json()["tasks"]
    assert any(t["task_id"] == "filter_ana_1" for t in tasks_succ)
    assert not any(t["task_id"] == "filter_exp_1" for t in tasks_succ)


def test_owner_isolation_in_api(tmp_path: Path, monkeypatch, web_client: TestClient, auth_user, exam_body):
    from solaire.web import public_access

    monkeypatch.setenv("SOLAIRE_PUBLIC_MODE", "1")
    authenticated = [dict(auth_user, id="teacher-1")]
    monkeypatch.setattr(
        public_access, "_authenticated_user", lambda request: authenticated[0]
    )
    monkeypatch.setattr(
        export_tasks.auth_service, "get_user_profile", lambda *args: dict(authenticated[0])
    )

    # Teacher 1 creates an export task
    resp = web_client.post("/api/exam/export-tasks", json=exam_body.model_dump())
    assert resp.status_code == 202
    t1_task_id = resp.json()["id"]

    # Teacher 1 can see it
    assert web_client.get(f"/api/tasks/{t1_task_id}").status_code == 200

    # Switch identity to Teacher 2
    authenticated[0] = dict(auth_user, id="teacher-2")

    # Teacher 2 cannot view Teacher 1's task (404)
    assert web_client.get(f"/api/tasks/{t1_task_id}").status_code == 404

    # Teacher 2 listing tasks does not include Teacher 1's task
    list_t2 = web_client.get("/api/tasks").json()["tasks"]
    assert not any(t["task_id"] == t1_task_id for t in list_t2)

    # Malicious attempt to spoof owner via query parameter is ignored
    spoof_resp = web_client.get(f"/api/tasks?owner=teacher:teacher-1")
    assert not any(t["task_id"] == t1_task_id for t in spoof_resp.json()["tasks"])


def test_controlled_retry_for_export_task(tmp_path: Path, monkeypatch, web_client: TestClient, auth_user, exam_body):
    root = tmp_path.resolve()
    pool = ManualExecutor()
    service = export_tasks.ExportTaskService(root, executor=pool)
    monkeypatch.setattr(export_tasks, "_executor", pool)
    monkeypatch.setattr(
        export_tasks.auth_service, "get_user_profile", lambda *args: dict(auth_user)
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
                "local",
                "pdf",
                json.dumps(exam_body.model_dump(mode="json")),
                None,
                "failed",
                "2026-10-27T00:00:00Z",
                "2026-10-27T00:01:00Z",
                1,
                json.dumps({"status": 503, "detail": "导出进程已中断，可重试此任务。"}),
            ),
        )

    # Sync into projection
    service.get(task_id, user=None)

    # Retry via unified API: POST /api/tasks/{task_id}/retry
    retry_resp = web_client.post(f"/api/tasks/{task_id}/retry")
    assert retry_resp.status_code == 202
    retried_data = retry_resp.json()
    assert retried_data["task_id"] == task_id
    assert retried_data["attempt"] == 2
    assert retried_data["status"] == "queued"
    pool.close()


def test_controlled_retry_rejects_analysis_and_unsupported_tasks(
    tmp_path: Path, monkeypatch, web_client: TestClient
):
    root = tmp_path.resolve()
    scope = get_project_scope_id(root)

    # Project an analysis task
    create_or_update_projection(
        root,
        TaskEvent(
            task_id="ana_job_fail",
            task_type="analysis",
            owner="local",
            project_scope=scope,
            source_id="ana_job_fail",
            status="failed",
            event_version=1,
            is_retryable=False,
        ),
    )

    # Retry must be rejected with 400
    resp = web_client.post("/api/tasks/ana_job_fail/retry")
    assert resp.status_code == 400
    assert "只读计算" in resp.json()["detail"] or "不支持重试" in resp.json()["detail"]

    # Nonexistent task retry returns 404
    resp_404 = web_client.post("/api/tasks/nonexistent_id/retry")
    assert resp_404.status_code == 404


def test_public_mode_auth_rejection(tmp_path: Path, monkeypatch, web_client: TestClient):
    from solaire.web import public_access

    monkeypatch.setenv("SOLAIRE_PUBLIC_MODE", "1")
    # Anonymous request
    monkeypatch.setattr(public_access, "_authenticated_user", lambda request: None)

    # Anonymous reading tasks returns 401
    assert web_client.get("/api/tasks").status_code == 401
    assert web_client.get("/api/tasks/any_id").status_code == 401
    assert web_client.post("/api/tasks/any_id/retry").status_code == 401


def test_old_apis_continue_functioning_identically(
    tmp_path: Path, monkeypatch, web_client: TestClient, auth_user, exam_body
):
    # Existing export tasks endpoints continue to return exact original structures
    resp = web_client.get("/api/exam/export-tasks")
    assert resp.status_code == 200
    assert "tasks" in resp.json()

    # Existing edu_analysis endpoints continue to return exact original structures
    ana_resp = web_client.get("/api/analysis/jobs")
    assert ana_resp.status_code == 200
    assert "jobs" in ana_resp.json()
