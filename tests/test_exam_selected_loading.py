from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from solaire.web import exam_service, export_workflow
from solaire.web.schemas.exams import ExamExportBody


def test_web_export_requests_selected_question_preparation(
    tmp_path: Path, monkeypatch
) -> None:
    root = tmp_path / "project"
    template_path = root / "templates" / "template.yaml"
    template_path.parent.mkdir(parents=True)
    template_path.write_text("template", encoding="utf-8")
    destination = root / "exams" / "label" / "subject"
    exam_yaml = root / ".solaire" / "build.yaml"
    prepared = SimpleNamespace(template=object())
    calls = {}

    monkeypatch.setattr(
        export_workflow,
        "resolve_template_under_project",
        lambda *_args: (template_path, "templates/template.yaml"),
    )
    monkeypatch.setattr(export_workflow, "_export_destination", lambda *_args: destination)
    monkeypatch.setattr(export_workflow, "_assert_export_destination_owner", lambda *_args: None)
    monkeypatch.setattr(export_workflow, "_completion_plan", lambda *_args: ("mark-id", {}))
    monkeypatch.setattr(export_workflow, "snapshot_build_yaml_before_export", lambda *_args: None)
    monkeypatch.setattr(export_workflow, "discard_build_yaml_backup", lambda *_args: None)
    monkeypatch.setattr(export_workflow, "_complete_export", lambda *_args: [])
    monkeypatch.setattr(export_workflow, "write_build_exam_yaml", lambda *_args, **_kwargs: exam_yaml)

    def fake_prepare_exam(_exam_yaml, **kwargs):
        calls["selected_questions_only"] = kwargs.get("selected_questions_only")
        return prepared

    def fake_export(_root, **kwargs):
        calls["prepared"] = kwargs.get("prepared")
        return destination, "student.pdf", "teacher.pdf"

    monkeypatch.setattr(exam_service, "prepare_exam", fake_prepare_exam)
    monkeypatch.setattr(export_workflow, "export_pdfs", fake_export)

    body = ExamExportBody(
        template_ref="template",
        template_path="templates/template.yaml",
        selected_items=[],
        export_label="Label",
        subject="Subject",
    )
    response = export_workflow._export_locked(root, body, format="pdf")

    assert calls == {"selected_questions_only": True, "prepared": prepared}
    assert response["exam_dir"] == "exams/label/subject"
    assert response["student_pdf"] == "student.pdf"
