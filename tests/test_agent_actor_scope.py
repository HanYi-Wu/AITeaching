from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.session import create_session, list_sessions, load_session
from solaire.agent_layer.tools import exam_tools, graph_tools
from solaire.knowledge_forge import create_graph
from solaire.web.actor_scope import teacher_graph_root
from solaire.web.agent_api import _owned_session, _project_ctx


def _teacher(user_id: str, username: str) -> dict[str, object]:
    return {
        "id": user_id,
        "school_id": "school-1",
        "role": "teacher",
        "username": username,
        "display_name": username,
        "status": "active",
    }


def test_invocation_context_preserves_authenticated_platform_actor(tmp_path: Path) -> None:
    actor = _teacher("teacher-a", "teacher_a")
    ctx = InvocationContext(project_root=tmp_path, session_id="actor", platform_user=actor)

    assert ctx.platform_user == actor
    assert exam_tools._platform_actor(ctx) == actor


def test_agent_graph_tools_use_teacher_scoped_roots(tmp_path: Path) -> None:
    teacher_a = InvocationContext(
        project_root=tmp_path,
        session_id="teacher-a",
        platform_user=_teacher("teacher-a", "teacher_a"),
    )
    teacher_b = InvocationContext(
        project_root=tmp_path,
        session_id="teacher-b",
        platform_user=_teacher("teacher-b", "teacher_b"),
    )

    created = graph_tools.tool_create_graph(
        teacher_a,
        {"display_name": "Teacher A Graph", "slug": "teacher-a-graph"},
    )
    assert created.status == "succeeded"

    a_graphs = graph_tools.tool_list_graphs(teacher_a, {}).data["graphs"]
    b_graphs = graph_tools.tool_list_graphs(teacher_b, {}).data["graphs"]
    assert any(graph["slug"] == "teacher-a-graph" for graph in a_graphs)
    assert all(graph["slug"] != "teacher-a-graph" for graph in b_graphs)


def test_agent_sessions_are_filterable_by_authenticated_owner(tmp_path: Path) -> None:
    session_a = create_session(tmp_path, owner_user_id="teacher-a")
    create_session(tmp_path, owner_user_id="teacher-b")

    visible = list_sessions(tmp_path, owner_user_id="teacher-a")

    assert [item["session_id"] for item in visible] == [session_a.session_id]

    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    request.state.platform_user = _teacher("teacher-b", "teacher_b")
    with pytest.raises(HTTPException) as denied:
        _owned_session(tmp_path, session_a.session_id, request)
    assert denied.value.status_code == 404
    with pytest.raises(ValueError):
        load_session(tmp_path, "../../uploads/forged")


def test_agent_project_context_uses_authenticated_teacher_graph_root(tmp_path: Path) -> None:
    teacher = _teacher("teacher-a", "teacher_a")
    create_graph(tmp_path, "Shared graph", "shared")
    create_graph(teacher_graph_root(tmp_path, teacher), "Private graph", "private")

    context = _project_ctx(tmp_path, teacher)

    assert [item["slug"] for item in context["graph_subjects"]] == ["private"]
