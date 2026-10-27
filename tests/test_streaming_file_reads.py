"""Tests for bounded file reading, PDF extraction budgets, and Markdown conversion behavior."""

from __future__ import annotations

import gc
import subprocess
import tracemalloc
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import pdfplumber
import pytest
from reportlab.pdfgen import canvas

from solaire.agent_layer.attachments import MAX_PDF_PAGES, extract_attachment
from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.tools._streaming_reader import read_file_window
from solaire.agent_layer.tools.doc_tools import tool_doc_convert_to_markdown
from solaire.agent_layer.tools.file_tools import tool_file_read


def _make_ctx(project_root: Path) -> InvocationContext:
    (project_root / "resource").mkdir(parents=True, exist_ok=True)
    return InvocationContext(
        project_root=project_root,
        session_id="test_sess_file_read",
        platform_user=None,
    )


# --------------------------------------------------------------------------
# Streaming file reading memory limits and splitlines semantics
# --------------------------------------------------------------------------


def test_streaming_file_read_quant_acceptance_large_file(tmp_path: Path) -> None:
    """Large-file acceptance criteria:

    - At least 64 MiB, at least 1,000,000 lines generated fixture.
    - Read 5 lines from mid/back (offset=800000, limit=5).
    - total_lines matches baseline splitlines(keepends=True) exactly.
    - content matches baseline slice exactly.
    - Peak memory (excluding fixture generation) <= 8.0 MiB.
    """
    large_file = tmp_path / "large_fixture.txt"
    line_format = "Line number {index:07d} with extra padding bytes to ensure total file size exceeds 64 MiB\n"
    total_target_lines = 1_000_000

    # Progressively write out fixture without loading whole file into memory
    with open(large_file, "w", encoding="utf-8", newline="") as f:
        for i in range(total_target_lines):
            f.write(line_format.format(index=i))

    file_size = large_file.stat().st_size
    assert file_size >= 64 * 1024 * 1024, f"Fixture size {file_size} is less than 64 MiB"

    # Read 5 lines from offset 800000
    offset = 800000
    limit = 5
    expected_lines = [line_format.format(index=offset + j) for j in range(limit)]
    expected_content = "".join(expected_lines)

    gc.collect()
    tracemalloc.start()
    total_lines, content = read_file_window(large_file, offset=offset, limit=limit)
    _, peak_memory = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    peak_mb = peak_memory / (1024 * 1024)
    assert total_lines == total_target_lines
    assert content == expected_content
    assert peak_mb <= 8.0, f"Peak memory {peak_mb:.2f} MiB exceeded 8.0 MiB limit"

    # Verify tool_file_read integration
    ctx = _make_ctx(tmp_path)
    res = tool_file_read(ctx, {"path": "large_fixture.txt", "offset": offset, "limit": limit})
    assert res.status == "succeeded"
    assert res.data["total_lines"] == total_target_lines
    assert res.data["content"] == expected_content


def test_streaming_file_read_edge_cases(tmp_path: Path) -> None:
    """Verify empty files, offset=0, end windows, offset past EOF, and limit=0."""
    ctx = _make_ctx(tmp_path)

    # 1. Empty file
    empty_file = tmp_path / "empty.txt"
    empty_file.write_text("", encoding="utf-8")
    tot, cnt = read_file_window(empty_file, offset=0, limit=10)
    assert tot == 0
    assert cnt == ""

    res_empty = tool_file_read(ctx, {"path": "empty.txt", "offset": 0, "limit": 10})
    assert res_empty.status == "succeeded"
    assert res_empty.data["total_lines"] == 0
    assert res_empty.data["content"] == ""

    # 2. Single newline
    nl_file = tmp_path / "single_nl.txt"
    nl_file.write_text("\n", encoding="utf-8")
    tot, cnt = read_file_window(nl_file, offset=0, limit=10)
    assert tot == 1
    assert cnt == "\n"

    # 3. Multiple empty lines
    multi_nl = tmp_path / "multi_nl.txt"
    multi_nl.write_text("\n\n\n", encoding="utf-8")
    tot, cnt = read_file_window(multi_nl, offset=0, limit=2)
    assert tot == 3
    assert cnt == "\n\n"

    # 4. No trailing newline
    no_trail = tmp_path / "no_trail.txt"
    no_trail.write_text("first\nsecond\nthird", encoding="utf-8")
    tot, cnt = read_file_window(no_trail, offset=1, limit=2)
    assert tot == 3
    assert cnt == "second\nthird"

    # 5. Offset=0 with limit
    tot, cnt = read_file_window(no_trail, offset=0, limit=1)
    assert tot == 3
    assert cnt == "first\n"

    # 6. End window (offset at last line)
    tot, cnt = read_file_window(no_trail, offset=2, limit=5)
    assert tot == 3
    assert cnt == "third"

    # 7. Offset past EOF
    tot, cnt = read_file_window(no_trail, offset=10, limit=5)
    assert tot == 3
    assert cnt == ""

    # 8. Limit=0
    tot, cnt = read_file_window(no_trail, offset=1, limit=0)
    assert tot == 3
    assert cnt == ""

    # 9. Negative limit retains the pre-streaming splitlines slicing behavior.
    original_lines = no_trail.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    for offset, limit in ((0, -1), (1, -1), (1, -2)):
        tot, cnt = read_file_window(no_trail, offset=offset, limit=limit, chunk_size=2)
        assert tot == len(original_lines)
        assert cnt == "".join(original_lines[offset:][:limit])

    res_negative_limit = tool_file_read(ctx, {"path": "no_trail.txt", "offset": 0, "limit": -1})
    assert res_negative_limit.status == "succeeded"
    assert res_negative_limit.data["content"] == "".join(original_lines[:-1])


