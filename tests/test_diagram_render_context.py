from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from solaire.exam_compiler.pipeline.diagram_expand import (
    DiagramRenderContext,
    expand_diagram_fences_in_text,
    prewarm_mermaid_render_batch,
)
from solaire.exam_compiler.pipeline import primebrush_expand
from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.pipeline.docx_resources import DocxResourceContext, _materialize_visuals
from solaire.exam_compiler.pipeline.hydrate import HydratedQuestion
from solaire.primebrush import parse_primebrush
from solaire.primebrush import registry as primebrush_registry


_SEEDED_PRIMEBRUSH = """primebrush:
  type: geometry_2d
  seed: 42
  canvas: { width: 200, height: 160, unit: px }
  constructions:
    - op: triangle
      id: T1
      nodes: [A, B, C]
      attr: { type: random, min_angle: 30 }
"""

_UNSEEDED_PRIMEBRUSH = _SEEDED_PRIMEBRUSH.replace("  seed: 42\n", "")


def _fence(kind: str, body: str) -> str:
    return f"```{kind}\n{body}\n```"


def _fake_mermaid(body: str, svg_path: Path) -> None:
    svg_path.parent.mkdir(parents=True, exist_ok=True)
    svg_path.write_text(f"<svg><text>{body}</text></svg>", encoding="utf-8")


def test_same_mermaid_body_renders_once_and_materializes_each_block(tmp_path: Path) -> None:
    image_dir = tmp_path / "resource" / "math" / "set" / "image"
    context = DiagramRenderContext()
    text = _fence("mermaid", "flowchart TD\n  A-->B") + "\n" + _fence("mermaid", "flowchart TD\n  A-->B")

    with patch(
        "solaire.exam_compiler.pipeline.diagram_expand.render_mermaid_to_svg_file",
        side_effect=_fake_mermaid,
    ) as render:
        out, _, next_index = expand_diagram_fences_in_text(
            text,
            image_dir=image_dir,
            mode="web",
            project_root=tmp_path,
            render_context=context,
        )

    assert render.call_count == 1
    assert next_index == 2
    assert out.count(":::MERMAID_IMG:") == 2
    assert len(list(image_dir.glob("mermaid_*.svg"))) == 2


def test_mermaid_context_rechecks_renderer_settings(tmp_path: Path, monkeypatch) -> None:
    image_dir = tmp_path / "resource" / "math" / "set" / "image"
    context = DiagramRenderContext()
    text = _fence("mermaid", "flowchart TD\n  A-->B")

    with patch(
        "solaire.exam_compiler.pipeline.diagram_expand.render_mermaid_to_svg_file",
        side_effect=_fake_mermaid,
    ) as render:
        for index, width in enumerate(("640", "800")):
            monkeypatch.setenv("SOLAIRE_MERMAID_WIDTH", width)
            expand_diagram_fences_in_text(
                text,
                image_dir=image_dir,
                mode="web",
                project_root=tmp_path,
                mermaid_start=index,
                render_context=context,
            )

    assert render.call_count == 2


def test_mermaid_batch_keeps_the_serial_png_failure_order(tmp_path: Path) -> None:
    context = DiagramRenderContext()
    image_dir = tmp_path / "image"
    bodies = ["first", "bad", "third", "fourth"]
    text = "\n".join(_fence("mermaid", body) for body in bodies)

    def fake_png(svg: str, target: Path) -> None:
        if "bad" in svg:
            raise ValueError("PNG conversion failed")
        target.write_bytes(b"png")

    with (
        patch("solaire.exam_compiler.pipeline.diagram_expand.render_mermaid_to_svg_file", _fake_mermaid),
        patch("solaire.exam_compiler.pipeline.diagram_expand._svg_to_png", fake_png),
    ):
        prewarm_mermaid_render_batch(((body, image_dir) for body in bodies), context, write_png=True)
        assert not image_dir.exists()
        with pytest.raises(ValueError, match="PNG conversion failed"):
            expand_diagram_fences_in_text(text, image_dir=image_dir, mode="latex", render_context=context)

    assert len(list(image_dir.glob("*.svg"))) == 2
    assert len(list(image_dir.glob("*.png"))) == 1


def test_seeded_primebrush_shares_svg_but_keeps_per_block_files(tmp_path: Path) -> None:
    image_dir = tmp_path / "resource" / "math" / "set" / "image"
    context = DiagramRenderContext()
    text = _fence("primebrush", _SEEDED_PRIMEBRUSH) + "\n" + _fence("primebrush", _SEEDED_PRIMEBRUSH)

    with patch.object(primebrush_expand, "primebrush_render", return_value="<svg>seeded</svg>") as render:
        out, next_index, _ = expand_diagram_fences_in_text(
            text,
            image_dir=image_dir,
            mode="web",
            project_root=tmp_path,
            render_context=context,
        )

    assert render.call_count == 1
    assert next_index == 2
    assert out.count(":::PRIMEBRUSH_IMG:") == 2
    svgs = sorted(image_dir.glob("primebrush_*.svg"))
    assert len(svgs) == 2
    assert all(path.read_text(encoding="utf-8") == "<svg>seeded</svg>" for path in svgs)


