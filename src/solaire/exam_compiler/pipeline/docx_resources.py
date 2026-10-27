"""Formula cleanup and media materialization for DOCX Markdown."""

from __future__ import annotations

import hashlib
import re
import shutil
from pathlib import Path

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.pipeline.diagram_expand import (
    ensure_mermaid_block_files,
    project_root_from_library_root,
)
from solaire.exam_compiler.pipeline.hydrate import HydratedQuestion
from solaire.exam_compiler.pipeline.primebrush_expand import _svg_to_png, ensure_primebrush_block_files
from solaire.exam_compiler.pipeline.table_expand import expand_tables_for_docx_markdown, separate_markdown_tables
from solaire.exam_compiler.qualified_id import namespace_of_qualified

_FENCE_RE = re.compile(r"```(primebrush|mermaid)\s*\n(.*?)```", re.DOTALL)
_EMBED_RE = re.compile(r":::EMBED_IMG:([^:]+):::")
_COMMON_MATH_MACROS_RE = re.compile(r"\\(arccot|dlim|dint|e|i)(?![A-Za-z])")


class DocxResourceContext:
    """Export-scoped local context for reusing visual resources and media copies."""

    def __init__(self) -> None:
        self._diagram_cache: dict[tuple[str, str, int, str], tuple[str, Path]] = {}
        self._media_cache: dict[tuple[str, str, str], tuple[str, Path]] = {}
        self._svg_cache: dict[tuple[str, str, str], tuple[str, Path]] = {}

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
    ) -> str | None:
        key = (str(src.resolve()), str(media_dir.resolve()), prefix)
        entry = self._media_cache.get(key)
        if entry is not None:
            rel, target = entry
            if target.is_file():
                return rel
        return None

    def put_copied_media(
        self,
        src: Path,
        media_dir: Path,
        prefix: str,
        rel: str,
        target: Path,
    ) -> None:
        key = (str(src.resolve()), str(media_dir.resolve()), prefix)
        self._media_cache[key] = (rel, target)

    def get_copied_svg(
        self,
        src: Path,
        media_dir: Path,
        prefix: str,
    ) -> str | None:
        key = (str(src.resolve()), str(media_dir.resolve()), prefix)
        entry = self._svg_cache.get(key)
        if entry is not None:
            rel, target = entry
            if target.is_file():
                return rel
        return None

    def put_copied_svg(
        self,
        src: Path,
        media_dir: Path,
        prefix: str,
        rel: str,
        target: Path,
    ) -> None:
        key = (str(src.resolve()), str(media_dir.resolve()), prefix)
        self._svg_cache[key] = (rel, target)


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
) -> str | None:
    src = src.resolve()
    if not src.is_file():
        return None
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(src).encode("utf-8")).hexdigest()[:10]
    suffix = src.suffix.lower() or ".png"
    stem = _sanitize_name_part(prefix or src.stem, "image")
    target = media_dir / f"{stem}_{digest}{suffix}"
    if context is not None:
        cached = context.get_copied_media(src, media_dir, stem)
        if cached is not None:
            return cached
    if target.resolve() != src:
        shutil.copy2(src, target)
    rel = f"media/{target.name}"
    if context is not None:
        context.put_copied_media(src, media_dir, stem, rel, target)
    return rel


def _copy_svg_as_png(
    src: Path,
    media_dir: Path,
    *,
    prefix: str,
    context: DocxResourceContext | None = None,
) -> str | None:
    src = src.resolve()
    if not src.is_file():
        return None
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(src).encode("utf-8")).hexdigest()[:10]
    stem = _sanitize_name_part(prefix or src.stem, "image")
    target = media_dir / f"{stem}_{digest}.png"
    if context is not None:
        cached = context.get_copied_svg(src, media_dir, stem)
        if cached is not None:
            return cached
    svg = src.read_text(encoding="utf-8")
    _svg_to_png(svg, target)
    rel = f"media/{target.name}"
    if context is not None:
        context.put_copied_svg(src, media_dir, stem, rel, target)
    return rel


def _markdown_image(rel_path: str | None) -> str:
    if not rel_path:
        return ""
    return f"\n\n![]({rel_path}){{width=80%}}\n\n"


def _library_context(
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
) -> tuple[Path, Path] | None:
    ns = namespace_of_qualified(hq.qualified_id)
    root = loaded.library_roots.get(ns)
    if root is None:
        return None
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
    ctx = _library_context(hq, loaded)
    if ctx is None:
        return text
    lib_root, project_root = ctx
    image_dir = lib_root / "image"
    primebrush_idx = 0
    mermaid_idx = 0

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

    def repl_embed(m: re.Match[str]) -> str:
        rel = m.group(1).strip()
        if not rel or ".." in rel or rel.startswith(("/", "\\")):
            return m.group(0)
        res_root = (project_root / "resource").resolve()
        src = (res_root / rel).resolve()
        try:
            src.relative_to(res_root)
        except ValueError:
            return m.group(0)
        if not src.is_file():
            return m.group(0)
        if src.suffix.lower() == ".svg":
            copied = _copy_svg_as_png(src, media_dir, prefix=src.stem, context=context)
        else:
            copied = _copy_media(src, media_dir, prefix=src.stem, context=context)
        return _markdown_image(copied)

    return _EMBED_RE.sub(repl_embed, out)


def _clean_latex_for_markdown(text: str) -> str:
    if not text:
        return ""
    out = text.replace("\r\n", "\n")
    out = re.sub(r"\\underline\{\\hspace\{[^{}]*\}\}", "________", out)
    out = re.sub(r"\\hspace\{[^{}]*\}", "____", out)
    out = re.sub(r"\\vspace\{[^{}]*\}", "\n\n", out)
    out = re.sub(r"\\(?:par|smallskip|medskip|bigskip)\b", "\n\n", out)
    out = re.sub(r"\\noindent\b", "", out)
    out = re.sub(r"\\\\", "\n", out)
    out = re.sub(r"\\textbf\{([^{}]*)\}", r"**\1**", out)
    out = re.sub(r"\\emph\{([^{}]*)\}", r"*\1*", out)
    out = re.sub(r"\\begin\{center\}|\\end\{center\}", "\n", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _expand_common_math_macros(math: str) -> str:
    replacements = {
        "arccot": r"\operatorname{arccot}",
        "dlim": r"\displaystyle\lim",
        "dint": r"\displaystyle\int",
        "e": r"\mathrm{e}",
        "i": r"\mathrm{i}",
    }
    return _COMMON_MATH_MACROS_RE.sub(lambda m: replacements[m.group(1)], math)


def _normalize_docx_math_macros(text: str) -> str:
    if "$" not in text:
        return text
    parts: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "$" or (i > 0 and text[i - 1] == "\\"):
            parts.append(text[i])
            i += 1
            continue
        delim = "$$" if i + 1 < n and text[i + 1] == "$" else "$"
        start = i + len(delim)
        end = start
        while True:
            end = text.find(delim, end)
            if end == -1:
                parts.append(text[i:])
                return "".join(parts)
            if end == 0 or text[end - 1] != "\\":
                break
            end += len(delim)
        parts.append(delim)
        parts.append(_expand_common_math_macros(text[start:end]))
        parts.append(delim)
        i = end + len(delim)
    return "".join(parts)


def _render_text(
    text: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    context: DocxResourceContext | None = None,
) -> str:
    return separate_markdown_tables(_normalize_docx_math_macros(
        _clean_latex_for_markdown(
            expand_tables_for_docx_markdown(
                _materialize_visuals(text, hq, loaded, media_dir, context=context)
            )
        )
    ))