def test_streaming_file_read_crlf_and_unicode_separators(tmp_path: Path) -> None:
    """Verify CRLF across chunks, standalone CR, and all Unicode line breaks."""
    # 1. CRLF across chunk boundaries (force chunk_size=4 bytes)
    crlf_file = tmp_path / "crlf_test.txt"
    raw_crlf = b"line1\r\nline2\r\nline3\r\n"
    crlf_file.write_bytes(raw_crlf)

    baseline_lines = crlf_file.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    tot, cnt = read_file_window(crlf_file, offset=1, limit=1, chunk_size=4)
    assert tot == len(baseline_lines)
    assert cnt == "".join(baseline_lines[1:2])

    # 2. Standalone CR
    cr_file = tmp_path / "cr_test.txt"
    cr_file.write_bytes(b"alpha\rbeta\rgamma\r")
    cr_baseline = cr_file.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    tot, cnt = read_file_window(cr_file, offset=0, limit=2, chunk_size=4)
    assert tot == len(cr_baseline)
    assert cnt == "".join(cr_baseline[0:2])

    # 3. Unicode line break characters
    unicode_file = tmp_path / "unicode_breaks.txt"
    u_content = "a\x0bb\x0cc\x1cd\x1de\x1ef\x85g\u2028h\u2029i\n"
    unicode_file.write_text(u_content, encoding="utf-8")
    u_baseline = u_content.splitlines(keepends=True)
    tot, cnt = read_file_window(unicode_file, offset=2, limit=4, chunk_size=3)
    assert tot == len(u_baseline)
    assert cnt == "".join(u_baseline[2:6])

    # 4. Super-long single line skipped before offset (bounded memory)
    long_file = tmp_path / "super_long.txt"
    with open(long_file, "w", encoding="utf-8", newline="") as f:
        f.write("A" * 200_000)  # 200 KB line
        f.write("\nTARGET_LINE\n")
        f.write("B" * 200_000)  # another 200 KB line

    tot, cnt = read_file_window(long_file, offset=1, limit=1, chunk_size=1024)
    assert tot == 3
    assert cnt == "TARGET_LINE\n"


# --------------------------------------------------------------------------
# Attachment PDF page budget and lazy Page object construction
# --------------------------------------------------------------------------


def test_pdf_attachment_80_page_budget_and_lazy_page_wrappers(tmp_path: Path) -> None:
    """Verify >= 81 page PDF:

    - Extracts only first 80 pages.
    - total_pages is exact (85).
    - truncated is True, metadata indicates page_limit.
    - Parser spy verifies NO pdfplumber.Page wrapper objects constructed for pages > 80.
    """
    pdf_path = tmp_path / "large_85_pages.pdf"
    c = canvas.Canvas(str(pdf_path))
    for i in range(1, 86):
        c.drawString(100, 700, f"Math Exam Question Page {i}")
        c.showPage()
    c.save()

    # Install spy on pdfplumber.page.Page.__init__
    orig_init = pdfplumber.page.Page.__init__
    created_pages: list[pdfplumber.page.Page] = []

    def spy_page_init(self: pdfplumber.page.Page, *args: object, **kwargs: object) -> None:
        created_pages.append(self)
        orig_init(self, *args, **kwargs)

    with patch.object(pdfplumber.page.Page, "__init__", spy_page_init):
        res = extract_attachment(pdf_path)

    # 1. Verification of page wrapper construction
    assert len(created_pages) == MAX_PDF_PAGES, (
        f"Expected at most {MAX_PDF_PAGES} Page objects constructed, but got {len(created_pages)}"
    )

    # 2. Metadata and truncation verification
    assert res.kind == "document"
    assert res.truncated is True
    assert res.metadata["pages"] == MAX_PDF_PAGES
    assert res.metadata["total_pages"] == 85
    assert res.metadata["page_budget"] == MAX_PDF_PAGES
    assert res.metadata["extracted_pages"] == MAX_PDF_PAGES
    assert res.metadata["truncation_reason"] == "page_limit"

    # 3. Content verification
    assert "第 1 页" in res.content
    assert f"第 {MAX_PDF_PAGES} 页" in res.content
    assert f"第 {MAX_PDF_PAGES + 1} 页" not in res.content


