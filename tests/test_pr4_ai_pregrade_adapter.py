"""Tests for Task D15: Asynchronous AI Pre-grade execution adapter, safety policies, and version conflict handling."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from solaire.agent_layer.llm import router as llm_router
from solaire.web.ai_pregrade_tasks import (
    AiPregradeTaskService,
)
from solaire.web.papers.grading_versions import advance_answer_revision
from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_paper_api import (
    _bootstrap_admin,
    _create_school_teacher_class,
    _headers,
    _teacher_token,
    _write_exam,
)


def _setup_attempt_fixture(client: TestClient, project_root: Path) -> dict[str, Any]:
    admin_token = _bootstrap_admin(client)
    school_id, teacher_id, class_id = _create_school_teacher_class(client, admin_token)

    # Enable AI for school in SQLite
    with connect(default_platform_root()) as con:
        con.execute("UPDATE schools SET ai_enabled = 1, status = 'active' WHERE id = ?", (school_id,))

    school_login = client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    imported = client.post(
        "/api/school/students/import",
        headers=school_headers,
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
    )
    assert imported.status_code == 200
    student = imported.json()["students"][0]

    exam_id = _write_exam(project_root)
    teacher_token = _teacher_token(client)
    teacher_headers = _headers(teacher_token)
    paper = client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    paper_id = paper["paper_id"]

    published = client.post(
        f"/api/papers/{paper_id}/publish",
        headers=teacher_headers,
        json={"class_ids": [class_id]},
    )
    assert published.status_code == 200
    pub_id = str(published.json()["publication"]["id"])

    student_login = client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    student_headers = _headers(str(student_login.json()["token"]))
    started = client.post(f"/api/student/publications/{pub_id}/start", headers=student_headers)
    assert started.status_code == 200
    attempt_id = str(started.json()["attempt"]["id"])

    # Save student answer for math/q1 so student_answers row exists with pending status
    saved = client.post(
        f"/api/student/attempts/{attempt_id}/answers",
        headers=student_headers,
        json={"answers": [{"question_id": "math/q1", "answer": "2"}]},
    )
    assert saved.status_code == 200

    submitted = client.post(
        f"/api/student/attempts/{attempt_id}/submit",
        headers=student_headers,
        json={"time_spent_seconds": 12},
    )
    assert submitted.status_code == 200

    # Ensure answer is pending subjective grading
    with connect(default_platform_root()) as con:
        con.execute(
            "UPDATE student_answers SET grading_status = 'pending', score = NULL, is_correct = NULL WHERE attempt_id = ?",
            (attempt_id,),
        )
        con.execute("UPDATE student_attempts SET score = NULL, grading_completed_at = NULL WHERE id = ?", (attempt_id,))

    with connect(default_platform_root()) as con:
        teacher_row = con.execute("SELECT * FROM users WHERE id = ?", (teacher_id,)).fetchone()
        teacher_user = dict(teacher_row)

    return {
        "admin_token": admin_token,
        "teacher_token": teacher_token,
        "teacher_id": teacher_id,
        "teacher_user": teacher_user,
        "school_id": school_id,
        "class_id": class_id,
        "paper_id": paper_id,
        "attempt_id": attempt_id,
        "exam_id": exam_id,
    }


def _mock_llm(monkeypatch: pytest.MonkeyPatch, suggested_score: float = 4.0) -> None:
    async def fake_ai_grade_answer(project_root, *, question, answer_text, ocr_text, max_score, **kwargs):
        return {
            "suggested_score": suggested_score,
            "feedback": "Good answer",
            "status": "needs_review",
        }

    monkeypatch.setattr("solaire.web.papers.ai_grading.ai_grade_answer", fake_ai_grade_answer)
    monkeypatch.setattr(llm_router, "load_llm_settings", lambda _root: SimpleNamespace(api_key="mock_key"))
    monkeypatch.setattr("solaire.web.ai_pregrade_tasks.load_llm_settings", lambda _root: SimpleNamespace(api_key="mock_key"))


def test_d15_async_ai_pregrade_successful_run(web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate full lifecycle of async AI pregrade task."""
    _mock_llm(monkeypatch, suggested_score=4.0)

    ctx = _setup_attempt_fixture(web_client, tmp_path)
    root = default_platform_root()
    project_root = tmp_path

    sync_pool = ThreadPoolExecutor(max_workers=1)
    service = AiPregradeTaskService(root, project_root, executor=sync_pool)

    task = service.submit(
        paper_id=ctx["paper_id"],
        user=ctx["teacher_user"],
        attempt_id=ctx["attempt_id"],
    )
    assert task["status"] == "queued"
    task_id = task["task_id"]

    # Wait for execution
    sync_pool.shutdown(wait=True)

    completed_task = service.get(task_id, user=ctx["teacher_user"])
    assert completed_task["status"] == "succeeded"
    assert completed_task["progress"] == 1.0
    assert completed_task["result_summary"]["suggestion_count"] >= 1

    # Check database: suggestions are present, but final score is NOT set!
    with connect(root) as con:
        rows = con.execute(
            "SELECT * FROM student_answers WHERE attempt_id = ?",
            (ctx["attempt_id"],),
        ).fetchall()
        assert len(rows) > 0
        for r in rows:
            assert r["grading_status"] == "needs_review"
            assert r["ai_suggested_score"] == 4.0
            assert r["ai_feedback"] == "Good answer"
            # CRITICAL: Teacher final score, graded_by, and graded_at MUST NOT be set!
            assert r["score"] is None
            assert r["graded_by"] is None
            assert r["graded_at"] is None

        att_row = con.execute(
            "SELECT * FROM student_attempts WHERE id = ?",
            (ctx["attempt_id"],),
        ).fetchone()
        assert att_row["score"] is None
        assert att_row["grading_completed_at"] is None


