"""Unified ```primebrush``` and ```mermaid``` fence expansion (source order)."""

from __future__ import annotations

import re
import struct
import hashlib
import shutil
import stat
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Iterable, Literal
from itertools import chain

from solaire.exam_compiler.models.template import MermaidPdfOptions, PrimeBrushPdfOptions
from solaire.exam_compiler.pipeline.mermaid_expand import (
    mermaid_render_cache_key,
    mermaid_stem,
    render_mermaid_to_svg_file,
)
from solaire.exam_compiler.pipeline.primebrush_expand import (
    _resource_rel_posix,
    _svg_to_png,
    ensure_primebrush_block_files,
)

# ```primebrush``` or ```mermaid``` — body until closing ```
_FENCE = re.compile(r"```(primebrush|mermaid)\s*\n(.*?)```", re.DOTALL)

_EMBED_IMG_RE = re.compile(r":::EMBED_IMG:([^:]+):::")

_PRIMEBRUSH_WEB_PREFIX = ":::PRIMEBRUSH_IMG:"
_MERMAID_WEB_PREFIX = ":::MERMAID_IMG:"
_WEB_SUFFIX = ":::"

_PREVIEW_RE = re.compile(
    r"```(primebrush|mermaid|solaire-table)\s*\n(.*?)```|:::EMBED_IMG:[^:]+:::",
    re.DOTALL,
)

_MERMAID_BATCH_MIN_JOBS = 4
_MERMAID_BATCH_MAX_WORKERS = 4
_MERMAID_BATCH_MAX_JOBS = 64


class DiagramRenderContext:
    """Short lived cache for deterministic assets during one export or preview request."""

    def __init__(self) -> None:
        self.primebrush_svg: dict[tuple[str, str, str], str] = {}
        self.primebrush_png: dict[tuple[str, str, str], bytes] = {}
        self.mermaid_svg: dict[tuple[object, ...], str] = {}
        self.mermaid_png: dict[tuple[object, ...], bytes] = {}
        self.resource_roots: dict[Path, Path] = {}
        self.embed_copies: set[tuple[Path, Path, int, int, int]] = set()


def _mermaid_export_cache_key(body: str, image_dir: Path) -> tuple[object, ...]:
    """Include exact source, render settings, renderer identity, and destination library."""
    return (*mermaid_render_cache_key(body), str(image_dir.resolve()))


def _render_mermaid_batch_item(
    body: str,
    write_png: bool,
    cached_svg: str | None,
) -> tuple[str, bytes | None]:
    """Render into private temporary files; callers publish results in source order."""
    with tempfile.TemporaryDirectory(prefix="solaire-mermaid-") as temp_dir:
        temp_root = Path(temp_dir)
        svg_path = temp_root / "diagram.svg"
        if cached_svg is None:
            render_mermaid_to_svg_file(body, svg_path)
            svg = svg_path.read_text(encoding="utf-8")
        else:
            svg = cached_svg
        if not write_png:
            return svg, None
        png_path = temp_root / "diagram.png"
        _svg_to_png(svg, png_path)
        return svg, png_path.read_bytes()