def test_pdf_attachment_char_budget_truncation_and_early_stop(tmp_path: Path) -> None:
    """Verify that when PDF text exceeds max_chars:

    - Content is bounded <= max_chars.
    - truncated is True with char_limit reason.
    - Early stopping avoids accumulating text for all remaining pages.
    """
    pdf_path = tmp_path / "heavy_text_10_pages.pdf"
    c = canvas.Canvas(str(pdf_path))
    for i in range(1, 11):
        # 10 pages with dense text
        for line_num in range(50):
            c.drawString(50, 750 - line_num * 14, f"P{i}-L{line_num}: " + "Dense mathematical text " * 5)
        c.showPage()
    c.save()

    res = extract_attachment(pdf_path, max_chars=5_000)
    assert res.kind == "document"
    assert res.truncated is True
    assert len(res.content) <= 5_000
    assert res.metadata["total_pages"] == 10
    assert res.metadata["truncation_reason"] == "char_limit"
    # Early stop should extract fewer than all 10 pages
    assert res.metadata["extracted_pages"] < 10


def test_pdf_attachment_normal_small_file(tmp_path: Path) -> None:
    """Verify that normal PDFs within budget are not marked truncated."""
    pdf_path = tmp_path / "normal_3_pages.pdf"
    c = canvas.Canvas(str(pdf_path))
    for i in range(1, 4):
        c.drawString(100, 700, f"Page {i} content")
        c.showPage()
    c.save()

    res = extract_attachment(pdf_path)
    assert res.kind == "document"
    assert res.truncated is False
    assert res.metadata["pages"] == 3
    assert res.metadata["total_pages"] == 3
    assert res.metadata["page_budget"] == MAX_PDF_PAGES
    assert res.metadata["extracted_pages"] == 3
    assert "truncation_reason" not in res.metadata


def test_pdf_exact_character_limit_is_not_truncated(tmp_path: Path) -> None:
    """A document that exactly fits the character budget is complete."""
    from solaire.agent_layer.attachments import _extract_pdf

    pdf_path = tmp_path / "exact_character_limit.pdf"
    c = canvas.Canvas(str(pdf_path))
    c.drawString(100, 700, "Short page")
    c.save()
    content, _ = _extract_pdf(pdf_path)

    res = extract_attachment(pdf_path, max_chars=len(content))

    assert res.content == content
    assert len(res.content) == len(content)
    assert res.truncated is False
    assert "truncation_reason" not in res.metadata


def test_pdf_large_page_text_does_not_accumulate_above_character_budget(
    tmp_path: Path,
) -> None:
    """The reader does not duplicate or retain a very large page beyond its bounded output."""
    import tracemalloc

    pdf_path = tmp_path / "large_page_text.pdf"
    c = canvas.Canvas(str(pdf_path))
    c.drawString(100, 700, "Placeholder")
    c.save()
    large_text = "x" * (16 * 1024 * 1024)

    with patch.object(pdfplumber.page.Page, "extract_text", return_value=large_text):
        tracemalloc.start()
        res = extract_attachment(pdf_path, max_chars=40_000)
        _, peak_bytes = tracemalloc.get_traced_memory()
        tracemalloc.stop()

    assert res.truncated is True
    assert len(res.content) <= 40_000
    assert res.metadata["truncation_reason"] == "char_limit"
    assert peak_bytes <= 8 * 1024 * 1024


# --------------------------------------------------------------------------
# Markdown same-path conversion behavior
# --------------------------------------------------------------------------


