"""Tests for Word student/teacher visual resource reuse, media caching, and golden validation."""

from __future__ import annotations

import hashlib
import shutil
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

import pytest
import yaml

from solaire.exam_compiler.pipeline import diagram_expand, docx as docx_pipeline, docx_resources, primebrush_expand
from solaire.exam_compiler.pipeline.docx import DocxResourceContext, PandocError, build_exam_docx
from solaire.web.extension_registry import resolve_exe

_MINIMAL_PRIMEBRUSH = """
primebrush:
  type: geometry_2d
  seed: 42
  canvas: { width: 200, height: 160, unit: px }
  constructions:
    - op: triangle
      id: T1
      nodes: [A, B, C]
      attr: { type: random, min_angle: 30 }
"""

_MINIMAL_MERMAID = """flowchart TD
  A[Start] --> B[End]
"""

_TEACHER_PRIMEBRUSH = """
primebrush:
  type: geometry_2d
  seed: 99
  canvas: { width: 100, height: 100, unit: px }
  constructions:
    - op: triangle
      id: T2
      nodes: [D, E, F]
      attr: { type: random, min_angle: 30 }
"""

_SECOND_PRIMEBRUSH = """
primebrush:
  type: geometry_2d
  seed: 123
  canvas: { width: 120, height: 120, unit: px }
  constructions:
    - op: triangle
      id: T3
      nodes: [X, Y, Z]
      attr: { type: random, min_angle: 45 }
"""


def _mock_png_bytes() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
        b"\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00"
        b"IEND\xaeB`\x82"
    )


