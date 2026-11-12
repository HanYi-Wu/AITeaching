"""Formula cleanup and media materialization for DOCX Markdown."""

from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.pipeline.diagram_expand import (
    DiagramRenderContext,
    ensure_mermaid_block_files,
    iter_mermaid_render_requests,
    prewarm_mermaid_render_batch,
    project_root_from_library_root,
)
from solaire.exam_compiler.pipeline.hydrate import HydratedQuestion
from solaire.exam_compiler.pipeline.primebrush_expand import _svg_to_png, ensure_primebrush_block_files
from solaire.exam_compiler.pipeline.table_expand import expand_tables_for_docx_markdown, separate_markdown_tables
from solaire.exam_compiler.qualified_id import namespace_of_qualified

_FENCE_RE = re.compile(r"```(primebrush|mermaid)\s*\n(.*?)```", re.DOTALL)
_EMBED_RE = re.compile(r":::EMBED_IMG:([^:]+):::")
_COMMON_MATH_MACROS_RE = re.compile(r"\\(arccot|dlim|dint|e|i)(?![A-Za-z])")
_COMMON_MATH_MACRO_REPLACEMENTS = {
    "arccot": r"\operatorname{arccot}",
    "dlim": r"\displaystyle\lim",
    "dint": r"\displaystyle\int",
    "e": r"\mathrm{e}",
    "i": r"\mathrm{i}",
}


class DocxResourceContext:
    """Export-scoped local context for reusing visual resources and media copies."""

    def __init__(self) -> None:
        self._diagram_render_context = DiagramRenderContext()
        self._diagram_cache: dict[tuple[str, str, int, str], tuple[str, Path]] = {}
        self._media_cache: dict[
            tuple[str, str, str], tuple[str, Path, tuple[int, int]]
        ] = {}
        self._svg_cache: dict[
            tuple[str, str, str], tuple[str, Path, tuple[int, int]]
        ] = {}
        self._library_context_cache: dict[Path, tuple[Path, Path] | None] = {}

    def get_library_context(self, library_root: Path) -> tuple[Path, Path] | None:
        if library_root in self._library_context_cache:
            return self._library_context_cache[library_root]
        try:
            value = (library_root, project_root_from_library_root(library_root))
        except ValueError:
            value = None
        self._library_context_cache[library_root] = value
        return value

    def get_diagram(
        self,
        kind: str,
        image_dir: Path,
        block_index: int,
        body: str,
    ) -> str | None:
        key = (kind, str(image_dir.resolve()), block_index, body)
        entry = self._diagram_cache.get(key)
        if entry is not None:
            rel, target = entry
            if target.is_file():
                return rel
        return None

    def put_diagram(
        self,
        kind: str,
        image_dir: Path,
        block_index: int,
        body: str,
        rel: str,
        target: Path,
    ) -> None:
        key = (kind, str(image_dir.resolve()), block_index, body)
        self._diagram_cache[key] = (rel, target)

    def get_copied_media(
        self,
        src: Path,
        media_dir: Path,
        prefix: str,
        *,
        paths_resolved: bool = False,
    ) -> str | None:
        src_key = str(src) if paths_resolved else str(src.resolve())
        media_dir_key = str(media_dir) if paths_resolved else str(media_dir.resolve())
        key = (src_key, media_dir_key, prefix)
        entry = self._media_cache.get(key)
        if entry is not None:
            rel, target = entry[:2]
            if target.is_file():
                return rel
        return None

    def _get_copied_resource_fast(
        self,
        cache: dict[tuple[str, str, str], tuple[str, Path, tuple[int, int]]],
        src: Path,
        media_dir: Path,
        prefix: str,
    ) -> str | None:
        """Use an exact canonical path hit without resolving it again."""
        entry = cache.get((str(src), str(media_dir), prefix))
        if entry is None:
            return None
        rel, target, cached_dir_identity = entry
        try:
            directory_stat = media_dir.stat()
        except OSError:
            return None
        if (directory_stat.st_dev, directory_stat.st_ino) != cached_dir_identity:
            return None
        if target.is_file():
            return rel
        return None

    def get_copied_media_fast(self, src: Path, media_dir: Path, prefix: str) -> str | None:
        stem = _sanitize_name_part(prefix or src.stem, "image")
        return self._get_copied_resource_fast(self._media_cache, src, media_dir, stem)

    def put_copied_media(
        self,
        src: Path,
        media_dir: Path,
        prefix: str,
        rel: str,
        target: Path,
        *,
        paths_resolved: bool = False,
    ) -> None:
        src_key = str(src) if paths_resolved else str(src.resolve())
        media_dir_key = str(media_dir) if paths_resolved else str(media_dir.resolve())
        key = (src_key, media_dir_key, prefix)
        directory_stat = media_dir.stat()
        self._media_cache[key] = (
            rel,
            target,
            (directory_stat.st_dev, directory_stat.st_ino),
        )

    def get_copied_svg(
        self,
        src: Path,
        media_dir: Path,
        prefix: str,
        *,
        paths_resolved: bool = False,
    ) -> str | None:
        src_key = str(src) if paths_resolved else str(src.resolve())
        media_dir_key = str(media_dir) if paths_resolved else str(media_dir.resolve())
        key = (src_key, media_dir_key, prefix)
        entry = self._svg_cache.get(key)
        if entry is not None:
            rel, target = entry[:2]
            if target.is_file():
                return rel
        return None

    def get_copied_svg_fast(self, src: Path, media_dir: Path, prefix: str) -> str | None:
        stem = _sanitize_name_part(prefix or src.stem, "image")
        return self._get_copied_resource_fast(self._svg_cache, src, media_dir, stem)

    def put_copied_svg(
        self,
        src: Path,
        media_dir: Path,
        prefix: str,
        rel: str,
        target: Path,
        *,
        paths_resolved: bool = False,
    ) -> None:
        src_key = str(src) if paths_resolved else str(src.resolve())
        media_dir_key = str(media_dir) if paths_resolved else str(media_dir.resolve())
        key = (src_key, media_dir_key, prefix)
        directory_stat = media_dir.stat()
        self._svg_cache[key] = (
            rel,
            target,
            (directory_stat.st_dev, directory_stat.st_ino),
        )


