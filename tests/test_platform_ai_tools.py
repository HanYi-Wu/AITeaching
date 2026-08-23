from __future__ import annotations

from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from solaire.agent_layer.models import InvocationContext, SessionState
from solaire.agent_layer.registry import get_registered_tool, invoke_registered_tool, select_tools_for_turn
from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web.app import ensure_project_layout


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _write_ai_tool_exam(root: Path) -> str:
    ensure_project_layout(root)
    library = root / "resource" / "math"
    library.mkdir(parents=True, exist_ok=True)
    (library / "q1.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q1",
                "type": "single_choice",
                "content": "1+1=?",
                "options": {"A": "2", "B": "3"},
                "answer": "A",
                "analysis": "1+1=2",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    exam_id = "midterm/Math"
    exam_dir = root / "exams" / "midterm" / "Math"
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "Midterm", "subject": "Math", "export_label": "midterm"},
        question_libraries=[QuestionLibraryRef(namespace="math", path="../../../resource/math")],
        template_path="templates/test.yaml",
        selected_items=[SelectedSection(section_id="Choice", question_ids=["math/q1"], score_per_item=5.0)],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)
    return exam_id


def _setup_teacher_paper(client: TestClient, root: Path) -> tuple[str, dict[str, object]]:
    admin = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert admin.status_code == 200
    admin_headers = _headers(str(admin.json()["token"]))
    school = client.post("/api/schools", json={"name": "AI Tool School"}, headers=admin_headers)
    assert school.status_code == 200
    school_id = school.json()["school"]["id"]
    account = client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "school_ai_tool", "password": "secret123", "display_name": "School Admin"},
        headers=admin_headers,
    )
    assert account.status_code == 200
    school_login = client.post("/api/auth/login", json={"username": "school_ai_tool", "password": "secret123"})
    assert school_login.status_code == 200
    school_headers = _headers(str(school_login.json()["token"]))
    teacher = client.post(
        "/api/school/teachers",
        json={"username": "teacher_ai_tool", "password": "teacher123", "display_name": "Teacher AI", "subjects": ["Math"]},
        headers=school_headers,
    )
    assert teacher.status_code == 200
    klass = client.post("/api/school/classes", json={"name": "Class 1", "grade": "G10"}, headers=school_headers)
    assert klass.status_code == 200
    assigned = client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher.json()["teacher"]["id"], "class_id": klass.json()["class"]["id"]},
        headers=school_headers,
    )
    assert assigned.status_code == 200
    _write_ai_tool_exam(root)
    teacher_login = client.post("/api/auth/login", json={"username": "teacher_ai_tool", "password": "teacher123"})
    assert teacher_login.status_code == 200
    teacher_headers = _headers(str(teacher_login.json()["token"]))
    listed = client.get("/api/papers", headers=teacher_headers)
    assert listed.status_code == 200
    return listed.json()["papers"][0]["paper_id"], teacher_login.json()["user"]


def test_teacher_ai_tools_include_online_publish_and_grading() -> None:
    publish_tool = get_registered_tool("exam.publish_online_paper")
    grade_tool = get_registered_tool("exam.ai_grade_submission")
    find_tool = get_registered_tool("paper.find_submissions")
    batch_grade_tool = get_registered_tool("paper.ai_grade_pending")
    profile_tool = get_registered_tool("teacher.student_profile")
    upload_guide_tool = get_registered_tool("paper.offline_upload_guide")

    assert publish_tool is not None
    assert grade_tool is not None
    assert find_tool is not None
    assert batch_grade_tool is not None
    assert profile_tool is not None
    assert upload_guide_tool is not None
    assert "submission_mode" in publish_tool.parameters_schema["properties"]
    assert "max_screen_switches" in publish_tool.parameters_schema["properties"]
    assert "time_limit_minutes" in publish_tool.parameters_schema["properties"]
    assert "start_at" in publish_tool.parameters_schema["properties"]
    assert "end_at" in publish_tool.parameters_schema["properties"]
    assert "paper_title" in publish_tool.parameters_schema["properties"]
    assert "exam_id" in publish_tool.parameters_schema["properties"]
    assert "class_names" in publish_tool.parameters_schema["properties"]
    assert "question_ids" in grade_tool.parameters_schema["properties"]
    assert "student_query" in grade_tool.parameters_schema["properties"]
    assert grade_tool.parameters_schema["required"] == ["paper_id"]
    assert find_tool.risk.value == "read"
    assert batch_grade_tool.parameters_schema["properties"]["max_attempts"]["maximum"] == 20


def test_compose_focus_exposes_publish_and_analysis_focus_exposes_ai_grading() -> None:
    compose_names = {
        tool.name
        for tool in select_tools_for_turn(
            skill_id=None,
            include_subtask=False,
            current_focus="compose",
            project_root=None,
        )
    }
    analysis_names = {
        tool.name
        for tool in select_tools_for_turn(
            skill_id=None,
            include_subtask=False,
            current_focus="analysis",
            project_root=None,
        )
    }

    assert "exam.publish_online_paper" in compose_names
    assert "exam.ai_grade_submission" in analysis_names


def test_teacher_ai_publish_tool_resolves_paper_title_and_class_name(web_client: TestClient, tmp_path: Path) -> None:
    paper_id, teacher_user = _setup_teacher_paper(web_client, tmp_path)
    ctx = InvocationContext(
        project_root=tmp_path,
        session_id="ai-tool-publish",
        session=SessionState(session_id="ai-tool-publish", current_focus="compose"),
        platform_user=teacher_user,
    )

    result = invoke_registered_tool(
        "exam.publish_online_paper",
        {"paper_title": "Midterm", "class_names": ["Class 1"], "title": "Midterm Online"},
        ctx,
    )

    assert result.status == "succeeded", result.error_message
    assert result.data["publication"]["paper_id"] == paper_id
    assert len(result.data["publication"]["class_ids"]) == 1
    assert result.data["publication"]["title"] == "Midterm Online"
