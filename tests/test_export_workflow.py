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


@pytest.fixture
def teacher_export_case(export_case, monkeypatch):
    from solaire.common.actor_context import actor
    from solaire.web import platform_db
    from solaire.web.export_policy import assert_destination_owner

    root, *_ = export_case
    platform_db.init_platform_db(root)
    monkeypatch.setattr(platform_db, "default_platform_root", lambda: root)
    monkeypatch.setattr(
        workflow, "_assert_export_destination_owner", assert_destination_owner
    )
    token = actor.set({"id": "teacher-b", "role": "teacher", "status": "active"})
    try:
        yield export_case
    finally:
        actor.reset(token)


def _owned_exam(root, exam_id, owner):
    path = root / "exams" / exam_id / "exam.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"metadata:\n  owner_teacher_id: {owner}\n", encoding="utf-8")
    return path


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_foreign_cleanup_is_rejected_before_any_build_write(
    teacher_export_case, format
):
    root, body, build, events = teacher_export_case
    foreign = _owned_exam(root, "Other/Math", "teacher-a")
    original = foreign.read_bytes()
    body.exam_ids_to_delete_on_success = ["Other/Math"]
    with pytest.raises(HTTPException) as caught:
        workflow.export_exam(root, body, format=format)
    assert caught.value.status_code == 403
    assert foreign.read_bytes() == original
    assert build.read_text(encoding="utf-8") == "previous valid configuration"
    assert events == []


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_cleanup_removes_own_old_copy_and_preserves_export_destination(
    teacher_export_case, monkeypatch, format
):
    root, body, build, events = teacher_export_case
    old = _owned_exam(root, "Old/Math", "teacher-b")
    body.exam_ids_to_delete_on_success = ["Old/Math", "Quiz/Math", "Old/Math"]

    def compile(root, **kwargs):
        output = _owned_exam(root, "Quiz/Math", "teacher-b")
        (output.parent / f"student.{format}").write_bytes(b"compiled exam")
        return output.parent, f"student.{format}", f"teacher.{format}"

    monkeypatch.setattr(
        workflow, "export_" + ("pdfs" if format == "pdf" else "docx"), compile
    )
    result = workflow.export_exam(root, body, format=format)
    assert result["ok"]
    assert not old.parent.exists()
    assert (root / result["exam_dir"] / f"student.{format}").is_file()
    assert (root / result["exam_dir"] / "exam.yaml").is_file()


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_cleanup_rechecks_ownership_after_long_running_compile(
    teacher_export_case, monkeypatch, format
):
    root, body, build, events = teacher_export_case
    old = _owned_exam(root, "Old/Math", "teacher-b")
    body.exam_ids_to_delete_on_success = ["Old/Math"]

    def compile(root, **kwargs):
        _owned_exam(root, "Old/Math", "teacher-a")
        return kwargs["dest_dir"], f"student.{format}", f"teacher.{format}"

    monkeypatch.setattr(
        workflow, "export_" + ("pdfs" if format == "pdf" else "docx"), compile
    )
    assert workflow.export_exam(root, body, format=format)["ok"]
    assert "teacher-a" in old.read_text(encoding="utf-8")


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_unreadable_ownership_metadata_is_rejected_before_build(
    teacher_export_case, format
):
    root, body, build, events = teacher_export_case
    existing = _owned_exam(root, "Quiz/Math", "teacher-b")
    existing.write_text("metadata: [unterminated\n", encoding="utf-8")
    original = existing.read_bytes()
    with pytest.raises(HTTPException) as caught:
        workflow.export_exam(root, body, format=format)
    assert caught.value.status_code == 400
    assert existing.read_bytes() == original
    assert build.read_text(encoding="utf-8") == "previous valid configuration"
    assert events == []
