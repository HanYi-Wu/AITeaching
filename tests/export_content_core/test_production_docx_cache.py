from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.models.question import QuestionItem
from solaire.exam_compiler.pipeline import docx_resources
from solaire.exam_compiler.pipeline.docx_resources import (
    DocxResourceContext,
    _clean_latex_for_markdown,
    _materialize_visuals,
    _normalize_docx_math_macros,
    _render_text,
)
from solaire.exam_compiler.pipeline.hydrate import HydratedQuestion
from solaire.exam_compiler.pipeline.table_expand import (
    expand_tables_for_docx_markdown,
    separate_markdown_tables,
)


def _loaded_project(root: Path, image: bytes) -> LoadedQuestions:
    namespace = "math/set"
    library_root = root / "resource" / namespace
    library_root.mkdir(parents=True, exist_ok=True)
    embedded = root / "resource" / "shared.png"
    embedded.parent.mkdir(parents=True, exist_ok=True)
    embedded.write_bytes(image)

    loaded = LoadedQuestions()
    loaded.library_roots[namespace] = library_root
    return loaded


def _question(text: str) -> HydratedQuestion:
    return HydratedQuestion(
        qualified_id="math/set/q1",
        item=QuestionItem(
            id="q1",
            type="single_choice",
            content=text,
            answer="A",
            analysis="",
            options={"A": "Choice A", "B": "Choice B"},
        ),
        item_score=1.0,
    )


def _legacy_render_text(
    text: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
) -> str:
    """Baseline _render_text composition, kept as a local output oracle."""
    visuals = _materialize_visuals(text, hq, loaded, media_dir)
    tables = expand_tables_for_docx_markdown(visuals)
    cleaned = _clean_latex_for_markdown(tables)
    normalized = _normalize_docx_math_macros(cleaned)
    return separate_markdown_tables(normalized)


def test_production_render_cache_matches_legacy_output(tmp_path: Path) -> None:
    loaded = _loaded_project(tmp_path, b"image bytes")
    hq = _question(
        "Header  \r\n"
        "$\\textbf{A} + \\e^x$ before image\n"
        ":::EMBED_IMG:shared.png:::\n"
        "```solaire-table\n"
        "version: 1\n"
        "rows:\n"
        "  - - text: 'left'\n"
        "    - text: 'right'\n"
        "```\n"
        "After table: $\\dlim_{n\\to\\infty} a_n$"
    )
    media_dir = tmp_path / "docx" / "media"
    media_dir.mkdir(parents=True)

    expected = _legacy_render_text(hq.item.content, hq, loaded, media_dir)
    context = DocxResourceContext()
    original = docx_resources._materialize_visuals
    with patch.object(docx_resources, "_materialize_visuals", wraps=original) as materialize:
        first = _render_text(hq.item.content, hq, loaded, media_dir, context=context)
        second = _render_text(hq.item.content, hq, loaded, media_dir, context=context)

    assert first == expected
    assert second == expected
    assert materialize.call_count == 2


def test_render_cache_does_not_cross_library_scope(tmp_path: Path) -> None:
    project_a = tmp_path / "project-a"
    project_b = tmp_path / "project-b"
    loaded_a = _loaded_project(project_a, b"project A image")
    loaded_b = _loaded_project(project_b, b"project B image")
    hq_a = _question(":::EMBED_IMG:shared.png:::")
    hq_b = _question(":::EMBED_IMG:shared.png:::")
    media_dir = tmp_path / "docx" / "media"
    media_dir.mkdir(parents=True)
    context = DocxResourceContext()

    rendered_a = _render_text(hq_a.item.content, hq_a, loaded_a, media_dir, context=context)
    rendered_b = _render_text(hq_b.item.content, hq_b, loaded_b, media_dir, context=context)

    assert rendered_a != rendered_b
    assert len(list(media_dir.glob("shared_*.png"))) == 2


def test_render_cache_has_a_per_export_memory_cap(tmp_path: Path) -> None:
    loaded = LoadedQuestions()
    hq = _question("plain text")
    media_dir = tmp_path / "docx" / "media"
    media_dir.mkdir(parents=True)
    context = DocxResourceContext()

    for index in range(350):
        text = f"field {index}: " + ("x" * 8192)
        _render_text(text, hq, loaded, media_dir, context=context)

    assert len(context._rendered_text_cache) < 4096
    assert context._rendered_text_cache_bytes <= docx_resources._RENDERED_TEXT_CACHE_MAX_BYTES
    assert context._rendered_text_cache_bytes > 3 * 1024 * 1024


def test_missing_embed_is_materialized_when_the_file_arrives(tmp_path: Path) -> None:
    loaded = _loaded_project(tmp_path, b"image bytes")
    source = tmp_path / "resource" / "shared.png"
    source.unlink()
    text = "Before :::EMBED_IMG:shared.png::: after"
    hq = _question(text)
    media_dir = tmp_path / "docx" / "media"
    media_dir.mkdir(parents=True)
    context = DocxResourceContext()

    assert ":::EMBED_IMG:" in _render_text(text, hq, loaded, media_dir, context=context)
    source.write_bytes(b"arrived image")
    rendered = _render_text(text, hq, loaded, media_dir, context=context)
    assert ":::EMBED_IMG:" not in rendered
    assert [path.read_bytes() for path in media_dir.glob("*.png")] == [b"arrived image"]


def test_removed_export_media_is_recreated_in_the_same_context(tmp_path: Path) -> None:
    loaded = _loaded_project(tmp_path, b"image bytes")
    text = ":::EMBED_IMG:shared.png:::"
    hq = _question(text)
    media_dir = tmp_path / "docx" / "media"
    media_dir.mkdir(parents=True)
    context = DocxResourceContext()

    first = _render_text(text, hq, loaded, media_dir, context=context)
    media = list(media_dir.glob("*.png"))
    assert len(media) == 1
    media[0].unlink()
    assert _render_text(text, hq, loaded, media_dir, context=context) == first
    assert media[0].read_bytes() == b"image bytes"