def test_markdown_same_path_preserves_source_content(tmp_path: Path) -> None:
    """Same-path conversion preserves its input when unavailable or successful.

    - Call tool_doc_convert_to_markdown with an existing .md file.
    - When pandoc is absent: returns failed with tool_not_installed, source file untouched.
    - When pandoc is present: converts and writes markdown to the same .md path.
      Source content is preserved/normalized by pandoc without silent corruption.
    - The source remains unchanged in both observed outcomes.
    """
    ctx = _make_ctx(tmp_path)
    md_rel = "resource/source.md"
    md_abs = tmp_path / md_rel
    orig_text = "# Test Document\n\nParagraph text with **bold**.\n"
    md_abs.write_text(orig_text, encoding="utf-8")

    # 1. Direct call without pandoc configured
    with patch("solaire.agent_layer.tools.doc_tools._configured_pandoc_cmd", return_value=None):
        res_no_tool = tool_doc_convert_to_markdown(ctx, {"path": md_rel})
        assert res_no_tool.status == "failed"
        assert res_no_tool.error_code == "tool_not_installed"
        assert md_abs.read_text(encoding="utf-8") == orig_text

    # 2. Simulated pandoc run returning normalized markdown
    with patch("solaire.agent_layer.tools.doc_tools._configured_pandoc_cmd", return_value="pandoc"):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=["pandoc", str(md_abs), "-t", "markdown", "--wrap=none"],
                returncode=0,
                stdout="# Test Document\n\nParagraph text with **bold**.\n",
                stderr="",
            )
            res_ok = tool_doc_convert_to_markdown(ctx, {"path": md_rel})
            assert res_ok.status == "succeeded"
            assert res_ok.data["source"] == md_rel
            assert Path(res_ok.data["output"]).as_posix() == Path(md_rel).as_posix()
            assert md_abs.read_text(encoding="utf-8") == orig_text


# --------------------------------------------------------------------------
# User Perspective & End-to-End Practical Reliability Tests
# --------------------------------------------------------------------------


def test_user_perspective_file_reading_journeys(tmp_path: Path) -> None:
    """Simulate real user & AI agent workflows and edge cases:

    - Paging through documents (page 1, 2, 3...)
    - Chinese directory paths and filenames with spaces
    - UTF-8 BOM files from Windows Notepad
    - Bad user / LLM parameters (non-integer strings, negative numbers)
    - Security boundaries (non-existent file, path traversal)
    """
    ctx = _make_ctx(tmp_path)

    # 1. Paging through a 50-line code/log file
    log_file = tmp_path / "resource" / "app.txt"
    with open(log_file, "w", encoding="utf-8") as f:
        for i in range(1, 51):
            f.write(f"Log event {i:02d}: system operational\n")

    # Read page 1 (lines 0..20)
    p1 = tool_file_read(ctx, {"path": "resource/app.txt", "offset": 0, "limit": 20})
    assert p1.status == "succeeded"
    assert p1.data["total_lines"] == 50
    assert "Log event 01:" in p1.data["content"]
    assert "Log event 20:" in p1.data["content"]
    assert "Log event 21:" not in p1.data["content"]

    # Read page 2 (lines 20..40)
    p2 = tool_file_read(ctx, {"path": "resource/app.txt", "offset": 20, "limit": 20})
    assert p2.status == "succeeded"
    assert "Log event 21:" in p2.data["content"]
    assert "Log event 40:" in p2.data["content"]

    # Read page 3 (lines 40..60, only 10 lines remain)
    p3 = tool_file_read(ctx, {"path": "resource/app.txt", "offset": 40, "limit": 20})
    assert p3.status == "succeeded"
    assert "Log event 41:" in p3.data["content"]
    assert "Log event 50:" in p3.data["content"]

    # Read past EOF (offset=100)
    past = tool_file_read(ctx, {"path": "resource/app.txt", "offset": 100, "limit": 20})
    assert past.status == "succeeded"
    assert past.data["total_lines"] == 50
    assert past.data["content"] == ""

    # 2. Chinese file path with spaces
    cn_dir = tmp_path / "resource" / "高中数学 必修一"
    cn_dir.mkdir(parents=True, exist_ok=True)
    cn_file = cn_dir / "第一章 集合与函数概念.txt"
    cn_file.write_text("第一节 集合的含义与表示\n第二节 集合间的基本关系\n", encoding="utf-8")
    cn_res = tool_file_read(ctx, {"path": "resource/高中数学 必修一/第一章 集合与函数概念.txt"})
    assert cn_res.status == "succeeded"
    assert cn_res.data["total_lines"] == 2
    assert "第一节 集合的含义与表示" in cn_res.data["content"]

    # 3. Windows Notepad UTF-8 with BOM file
    bom_file = tmp_path / "resource" / "notes_bom.txt"
    bom_file.write_bytes(b"\xef\xbb\xbfSection 1\nSection 2\n")
    bom_res = tool_file_read(ctx, {"path": "resource/notes_bom.txt"})
    assert bom_res.status == "succeeded"
    assert bom_res.data["total_lines"] == 2
    assert "Section 1" in bom_res.data["content"]

    # 4. User / LLM passes non-integer string arguments
    bad_offset = tool_file_read(ctx, {"path": "resource/app.txt", "offset": "invalid"})
    assert bad_offset.status == "failed"
    assert "offset 参数必须为整数" in bad_offset.error_message

    bad_limit = tool_file_read(ctx, {"path": "resource/app.txt", "limit": "invalid"})
    assert bad_limit.status == "failed"
    assert "limit 参数必须为整数" in bad_limit.error_message

    # 5. Non-existent file and traversal defense
    missing_res = tool_file_read(ctx, {"path": "resource/non_existent.txt"})
    assert missing_res.status == "failed"
    assert "文件不存在" in missing_res.error_message

    trav_res = tool_file_read(ctx, {"path": "../../../secret.txt"})
    assert trav_res.status == "failed"