def test_d15_account_disabled_check(web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate that inactive/disabled accounts cannot run or continue AI pregrade jobs."""
    _mock_llm(monkeypatch)

    ctx = _setup_attempt_fixture(web_client, tmp_path)
    root = default_platform_root()
    project_root = tmp_path

    # Disable the teacher's account in SQLite
    with connect(root) as con:
        con.execute("UPDATE users SET status = 'disabled' WHERE id = ?", (ctx["teacher_id"],))

    service = AiPregradeTaskService(root, project_root)
    with pytest.raises(Exception) as excinfo:
        service.submit(
            paper_id=ctx["paper_id"],
            user=ctx["teacher_user"],
            attempt_id=ctx["attempt_id"],
        )
    assert "已被禁用" in str(excinfo.value) or "403" in str(excinfo.value) or "401" in str(excinfo.value)


def test_d15_school_ai_policy_enforcement(web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate that when school AI is disabled, execution is authoritatively rejected."""
    _mock_llm(monkeypatch)

    ctx = _setup_attempt_fixture(web_client, tmp_path)
    root = default_platform_root()
    project_root = tmp_path

    # Turn off AI for the school
    with connect(root) as con:
        con.execute("UPDATE schools SET ai_enabled = 0 WHERE id = ?", (ctx["school_id"],))

    service = AiPregradeTaskService(root, project_root)
    with pytest.raises(ValueError) as excinfo:
        service.submit(
            paper_id=ctx["paper_id"],
            user=ctx["teacher_user"],
            attempt_id=ctx["attempt_id"],
        )
    assert "School AI is disabled" in str(excinfo.value)


def test_d15_late_suggestion_rejected_on_manual_grade(web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate that if a teacher manually confirms/grades an answer, late AI suggestions are rejected."""
    _mock_llm(monkeypatch, suggested_score=3.0)

    ctx = _setup_attempt_fixture(web_client, tmp_path)
    root = default_platform_root()
    project_root = tmp_path

    # Simulate teacher manually grading the first answer BEFORE worker write-back
    with connect(root) as con:
        row = con.execute(
            "SELECT id, question_id FROM student_answers WHERE attempt_id = ?",
            (ctx["attempt_id"],),
        ).fetchone()
        con.execute(
            """
            UPDATE student_answers
            SET grading_status = 'graded',
                score = 5.0,
                graded_by = ?,
                graded_at = '2026-10-27T00:00:00Z',
                feedback = 'Teacher manual grade'
            WHERE id = ?
            """,
            (ctx["teacher_id"], row["id"]),
        )

    sync_pool = ThreadPoolExecutor(max_workers=1)
    service = AiPregradeTaskService(root, project_root, executor=sync_pool)
    task = service.submit(
        paper_id=ctx["paper_id"],
        user=ctx["teacher_user"],
        attempt_id=ctx["attempt_id"],
    )
    sync_pool.shutdown(wait=True)

    # Verify: teacher manual grade was NOT overwritten!
    with connect(root) as con:
        ans = con.execute("SELECT * FROM student_answers WHERE id = ?", (row["id"],)).fetchone()
        assert ans["grading_status"] == "graded"
        assert ans["score"] == 5.0
        assert ans["feedback"] == "Teacher manual grade"
        assert ans["ai_suggested_score"] is None


def test_d15_late_suggestion_rejected_on_version_bump(web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate that if paper_answer_grading_versions is bumped during processing, late AI suggestion is rejected."""
    _mock_llm(monkeypatch, suggested_score=2.0)

    ctx = _setup_attempt_fixture(web_client, tmp_path)
    root = default_platform_root()
    project_root = tmp_path

    with connect(root) as con:
        row = con.execute(
            "SELECT id, question_id FROM student_answers WHERE attempt_id = ?",
            (ctx["attempt_id"],),
        ).fetchone()
        qid = str(row["question_id"])

    sync_pool = ThreadPoolExecutor(max_workers=1)
    service = AiPregradeTaskService(root, project_root, executor=sync_pool)

    # Advance revision concurrently during AI model generation
    async def concurrent_bump_ai_grade_answer(*args, **kwargs):
        with connect(root) as con:
            advance_answer_revision(con, ctx["attempt_id"], qid)
        return {"suggested_score": 2.0, "feedback": "Good answer", "status": "needs_review"}

    monkeypatch.setattr("solaire.web.papers.ai_grading.ai_grade_answer", concurrent_bump_ai_grade_answer)

    task = service.submit(
        paper_id=ctx["paper_id"],
        user=ctx["teacher_user"],
        attempt_id=ctx["attempt_id"],
    )
    sync_pool.shutdown(wait=True)

    with connect(root) as con:
        ans = con.execute("SELECT * FROM student_answers WHERE id = ?", (row["id"],)).fetchone()
        assert ans["grading_status"] == "pending"
        assert ans["ai_suggested_score"] is None
        assert ans["score"] is None


def test_d15_ai_pregrade_router_endpoints(web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate HTTP router endpoints for task submission and polling."""
    from solaire.web.routers.ai_pregrade_tasks import router as pregrade_router
    from solaire.web.app import app

    _mock_llm(monkeypatch, suggested_score=4.5)
    ctx = _setup_attempt_fixture(web_client, tmp_path)

    # Mount pregrade router if not already included
    if not any(getattr(r, "path", None) == "/api/papers/{paper_id}/ai-grade-tasks" for r in app.routes):
        app.include_router(pregrade_router)

    teacher_headers = _headers(ctx["teacher_token"])

    # 1. Submit paper-level async task
    resp = web_client.post(
        f"/api/papers/{ctx['paper_id']}/ai-grade-tasks",
        headers=teacher_headers,
        json={"max_attempts": 2, "max_questions_total": 10},
    )
    assert resp.status_code == 202
    data = resp.json()
    assert "task_id" in data
    assert data["status"] in {"queued", "running", "succeeded"}
    task_id = data["task_id"]

    # 2. Query task status
    get_resp = web_client.get(
        f"/api/papers/{ctx['paper_id']}/ai-grade-tasks/{task_id}",
        headers=teacher_headers,
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["task_id"] == task_id

    # 3. Submit attempt-level async task
    att_resp = web_client.post(
        f"/api/papers/{ctx['paper_id']}/attempts/{ctx['attempt_id']}/ai-grade-task",
        headers=teacher_headers,
    )
    assert att_resp.status_code == 202
    assert "task_id" in att_resp.json()


def test_d15_projection_recorded_in_task_tracking(web_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate that AI pregrade status is durably recorded in unified TaskProjection."""
    from solaire.web.task_tracking.contract import get_task_projection

    _mock_llm(monkeypatch, suggested_score=4.0)
    ctx = _setup_attempt_fixture(web_client, tmp_path)
    root = default_platform_root()
    project_root = tmp_path

    sync_pool = ThreadPoolExecutor(max_workers=1)
    service = AiPregradeTaskService(root, project_root, executor=sync_pool)
    task = service.submit(paper_id=ctx["paper_id"], user=ctx["teacher_user"], attempt_id=ctx["attempt_id"])
    sync_pool.shutdown(wait=True)

    # Query unified task projection through the public contract.
    proj = get_task_projection(project_root, task["task_id"], owner=f"teacher:{ctx['teacher_id']}")
    assert proj is not None
    assert proj.status == "succeeded"
    assert proj.task_type == "ai_pregrade"
    assert proj.progress == 1.0