def _write_comprehensive_exam_fixture(root: Path) -> Path:
    tpl = root / "templates" / "template.yaml"
    tpl.parent.mkdir(parents=True, exist_ok=True)
    tpl.write_text(
        yaml.safe_dump(
            {
                "template_id": "resource_reuse_template",
                "layout": "single_column",
                "sections": [
                    {
                        "section_id": "Choice",
                        "type": "single_choice",
                        "required_count": 2,
                        "score_per_item": 5,
                    }
                ],
                "metadata_defaults": {"school": "实验高中", "show_name_column": True},
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    # Library 1: math/set
    lib1 = root / "resource" / "math" / "set"
    lib1.mkdir(parents=True, exist_ok=True)
    (lib1 / "sample.png").write_bytes(_mock_png_bytes())
    (lib1 / "vector.svg").write_text(
        "<svg width='100' height='100'><circle cx='50' cy='50' r='40'/></svg>",
        encoding="utf-8",
    )
    (lib1 / "teacher_note.png").write_bytes(_mock_png_bytes())

    q1_content = (
        "已知集合问题：$x_1+1$ 与 $y=\\e^x+\\dlim_{n\\to\\infty} a_n+\\arccot x$\n"
        "| 列A | 列B |\n|---|---|\n| 1 | 2 |\n\n"
        "```primebrush\n" + _MINIMAL_PRIMEBRUSH.strip() + "\n```\n\n"
        "```mermaid\n" + _MINIMAL_MERMAID.strip() + "\n```\n\n"
        "插图1：:::EMBED_IMG:math/set/sample.png:::\n"
        "插图2：:::EMBED_IMG:math/set/vector.svg:::\n"
    )
    q1_analysis = (
        "详细解析如下：\n"
        "```primebrush\n" + _TEACHER_PRIMEBRUSH.strip() + "\n```\n\n"
        "教师专用补充图：:::EMBED_IMG:math/set/teacher_note.png:::\n"
    )

    (lib1 / "q1.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q1",
                "type": "single_choice",
                "content": q1_content,
                "options": {"A": "$1$", "B": "$2$"},
                "answer": "A",
                "analysis": q1_analysis,
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    # Library 2: math/geometry (to verify library isolation)
    lib2 = root / "resource" / "math" / "geometry"
    lib2.mkdir(parents=True, exist_ok=True)
    q2_content = (
        "几何综合题：包含两个连续 PrimeBrush 块（验证同一题内不同 block index 隔离）：\n"
        "```primebrush\n" + _MINIMAL_PRIMEBRUSH.strip() + "\n```\n\n"
        "```primebrush\n" + _SECOND_PRIMEBRUSH.strip() + "\n```\n"
    )
    (lib2 / "q2.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q2",
                "type": "single_choice",
                "content": q2_content,
                "options": {"A": "$x_1$", "B": "$x_2$"},
                "answer": "B",
                "analysis": "无解析",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    exam_yaml = root / "exam.yaml"
    exam_yaml.write_text(
        yaml.safe_dump(
            {
                "exam_id": "resource_reuse_exam",
                "template_ref": "resource_reuse_template",
                "template_path": "templates/template.yaml",
                "metadata": {"title": "数学调研卷", "subject": "数学"},
                "question_libraries": [
                    {"namespace": "math/set", "path": "resource/math/set"},
                    {"namespace": "math/geometry", "path": "resource/math/geometry"},
                ],
                "selected_items": [
                    {"section_id": "Choice", "question_ids": ["math/set/q1", "math/geometry/q2"]}
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return exam_yaml


def test_diagram_reuse_shared_diagram_materialized_once_and_teacher_isolated(tmp_path: Path) -> None:
    exam_yaml = _write_comprehensive_exam_fixture(tmp_path)

    counts = {
        "ensure_primebrush": 0,
        "ensure_mermaid": 0,
        "primebrush_render": 0,
        "render_mermaid": 0,
        "svg_to_png": 0,
        "shutil_copy2": 0,
    }

    orig_ensure_pb = primebrush_expand.ensure_primebrush_block_files

    def spy_ensure_pb(*args, **kwargs):
        counts["ensure_primebrush"] += 1
        return orig_ensure_pb(*args, **kwargs)

    orig_ensure_mm = diagram_expand.ensure_mermaid_block_files

    def spy_ensure_mm(*args, **kwargs):
        counts["ensure_mermaid"] += 1
        return orig_ensure_mm(*args, **kwargs)

    orig_pb_render = primebrush_expand.primebrush_render

    def spy_pb_render(*args, **kwargs):
        counts["primebrush_render"] += 1
        return orig_pb_render(*args, **kwargs)

    def fake_render_mermaid(body: str, svg_path: Path):
        counts["render_mermaid"] += 1
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text(f"<svg><text>{body[:10]}</text></svg>", encoding="utf-8")

    def fake_svg_to_png(svg: str, png_path: Path):
        counts["svg_to_png"] += 1
        png_path.parent.mkdir(parents=True, exist_ok=True)
        png_path.write_bytes(_mock_png_bytes())

    orig_copy2 = shutil.copy2

    def spy_copy2(src, dst, **kwargs):
        counts["shutil_copy2"] += 1
        return orig_copy2(src, dst, **kwargs)

    out_dir = tmp_path / "out"

    with patch.object(primebrush_expand, "ensure_primebrush_block_files", spy_ensure_pb), \
         patch.object(docx_resources, "ensure_primebrush_block_files", spy_ensure_pb), \
         patch.object(diagram_expand, "ensure_mermaid_block_files", spy_ensure_mm), \
         patch.object(docx_resources, "ensure_mermaid_block_files", spy_ensure_mm), \
         patch.object(primebrush_expand, "primebrush_render", spy_pb_render), \
         patch.object(diagram_expand, "render_mermaid_to_svg_file", fake_render_mermaid), \
         patch.object(primebrush_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(docx_resources, "_svg_to_png", fake_svg_to_png), \
         patch.object(shutil, "copy2", spy_copy2), \
         patch.object(docx_pipeline, "_run_pandoc", lambda md, out: out.write_bytes(b"mock docx")):

        student_docx, teacher_docx = build_exam_docx(exam_yaml, out_dir)

    assert student_docx.is_file()
    assert teacher_docx.is_file()

    work = tmp_path / "exam" / "docx"
    student_md = (work / "student_paper.md").read_text(encoding="utf-8")
    teacher_md = (work / "teacher_paper.md").read_text(encoding="utf-8")

    # In student pass:
    #   q1 has 1 pb, 1 mm.
    #   q2 has 2 pb (block 0 and block 1).
    #   Total pb in student = 3. Total mm in student = 1.
    # In teacher pass:
    #   q1 common pb and mm are reused (0 pb, 0 mm).
    #   q1 analysis has 1 teacher-only pb (rendered 1 time).
    #   q2 common pb (block 0 and block 1) are reused (0 pb).
    # Expected:
    #   ensure_primebrush: 3 in student + 1 teacher-only = 4 total (NOT 3*2+1=7!)
    #   primebrush_render: 4 total (NOT 7!)
    #   ensure_mermaid: 1 total (NOT 2!)
    #   render_mermaid: 1 total (NOT 2!)
    assert counts["ensure_primebrush"] == 4
    assert counts["primebrush_render"] == 4
    assert counts["ensure_mermaid"] == 1
    assert counts["render_mermaid"] == 1

    # Verify teacher-only diagram is isolated:
    # Teacher pb has seed 99 -> check stem pattern
    # In student MD: no answer, no analysis, no teacher-only image
    assert "【答案】" not in student_md
    assert "【解析】" not in student_md
    assert "详细解析如下" not in student_md
    assert "教师专用补充图" not in student_md

    # In teacher MD: has answer, analysis, and teacher-only image
    assert "【答案】" in teacher_md
    assert "【解析】" in teacher_md
    assert "详细解析如下" in teacher_md
    assert "教师专用补充图" in teacher_md

    # Verify common diagram Markdown paths match exactly in student and teacher
    # Extract image links from student_md and check they are present in teacher_md
    for line in student_md.splitlines():
        if "![](" in line:
            assert line in teacher_md


def test_media_reuse_embed_and_diagram_media_copy_reduced(tmp_path: Path) -> None:
    exam_yaml = _write_comprehensive_exam_fixture(tmp_path)

    copy_calls: list[tuple[str, str]] = []
    svg_convert_calls: list[str] = []

    orig_copy2 = shutil.copy2

    def spy_copy2(src, dst, **kwargs):
        copy_calls.append((str(Path(src).resolve()), str(Path(dst).resolve())))
        return orig_copy2(src, dst, **kwargs)

    def fake_svg_to_png(svg: str, png_path: Path):
        svg_convert_calls.append(str(Path(png_path).resolve()))
        png_path.parent.mkdir(parents=True, exist_ok=True)
        png_path.write_bytes(_mock_png_bytes())

    def fake_render_mermaid(body: str, svg_path: Path):
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text("<svg></svg>", encoding="utf-8")

    out_dir = tmp_path / "out"

    with patch.object(primebrush_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(docx_resources, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "render_mermaid_to_svg_file", fake_render_mermaid), \
         patch.object(shutil, "copy2", spy_copy2), \
         patch.object(docx_pipeline, "_run_pandoc", lambda md, out: out.write_bytes(b"mock docx")):

        build_exam_docx(exam_yaml, out_dir)

    work = tmp_path / "exam" / "docx"
    media_dir = work / "media"
    assert media_dir.is_dir()

    # Find copies into media_dir
    media_copies = [dst for _src, dst in copy_calls if str(media_dir) in dst]
    # Each unique destination file in media_dir should be copied at most once!
    assert len(media_copies) == len(set(media_copies))

    # SVG conversions into media_dir:
    svg_media_conversions = [dst for dst in svg_convert_calls if str(media_dir) in dst]
    assert len(svg_media_conversions) == len(set(svg_media_conversions))

    # vector.svg was converted to vector_*.png in media_dir exactly once
    assert len(svg_media_conversions) == 1


def test_independent_exports_have_isolated_resource_contexts(tmp_path: Path) -> None:
    exam_yaml = _write_comprehensive_exam_fixture(tmp_path)

    counts = {"ensure_pb": 0}

    orig_ensure_pb = primebrush_expand.ensure_primebrush_block_files

    def spy_ensure_pb(*args, **kwargs):
        counts["ensure_pb"] += 1
        return orig_ensure_pb(*args, **kwargs)

    def fake_svg_to_png(svg: str, png_path: Path):
        png_path.parent.mkdir(parents=True, exist_ok=True)
        png_path.write_bytes(_mock_png_bytes())

    def fake_render_mermaid(body: str, svg_path: Path):
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text("<svg></svg>", encoding="utf-8")

    out1 = tmp_path / "out1"
    out2 = tmp_path / "out2"

    with patch.object(primebrush_expand, "ensure_primebrush_block_files", spy_ensure_pb), \
         patch.object(docx_resources, "ensure_primebrush_block_files", spy_ensure_pb), \
         patch.object(primebrush_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(docx_resources, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "render_mermaid_to_svg_file", fake_render_mermaid), \
         patch.object(docx_pipeline, "_run_pandoc", lambda md, out: out.write_bytes(b"mock docx")):

        # Run 1st export
        build_exam_docx(exam_yaml, out1)
        run1_count = counts["ensure_pb"]
        assert run1_count == 4

        # Run 2nd export with clean_workdir=False
        # Context must NOT carry over across exports:
        build_exam_docx(exam_yaml, out2)
        run2_total = counts["ensure_pb"]
        # The second run must do its own 4 materializations, not 0 from leftover context
        assert run2_total == run1_count + 4


def test_docx_content_pandoc_failure_preserves_dest_and_no_partial_publish(tmp_path: Path) -> None:
    exam_yaml = _write_comprehensive_exam_fixture(tmp_path)

    dest = tmp_path / "final_dest"
    dest.mkdir(parents=True)
    old_student = dest / "student_paper.docx"
    old_teacher = dest / "teacher_paper.docx"
    old_student.write_bytes(b"existing_student_content")
    old_teacher.write_bytes(b"existing_teacher_content")
    student_sha_before = hashlib.sha256(old_student.read_bytes()).hexdigest()
    teacher_sha_before = hashlib.sha256(old_teacher.read_bytes()).hexdigest()

    def fake_svg_to_png(svg: str, png_path: Path):
        png_path.parent.mkdir(parents=True, exist_ok=True)
        png_path.write_bytes(_mock_png_bytes())

    def fake_render_mermaid(body: str, svg_path: Path):
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text("<svg></svg>", encoding="utf-8")

    # Inject failure on the second volume (teacher docx) during pandoc
    def failing_pandoc(md_path: Path, docx_path: Path, **kwargs):
        if "student" in md_path.name:
            docx_path.write_bytes(b"new_student_docx")
        else:
            raise PandocError("Simulated Pandoc failure on teacher paper")

    with patch.object(primebrush_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(docx_resources, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "render_mermaid_to_svg_file", fake_render_mermaid), \
         patch.object(docx_pipeline, "_run_pandoc", failing_pandoc):

        with pytest.raises(PandocError, match="Simulated Pandoc failure"):
            build_exam_docx(exam_yaml, dest)

    # Output destination must NOT have partial new product!
    # Both old files must remain byte-identical!
    assert hashlib.sha256(old_student.read_bytes()).hexdigest() == student_sha_before
    assert hashlib.sha256(old_teacher.read_bytes()).hexdigest() == teacher_sha_before


def test_docx_content_resource_rendering_failure_preserves_dest(tmp_path: Path) -> None:
    exam_yaml = _write_comprehensive_exam_fixture(tmp_path)

    dest = tmp_path / "final_dest"
    dest.mkdir(parents=True)
    old_student = dest / "student_paper.docx"
    old_teacher = dest / "teacher_paper.docx"
    old_student.write_bytes(b"existing_student")
    old_teacher.write_bytes(b"existing_teacher")

    def failing_ensure_pb(*args, **kwargs):
        raise RuntimeError("Simulated PrimeBrush renderer crash")

    with patch.object(docx_resources, "ensure_primebrush_block_files", failing_ensure_pb):
        with pytest.raises(RuntimeError, match="Simulated PrimeBrush renderer crash"):
            build_exam_docx(exam_yaml, dest)

    # Destination directory must remain unchanged
    assert old_student.read_bytes() == b"existing_student"
    assert old_teacher.read_bytes() == b"existing_teacher"


def test_docx_content_resource_layer_semantic_golden_markdown(tmp_path: Path) -> None:
    """Resource layer semantic golden check: verifies formulas, tables, and visibility."""
    exam_yaml = _write_comprehensive_exam_fixture(tmp_path)

    def fake_svg_to_png(svg: str, png_path: Path):
        png_path.parent.mkdir(parents=True, exist_ok=True)
        png_path.write_bytes(_mock_png_bytes())

    def fake_render_mermaid(body: str, svg_path: Path):
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text("<svg></svg>", encoding="utf-8")

    out_dir = tmp_path / "out"

    with patch.object(primebrush_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(docx_resources, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "render_mermaid_to_svg_file", fake_render_mermaid), \
         patch.object(docx_pipeline, "_run_pandoc", lambda md, out: out.write_bytes(b"mock docx")):

        build_exam_docx(exam_yaml, out_dir)

    work = tmp_path / "exam" / "docx"
    student_md = (work / "student_paper.md").read_text(encoding="utf-8")
    teacher_md = (work / "teacher_paper.md").read_text(encoding="utf-8")

    # Math formulas normalized
    assert r"\mathrm{e}^x" in student_md
    assert r"\displaystyle\lim_{n\to\infty}" in student_md
    assert r"\operatorname{arccot}" in student_md
    assert r"\e^x" not in student_md

    # Table preserved
    assert "| 列A | 列B |" in student_md
    assert "|---|---|" in student_md

    # Header metadata
    assert "# 数学调研卷" in student_md
    assert "实验高中" in student_md
    assert "**科目：** 数学" in student_md

    # Answer visibility
    assert "【答案】" not in student_md
    assert "【解析】" not in student_md
    assert "**【答案】** A" in teacher_md
    assert "**【解析】**" in teacher_md


def test_docx_content_real_pandoc_golden_docx_structure(tmp_path: Path) -> None:
    """
    End-to-end golden verification against real Pandoc output.
    Requires the real Word converter and the Mermaid renderer used by the fixture.
    """
    pandoc_exe = shutil.which("pandoc") or resolve_exe("pandoc", "pandoc")
    if not pandoc_exe:
        pytest.skip("Real Pandoc executable is not installed in the environment (reported integration threshold)")
    from solaire.exam_compiler.pipeline.mermaid_expand import _find_mmdr

    if not _find_mmdr():
        pytest.skip("Real Mermaid renderer (mmdr) is not installed for the DOCX golden fixture")

    exam_yaml = _write_comprehensive_exam_fixture(tmp_path)
    out_dir = tmp_path / "out"

    student_docx, teacher_docx = build_exam_docx(exam_yaml, out_dir)

    assert student_docx.is_file()
    assert teacher_docx.is_file()

    def inspect_docx(docx_file: Path) -> tuple[str, list[str], list[str]]:
        with zipfile.ZipFile(docx_file, "r") as z:
            doc_xml = z.read("word/document.xml").decode("utf-8")
            rels_xml = z.read("word/_rels/document.xml.rels").decode("utf-8")
            media_entries = [name for name in z.namelist() if name.startswith("word/media/")]
        return doc_xml, rels_xml, media_entries

    s_xml, s_rels, s_media = inspect_docx(student_docx)
    t_xml, t_rels, t_media = inspect_docx(teacher_docx)

    # 1. Semantic golden: both volumes have document body, tables, and drawing
    assert "<w:document" in s_xml
    assert "<w:document" in t_xml
    assert "<w:tbl" in s_xml  # table entered actual Word body
    assert "<w:tbl" in t_xml
    assert "<w:drawing" in s_xml  # images entered actual Word body
    assert "<w:drawing" in t_xml

    # 2. Both docx files contain media entries
    assert len(s_media) > 0
    assert len(t_media) > 0

    # 3. Student docx does not contain answer/analysis text
    assert "【答案】" not in s_xml
    assert "【解析】" not in s_xml

    # 4. Teacher docx contains answer/analysis text
    assert "【答案】" in t_xml
    assert "【解析】" in t_xml


def test_user_perspective_complete_workflow(tmp_path: Path) -> None:
    """
    User-perspective end-to-end testing:
    1. Teacher creates realistic exam with math, diagrams, images, choices, and missing image tolerance.
    2. Student and teacher papers exported without crashes; no answer leakage in student paper.
    3. All referenced media files exist and are readable.
    4. Teacher modifies a question and re-exports; changes are immediately reflected without stale cache.
    5. Exported files can be queried via result service and downloaded via Web API.
    """
    from fastapi.testclient import TestClient
    from solaire.web.app import app
    from solaire.web.exam_service import export_docx
    from solaire.web.result_service import find_exported_docx_path
    import solaire.web.state as st
    from solaire.web import recent_projects
    import solaire.web.routers.exams as exams_router
    from solaire.exam_compiler.loaders.template_loader import load_template

    def fake_svg_to_png(svg: str, png_path: Path):
        png_path.parent.mkdir(parents=True, exist_ok=True)
        png_path.write_bytes(_mock_png_bytes())

    def fake_render_mermaid(body: str, svg_path: Path):
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text(f"<svg><text>{body[:20]}</text></svg>", encoding="utf-8")

    def fake_run_pandoc(md_path: Path, docx_path: Path, *, pandoc_path=None, reference_docx=None):
        docx_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
            text = md_path.read_text(encoding="utf-8")
            escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            z.writestr("word/document.xml", f"<w:document><w:body><w:p><w:r><w:t>{escaped}</w:t></w:r></w:p></w:body></w:document>")
            z.writestr("word/_rels/document.xml.rels", "<Relationships></Relationships>")
            z.writestr("[Content_Types].xml", "<Types></Types>")

    root = tmp_path.resolve()
    templates_dir = root / "templates"
    templates_dir.mkdir(parents=True)
    tpl_file = templates_dir / "user_tpl.yaml"
    tpl_file.write_text(
        yaml.safe_dump(
            {
                "template_id": "user_tpl",
                "layout": "single_column",
                "sections": [
                    {
                        "section_id": "ChoiceSec",
                        "type": "single_choice",
                        "required_count": 2,
                        "score_per_item": 5,
                    }
                ],
                "metadata_defaults": {
                    "school": "实验中学",
                    "show_name_column": True,
                    "preamble_notices": "请在答题卡上作答。"
                },
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    math_lib = root / "resource" / "math"
    math_lib.mkdir(parents=True)
    (math_lib / "chart.png").write_bytes(_mock_png_bytes())
    (math_lib / "graph.svg").write_text("<svg><circle cx='50' cy='50' r='40'/></svg>", encoding="utf-8")
    (math_lib / "teacher_expl.png").write_bytes(_mock_png_bytes())

    q1_content = (
        "设函数 $f(x)=\\e^x+\\dlim_{x\\to 0}\\frac{\\sin x}{x}$。\n"
        "```primebrush\n"
        "primebrush:\n"
        "  type: geometry_2d\n"
        "  seed: 101\n"
        "  canvas: { width: 250, height: 200, unit: px }\n"
        "  constructions:\n"
        "    - op: triangle\n"
        "      id: T1\n"
        "      nodes: [A, B, C]\n"
        "      attr: { type: random, min_angle: 30 }\n"
        "```\n"
        "参考图：:::EMBED_IMG:math/chart.png:::\n"
    )
    q1_analysis = (
        "【解法分析】结合图像分析：\n"
        "```primebrush\n"
        "primebrush:\n"
        "  type: geometry_2d\n"
        "  seed: 888\n"
        "  canvas: { width: 250, height: 200, unit: px }\n"
        "  constructions:\n"
        "    - op: triangle\n"
        "      id: T2\n"
        "      nodes: [D, E, F]\n"
        "      attr: { type: random, min_angle: 30 }\n"
        "```\n"
        "解析图：:::EMBED_IMG:math/teacher_expl.png:::\n"
    )
    (math_lib / "q1.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q1",
                "type": "single_choice",
                "content": q1_content,
                "options": {"A": "$\\sqrt{2}$", "B": "$2\\sqrt{2}$"},
                "answer": "B",
                "analysis": q1_analysis,
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    q2_file = math_lib / "q2.yaml"
    q2_file.write_text(
        yaml.safe_dump(
            {
                "id": "q2",
                "type": "single_choice",
                "content": "程序流程图：\n```mermaid\nflowchart TD\n  Start --> End\n```\n矢量图：:::EMBED_IMG:math/graph.svg:::\n容错缺图：:::EMBED_IMG:math/nonexistent.png:::",
                "options": {"A": "1", "B": "2"},
                "answer": "A",
                "analysis": "无特殊解析",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    exam_yaml = root / ".solaire" / "build.yaml"
    exam_yaml.parent.mkdir(parents=True)
    exam_yaml.write_text(
        yaml.safe_dump(
            {
                "exam_id": "math_final_user_test",
                "template_ref": "user_tpl",
                "template_path": "../templates/user_tpl.yaml",
                "metadata": {
                    "title": "高三调研数学卷",
                    "subject": "数学",
                    "school": "实验中学",
                },
                "question_libraries": [{"namespace": "math", "path": "../resource/math"}],
                "selected_items": [
                    {"section_id": "ChoiceSec", "question_ids": ["math/q1", "math/q2"]}
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    dest_dir = root / "exams" / "Exam2026" / "Math"
    dest_dir.mkdir(parents=True)

    with patch.object(primebrush_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "_svg_to_png", fake_svg_to_png), \
         patch.object(docx_resources, "_svg_to_png", fake_svg_to_png), \
         patch.object(diagram_expand, "render_mermaid_to_svg_file", fake_render_mermaid), \
         patch.object(docx_pipeline, "_run_pandoc", fake_run_pandoc):

        # 1. Export documents via export_docx service
        template = load_template(tpl_file)
        result_dir, s_name, t_name = export_docx(
            root,
            exam_yaml=exam_yaml,
            export_label="Exam2026",
            subject="Math",
            template=template,
            dest_dir=dest_dir,
        )

        assert (dest_dir / s_name).is_file()
        assert (dest_dir / t_name).is_file()

        # 2. Check student paper has no leaked answer and teacher paper has full answer
        work = root / ".solaire" / "build" / "docx"
        student_md = (work / "student_paper.md").read_text(encoding="utf-8")
        teacher_md = (work / "teacher_paper.md").read_text(encoding="utf-8")

        assert "【答案】" not in student_md
        assert "【解法分析】" not in student_md
        assert "**【答案】** B" in teacher_md
        assert "**【解析】**" in teacher_md

        # 3. Check media files exist on disk
        import re
        img_refs = re.findall(r"!\[\]\((media/[^)]+)\)", student_md)
        assert len(img_refs) >= 3
        for ref in img_refs:
            assert (work / ref).is_file()

        # 4. Teacher modifies q2 and re-exports: verify cache does not use stale content
        q2_file.write_text(
            yaml.safe_dump(
                {
                    "id": "q2",
                    "type": "single_choice",
                    "content": "修改后第二题题干",
                    "options": {"A": "10", "B": "20"},
                    "answer": "B",
                }
            ),
            encoding="utf-8",
        )
        export_docx(
            root,
            exam_yaml=exam_yaml,
            export_label="Exam2026",
            subject="Math",
            template=template,
            dest_dir=dest_dir,
        )
        updated_student_md = (work / "student_paper.md").read_text(encoding="utf-8")
        assert "修改后第二题题干" in updated_student_md
        assert "程序流程图" not in updated_student_md

        # 5. Verify user download & open via API
        s_found = find_exported_docx_path(root, "Exam2026/Math", variant="student")
        t_found = find_exported_docx_path(root, "Exam2026/Math", variant="teacher")
        assert s_found == dest_dir / s_name
        assert t_found == dest_dir / t_name

        with patch.object(st, "get_root", lambda: root), \
             patch.object(recent_projects, "app_data_dir", lambda: root / "appdata"):

            client = TestClient(app)
            resp_s = client.get("/api/exams/Exam2026%2FMath/docx-file?variant=student")
            assert resp_s.status_code == 200
            assert "wordprocessingml.document" in resp_s.headers["content-type"]
            assert len(resp_s.content) > 0

            resp_t = client.get("/api/exams/Exam2026%2FMath/docx-file?variant=teacher")
            assert resp_t.status_code == 200
            assert "wordprocessingml.document" in resp_t.headers["content-type"]
            assert len(resp_t.content) > 0

            opened: list[Path] = []
            with patch.object(exams_router, "open_docx_with_default_app", lambda p: opened.append(p)):
                resp_open = client.post("/api/exams/Exam2026%2FMath/open-docx", json={"variant": "teacher"})
                assert resp_open.status_code == 200
                assert opened and opened[0].name == t_name
