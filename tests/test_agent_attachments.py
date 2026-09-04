from __future__ import annotations

from pathlib import Path
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook
from fastapi.testclient import TestClient

from solaire.agent_layer.attachments import (
    SUPPORTED_UPLOAD_SUFFIXES,
    capability_for_filename,
    extract_attachment,
)
from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.registry import invoke_registered_tool
from solaire.web.app import app


def _workbook(path: Path) -> Path:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Knowledge"
    sheet.append(["subject", "knowledge_point", "parent", "description"])
    sheet.append(["math", "functions", None, "function basics"])
    sheet.append(["math", "linear functions", "functions", "definition and graph"])
    workbook.save(path)
    return path


def _workbook_bytes() -> bytes:
    stream = BytesIO()
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["subject", "knowledge_point"])
    sheet.append(["math", "linear functions"])
    workbook.save(stream)
    return stream.getvalue()


def test_common_format_registry_is_explicit_and_actionable() -> None:
    expected = {
        ".txt", ".md", ".yaml", ".yml", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".rtf",
        ".xlsx", ".xls", ".docx", ".doc", ".pdf", ".pptx", ".ppt",
        ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif",
        ".odt", ".ods", ".odp",
    }
    assert expected <= SUPPORTED_UPLOAD_SUFFIXES
    assert capability_for_filename("outline.xlsx").strategy == "builtin"
    assert capability_for_filename("legacy.doc").strategy == "converter"

    unsupported = capability_for_filename("payload.exe")
    assert unsupported.strategy == "unsupported"
    assert "转换" in unsupported.suggestion
    assert ".xlsx" in unsupported.supported_extensions


def test_xlsx_extraction_returns_sheet_rows(tmp_path: Path) -> None:
    result = extract_attachment(_workbook(tmp_path / "knowledge-outline.xlsx"))

    assert result.kind == "spreadsheet"
    assert "Knowledge" in result.content
    assert "linear functions" in result.content
    assert result.truncated is False


def test_text_extraction_is_bounded_and_reports_truncation(tmp_path: Path) -> None:
    path = tmp_path / "large.txt"
    path.write_text("0123456789" * 20, encoding="utf-8")

    result = extract_attachment(path, max_chars=35)

    assert len(result.content) <= 35
    assert result.truncated is True


def test_zip_based_office_files_reject_excessive_expansion(tmp_path: Path) -> None:
    path = tmp_path / "oversized.xlsx"
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("xl/worksheets/sheet1.xml", b"0" * (51 * 1024 * 1024))

    result = extract_attachment(path)

    assert result.error_code == "unsafe_archive"
    assert "解压" in result.error


def test_modern_office_extractors_return_visible_content(tmp_path: Path) -> None:
    from docx import Document
    from pptx import Presentation

    docx_path = tmp_path / "lesson.docx"
    document = Document()
    document.add_heading("Functions", level=1)
    document.add_paragraph("Linear function lesson")
    document.save(docx_path)

    pptx_path = tmp_path / "lesson.pptx"
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = "Functions"
    slide.placeholders[1].text = "Quadratic function lesson"
    presentation.save(pptx_path)

    assert "Linear function lesson" in extract_attachment(docx_path).content
    assert "Quadratic function lesson" in extract_attachment(pptx_path).content


def test_converter_and_image_formats_return_specific_guidance(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr('solaire.agent_layer.ocr.resolve_exe', lambda *args: None)
    legacy = tmp_path / "lesson.doc"
    legacy.write_bytes(b"legacy")
    legacy_result = extract_attachment(legacy)
    assert legacy_result.error_code == "converter_required"
    assert "设置" in legacy_result.suggestion

    image = tmp_path / "diagram.png"
    image.write_bytes(b"not-a-real-image")
    image_result = extract_attachment(image)
    assert image_result.error_code == "ocr_required"
    assert "OCR" in image_result.suggestion


def test_agent_upload_accepts_workbook_and_file_read_extracts_it(
    tmp_path: Path, monkeypatch,
) -> None:
    from solaire.web import state

    monkeypatch.delenv("SOLAIRE_PUBLIC_MODE", raising=False)
    monkeypatch.setattr(state, "get_content_root", lambda: tmp_path)
    client = TestClient(app)

    response = client.post(
        "/api/agent/upload",
        files={
            "file": (
                "knowledge-outline.xlsx",
                _workbook_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"session_id": "xlsx-test"},
    )

    assert response.status_code == 200
    assert response.json()["path"].startswith(".solaire/uploads/xlsx-test/")
    ctx = InvocationContext(project_root=tmp_path, session_id="xlsx-test")
    result = invoke_registered_tool("file.read", {"path": response.json()["path"]}, ctx)
    assert result.status == "succeeded"
    assert "linear functions" in result.data["content"]
    assert result.data["kind"] == "spreadsheet"

    unsafe = client.post(
        "/api/agent/upload",
        files={"file": ("notes.txt", b"safe", "text/plain")},
        data={"session_id": "../../outside"},
    )
    assert unsafe.status_code == 400


def test_agent_upload_rejection_and_capabilities_are_actionable(
    tmp_path: Path, monkeypatch,
) -> None:
    from solaire.web import state

    monkeypatch.delenv("SOLAIRE_PUBLIC_MODE", raising=False)
    monkeypatch.setattr(state, "get_content_root", lambda: tmp_path)
    client = TestClient(app)

    capabilities = client.get("/api/agent/upload-capabilities")
    assert capabilities.status_code == 200
    assert ".xlsx" in capabilities.json()["accepted_extensions"]
    assert capabilities.json()["max_bytes"] == 10 * 1024 * 1024

    rejected = client.post(
        "/api/agent/upload",
        files={"file": ("payload.exe", b"not executable", "application/octet-stream")},
    )
    assert rejected.status_code == 400
    detail = rejected.json()["detail"]
    assert detail["code"] == "unsupported_file_type"
    assert detail["extension"] == ".exe"
    assert ".xlsx" in detail["supported_extensions"]
    assert "转换" in detail["suggestion"]
