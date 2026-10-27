"""Tests for Task D18: Document/OCR to question bank and knowledge graph input boundaries."""

from __future__ import annotations

from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.tools.bank_tools import tool_bank_create_item
from solaire.agent_layer.tools.doc_tools import (
    tool_doc_convert_to_markdown,
    tool_doc_extract_pdf_text,
    tool_doc_ocr_image,
)
from solaire.agent_layer.tools.graph_tools import (
    tool_batch_bind_questions,
    tool_bind_question,
    tool_create_node,
)
from solaire.common.security import assert_within_project
from solaire.knowledge_forge import (
    create_concept_node,
    create_graph,
    list_questions_for_node,
)


def _make_ctx(project_root: Path) -> InvocationContext:
    assert_within_project(project_root, project_root)
    # Ensure standard project directories exist
    (project_root / "resource").mkdir(parents=True, exist_ok=True)
    return InvocationContext(
        project_root=project_root,
        session_id="test_sess_d18",
        platform_user=None,
    )


def test_doc_ocr_image_boundary_and_real_fixtures(tmp_path: Path) -> None:
    """Verify image OCR input boundaries and execution on real image files."""
    ctx = _make_ctx(tmp_path)
    res_dir = tmp_path / "resource"

    # Create real local test PNG image
    img_path = res_dir / "test_ocr_input.png"
    img = Image.new("RGB", (120, 60), color=(255, 255, 255))
    img.save(img_path)

    # 1. Real image call
    res = tool_doc_ocr_image(ctx, {"path": "resource/test_ocr_input.png", "lang": "eng"})
    # A blank image yields a no-text result; an unavailable engine yields install guidance.
    assert res.status in ("succeeded", "failed")
    if res.status == "failed":
        if res.error_code == "ocr_not_installed":
            assert "tesseract" in res.error_message.lower() or "ocr" in res.error_message.lower()
        else:
            assert res.error_code == "ocr_failed"
            assert "未识别到文字" in res.error_message
    else:
        assert "content" in res.data
        assert res.data["source"] == "resource/test_ocr_input.png"

    # 2. Non-existent file
    res_missing = tool_doc_ocr_image(ctx, {"path": "resource/non_existent.png"})
    assert res_missing.status == "failed"
    assert res_missing.error_code == "not_found"

    # 3. Path traversal rejected
    res_trav = tool_doc_ocr_image(ctx, {"path": "../secret.png"})
    assert res_trav.status == "failed"
    assert res_trav.error_code == "invalid_arguments"

    # 4. Unsupported file extension
    bad_ext = res_dir / "bad_file.bin"
    bad_ext.write_bytes(b"some binary data")
    res_ext = tool_doc_ocr_image(ctx, {"path": "resource/bad_file.bin"})
    assert res_ext.status == "failed"
    assert res_ext.error_code == "unsupported_format"

    # 5. Invalid OCR language string (prevent injection/malformed lang parameter)
    res_lang = tool_doc_ocr_image(ctx, {"path": "resource/test_ocr_input.png", "lang": "bad;lang"})
    assert res_lang.status == "failed"
    assert res_lang.error_code == "invalid_arguments"


def test_doc_extract_pdf_text_with_real_local_fixture(tmp_path: Path) -> None:
    """Verify real PDF text extraction and capacity boundaries."""
    ctx = _make_ctx(tmp_path)
    res_dir = tmp_path / "resource"

    # Generate a real local PDF fixture using reportlab
    pdf_path = res_dir / "sample_math_paper.pdf"
    c = canvas.Canvas(str(pdf_path), pagesize=letter)
    c.drawString(72, 750, "Sample Math Exam: Compute derivative of x^2")
    c.save()

    # 1. Extract text from real PDF
    res = tool_doc_extract_pdf_text(ctx, {"path": "resource/sample_math_paper.pdf"})
    assert res.status == "succeeded"
    assert res.data["pages"] == 1
    assert "Compute derivative of x^2" in res.data["content"]

    # 2. Path traversal rejected
    res_trav = tool_doc_extract_pdf_text(ctx, {"path": "../secret.pdf"})
    assert res_trav.status == "failed"
    assert res_trav.error_code == "invalid_arguments"

    # 3. Unsupported format rejected
    txt_path = res_dir / "note.txt"
    txt_path.write_text("Hello", encoding="utf-8")
    res_unsupported = tool_doc_extract_pdf_text(ctx, {"path": "resource/note.txt"})
    assert res_unsupported.status == "failed"
    assert res_unsupported.error_code == "unsupported_format"


