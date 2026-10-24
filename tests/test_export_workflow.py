"""Both formats share authorization, failure recovery and completion rules."""

import pytest
from fastapi import HTTPException

from solaire.web import export_workflow as workflow
from solaire.web.schemas.exams import ExamExportBody


@pytest.fixture
def export_case(tmp_path, monkeypatch):
    template = tmp_path / "templates/test.yaml"
    template.parent.mkdir()
    template.write_text("template_id: test\nsections: []\n", encoding="utf-8")
    build = tmp_path / ".solaire/build.yaml"
    build.parent.mkdir()
    build.write_text("previous valid configuration", encoding="utf-8")
    events = []

    def write(root, **kwargs):
        events.append("write")
        build.write_text("new configuration", encoding="utf-8")
        return build

    monkeypatch.setattr(
        workflow,
        "resolve_template_under_project",
        lambda *a: (template, "templates/test.yaml"),
    )
    monkeypatch.setattr(workflow, "load_template", lambda *a: None)
    monkeypatch.setattr(
        workflow,
        "_assert_export_destination_owner",
        lambda *a: events.append("authorize"),
    )
    monkeypatch.setattr(workflow, "write_build_exam_yaml", write)
    monkeypatch.setattr(workflow, "run_validate", lambda *a: events.append("validate"))
    monkeypatch.setattr(workflow, "mark_exported", lambda *a: events.append("complete"))
    monkeypatch.setattr(
        workflow,
        "save_exam_workspace_after_export_failure",
        lambda *a, **k: {"exam_id": "Recovery/Math", "name": "Recovery"},
    )
    body = ExamExportBody(
        template_ref="test",
        template_path="templates/test.yaml",
        selected_items=[],
        export_label="Quiz",
        subject="Math",
    )
    return tmp_path, body, build, events


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_formats_use_one_ordered_workflow(export_case, monkeypatch, format):
    root, body, build, events = export_case

    def compile(root, **kwargs):
        events.append("compile")
        return kwargs["dest_dir"], "student." + format, "teacher." + format

    monkeypatch.setattr(
        workflow, "export_" + ("pdfs" if format == "pdf" else "docx"), compile
    )
    result = workflow.export_exam(root, body, format=format)
    assert events == ["authorize", "write", "validate", "compile", "complete"]
    assert result == {
        "ok": True,
        "exam_dir": "exams/Quiz/Math",
        f"student_{format}": "student." + format,
        f"teacher_{format}": "teacher." + format,
    }
    assert not (build.parent / "build.yaml.before_export").exists()


@pytest.mark.parametrize("endpoint", ["/api/exam/export", "/api/exam/export-word"])
def test_permission_rejection_keeps_http_status_and_does_not_write(
    export_case, monkeypatch, web_client, endpoint
):
    root, body, build, events = export_case

    def deny(*args):
        raise HTTPException(status_code=403, detail="Other teacher's paper")

    monkeypatch.setattr(workflow, "_assert_export_destination_owner", deny)
    response = web_client.post(endpoint, json=body.model_dump())
    assert response.status_code == 403
    assert response.json()["detail"] == "Other teacher's paper"
    assert events == []
    assert build.read_text(encoding="utf-8") == "previous valid configuration"


@pytest.mark.parametrize("format", ["pdf", "docx"])
@pytest.mark.parametrize(
    "error,status",
    [(ValueError("bad questions"), 400), (RuntimeError("compiler failed"), 500)],
)
def test_failure_restores_previous_build_and_returns_recoverable_draft(
    export_case, monkeypatch, format, error, status
):
    root, body, build, events = export_case

    def fail(*args, **kwargs):
        raise error

    monkeypatch.setattr(
        workflow, "export_" + ("pdfs" if format == "pdf" else "docx"), fail
    )
    with pytest.raises(HTTPException) as caught:
        workflow.export_exam(root, body, format=format)
    assert caught.value.status_code == status
    assert caught.value.detail["exam_saved"]["exam_id"] == "Recovery/Math"
    assert build.read_text(encoding="utf-8") == "previous valid configuration"
    assert "complete" not in events
