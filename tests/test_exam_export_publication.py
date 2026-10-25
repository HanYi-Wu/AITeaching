"""Failed generation or replacement must leave the previous export usable."""

from pathlib import Path

import pytest
import yaml

from solaire.web import exam_service as service


@pytest.fixture
def export_case(tmp_path):
    exam = tmp_path / ".solaire" / "build.yaml"
    exam.parent.mkdir()
    exam.write_text(
        yaml.safe_dump(
            {
                "exam_id": "web_export",
                "template_ref": "test",
                "metadata": {},
                "question_libraries": [],
                "selected_items": [],
            }
        ),
        encoding="utf-8",
    )
    destination = tmp_path / "exams" / "Quiz" / "Math"
    destination.mkdir(parents=True)
    originals = {
        "exam.yaml": b"previous exam configuration",
        "scores/results.csv": b"score data",
        "notes.pdf": b"unrelated document",
    }
    for extension in ("pdf", "docx"):
        for variant in ("学生版", "教师版"):
            originals[f"Quiz-Math-{variant}.{extension}"] = (
                f"old {variant} {extension}".encode()
            )
    for name, content in originals.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return tmp_path, exam, destination, originals


def _export(case, format):
    root, exam, destination, _ = case
    return (service.export_pdfs if format == "pdf" else service.export_docx)(
        root,
        exam_yaml=exam,
        export_label="Quiz",
        subject="Math",
        dest_dir=destination,
    )


def _assert_originals(case):
    _, _, destination, originals = case
    for name, content in originals.items():
        assert (destination / name).read_bytes() == content


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_compilation_failure_keeps_previous_export(export_case, monkeypatch, format):
    def fail(*args, **kwargs):
        raise RuntimeError("compiler failed")

    monkeypatch.setattr(
        service, "build_exam_" + ("pdfs" if format == "pdf" else "docx"), fail
    )
    with pytest.raises(RuntimeError, match="compiler failed"):
        _export(export_case, format)
    _assert_originals(export_case)


def _fake_builder(format):
    def build(exam_yaml, out_dir):
        paths = []
        for variant in ("student", "teacher"):
            path = out_dir / f"{variant}_paper.{format}"
            path.write_bytes(f"new {variant}".encode())
            paths.append(path)
        return (*paths, []) if format == "pdf" else tuple(paths)

    return build


@pytest.mark.parametrize("format", ["pdf", "docx"])
@pytest.mark.parametrize("failing_name", ["Quiz-Math-教师版", "exam"])
def test_replacement_failure_restores_entire_previous_export(
    export_case, monkeypatch, format, failing_name
):
    destination = export_case[2]
    monkeypatch.setattr(
        service,
        "build_exam_" + ("pdfs" if format == "pdf" else "docx"),
        _fake_builder(format),
    )
    original_replace = service.os.replace
    failed = False
    expected = destination / (
        "exam.yaml" if failing_name == "exam" else failing_name + "." + format
    )

    def replace(source, target):
        nonlocal failed
        if Path(target) == expected and not failed:
            failed = True
            raise OSError("replacement failed")
        return original_replace(source, target)

    monkeypatch.setattr(service.os, "replace", replace)
    with pytest.raises(OSError, match="replacement failed"):
        _export(export_case, format)
    assert failed
    _assert_originals(export_case)


@pytest.mark.parametrize("format", ["pdf", "docx"])
def test_success_replaces_pair_and_keeps_other_format_and_user_files(
    export_case, monkeypatch, format
):
    monkeypatch.setattr(
        service,
        "build_exam_" + ("pdfs" if format == "pdf" else "docx"),
        _fake_builder(format),
    )
    destination, student, teacher = _export(export_case, format)
    assert (destination / student).read_bytes() == b"new student"
    assert (destination / teacher).read_bytes() == b"new teacher"
    assert (
        yaml.safe_load((destination / "exam.yaml").read_text(encoding="utf-8"))[
            "exam_id"
        ]
        == "web_export"
    )
    for name, content in export_case[3].items():
        if (
            name != "exam.yaml"
            and not name.startswith("Quiz-Math-")
            or name.endswith(".docx" if format == "pdf" else ".pdf")
        ):
            assert (destination / name).read_bytes() == content
