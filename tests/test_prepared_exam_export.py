"""One export uses the same validated question and template inputs throughout."""
import pytest
import yaml

from solaire.exam_compiler.pipeline import build, docx, prepare
from solaire.web import exam_service
from tests.test_exam_docx_export import _write_minimal_exam_project


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_export_reuses_validated_inputs_and_keeps_rendered_content(tmp_path, monkeypatch, format):
    exam_yaml = _write_minimal_exam_project(tmp_path)
    counts = {"questions": 0, "template": 0}
    for function_name, key in (("load_all_questions", "questions"), ("load_template", "template")):
        original = getattr(prepare, function_name)
        def counted(*args, original=original, key=key, **kwargs):
            counts[key] += 1
            return original(*args, **kwargs)
        monkeypatch.setattr(prepare, function_name, counted)

    def compile_pdf(work_dir, tex):
        tex.with_suffix(".pdf").write_bytes(b"compiler output")
    monkeypatch.setattr(build, "run_latexmk", compile_pdf)
    monkeypatch.setattr(docx, "_run_pandoc", lambda markdown, target: target.write_bytes(b"compiler output"))
    exporter = exam_service.export_pdfs if format == "pdf" else exam_service.export_docx

    def rendered_text():
        work = tmp_path / "exam"
        return {path.name: path.read_text(encoding="utf-8") for path in work.rglob("*." + ("tex" if format == "pdf" else "md"))}

    validated = exam_service.run_validate(tmp_path, exam_yaml)
    exporter(tmp_path, exam_yaml=exam_yaml, export_label="Quiz", subject="Math", template=validated.template, dest_dir=tmp_path / "exams/uncached")
    baseline = rendered_text()
    assert counts == {"questions": 2, "template": 2}

    counts.update(questions=0, template=0)
    validated = exam_service.run_validate(tmp_path, exam_yaml)
    exporter(tmp_path, exam_yaml=exam_yaml, export_label="Quiz", subject="Math", dest_dir=tmp_path / "exams/reused", prepared=validated)
    assert counts == {"questions": 1, "template": 1}
    assert rendered_text() == baseline


def test_prepared_word_export_keeps_validated_content_and_metadata_when_sources_change(tmp_path, monkeypatch):
    exam_yaml = _write_minimal_exam_project(tmp_path)
    validated = exam_service.run_validate(tmp_path, exam_yaml)
    original_exam = validated.exam.model_dump(mode="json")
    raw = yaml.safe_load(exam_yaml.read_text(encoding="utf-8"))
    raw["metadata"]["title"] = "Later edit"
    exam_yaml.write_text(yaml.safe_dump(raw), encoding="utf-8")
    (tmp_path / "resource/math/set/q1.yaml").write_text("broken: [", encoding="utf-8")
    monkeypatch.setattr(docx, "_run_pandoc", lambda markdown, target: target.write_bytes(b"compiler output"))
    destination = tmp_path / "exams/export"
    exam_service.export_docx(tmp_path, exam_yaml=exam_yaml, export_label="Quiz", subject="Math", dest_dir=destination, prepared=validated)
    assert "# Docx Test" in (tmp_path / "exam/docx/student_paper.md").read_text(encoding="utf-8")
    assert yaml.safe_load((destination / "exam.yaml").read_text(encoding="utf-8"))["metadata"]["title"] == "Docx Test"
    assert validated.exam.model_dump(mode="json") == original_exam


def test_prepared_inputs_cannot_be_used_for_a_different_exam_or_preview_mode(tmp_path):
    validated = exam_service.run_validate(tmp_path, _write_minimal_exam_project(tmp_path))
    with pytest.raises(ValueError, match="different source"):
        validated.check_source(tmp_path / "other.yaml")
    with pytest.raises(ValueError, match="validation mode"):
        validated.check_source(validated.exam_yaml, preview_relaxed=True)