def _sanitize_name_part(s: str, default: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", s.strip())
    clean = clean.strip("._")
    return clean or default


def _copy_media(
    src: Path,
    media_dir: Path,
    *,
    prefix: str,
    context: DocxResourceContext | None = None,
    source_is_resolved: bool = False,
) -> str | None:
    src = src if source_is_resolved else src.resolve()
    if not src.is_file():
        return None
    media_dir.mkdir(parents=True, exist_ok=True)
    media_dir = media_dir.resolve()
    digest = hashlib.sha256(str(src).encode("utf-8")).hexdigest()[:10]
    suffix = src.suffix.lower() or ".png"
    stem = _sanitize_name_part(prefix or src.stem, "image")
    target = media_dir / f"{stem}_{digest}{suffix}"
    if context is not None:
        cached = context.get_copied_media(src, media_dir, stem, paths_resolved=True)
        if cached is not None:
            return cached
    if target.resolve() != src:
        shutil.copy2(src, target)
    rel = f"media/{target.name}"
    if context is not None:
        context.put_copied_media(src, media_dir, stem, rel, target, paths_resolved=True)
    return rel


def _copy_svg_as_png(
    src: Path,
    media_dir: Path,
    *,
    prefix: str,
    context: DocxResourceContext | None = None,
    source_is_resolved: bool = False,
) -> str | None:
    src = src if source_is_resolved else src.resolve()
    if not src.is_file():
        return None
    media_dir.mkdir(parents=True, exist_ok=True)
    media_dir = media_dir.resolve()
    digest = hashlib.sha256(str(src).encode("utf-8")).hexdigest()[:10]
    stem = _sanitize_name_part(prefix or src.stem, "image")
    target = media_dir / f"{stem}_{digest}.png"
    if context is not None:
        cached = context.get_copied_svg(src, media_dir, stem, paths_resolved=True)
        if cached is not None:
            return cached
    svg = src.read_text(encoding="utf-8")
    _svg_to_png(svg, target)
    rel = f"media/{target.name}"
    if context is not None:
        context.put_copied_svg(src, media_dir, stem, rel, target, paths_resolved=True)
    return rel


def _markdown_image(rel_path: str | None) -> str:
    if not rel_path:
        return ""
    return f"\n\n![]({rel_path}){{width=80%}}\n\n"


def _library_context(
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    *,
    context: DocxResourceContext | None = None,
) -> tuple[Path, Path] | None:
    ns = namespace_of_qualified(hq.qualified_id)
    root = loaded.library_roots.get(ns)
    if root is None:
        return None
    if context is not None:
        return context.get_library_context(root)
    try:
        project_root = project_root_from_library_root(root)
    except ValueError:
        return None
    return root, project_root


def _materialize_visuals(
    text: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    context: DocxResourceContext | None = None,
) -> str:
    if not text:
        return ""
    if "```primebrush" not in text and "```mermaid" not in text and ":::EMBED_IMG:" not in text:
        return text
    ctx = _library_context(hq, loaded, context=context)
    if ctx is None:
        return text
    lib_root, project_root = ctx
    image_dir = lib_root / "image"
    primebrush_idx = 0
    mermaid_idx = 0
    diagram_cache = context._diagram_render_context if context is not None else None

    def repl_fence(m: re.Match[str]) -> str:
        nonlocal primebrush_idx, mermaid_idx
        kind = m.group(1)
        body = m.group(2)
        if kind == "primebrush":
            b_idx = primebrush_idx
            primebrush_idx += 1
            if context is not None:
                cached = context.get_diagram("primebrush", image_dir, b_idx, body)
                if cached is not None:
                    return _markdown_image(cached)
            stem, png_name = ensure_primebrush_block_files(
                body,
                image_dir=image_dir,
                block_index=b_idx,
                write_png=True,
                render_cache=diagram_cache.primebrush_svg if diagram_cache is not None else None,
                png_cache=diagram_cache.primebrush_png if diagram_cache is not None else None,
            )
            rel = _copy_media(image_dir / png_name, media_dir, prefix=stem, context=context)
            if context is not None and rel is not None:
                context.put_diagram(
                    "primebrush",
                    image_dir,
                    b_idx,
                    body,
                    rel,
                    media_dir / Path(rel).name,
                )
            return _markdown_image(rel)

        b_idx = mermaid_idx
        mermaid_idx += 1
        if context is not None:
            cached = context.get_diagram("mermaid", image_dir, b_idx, body)
            if cached is not None:
                return _markdown_image(cached)
        stem, png_name = ensure_mermaid_block_files(
            body,
            image_dir=image_dir,
            block_index=b_idx,
            write_png=True,
            render_cache=diagram_cache.mermaid_svg if diagram_cache is not None else None,
            png_cache=diagram_cache.mermaid_png if diagram_cache is not None else None,
        )
        rel = _copy_media(image_dir / png_name, media_dir, prefix=stem, context=context)
        if context is not None and rel is not None:
            context.put_diagram(
                "mermaid",
                image_dir,
                b_idx,
                body,
                rel,
                media_dir / Path(rel).name,
            )
        return _markdown_image(rel)

    out = _FENCE_RE.sub(repl_fence, text)
    resolved_resource_root: Path | None = None

    def repl_embed(m: re.Match[str]) -> str:
        nonlocal resolved_resource_root
        rel = m.group(1).strip()
        if not rel or ".." in rel or rel.startswith(("/", "\\")):
            return m.group(0)
        if resolved_resource_root is None:
            resolved_resource_root = (project_root / "resource").resolve()
        res_root = resolved_resource_root
        src = (res_root / rel).resolve()
        try:
            src.relative_to(res_root)
        except ValueError:
            return m.group(0)
        if not src.is_file():
            return m.group(0)
        if src.suffix.lower() == ".svg":
            if context is not None:
                cached = context.get_copied_svg_fast(src, media_dir, src.stem)
                if cached is not None:
                    return _markdown_image(cached)
            copied = _copy_svg_as_png(
                src, media_dir, prefix=src.stem, context=context, source_is_resolved=True
            )
        else:
            if context is not None:
                cached = context.get_copied_media_fast(src, media_dir, src.stem)
                if cached is not None:
                    return _markdown_image(cached)
            copied = _copy_media(
                src, media_dir, prefix=src.stem, context=context, source_is_resolved=True
            )
        return _markdown_image(copied)

    return _EMBED_RE.sub(repl_embed, out)


_RE_UNDERLINE = re.compile(r"\\underline\{\\hspace\{[^{}]*\}\}")
_RE_HSPACE = re.compile(r"\\hspace\{[^{}]*\}")
_RE_VSPACE = re.compile(r"\\vspace\{[^{}]*\}")
_RE_BREAKS = re.compile(r"\\(?:par|smallskip|medskip|bigskip)\b")
_RE_NOINDENT = re.compile(r"\\noindent\b")
_RE_NEWLINE = re.compile(r"\\\\")
_RE_TEXTBF = re.compile(r"\\textbf\{([^{}]*)\}")
_RE_EMPH = re.compile(r"\\emph\{([^{}]*)\}")
_RE_CENTER = re.compile(r"\\begin\{center\}|\\end\{center\}")
_RE_TRAILING_SPACE = re.compile(r"[ \t]+\n")
_RE_MULTI_NEWLINE = re.compile(r"\n{3,}")
_RENDERED_TEXT_CACHE_MAX_BYTES = 4 * 1024 * 1024
_RENDERED_TEXT_CACHE_MAX_ENTRIES = 4096


def _clean_latex_for_markdown(text: str) -> str:
    if not text:
        return ""
    out = text.replace("\r\n", "\n")
    if "\\" in out:
        out = _RE_UNDERLINE.sub("________", out)
        out = _RE_HSPACE.sub("____", out)
        out = _RE_VSPACE.sub("\n\n", out)
        out = _RE_BREAKS.sub("\n\n", out)
        out = _RE_NOINDENT.sub("", out)
        out = _RE_NEWLINE.sub("\n", out)
        out = _RE_TEXTBF.sub(r"**\1**", out)
        out = _RE_EMPH.sub(r"*\1*", out)
        out = _RE_CENTER.sub("\n", out)
    out = _RE_TRAILING_SPACE.sub("\n", out)
    out = _RE_MULTI_NEWLINE.sub("\n\n", out)
    return out.strip()


def _expand_common_math_macros(math: str) -> str:
    return _COMMON_MATH_MACROS_RE.sub(
        lambda m: _COMMON_MATH_MACRO_REPLACEMENTS[m.group(1)], math
    )


def _normalize_docx_math_macros(text: str) -> str:
    if "$" not in text or "\\" not in text:
        return text
    parts: list[str] = []
    emitted = 0
    search = 0
    while True:
        opening = text.find("$", search)
        if opening < 0:
            break
        if opening > 0 and text[opening - 1] == "\\":
            search = opening + 1
            continue
        delimiter = "$$" if text.startswith("$$", opening) else "$"
        start = opening + len(delimiter)
        end = text.find(delimiter, start)
        while end >= 0 and text[end - 1] == "\\":
            end = text.find(delimiter, end + len(delimiter))
        if end < 0:
            break
        parts.append(text[emitted:start])
        parts.append(_expand_common_math_macros(text[start:end]))
        parts.append(delimiter)
        emitted = end + len(delimiter)
        search = emitted
    if not parts:
        return text
    parts.append(text[emitted:])
    return "".join(parts)


def _render_text(
    text: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    context: DocxResourceContext | None = None,
) -> str:
    if not text:
        return ""
    # Recheck resource existence and perform any required copies on every call.
    # Once materialized, all remaining transformations depend only on this text,
    # so identical content can share the bounded export-scoped result cache.
    materialized_text = _materialize_visuals(text, hq, loaded, media_dir, context=context)
    cache = None
    if context is not None:
        cache = getattr(context, "_rendered_text_cache", None)
        if cache is None:
            cache = {}
            try:
                setattr(context, "_rendered_text_cache", cache)
                setattr(context, "_rendered_text_cache_bytes", 0)
            except Exception:
                pass
        else:
            cached = cache.get(materialized_text)
            if cached is not None:
                return cached

    rendered_text = separate_markdown_tables(_normalize_docx_math_macros(
        _clean_latex_for_markdown(
            expand_tables_for_docx_markdown(materialized_text)
        )
    ))

    if cache is not None:
        cache_bytes = getattr(context, "_rendered_text_cache_bytes", 0)
        entry_bytes = sys.getsizeof(materialized_text) + sys.getsizeof(rendered_text) + 128
        if (
            len(cache) < _RENDERED_TEXT_CACHE_MAX_ENTRIES
            and cache_bytes + entry_bytes <= _RENDERED_TEXT_CACHE_MAX_BYTES
        ):
            cache[materialized_text] = rendered_text
            setattr(context, "_rendered_text_cache_bytes", cache_bytes + entry_bytes)

    return rendered_text
