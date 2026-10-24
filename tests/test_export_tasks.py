"""Export jobs retain ownership and retry safely without executing duplicates."""

import pytest
from fastapi import HTTPException

from solaire.web import export_tasks
from solaire.web.schemas.exams import ExamExportBody


class ManualExecutor:
    def __init__(self):
        self.pending = []

    def submit(self, fn, *args):
        self.pending.append((fn, args))

    def run(self):
        fn, args = self.pending.pop(0)
        fn(*args)

    def close(self):
        for _, args in self.pending:
            args[-1].close()


@pytest.fixture
def task_case(tmp_path, monkeypatch):
    pool = ManualExecutor()
    user = {"id": "teacher-a", "role": "teacher", "status": "active"}
    monkeypatch.setattr(export_tasks.auth_service, "get_user_profile", lambda *args: dict(user))
    calls = []

    def compile(root, body, *, format):
        calls.append((root, body.export_label, format, export_tasks.actor.get()))
        return {"ok": True, "exam_dir": "exams/Quiz/Math", f"student_{format}": "student." + format, f"teacher_{format}": "teacher." + format}

    monkeypatch.setattr(export_tasks.export_workflow, "export_exam", compile)
    body = ExamExportBody(template_ref="test", template_path="templates/test.yaml", selected_items=[], export_label="Quiz", subject="Math")
    service = export_tasks.ExportTaskService(tmp_path, executor=pool)
    yield service, pool, user, body, calls
    pool.close()


def test_jobs_are_durable_and_execute_in_the_request_actor_scope(task_case):
    service, pool, user, body, calls = task_case
    job = service.submit(body, format="docx", user=user)
    another = export_tasks.ExportTaskService(service.root, executor=pool)
    assert another.get(job["id"], user=user)["status"] == "queued"
    pool.run()
    completed = another.get(job["id"], user=user)
    assert completed["status"] == "succeeded"
    assert completed["result"]["student_docx"] == "student.docx"
    assert calls[0][3] == user
    assert export_tasks.actor.get() is None
    assert "request_json" not in completed and "owner" not in completed


def test_request_key_deduplicates_and_rejects_changed_payload(task_case):
    service, pool, user, body, calls = task_case
    first = service.submit(body, format="pdf", user=user, request_key="one")
    second = service.submit(body, format="pdf", user=user, request_key="one")
    assert second["id"] == first["id"] and len(pool.pending) == 1
    with pytest.raises(HTTPException) as caught:
        service.submit(body.model_copy(update={"export_label": "Different"}), format="pdf", user=user, request_key="one")
    assert caught.value.status_code == 409


def test_other_teachers_cannot_list_read_or_retry_a_job(task_case):
    service, pool, user, body, calls = task_case
    job = service.submit(body, format="pdf", user=user)
    other = dict(user, id="teacher-b")
    assert service.list(user=other) == []
    for method in (service.get, service.retry):
        with pytest.raises(HTTPException) as caught:
            method(job["id"], user=other)
        assert caught.value.status_code == 404
    with pytest.raises(HTTPException) as caught:
        service.list(user=dict(user, role="student"))
    assert caught.value.status_code == 403


def test_failed_job_retries_once_and_completed_retry_is_idempotent(task_case, monkeypatch):
    service, pool, user, body, calls = task_case
    original = export_tasks.export_workflow.export_exam

    def fail(*args, **kwargs):
        raise HTTPException(status_code=400, detail={"message": "Fix template", "exam_saved": {"exam_id": "Recovery/Math"}})

    monkeypatch.setattr(export_tasks.export_workflow, "export_exam", fail)
    job = service.submit(body, format="pdf", user=user)
    pool.run()
    failed = service.get(job["id"], user=user)
    assert failed["status"] == "failed" and failed["error"]["status"] == 400
    monkeypatch.setattr(export_tasks.export_workflow, "export_exam", original)
    assert service.retry(job["id"], user=user)["attempt"] == 2
    service.retry(job["id"], user=user)
    assert len(pool.pending) == 1
    pool.run()
    assert service.retry(job["id"], user=user)["status"] == "succeeded"
    assert len(calls) == 1 and pool.pending == []


