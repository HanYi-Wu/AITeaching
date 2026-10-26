"""Regression tests for Task D05: Plan parsing, confirmation resume, and authoritative policy verification."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock

from solaire.agent_layer.models import (
    ChatMessage,
    InvocationContext,
    PendingConfirmation,
    SessionState,
)
from solaire.agent_layer.orchestrator import run_agent_turn
from solaire.agent_layer.task_tracker import (
    build_task_plan_dynamic_block,
    handle_confirmation_resume,
    plan_to_prompt_block,
    resolve_plan_and_execution_path,
    set_plan,
    update_step,
    verify_authoritative_actor_and_policy,
)
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.organization import create_school
from solaire.web.school.policy import update_school_ai_enabled


def _setup_db_user(
    root: Path,
    *,
    user_id: str = "teacher-d05",
    school_id: str = "school-d05",
    status: str = "active",
    ai_enabled: bool = True,
) -> dict[str, object]:
    init_platform_db(root)
    with connect(root) as con:
        con.execute(
            """
            INSERT OR REPLACE INTO schools (id, name, status, ai_enabled, created_at, updated_at)
            VALUES (?, 'D05 Test School', 'active', ?, datetime('now'), datetime('now'))
            """,
            (school_id, 1 if ai_enabled else 0),
        )
        con.execute(
            """
            INSERT OR REPLACE INTO users (
                id, school_id, role, username, password_hash, display_name, status, created_at, updated_at
            )
            VALUES (?, ?, 'teacher', ?, 'hash123', 'Teacher D05', ?, datetime('now'), datetime('now'))
            """,
            (user_id, school_id, f"user_{user_id}", status),
        )
    return {
        "id": user_id,
        "school_id": school_id,
        "role": "teacher",
        "username": f"user_{user_id}",
        "display_name": "Teacher D05",
        "status": status,
    }


def test_task_tracker_step_lifecycle_and_backward_compatibility() -> None:
    session = SessionState(session_id="s-plan")
    steps = [
        {"title": "读取题库", "status": "pending"},
        {"title": "生成变式", "status": "pending"},
    ]
    set_plan(session, steps)
    assert len(session.task_plan) == 2
    assert session.task_plan[0]["status"] == "pending"

    update_step(session, 0, "in_progress")
    assert session.task_plan[0]["status"] == "in_progress"

    prompt_blk = plan_to_prompt_block(session)
    assert "1. [in_progress] 读取题库" in prompt_blk
    assert "2. [pending] 生成变式" in prompt_blk

    dyn_blk = build_task_plan_dynamic_block(session)
    assert "## 当前任务进度" in dyn_blk
    assert "1. [in_progress] 读取题库" in dyn_blk


def test_plan_resolution_flow(tmp_path: Path) -> None:
    async def run():
        session = SessionState(session_id="s-res")
        plan_rel = ".solaire/agent/plans/exam_plan.md"
        plan_file = tmp_path / plan_rel
        plan_file.parent.mkdir(parents=True, exist_ok=True)
        plan_file.write_text(
            "---\nname: 期末测验\noverview: 计划概述\ntodos:\n  - id: t1\n    content: 准备试题\n    status: pending\n---\n\n## 详情\n",
            encoding="utf-8",
        )

        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        # 1. Unapproved plan rejected
        abort = await resolve_plan_and_execution_path(
            tmp_path,
            session,
            {"_execution_plan_path": plan_rel},
            emit,
        )
        assert abort is True
        assert any(e[0] == "error" and e[1].get("code") == "plan_not_approved" for e in events)

        # 2. Approved plan proceeds and sets task_plan
        events.clear()
        session.pending_plan_path = plan_rel
        abort2 = await resolve_plan_and_execution_path(
            tmp_path,
            session,
            {"_execution_plan_path": plan_rel},
            emit,
        )
        assert abort2 is False
        assert session.execution_plan_path == plan_rel
        assert len(session.task_plan) == 1
        assert "准备试题" in session.task_plan[0]["title"]
        assert any(e[0] == "task_update" for e in events)

    asyncio.run(run())


def test_confirmation_resume_rejection(tmp_path: Path) -> None:
    async def run():
        session = SessionState(session_id="s-rej")
        session.pending_confirmations["act-cancel"] = PendingConfirmation(
            tool_call_id="c1",
            tool_name="file.write",
            arguments={"path": "test.txt", "content": "data"},
            description="写入文件",
        )
        session.draft_assistant = {"content": "draft"}
        session.draft_tool_results = [{"result": 1}]

        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        ctx = InvocationContext(project_root=tmp_path, session_id="s-rej", session=session)
        res = await handle_confirmation_resume(
            project_root=tmp_path,
            session=session,
            ctx=ctx,
            confirm_action_id="act-cancel",
            confirm_accepted=False,
            emit=emit,
        )
        assert res is None
        assert session.draft_assistant is None
        assert session.draft_tool_results == []
        assert any(e[0] == "text_delta" and "已取消" in e[1]["text"] for e in events)
        assert any(e[0] == "done" for e in events)

    asyncio.run(run())


def test_sqlite_policy_verification_on_user_and_school_ai_change(tmp_path: Path, monkeypatch) -> None:
    """真实SQLite策略状态验证: 已建会话/已显示确认 -> 权限变化 -> 点击继续 的路径。"""
    async def run():
        # Setup admin LLM key in environment for school policy check
        monkeypatch.setenv("SOLAIRE_LLM_API_KEY", "sk-test-admin-key")

        actor = _setup_db_user(tmp_path, user_id="teacher-1", school_id="school-1", status="active", ai_enabled=True)
        session = SessionState(session_id="s-confirm-auth", owner_user_id="teacher-1")
        session.pending_confirmations["act-ai"] = PendingConfirmation(
            tool_call_id="c-ai",
            tool_name="agent.run_subtask",
            arguments={"objective": "subtask objective"},
            description="执行 AI 子任务",
        )
        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        ctx = InvocationContext(
            project_root=tmp_path,
            session_id=session.session_id,
            session=session,
            platform_user=actor,
        )

        # 1. 账号被禁用场景: UPDATE users SET status = 'disabled'
        with connect(tmp_path) as con:
            con.execute("UPDATE users SET status = 'disabled' WHERE id = 'teacher-1'")

        res_disabled = await handle_confirmation_resume(
            project_root=tmp_path,
            session=session,
            ctx=ctx,
            confirm_action_id="act-ai",
            confirm_accepted=True,
            emit=emit,
        )
        assert res_disabled is None
        assert any(e[0] == "error" and e[1].get("code") == "user_inactive" for e in events)
        assert any(e[0] == "done" for e in events)

        # 2. 账号恢复 active，但学校 AI 刚被关闭: UPDATE schools SET ai_enabled = 0
        events.clear()
        with connect(tmp_path) as con:
            con.execute("UPDATE users SET status = 'active' WHERE id = 'teacher-1'")
        update_school_ai_enabled(tmp_path, school_id="school-1", ai_enabled=False)

        session.pending_confirmations["act-ai-2"] = PendingConfirmation(
            tool_call_id="c-ai-2",
            tool_name="agent.run_subtask",
            arguments={"objective": "subtask objective"},
            description="执行 AI 子任务 2",
        )

        res_school_off = await handle_confirmation_resume(
            project_root=tmp_path,
            session=session,
            ctx=ctx,
            confirm_action_id="act-ai-2",
            confirm_accepted=True,
            emit=emit,
        )
        assert res_school_off is None
        assert any(e[0] == "error" and e[1].get("code") == "school_ai_disabled" for e in events)
        assert any(e[0] == "done" for e in events)

    asyncio.run(run())


def test_run_agent_turn_blocks_when_school_ai_disabled_during_turn(tmp_path: Path, monkeypatch) -> None:
    """验证当会话建立后，若进入模型轮次前学校 AI 被关闭，立即中断并不调用模型。"""
    async def run():
        monkeypatch.setenv("SOLAIRE_LLM_API_KEY", "sk-test-admin-key")
        actor = _setup_db_user(tmp_path, user_id="teacher-turn", school_id="school-turn", status="active", ai_enabled=False)

        session = SessionState(session_id="s-turn", owner_user_id="teacher-turn")
        events: list[tuple[str, dict]] = []

        async def emit(ev: str, data: dict) -> None:
            events.append((ev, data))

        llm_called = False

        from solaire.agent_layer import orchestrator as orch_mod

        async def fake_llm(*args, **kw):
            nonlocal llm_called
            llm_called = True
            return ("", [], {}, "", "stop")

        monkeypatch.setattr(orch_mod, "_llm_round_call", fake_llm)

        router = MagicMock()
        router.main.return_value = MagicMock()
        router.fast.return_value = MagicMock()

        await run_agent_turn(
            tmp_path,
            session,
            user_message="测试",
            project_ctx={"_platform_user": actor},
            router=router,
            emit=emit,
        )

        assert llm_called is False
        assert any(e[0] == "error" and e[1].get("code") == "school_ai_disabled" for e in events)
        assert any(e[0] == "done" for e in events)

    asyncio.run(run())