def prewarm_mermaid_render_batch(
    requests: Iterable[tuple[str, Path]],
    render_context: DiagramRenderContext,
    *,
    write_png: bool,
) -> None:
    """Render a large export's distinct Mermaid figures concurrently, without publishing files.

    The normal source-order expansion writes the indexed SVG/PNG files and
    reports errors. Only a successful batch populates the render cache.
    """
    try:
        candidates: dict[tuple[str, Path], str] = {}
        for body, image_dir in requests:
            candidates.setdefault((body.strip(), image_dir), body)
            if len(candidates) == _MERMAID_BATCH_MAX_JOBS:
                break
        if len(candidates) < _MERMAID_BATCH_MIN_JOBS:
            return

        pending: dict[tuple[object, ...], tuple[str, str | None]] = {}
        for (_normalized, image_dir), body in candidates.items():
            key = _mermaid_export_cache_key(body, image_dir)
            cached_svg = render_context.mermaid_svg.get(key)
            if cached_svg is not None and (not write_png or key in render_context.mermaid_png):
                continue
            pending.setdefault(key, (body, cached_svg))
        if len(pending) < _MERMAID_BATCH_MIN_JOBS:
            return

        def render(job: tuple[str, str | None]) -> tuple[str, bytes | None]:
            body, cached_svg = job
            return _render_mermaid_batch_item(body, write_png, cached_svg)

        with ThreadPoolExecutor(
            max_workers=min(_MERMAID_BATCH_MAX_WORKERS, len(pending)),
            thread_name_prefix="mermaid-render",
        ) as pool:
            outputs = list(pool.map(render, pending.values()))
    except Exception:
        # The serial consumer will report failures in the usual source order.
        return

    for key, (svg, png) in zip(pending, outputs, strict=True):
        render_context.mermaid_svg[key] = svg
        if png is not None:
            render_context.mermaid_png[key] = png


def iter_mermaid_render_requests(text: str, image_dir: Path) -> Iterable[tuple[str, Path]]:
    """Yield Mermaid fences in text without including PrimeBrush fences."""
    if not text or "```mermaid" not in text:
        return
    for match in _FENCE.finditer(text):
        if match.group(1) == "mermaid":
            yield match.group(2), image_dir


def project_root_from_library_root(lib_root: Path) -> Path:
    """Walk up from a question library root until ``resource/``; return its parent (project root)."""
    cur = lib_root.resolve()
    while cur.name != "resource":
        if cur.parent == cur:
            raise ValueError(f"Cannot resolve project root from library path: {lib_root}")
        cur = cur.parent
    return cur.parent


def expand_embed_img_markers_in_text(
    text: str,
    *,
    mode: Literal["latex", "web"],
    project_root: Path | None,
    image_dir: Path | None = None,
    primebrush_pdf: PrimeBrushPdfOptions | None = None,
    render_context: DiagramRenderContext | None = None,
) -> str:
    """
    Replace ``:::EMBED_IMG:<resource-relative-path>:::`` with ``\\includegraphics`` in LaTeX mode.

    Web mode leaves markers unchanged for the frontend. Missing or unsafe paths keep the marker.
    """
    if not text or ":::EMBED_IMG:" not in text:
        return text
    if mode == "web":
        return text
    if project_root is None:
        return text
    pp = primebrush_pdf if primebrush_pdf is not None else PrimeBrushPdfOptions()
    if render_context is not None:
        res_root = render_context.resource_roots.get(project_root)
        if res_root is None:
            res_root = (project_root / "resource").resolve()
            render_context.resource_roots[project_root] = res_root
    else:
        res_root = (project_root / "resource").resolve()

    def repl(m: re.Match[str]) -> str:
        rel = m.group(1).strip()
        if not rel or ".." in rel or rel.startswith(("/", "\\")):
            return m.group(0)
        path = (project_root / "resource" / rel).resolve()
        try:
            path.relative_to(res_root)
        except ValueError:
            return m.group(0)
        try:
            source_stat = path.stat()
        except OSError:
            return m.group(0)
        if not stat.S_ISREG(source_stat.st_mode):
            return m.group(0)
        basename = path.name
        if image_dir is not None and path.parent != image_dir.resolve():
            image_dir.mkdir(parents=True, exist_ok=True)
            basename = f"embed-{hashlib.sha256(rel.encode('utf-8')).hexdigest()[:12]}{path.suffix.lower()}"
            target = (image_dir / basename).resolve()
            if target.parent != image_dir.resolve():
                return m.group(0)
            copy_key = (
                path,
                target,
                source_stat.st_size,
                source_stat.st_mtime_ns,
                source_stat.st_ctime_ns,
            )
            if (
                render_context is None
                or copy_key not in render_context.embed_copies
                or not target.is_file()
            ):
                shutil.copy2(path, target)
                if render_context is not None:
                    render_context.embed_copies.add(copy_key)
        inc = f"\\includegraphics[width={pp.latex_width},keepaspectratio]{{{basename}}}"
        return f"\n{inc}\n"

    return _EMBED_IMG_RE.sub(repl, text)