def test_render_cache_does_not_cross_library_image_directories(tmp_path: Path) -> None:
    context = DiagramRenderContext()
    text = _fence("primebrush", _SEEDED_PRIMEBRUSH)
    image_dirs = [
        tmp_path / "resource" / "math" / name / "image"
        for name in ("set-a", "set-b")
    ]

    with patch.object(primebrush_expand, "primebrush_render", return_value="<svg>shared</svg>") as render:
        for image_dir in image_dirs:
            expand_diagram_fences_in_text(
                text,
                image_dir=image_dir,
                mode="web",
                project_root=tmp_path,
                render_context=context,
            )

    assert render.call_count == 2


def test_unseeded_primebrush_and_independent_exports_render_again(tmp_path: Path) -> None:
    image_dir = tmp_path / "resource" / "math" / "set" / "image"
    text = _fence("primebrush", _UNSEEDED_PRIMEBRUSH)

    with patch.object(primebrush_expand, "primebrush_render", return_value="<svg>fresh</svg>") as render:
        expand_diagram_fences_in_text(text, image_dir=image_dir, mode="web", project_root=tmp_path)
        expand_diagram_fences_in_text(text, image_dir=image_dir, mode="web", project_root=tmp_path)

    assert render.call_count == 2


def test_custom_primebrush_plugin_is_not_render_cached(monkeypatch) -> None:
    doc = parse_primebrush(_SEEDED_PRIMEBRUSH)
    monkeypatch.setitem(primebrush_registry._BY_TYPE, "geometry_2d", object())
    assert primebrush_expand._stable_render_cache_key(doc) is None


def test_failed_mermaid_render_does_not_poison_request_cache(tmp_path: Path) -> None:
    image_dir = tmp_path / "resource" / "math" / "set" / "image"
    context = DiagramRenderContext()
    fence = _fence("mermaid", "flowchart LR\n  X-->Y")

    attempts = 0

    def fail_once_then_render(body: str, svg_path: Path) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("first attempt fails")
        _fake_mermaid(body, svg_path)

    with patch(
        "solaire.exam_compiler.pipeline.diagram_expand.render_mermaid_to_svg_file",
        side_effect=fail_once_then_render,
    ) as render:
        first, _, _ = expand_diagram_fences_in_text(
            fence,
            image_dir=image_dir,
            mode="web",
            project_root=tmp_path,
            render_context=context,
        )
        second, _, _ = expand_diagram_fences_in_text(
            fence,
            image_dir=image_dir,
            mode="web",
            project_root=tmp_path,
            render_context=context,
        )

    assert render.call_count == 2
    assert first == fence
    assert ":::MERMAID_IMG:" in second


def test_cached_diagram_rebuilds_deleted_per_block_file(tmp_path: Path) -> None:
    image_dir = tmp_path / "resource" / "math" / "set" / "image"
    context = DiagramRenderContext()
    text = _fence("mermaid", "flowchart TD\n  A-->B")

    with patch(
        "solaire.exam_compiler.pipeline.diagram_expand.render_mermaid_to_svg_file",
        side_effect=_fake_mermaid,
    ) as render:
        expand_diagram_fences_in_text(
            text,
            image_dir=image_dir,
            mode="web",
            project_root=tmp_path,
            render_context=context,
        )
        svg_path = next(image_dir.glob("mermaid_*.svg"))
        svg_path.unlink()
        expand_diagram_fences_in_text(
            text,
            image_dir=image_dir,
            mode="web",
            project_root=tmp_path,
            render_context=context,
        )

    assert render.call_count == 1
    assert svg_path.is_file()


def test_docx_export_context_reuses_seeded_render_across_block_indexes(tmp_path: Path) -> None:
    library_root = tmp_path / "resource" / "math" / "set"
    library_root.mkdir(parents=True)
    hq = HydratedQuestion("math/set/q1", object(), 1.0)
    loaded = LoadedQuestions(library_roots={"math/set": library_root})
    context = DocxResourceContext()
    media_dir = tmp_path / "exam" / "docx" / "media"
    text = _fence("primebrush", _SEEDED_PRIMEBRUSH) + "\n" + _fence("primebrush", _SEEDED_PRIMEBRUSH)

    def fake_png(_svg: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"png")

    with patch.object(primebrush_expand, "primebrush_render", return_value="<svg>same</svg>") as render, patch.object(
        primebrush_expand, "_svg_to_png", side_effect=fake_png
    ) as convert:
        materialized = _materialize_visuals(text, hq, loaded, media_dir, context=context)

    assert render.call_count == 1
    assert convert.call_count == 1
    assert materialized.count("![](") == 2
    assert len(list((library_root / "image").glob("primebrush_*.png"))) == 2
