"""Expand ```primebrush fenced blocks: render SVG + PNG under library image/, replace body for LaTeX or Web."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from solaire.primebrush.api import parse_primebrush, render as primebrush_render

if TYPE_CHECKING:
    from solaire.exam_compiler.loaders.questions import LoadedQuestions
    from solaire.exam_compiler.pipeline.hydrate import HydratedExam
    from solaire.exam_compiler.pipeline.diagram_expand import DiagramRenderContext

_CAIROSVG_HINT = (
    "PrimeBrush 插图需要 SVG 转 PNG（供 LaTeX 使用）。请安装：pip install 'solaire-education[primebrush-pdf]'"
    " 或 pip install cairosvg"
)


def _norm_yaml_for_hash(body: str) -> str:
    return body.strip().replace("\r\n", "\n")


def _block_stem(body: str, block_index: int) -> str:
    h = hashlib.sha256(_norm_yaml_for_hash(body).encode("utf-8")).hexdigest()[:16]
    return f"primebrush_{h}_{block_index}"


def _svg_to_png(svg: str, png_path: Path) -> None:
    try:
        import cairosvg  # type: ignore[import-untyped]
    except ImportError as e:
        raise RuntimeError(_CAIROSVG_HINT) from e
    png_path.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(png_path))


def _stable_render_cache_key(doc: object) -> tuple[str, str] | None:
    """Restrict sharing to seeded built-in scenes with reproducible renderers."""
    kind = getattr(doc, "type", None)
    seed = getattr(doc, "seed", None)
    if kind not in {"geometry_2d", "plot_2D", "chart"} or seed is None:
        return None
    from solaire.primebrush.plugins.chart_plugin import ChartPlugin
    from solaire.primebrush.plugins.geometry_2d_plugin import Geometry2dPlugin
    from solaire.primebrush.plugins.plot_2d_plugin import Plot2dPlugin
    from solaire.primebrush.registry import get_plugin_for_doc

    expected_plugin = {
        "geometry_2d": Geometry2dPlugin,
        "plot_2D": Plot2dPlugin,
        "chart": ChartPlugin,
    }[kind]
    if type(get_plugin_for_doc(doc)) is not expected_plugin:
        return None
    return str(kind), doc.model_dump_json()  # type: ignore[attr-defined,no-any-return]


def _resource_rel_posix(image_dir: Path, project_root: Path) -> str:
    """Path under resource/ for Web URLs, e.g. 数学/模拟题/image/foo.svg"""
    img = image_dir.resolve()
    res = (project_root / "resource").resolve()
    rel = img.relative_to(res)
    return rel.as_posix()


def ensure_primebrush_block_files(
    body: str,
    *,
    image_dir: Path,
    block_index: int,
    write_png: bool,
    render_cache: dict[tuple[str, str, str], str] | None = None,
    png_cache: dict[tuple[str, str, str], bytes] | None = None,
) -> tuple[str, str]:
    """
    Render one fenced body to SVG (+ optional PNG). Returns (svg_stem, png_filename).
    """
    stem = _block_stem(body, block_index)
    image_dir.mkdir(parents=True, exist_ok=True)
    svg_path = image_dir / f"{stem}.svg"
    png_path = image_dir / f"{stem}.png"

    doc = parse_primebrush(body.strip())
    stable_key = _stable_render_cache_key(doc)
    cache_key = (*stable_key, str(image_dir.resolve())) if stable_key is not None else None
    svg = render_cache.get(cache_key) if cache_key is not None and render_cache is not None else None
    if svg is None:
        svg = primebrush_render(doc)
        if cache_key is not None and render_cache is not None:
            render_cache[cache_key] = svg
    svg_path.write_text(svg, encoding="utf-8")
    if write_png:
        png = png_cache.get(cache_key) if cache_key is not None and png_cache is not None else None
        if png is not None:
            png_path.write_bytes(png)
        else:
            _svg_to_png(svg, png_path)
            if cache_key is not None and png_cache is not None:
                png_cache[cache_key] = png_path.read_bytes()
    return stem, f"{stem}.png"


def expand_primebrush_in_text(
    text: str,
    *,
    image_dir: Path,
    mode: Literal["latex", "web"],
    project_root: Path | None = None,
    starting_block_index: int = 0,
    render_context: DiagramRenderContext | None = None,
) -> tuple[str, int]:
    """Replace ```primebrush``` and ```mermaid``` blocks (see diagram_expand)."""
    from solaire.exam_compiler.pipeline.diagram_expand import expand_diagram_fences_in_text

    out, pi, _mi = expand_diagram_fences_in_text(
        text,
        image_dir=image_dir,
        mode=mode,
        project_root=project_root,
        primebrush_start=starting_block_index,
        mermaid_start=0,
        mermaid_pdf=None,
        primebrush_pdf=None,
        render_context=render_context,
    )
    return out, pi


def strip_primebrush_fences_for_preview(text: str, max_len: int = 200) -> str:
    """Remove fenced primebrush / mermaid blocks for one-line style previews."""
    from solaire.exam_compiler.pipeline.diagram_expand import strip_diagram_fences_for_preview

    return strip_diagram_fences_for_preview(text, max_len=max_len)


def expand_hydrated_for_latex(hydrated: HydratedExam, loaded: LoadedQuestions) -> None:
    """Mutate question items in place: ```primebrush``` / ```mermaid``` → \\includegraphics; writes under each library's image/."""
    from solaire.exam_compiler.pipeline.diagram_expand import (
        expand_diagram_fences_in_text,
        expand_embed_img_markers_in_text,
        DiagramRenderContext,
        iter_mermaid_render_requests,
        mermaid_pdf_options_from_metadata,
        primebrush_pdf_options_from_metadata,
        prewarm_mermaid_render_batch,
        project_root_from_library_root,
    )
    from solaire.exam_compiler.pipeline.table_expand import expand_tables_for_latex
    from solaire.exam_compiler.qualified_id import namespace_of_qualified

    mermaid_pdf = mermaid_pdf_options_from_metadata(hydrated.metadata)
    primebrush_pdf = primebrush_pdf_options_from_metadata(hydrated.metadata)
    render_context = DiagramRenderContext()

    def mermaid_requests():
        from solaire.common.answer_logic import display as display_answer
        from solaire.exam_compiler.qualified_id import namespace_of_qualified

        for section in hydrated.sections:
            for hq in section.questions:
                namespace = namespace_of_qualified(hq.qualified_id)
                library_root = loaded.library_roots.get(namespace)
                if library_root is None:
                    continue
                image_dir = library_root / "image"
                q = hq.item
                fields = (
                    q.content,
                    display_answer(q.answer),
                    q.analysis or "",
                    *(q.options.values() if q.options else ()),
                    q.group_material or "",
                )
                for field in fields:
                    yield from iter_mermaid_render_requests(field, image_dir)

    prewarm_mermaid_render_batch(
        mermaid_requests(),
        render_context,
        write_png=True,
    )
    # Export-local only: the next render resolves each library root afresh.
    project_roots: dict[Path, Path] = {}
    for sec in hydrated.sections:
        for hq in sec.questions:
            ns = namespace_of_qualified(hq.qualified_id)
            root = loaded.library_roots.get(ns)
            if root is None:
                continue
            image_dir = root / "image"
            if root not in project_roots:
                project_roots[root] = project_root_from_library_root(root)
            pr = project_roots[root]
            q = hq.item
            pi, mi = 0, 0
            q.content, pi, mi = expand_diagram_fences_in_text(
                q.content,
                image_dir=image_dir,
                mode="latex",
                primebrush_start=pi,
                mermaid_start=mi,
                mermaid_pdf=mermaid_pdf,
                primebrush_pdf=primebrush_pdf,
                render_context=render_context,
            )
            q.content = expand_embed_img_markers_in_text(
                q.content, mode="latex", project_root=pr, image_dir=image_dir, primebrush_pdf=primebrush_pdf,
                render_context=render_context,
            )
            q.content = expand_tables_for_latex(q.content)
            from solaire.common.answer_logic import display as display_answer
            q.answer, pi, mi = expand_diagram_fences_in_text(
                display_answer(q.answer),
                image_dir=image_dir,
                mode="latex",
                primebrush_start=pi,
                mermaid_start=mi,
                mermaid_pdf=mermaid_pdf,
                primebrush_pdf=primebrush_pdf,
                render_context=render_context,
            )
            q.answer = expand_embed_img_markers_in_text(
                q.answer, mode="latex", project_root=pr, image_dir=image_dir, primebrush_pdf=primebrush_pdf,
                render_context=render_context,
            )
            q.answer = expand_tables_for_latex(q.answer)
            q.analysis, pi, mi = expand_diagram_fences_in_text(
                q.analysis or "",
                image_dir=image_dir,
                mode="latex",
                primebrush_start=pi,
                mermaid_start=mi,
                mermaid_pdf=mermaid_pdf,
                primebrush_pdf=primebrush_pdf,
                render_context=render_context,
            )
            q.analysis = expand_embed_img_markers_in_text(
                q.analysis, mode="latex", project_root=pr, image_dir=image_dir, primebrush_pdf=primebrush_pdf,
                render_context=render_context,
            )
            q.analysis = expand_tables_for_latex(q.analysis)
            if q.options:
                next_options: dict[str, str] = {}
                for key, value in q.options.items():
                    opt, pi, mi = expand_diagram_fences_in_text(
                        value,
                        image_dir=image_dir,
                        mode="latex",
                        primebrush_start=pi,
                        mermaid_start=mi,
                        mermaid_pdf=mermaid_pdf,
                        primebrush_pdf=primebrush_pdf,
                        render_context=render_context,
                    )
                    opt = expand_embed_img_markers_in_text(
                        opt, mode="latex", project_root=pr, image_dir=image_dir, primebrush_pdf=primebrush_pdf,
                        render_context=render_context,
                    )
                    next_options[key] = expand_tables_for_latex(opt)
                q.options = next_options
            if q.group_material:
                q.group_material, _, _ = expand_diagram_fences_in_text(
                    q.group_material,
                    image_dir=image_dir,
                    mode="latex",
                    primebrush_start=pi,
                    mermaid_start=mi,
                    mermaid_pdf=mermaid_pdf,
                    primebrush_pdf=primebrush_pdf,
                    render_context=render_context,
                )
                q.group_material = expand_embed_img_markers_in_text(
                    q.group_material, mode="latex", project_root=pr, image_dir=image_dir, primebrush_pdf=primebrush_pdf,
                    render_context=render_context,
                )
                q.group_material = expand_tables_for_latex(q.group_material)