def test_worker_rechecks_account_status_before_compiling(task_case, monkeypatch):
    service, pool, user, body, calls = task_case
    job = service.submit(body, format="pdf", user=user)
    monkeypatch.setattr(export_tasks.auth_service, "get_user_profile", lambda *args: dict(user, status="disabled"))
    pool.run()
    assert service.get(job["id"], user=user)["error"]["status"] == 403
    assert calls == []


def test_process_loss_becomes_a_retryable_failure(task_case):
    service, pool, user, body, calls = task_case
    job = service.submit(body, format="pdf", user=user)
    # A dead process releases its OS lease even if its last state was queued.
    pool.close()
    pool.pending.clear()
    recovered = service.get(job["id"], user=user)
    assert recovered["status"] == "failed" and recovered["error"]["status"] == 503
    service.retry(job["id"], user=user)
    pool.run()
    assert service.get(job["id"], user=user)["status"] == "succeeded"


def test_queue_is_bounded_per_owner(task_case):
    service, pool, user, body, calls = task_case
    for _ in range(4):
        service.submit(body, format="pdf", user=user)
    with pytest.raises(HTTPException) as caught:
        service.submit(body, format="pdf", user=user)
    assert caught.value.status_code == 429


def test_invalid_stored_retry_does_not_leave_a_queued_job_or_locked_lease(task_case):
    service, pool, user, body, calls = task_case
    job = service.submit(body, format="pdf", user=user)
    pool.close()
    pool.pending.clear()
    assert service.get(job["id"], user=user)["status"] == "failed"
    with service._connect() as db:
        db.execute("UPDATE export_tasks SET request_json='invalid' WHERE id=?", (job["id"],))
    with pytest.raises(HTTPException) as caught:
        service.retry(job["id"], user=user)
    assert caught.value.status_code == 409
    assert service.get(job["id"], user=user)["status"] == "failed"
    with service._lease(job["id"]):
        pass


def test_task_api_keeps_payload_private_and_validates_formats(task_case, monkeypatch, web_client):
    service, pool, user, body, calls = task_case
    monkeypatch.setattr(export_tasks, "_executor", pool)
    request = dict(body.model_dump(), format="docx", request_key="http-one")
    response = web_client.post("/api/exam/export-tasks", json=request)
    assert response.status_code == 202, response.text
    job = response.json()
    assert job["status"] == "queued" and "request_json" not in job
    pool.run()
    result = web_client.get(f"/api/exam/export-tasks/{job['id']}")
    assert result.json()["status"] == "succeeded"
    assert web_client.get("/api/exam/export-tasks").json()["tasks"][0]["id"] == job["id"]
    assert web_client.post("/api/exam/export-tasks", json=dict(request, format="exe")).status_code == 422


def test_public_api_requires_login_and_preserves_teacher_isolation(task_case, monkeypatch, web_client):
    from solaire.web import public_access

    service, pool, user, body, calls = task_case
    monkeypatch.setenv("SOLAIRE_PUBLIC_MODE", "1")
    monkeypatch.setattr(export_tasks, "_executor", pool)
    authenticated = [None]
    monkeypatch.setattr(public_access, "_authenticated_user", lambda request: authenticated[0])
    assert web_client.get("/api/exam/export-tasks").status_code == 401
    authenticated[0] = user
    response = web_client.post("/api/exam/export-tasks", json=body.model_dump())
    assert response.status_code == 202, response.text
    task_id = response.json()["id"]
    authenticated[0] = dict(user, id="teacher-b")
    assert web_client.get(f"/api/exam/export-tasks/{task_id}").status_code == 404
    assert web_client.post(f"/api/exam/export-tasks/{task_id}/retry").status_code == 404
    for role in ("student", "school"):
        authenticated[0] = dict(user, role=role)
        assert web_client.get("/api/exam/export-tasks").status_code == 403
        assert web_client.post(f"/api/exam/export-tasks/{task_id}/retry").status_code == 403