def primebrush_pdf_options_from_metadata(metadata: dict[str, Any] | None) -> PrimeBrushPdfOptions:
    """Resolve ``metadata['primebrush_pdf']`` for LaTeX PrimeBrush figures."""
    if not metadata:
        return PrimeBrushPdfOptions()
    raw = metadata.get("primebrush_pdf")
    if raw is None:
        return PrimeBrushPdfOptions()
    if isinstance(raw, dict):
        return PrimeBrushPdfOptions.model_validate(raw)
    return PrimeBrushPdfOptions()


def mermaid_pdf_options_from_metadata(metadata: dict[str, Any] | None) -> MermaidPdfOptions:
    """Resolve ``metadata['mermaid_pdf']`` for LaTeX Mermaid figures."""
    if not metadata:
        return MermaidPdfOptions()
    raw = metadata.get("mermaid_pdf")
    if raw is None:
        return MermaidPdfOptions()
    if isinstance(raw, dict):
        return MermaidPdfOptions.model_validate(raw)
    return MermaidPdfOptions()


def _png_pixel_size(png_path: Path) -> tuple[int, int] | None:
    """Read PNG IHDR width/height; returns None if not a valid PNG."""
    try:
        with png_path.open("rb") as f:
            if f.read(8) != b"\x89PNG\r\n\x1a\n":
                return None
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    return None
                length = struct.unpack(">I", hdr[:4])[0]
                ctype = hdr[4:8]
                chunk = f.read(length)
                f.read(4)
                if ctype == b"IHDR":
                    if len(chunk) < 8:
                        return None
                    w, h = struct.unpack(">II", chunk[:8])
                    return (int(w), int(h))
    except OSError:
        return None


def _latex_includegraphics_mermaid(png_name: str, png_path: Path, opts: MermaidPdfOptions) -> str:
    """\\includegraphics for Mermaid PNG: landscape → width only; portrait → width + max height."""
    sz = _png_pixel_size(png_path)
    if sz is None:
        return (
            f"\\includegraphics[width={opts.landscape_width},"
            f"height={opts.portrait_max_height},keepaspectratio]{{{png_name}}}"
        )
    w, h = sz
    if w >= h:
        return f"\\includegraphics[width={opts.landscape_width},keepaspectratio]{{{png_name}}}"
    return (
        f"\\includegraphics[width={opts.portrait_width},height={opts.portrait_max_height},"
        f"keepaspectratio]{{{png_name}}}"
    )


def ensure_mermaid_block_files(
    body: str,
    *,
    image_dir: Path,
    block_index: int,
    write_png: bool,
    render_cache: dict[tuple[object, ...], str] | None = None,
    png_cache: dict[tuple[object, ...], bytes] | None = None,
) -> tuple[str, str]:
    stem = mermaid_stem(body, block_index)
    image_dir.mkdir(parents=True, exist_ok=True)
    svg_path = image_dir / f"{stem}.svg"
    png_path = image_dir / f"{stem}.png"
    cache_key = (
        _mermaid_export_cache_key(body, image_dir)
        if render_cache is not None or png_cache is not None
        else None
    )
    svg = render_cache.get(cache_key) if cache_key is not None and render_cache is not None else None
    if svg is None:
        render_mermaid_to_svg_file(body, svg_path)
        svg = svg_path.read_text(encoding="utf-8")
        if cache_key is not None and render_cache is not None:
            render_cache[cache_key] = svg
    else:
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