def test_user_perspective_pdf_upload_and_reading_flow(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Simulate real end-to-end user journey:

    - User uploads PDF via /api/agent/upload
    - Agent calls file.read on the uploaded file
    - PDF contains normal multi-page text, blank pages, and large 100-page textbook
    - Corrupt/fake PDF handling returns clear actionable error
    """
    from io import BytesIO
    from fastapi.testclient import TestClient
    from solaire.agent_layer.registry import invoke_registered_tool
    from solaire.web.app import app
    from solaire.web import state

    monkeypatch.setattr(state, "get_content_root", lambda: tmp_path)

    # Case A: Normal 5-page PDF upload and agent reading
    pdf_stream = BytesIO()
    c = canvas.Canvas(pdf_stream)
    for i in range(1, 6):
        c.drawString(100, 700, f"Math Course Syllabus - Lecture {i}")
        # Insert a blank page on page 3 to verify graceful non-text handling
        c.showPage()
    c.save()

    with closing(TestClient(app)) as client:
        up_res = client.post(
            "/api/agent/upload",
            files={"file": ("syllabus.pdf", pdf_stream.getvalue(), "application/pdf")},
            data={"session_id": "sess_user_flow"},
        )
        assert up_res.status_code == 200
        uploaded_rel = up_res.json()["path"]

        ctx = InvocationContext(project_root=tmp_path, session_id="sess_user_flow")
        agent_read = invoke_registered_tool("file.read", {"path": uploaded_rel}, ctx)
        assert agent_read.status == "succeeded"
        assert agent_read.data["kind"] == "document"
        assert agent_read.data["truncated"] is False
        assert agent_read.data["metadata"]["total_pages"] == 5
        assert agent_read.data["metadata"]["pages"] == 5
        assert "Lecture 1" in agent_read.data["content"]
        assert "Lecture 5" in agent_read.data["content"]

        # Case B: 100-page textbook upload with page budget protection
        heavy_stream = BytesIO()
        c2 = canvas.Canvas(heavy_stream)
        for i in range(1, 101):
            c2.drawString(100, 700, f"Textbook Chapter {i}")
            c2.showPage()
        c2.save()

        up_heavy = client.post(
            "/api/agent/upload",
            files={"file": ("textbook.pdf", heavy_stream.getvalue(), "application/pdf")},
            data={"session_id": "sess_heavy_flow"},
        )
        assert up_heavy.status_code == 200
        heavy_rel = up_heavy.json()["path"]

        ctx_heavy = InvocationContext(project_root=tmp_path, session_id="sess_heavy_flow")
        heavy_read = invoke_registered_tool("file.read", {"path": heavy_rel}, ctx_heavy)
        assert heavy_read.status == "succeeded"
        assert heavy_read.data["truncated"] is True
        assert heavy_read.data["metadata"]["total_pages"] == 100
        assert heavy_read.data["metadata"]["pages"] == MAX_PDF_PAGES
        assert heavy_read.data["metadata"]["truncation_reason"] == "page_limit"

        # Case C: Corrupt PDF file uploaded by mistake
        fake_pdf = tmp_path / "resource" / "corrupted.pdf"
        fake_pdf.write_bytes(b"This is not a real PDF file header")
        corrupt_read = invoke_registered_tool("file.read", {"path": "resource/corrupted.pdf"}, ctx)
        assert corrupt_read.status == "failed"
        assert corrupt_read.error_code == "extract_failed"
        assert "建议" in corrupt_read.data.get("suggestion", "") or "损坏" in corrupt_read.error_message