def test_doc_convert_to_markdown_boundaries(tmp_path: Path) -> None:
    """Verify markdown conversion boundaries: missing files, traversal, format validation."""
    ctx = _make_ctx(tmp_path)

    # 1. Missing path argument
    res_empty = tool_doc_convert_to_markdown(ctx, {})
    assert res_empty.status == "failed"
    assert res_empty.error_code == "invalid_arguments"

    # 2. Path traversal
    res_trav = tool_doc_convert_to_markdown(ctx, {"path": "../test.docx"})
    assert res_trav.status == "failed"
    assert res_trav.error_code == "invalid_arguments"

    # 3. Non-existent file
    res_missing = tool_doc_convert_to_markdown(ctx, {"path": "resource/missing.docx"})
    assert res_missing.status == "failed"
    assert res_missing.error_code == "not_found"


def test_ocr_output_to_bank_item_and_graph_binding_flow(tmp_path: Path) -> None:
    """E2E flow: doc/OCR output text enters bank creation, question validated, and bound to graph."""
    ctx = _make_ctx(tmp_path)
    create_graph(tmp_path, "数学", slug="math")

    # Step 1: Simulate OCR extracted content creating a question in bank
    ocr_stem = "已知函数 f(x) = x^2 - 4x + 3，求函数的极小值点。"
    q_res = tool_bank_create_item(
        ctx,
        {
            "subject": "数学",
            "question_id": "ocr_deriv_001",
            "question_type": "choice",
            "content": ocr_stem,
            "options": {"A": "x=1", "B": "x=2", "C": "x=3", "D": "x=-2"},
            "answer": "B",
            "analysis": "求导得 f'(x) = 2x - 4，令导数为0得 x=2。",
            "source_kind": "AI辅助导入",
        },
    )
    assert q_res.status == "succeeded"
    qid = q_res.data["qualified_id"]
    assert qid == "数学/默认/ocr_deriv_001"

    # Step 2: Create knowledge point in graph
    node_res = tool_create_node(
        ctx,
        {
            "id": "math/calc/extrema",
            "canonical_name": "极值点与导数应用",
            "subject": "数学",
            "graph": "math",
        },
    )
    assert node_res.status == "succeeded"
    node_id = node_res.data["node_id"]

    # Step 3: Bind OCR-generated question to graph node
    bind_res = tool_bind_question(
        ctx,
        {
            "question_qualified_id": qid,
            "node_id": node_id,
            "graph": "math",
        },
    )
    assert bind_res.status == "succeeded"

    # Step 4: Verify binding is persisted and queryable
    bound_questions = list_questions_for_node(tmp_path, node_id, graph="math")
    assert qid in bound_questions


def test_binding_rejects_missing_fields_bad_ids_and_nonexistent_nodes(tmp_path: Path) -> None:
    """Binding clearly rejects invalid IDs or non-existent nodes without creating half-bindings."""
    ctx = _make_ctx(tmp_path)
    create_graph(tmp_path, "物理", slug="phys")
    create_concept_node(
        tmp_path,
        {"id": "phys/newton/first", "canonical_name": "牛顿第一定律", "node_kind": "concept"},
        graph="phys",
    )

    # 1. Missing qualified_id
    res_no_qid = tool_bind_question(ctx, {"question_qualified_id": "", "node_id": "phys/newton/first", "graph": "phys"})
    assert res_no_qid.status == "failed"
    assert res_no_qid.error_code == "invalid_arguments"

    # 2. Malformed qualified_id (no slash)
    res_bad_qid = tool_bind_question(ctx, {"question_qualified_id": "bare_question_id", "node_id": "phys/newton/first", "graph": "phys"})
    assert res_bad_qid.status == "failed"
    assert res_bad_qid.error_code == "invalid_arguments"

    # 3. Path traversal in qualified_id
    res_trav_qid = tool_bind_question(ctx, {"question_qualified_id": "物理/../etc/passwd", "node_id": "phys/newton/first", "graph": "phys"})
    assert res_trav_qid.status == "failed"
    assert res_trav_qid.error_code == "invalid_arguments"

    # 4. Target node does not exist -> rejects cleanly without half-binding
    res_not_found = tool_bind_question(ctx, {"question_qualified_id": "物理/默认/q100", "node_id": "phys/non_existent_node", "graph": "phys"})
    assert res_not_found.status == "failed"
    assert res_not_found.error_code == "not_found"

    # 5. Verify no bindings exist on the real node
    assert len(list_questions_for_node(tmp_path, "phys/newton/first", graph="phys")) == 0

    # 6. Batch binding with invalid node halts and creates NO partial bindings
    batch_res = tool_batch_bind_questions(
        ctx,
        {
            "bindings": [
                {"question_qualified_id": "物理/默认/q101", "node_id": "phys/newton/first"},
                {"question_qualified_id": "物理/默认/q102", "node_id": "phys/fake_node"},
            ],
            "graph": "phys",
        },
    )
    assert batch_res.status == "failed"
    # phys/newton/first must NOT have received q101 (all-or-nothing rollback)
    assert len(list_questions_for_node(tmp_path, "phys/newton/first", graph="phys")) == 0