def expand_diagram_fences_in_text(
    text: str,
    *,
    image_dir: Path,
    mode: Literal["latex", "web"],
    project_root: Path | None = None,
    primebrush_start: int = 0,
    mermaid_start: int = 0,
    mermaid_pdf: MermaidPdfOptions | None = None,
    primebrush_pdf: PrimeBrushPdfOptions | None = None,
    render_context: DiagramRenderContext | None = None,
) -> tuple[str, int, int]:
    """
    Replace each ```primebrush``` / ```mermaid``` block in **source order**.

    Returns (new_text, next_primebrush_index, next_mermaid_index).
    """
    if not text or "```" not in text:
        return text, primebrush_start, mermaid_start
    matches = _FENCE.finditer(text)
    first = next(matches, None)
    if first is None:
        return text, primebrush_start, mermaid_start
    if render_context is None:
        render_context = DiagramRenderContext()

    pi = primebrush_start
    mi = mermaid_start
    pos = 0
    out: list[str] = []

    for m in chain((first,), matches):
        out.append(text[pos : m.start()])
        kind = m.group(1)
        body = m.group(2)
        if kind == "primebrush":
            stem, png_name = ensure_primebrush_block_files(
                body,
                image_dir=image_dir,
                block_index=pi,
                write_png=(mode == "latex"),
                render_cache=render_context.primebrush_svg if render_context is not None else None,
                png_cache=render_context.primebrush_png if render_context is not None else None,
            )
            pi += 1
            if mode == "latex":
                pp = primebrush_pdf if primebrush_pdf is not None else PrimeBrushPdfOptions()
                inc = f"\\includegraphics[width={pp.latex_width},keepaspectratio]{{{png_name}}}"
                out.append(f"\n{inc}\n")
            else:
                if project_root is None:
                    raise ValueError("project_root is required for web diagram expansion")
                rel_base = _resource_rel_posix(image_dir, project_root)
                svg_rel = f"{rel_base}/{stem}.svg"
                out.append(f"\n{_PRIMEBRUSH_WEB_PREFIX}{svg_rel}{_WEB_SUFFIX}\n")
        else:
            # LaTeX 仍依赖 mmdr 生成 SVG→PNG；Web 若未装 mmdr 或渲染失败，保留 ```mermaid 围栏供前端用 mermaid.js 渲染，避免 API 500。
            if mode == "web":
                try:
                    stem, png_name = ensure_mermaid_block_files(
                        body,
                        image_dir=image_dir,
                        block_index=mi,
                        write_png=False,
                        render_cache=render_context.mermaid_svg if render_context is not None else None,
                        png_cache=render_context.mermaid_png if render_context is not None else None,
                    )
                except Exception:
                    out.append(m.group(0))
                    mi += 1
                    pos = m.end()
                    continue
            else:
                stem, png_name = ensure_mermaid_block_files(
                    body,
                    image_dir=image_dir,
                    block_index=mi,
                    write_png=True,
                    render_cache=render_context.mermaid_svg if render_context is not None else None,
                    png_cache=render_context.mermaid_png if render_context is not None else None,
                )
            mi += 1
            if mode == "latex":
                mp = mermaid_pdf if mermaid_pdf is not None else MermaidPdfOptions()
                png_path = image_dir / png_name
                inc = _latex_includegraphics_mermaid(png_name, png_path, mp)
                out.append(f"\n{inc}\n")
            else:
                if project_root is None:
                    raise ValueError("project_root is required for web diagram expansion")
                rel_base = _resource_rel_posix(image_dir, project_root)
                svg_rel = f"{rel_base}/{stem}.svg"
                out.append(f"\n{_MERMAID_WEB_PREFIX}{svg_rel}{_WEB_SUFFIX}\n")
        pos = m.end()

    out.append(text[pos:])
    return "".join(out), pi, mi


def strip_diagram_fences_for_preview(text: str, max_len: int = 200) -> str:
    """Remove fenced primebrush / mermaid blocks and embed-image markers for one-line style previews."""
    def replace(match: re.Match[str]) -> str:
        kind = match.group(1)
        if kind == "primebrush":
            return " [插图] "
        if kind == "mermaid":
            return " [流程图] "
        if kind == "solaire-table":
            return " [table] "
        return " [图片] "

    t = _PREVIEW_RE.sub(replace, text)
    t = " ".join(t.split())
    return t if len(t) <= max_len else t[: max_len - 3] + "..."
