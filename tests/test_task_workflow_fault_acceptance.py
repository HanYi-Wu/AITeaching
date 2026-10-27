"""Source-controlled workflow interruptions, confirmations, and authorization changes."""
import asyncio
import json
from dataclasses import replace
from unittest.mock import MagicMock

import pytest
from solaire.agent_layer.models import InvocationContext, PendingConfirmation, SessionState
from solaire.agent_layer.session import load_session, save_session
from solaire.agent_layer import orchestrator, registry
from solaire.web.task_tracking import TaskEvent, create_or_update_projection, get_task_projection, get_project_scope_id
from solaire.web.task_tracking.reconciliation import reconcile_task


def event(root, **changes):
    return TaskEvent(task_id="workflow", task_type="agent", owner="local",
                     project_scope=get_project_scope_id(root), source_id="session:s", **changes)


def test_success_cannot_be_replaced_by_late_cancel_or_running(tmp_path):
    create_or_update_projection(tmp_path, event(tmp_path, status="succeeded", event_version=3))
    for version, status in ((4, "cancelled"), (5, "running")):
        result = create_or_update_projection(tmp_path, event(tmp_path, status=status, event_version=version))
        assert result.status == "succeeded" and result.event_version == 3


def test_retry_clears_previous_error_and_result(tmp_path):
    create_or_update_projection(tmp_path, event(tmp_path, status="failed", event_version=3,
        error_summary={"code": "interrupted"}, result_summary={"output": "old"}))
    result = create_or_update_projection(tmp_path, event(tmp_path, status="queued", attempt=2))
    assert result.error_summary is None and result.result_summary is None
    assert result.attempt == 2


def test_process_loss_requires_verification_without_replay(tmp_path):
    for kind in ("agent", "ai_pregrade"):
        task = event(tmp_path, status="running").model_copy(update={"task_type": kind, "task_id": kind})
        record = create_or_update_projection(tmp_path, task)
        recovered = reconcile_task(tmp_path, record, None)
        assert recovered.status == "failed"
        assert recovered.error_summary["code"] == "interrupted_requires_verification"
        assert not recovered.is_retryable


def test_unified_query_reconciles_export_process_loss(web_client, tmp_path):
    from tests.test_pr4_task_tracking_d12_export import ManualExecutor, _minimal_exam_body
    from solaire.web.export_tasks import ExportTaskService
    pool = ManualExecutor()
    service = ExportTaskService(tmp_path, executor=pool)
    task = service.submit(_minimal_exam_body(), format="docx", user=None)
    assert web_client.get(f"/api/tasks/{task['id']}").json()["status"] == "queued"
    pool.close()  # represents release of the source lease after process loss
    response = web_client.get(f"/api/tasks/{task['id']}")
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["is_retryable"] is True
    assert len(pool.pending) == 1  # querying has not executed or enqueued another export


def pending_session(root):
    session = SessionState(session_id="confirmation-workflow")
    args = {"path": "resource/accepted.txt", "content": "approved"}
    session.pending_confirmations["approve-once"] = PendingConfirmation(
        tool_call_id="write-one", tool_name="file.write", arguments=args, description="Write file")
    session.draft_assistant = {"tool_calls": [{"id": "write-one", "function": {
        "name": "file.write", "arguments": json.dumps(args)}}]}
    save_session(root, session)
    return session


def test_repeated_confirmation_executes_real_write_once(tmp_path, monkeypatch):
    session = pending_session(tmp_path)
    stale_copy = session.model_copy(deep=True)
    rt = registry.get_registered_tool("file.write")
    calls = []

    def write(ctx, args):
        calls.append(args)
        return rt.handler(ctx, args)

    monkeypatch.setitem(registry._TOOL_BY_NAME, "file.write", replace(rt, handler=write))

    async def model(*args, **kwargs):
        return "finished", [], {}, "", "stop"

    monkeypatch.setattr(orchestrator, "_llm_round_call", model)

    async def run():
        router = MagicMock()
        for current in (session, stale_copy):
            chunks = [chunk async for chunk in orchestrator.iter_agent_turn_sse(
                tmp_path, current, user_message=None, project_ctx={}, router=router,
                confirm_action_id="approve-once", confirm_accepted=True)]
            assert "event: done" in "".join(chunks)

    asyncio.run(run())
    assert len(calls) == 1
    assert (tmp_path / "resource/accepted.txt").read_text(encoding="utf-8") == "approved"
    assert not load_session(tmp_path, session.session_id).pending_confirmations


def test_unknown_write_outcome_persists_nonreplayable_cursor(tmp_path, monkeypatch):
    from solaire.agent_layer.task_tracker import handle_confirmation_resume
    session = pending_session(tmp_path)
    rt = registry.get_registered_tool("file.write")

    class ProcessInterrupted(BaseException):
        pass

    def interrupted(ctx, args):
        rt.handler(ctx, args)
        raise ProcessInterrupted()

    monkeypatch.setitem(registry._TOOL_BY_NAME, "file.write", replace(rt, handler=interrupted))

    async def emit(*args):
        pass

    with pytest.raises(ProcessInterrupted):
        asyncio.run(handle_confirmation_resume(project_root=tmp_path, session=session,
            ctx=InvocationContext(project_root=tmp_path, session_id=session.session_id, session=session),
            confirm_action_id="approve-once", confirm_accepted=True, emit=emit))
    persisted = load_session(tmp_path, session.session_id)
    assert not persisted.pending_confirmations
    assert not persisted.approved_write_keys
    assert len(persisted.draft_tool_results) == 1
    assert "needs_verification" in persisted.draft_tool_results[0]["content"]
    assert (tmp_path / "resource/accepted.txt").exists()


def test_agent_reads_live_platform_database_separate_from_project(tmp_path, monkeypatch):
    from tests.test_agent_pr4_orchestration_failure import _setup_db_user
    from solaire.web.platform_db import connect
    platform = tmp_path / "accounts"
    project = tmp_path / "content"
    user = _setup_db_user(platform)
    with connect(platform) as con:
        con.execute("UPDATE users SET status='disabled' WHERE id=?", (user["id"],))
    ctx = InvocationContext(project_root=project, platform_root=platform,
                            session_id="blocked", platform_user=user)
    result = registry.invoke_registered_tool("file.write", {"path": "x.txt", "content": "bad"}, ctx)
    assert result.status == "failed" and result.error_code == "permission_denied"
    assert not (project / "x.txt").exists()


def test_domain_catalog_rejects_duplicate_before_dict_indexing():
    from solaire.agent_layer.tools.schema_builder import compose_tool_catalog
    tool = registry.get_registered_tool("file.read")
    with pytest.raises(ValueError, match="Duplicate"):
        compose_tool_catalog([[tool], [tool]], [tool.name])
    with pytest.raises(ValueError, match="selection order"):
        compose_tool_catalog([[tool]], [tool.name, "missing"])
