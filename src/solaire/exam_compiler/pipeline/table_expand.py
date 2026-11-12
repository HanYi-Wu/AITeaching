"""Expand ```solaire-table``` fenced blocks for preview/export pipelines."""

from __future__ import annotations

import re
import sys
from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from threading import Lock
from typing import Any, Literal

import yaml

from solaire.common.yaml_utils import safe_load_yaml
from solaire.exam_compiler.latex_util import latex_escape_text

TABLE_FENCE_RE = re.compile(r"```solaire-table\s*\n(.*?)```", re.DOTALL)
_TABLE_RENDER_CACHE_MAX_ENTRIES = 512
_TABLE_RENDER_CACHE_MAX_BYTES = 8 * 1024 * 1024
_TABLE_RENDER_CACHE: OrderedDict[tuple[str, str], tuple[str, int]] = OrderedDict()
_TABLE_RENDER_CACHE_BYTES = 0
_TABLE_RENDER_CACHE_LOCK = Lock()

Align = Literal["left", "center", "right"]


@dataclass(frozen=True)
class TableCell:
    text: str = ""
    header: bool = False
    align: Align | None = None
    row_span: int = 1
    col_span: int = 1


@dataclass(frozen=True)
class TableAnchor:
    row: int
    col: int
    cell: TableCell


@dataclass(frozen=True)
class TableSlot:
    anchor_row: int
    anchor_col: int
    cell: TableCell
    covered: bool


@dataclass(frozen=True)
class ExpandedTable:
    width: int
    height: int
    slots: list[list[TableSlot]]
    anchors: list[TableAnchor]


def _span(raw: Any, key: str) -> int:
    if raw is None:
        return 1
    if not isinstance(raw, int) or raw < 1:
        raise ValueError(f"{key} must be a positive integer")
    return raw


def _cell(raw: Any) -> TableCell:
    if isinstance(raw, (str, int, float, bool)):
        return TableCell(text=str(raw))
    if not isinstance(raw, dict):
        raise ValueError("table cell must be an object")
    align = raw.get("align")
    if align is not None:
        align = str(align)
        if align not in {"left", "center", "right"}:
            raise ValueError("table cell align must be left, center, or right")
    return TableCell(
        text="" if raw.get("text") is None else str(raw.get("text")),
        header=raw.get("header") is True,
        align=align,  # type: ignore[arg-type]
        row_span=_span(raw.get("rowSpan", raw.get("rowspan")), "rowSpan"),
        col_span=_span(raw.get("colSpan", raw.get("colspan")), "colSpan"),
    )


def _parse_table_rows(source: str) -> list[list[TableCell]]:
    try:
        raw = safe_load_yaml(source)
    except yaml.YAMLError:
        # Keep PyYAML's established diagnostics on invalid table YAML.
        raw = yaml.safe_load(source)
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise ValueError("unsupported solaire-table version")
    rows = raw.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("table rows must be a non-empty array")
    out: list[list[TableCell]] = []
    for row in rows:
        if not isinstance(row, list):
            raise ValueError("each table row must be an array")
        out.append([_cell(c) for c in row])
    return out


def parse_table(source: str) -> list[list[TableCell]]:
    rows = _table_plan(source)
    expand_table([list(row) for row in rows])
    return [list(row) for row in rows]


@dataclass(frozen=True)
class _ExpansionPlan:
    width: int
    height: int
    slots: tuple[tuple[tuple[int, int, int, bool], ...], ...]
    anchors: tuple[tuple[int, int, int], ...]


def _build_expansion_plan(rows: tuple[tuple[TableCell, ...], ...]) -> _ExpansionPlan:
    slots: list[list[tuple[int, int, int, bool] | None]] = [[] for _ in rows]
    anchors: list[tuple[int, int, int]] = []
    for r, row in enumerate(rows):
        c = 0
        for cell_index, cell in enumerate(row):
            if r + cell.row_span > len(rows):
                raise ValueError("rowSpan exceeds table height")
            while c < len(slots[r]) and slots[r][c] is not None:
                c += 1
            for rr in range(r, r + cell.row_span):
                while len(slots[rr]) < c + cell.col_span:
                    slots[rr].append(None)
                for cc in range(c, c + cell.col_span):
                    if slots[rr][cc] is not None:
                        raise ValueError("table cells overlap")
            anchors.append((r, c, cell_index))
            for rr in range(r, r + cell.row_span):
                for cc in range(c, c + cell.col_span):
                    slots[rr][cc] = (r, c, cell_index, rr != r or cc != c)
            c += cell.col_span
    width = max(len(row) for row in slots)
    dense: list[tuple[tuple[int, int, int, bool], ...]] = []
    for row in slots:
        if len(row) != width or any(slot is None for slot in row):
            raise ValueError("table must be rectangular")
        dense.append(tuple(slot for slot in row if slot is not None))
    return _ExpansionPlan(width, len(rows), tuple(dense), tuple(anchors))


@lru_cache(maxsize=128)
def _cached_expansion_plan(rows: tuple[tuple[TableCell, ...], ...]) -> _ExpansionPlan:
    return _build_expansion_plan(rows)


def _materialize_expansion_plan(
    plan: _ExpansionPlan, rows: list[list[TableCell]] | tuple[tuple[TableCell, ...], ...]
) -> ExpandedTable:
    slots = [
        [TableSlot(r, c, rows[r][cell_index], covered) for r, c, cell_index, covered in row]
        for row in plan.slots
    ]
    anchors = [TableAnchor(r, c, rows[r][cell_index]) for r, c, cell_index in plan.anchors]
    return ExpandedTable(plan.width, plan.height, slots, anchors)


def _expand_table_direct(rows: list[list[TableCell]]) -> ExpandedTable:
    slots: list[list[TableSlot | None]] = [[] for _ in rows]
    anchors: list[TableAnchor] = []
    for r, row in enumerate(rows):
        c = 0
        for cell in row:
            if r + cell.row_span > len(rows):
                raise ValueError("rowSpan exceeds table height")
            while c < len(slots[r]) and slots[r][c] is not None:
                c += 1
            for rr in range(r, r + cell.row_span):
                while len(slots[rr]) < c + cell.col_span:
                    slots[rr].append(None)
                for cc in range(c, c + cell.col_span):
                    if slots[rr][cc] is not None:
                        raise ValueError("table cells overlap")
            anchors.append(TableAnchor(row=r, col=c, cell=cell))
            for rr in range(r, r + cell.row_span):
                for cc in range(c, c + cell.col_span):
                    slots[rr][cc] = TableSlot(
                        anchor_row=r,
                        anchor_col=c,
                        cell=cell,
                        covered=rr != r or cc != c,
                    )
            c += cell.col_span
    width = max(len(row) for row in slots)
    dense: list[list[TableSlot]] = []
    for row in slots:
        if len(row) != width or any(slot is None for slot in row):
            raise ValueError("table must be rectangular")
        dense.append([slot for slot in row if slot is not None])
    return ExpandedTable(width=width, height=len(rows), slots=dense, anchors=anchors)


def expand_table(rows: list[list[TableCell]]) -> ExpandedTable:
    frozen_rows = tuple(tuple(row) for row in rows)
    if all(type(cell) is TableCell for row in frozen_rows for cell in row):
        try:
            hash(frozen_rows)
        except TypeError:
            return _expand_table_direct(rows)
        return _materialize_expansion_plan(_cached_expansion_plan(frozen_rows), rows)
    return _expand_table_direct(rows)


_DEFAULT_EXPAND_TABLE = expand_table


_TablePlan = tuple[tuple[TableCell, ...], ...]
_TABLE_PLAN_MAX_SOURCE_CHARS = 16 * 1024


def _build_table_plan(source: str) -> _TablePlan:
    return tuple(tuple(row) for row in _parse_table_rows(source))


@lru_cache(maxsize=128)
def _cached_table_plan(source: str) -> _TablePlan:
    return _build_table_plan(source)


def _table_plan(source: str) -> _TablePlan:
    # Share parsed cells and the expanded grid across preview, TeX, and Word
    # exports while keeping unusually large source strings out of the cache.
    if len(source) <= _TABLE_PLAN_MAX_SOURCE_CHARS:
        return _cached_table_plan(source)
    return _build_table_plan(source)


def _find_math_close(text: str, delimiter: str, start: int) -> int:
    index = start
    while index < len(text):
        if text[index] != "$":
            index += 1
            continue
        token = "$$" if text.startswith("$$", index) else "$"
        if token == delimiter:
            return index
        index += len(token)
    return -1


def _iter_math_segments(text: str) -> Iterator[tuple[str, str | None]]:
    """Yield (plain text, None) or (formula body, its exact dollar delimiter)."""
    plain_start = 0
    index = 0
    size = len(text)
    while index < size:
        if text[index] != "$":
            index += 1
            continue
        delimiter = "$$" if text.startswith("$$", index) else "$"
        closing = _find_math_close(text, delimiter, index + len(delimiter))
        if closing < 0:
            if plain_start < size:
                yield text[plain_start:], None
            return
        if plain_start < index:
            yield text[plain_start:index], None
        yield text[index + len(delimiter) : closing], delimiter
        index = closing + len(delimiter)
        plain_start = index
    if plain_start < size:
        yield text[plain_start:], None


def _latex_text(text: str) -> str:
    out: list[str] = []
    for segment, delimiter in _iter_math_segments(text):
        if delimiter is None:
            out.append(latex_escape_text(segment).replace("\n", r"\newline "))
        else:
            out.extend((delimiter, segment, delimiter))
    return "".join(out)


def _col_width(width: int, span: int = 1) -> str:
    portion = max(0.12, min(0.92, 0.92 * span / max(width, 1)))
    return f"{portion:.3f}\\linewidth"


def _render_table_latex_uncached(source: str) -> str:
    expanded = expand_table([list(row) for row in _table_plan(source)])
    spec = "|" + "|".join([rf"p{{{_col_width(expanded.width)}}}" for _ in range(expanded.width)]) + "|"
    lines = [r"\begin{center}", r"\small", rf"\begin{{tabular}}{{{spec}}}", r"\hline"]
    if any(anchor.cell.row_span > 1 for anchor in expanded.anchors):
        lines.insert(2, r"\providecommand{\multirow}[3]{#3}")
    for r, row in enumerate(expanded.slots):
        rendered: list[str] = []
        c = 0
        while c < expanded.width:
            slot = row[c]
            cell = slot.cell
            if slot.covered:
                if slot.anchor_row < r and slot.anchor_col == c:
                    if cell.col_span > 1:
                        rendered.append(rf"\multicolumn{{{cell.col_span}}}{{|p{{{_col_width(expanded.width, cell.col_span)}}}|}}{{}}")
                    else:
                        rendered.append("")
                    c += cell.col_span
                    continue
                c += 1
                continue
            body = _latex_text(cell.text)
            if cell.header:
                body = rf"\textbf{{{body}}}"
            if cell.row_span > 1:
                body = rf"\multirow{{{cell.row_span}}}{{*}}{{{body}}}"
            if cell.col_span > 1:
                body = rf"\multicolumn{{{cell.col_span}}}{{|p{{{_col_width(expanded.width, cell.col_span)}}}|}}{{{body}}}"
            rendered.append(body)
            c += cell.col_span
        lines.append(" & ".join(rendered) + r" \\")
        lines.append(r"\hline")
    lines.extend([r"\end{tabular}", r"\end{center}"])
    return "\n".join(lines)


def _cached_table_output(format: Literal["latex", "openxml"], source: str) -> str:
    if expand_table is not _DEFAULT_EXPAND_TABLE or type(source) is not str:
        renderer = _render_table_latex_uncached if format == "latex" else _render_table_openxml_uncached
        return renderer(source)
    if sys.getsizeof(source) + 128 > _TABLE_RENDER_CACHE_MAX_BYTES:
        return _render_table_latex_uncached(source) if format == "latex" else _render_table_openxml_uncached(source)

    key = (format, source)
    with _TABLE_RENDER_CACHE_LOCK:
        cached = _TABLE_RENDER_CACHE.get(key)
        if cached is not None:
            _TABLE_RENDER_CACHE.move_to_end(key)
            return cached[0]

    renderer = _render_table_latex_uncached if format == "latex" else _render_table_openxml_uncached
    output = renderer(source)
    weight = (
        sys.getsizeof(source)
        + sys.getsizeof(output)
        + sys.getsizeof(key)
        + sys.getsizeof((output, 0))
        + 128  # OrderedDict entry and retained format metadata.
    )
    if weight <= _TABLE_RENDER_CACHE_MAX_BYTES:
        global _TABLE_RENDER_CACHE_BYTES
        with _TABLE_RENDER_CACHE_LOCK:
            previous = _TABLE_RENDER_CACHE.pop(key, None)
            if previous is not None:
                _TABLE_RENDER_CACHE_BYTES -= previous[1]
            _TABLE_RENDER_CACHE[key] = (output, weight)
            _TABLE_RENDER_CACHE_BYTES += weight
            while (
                len(_TABLE_RENDER_CACHE) > _TABLE_RENDER_CACHE_MAX_ENTRIES
                or _TABLE_RENDER_CACHE_BYTES > _TABLE_RENDER_CACHE_MAX_BYTES
            ):
                _old_key, (_old_output, old_weight) = _TABLE_RENDER_CACHE.popitem(last=False)
                _TABLE_RENDER_CACHE_BYTES -= old_weight
    return output


def table_to_latex(source: str) -> str:
    return _cached_table_output("latex", source)


def expand_tables_for_latex(text: str) -> str:
    if not text or "```solaire-table" not in text:
        return text
    return TABLE_FENCE_RE.sub(lambda m: "\n" + table_to_latex(m.group(1)) + "\n", text)


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _paragraph_content_with_math(text: str) -> str:
    out: list[str] = []
    for segment, delimiter in _iter_math_segments(text):
        if delimiter is None:
            if segment:
                out.append(f'<w:r><w:t xml:space="preserve">{_xml_escape(segment)}</w:t></w:r>')
        else:
            math = _xml_escape(segment)
            out.append(f"<m:oMath><m:r><m:t>{math}</m:t></m:r></m:oMath>")
    return "".join(out) or '<w:r><w:t xml:space="preserve"></w:t></w:r>'


def _cell_paragraphs(text: str) -> str:
    lines = text.splitlines() or [""]
    return "".join("<w:p>" + _paragraph_content_with_math(line) + "</w:p>" for line in lines)


def _render_table_openxml_uncached(source: str) -> str:
    expanded = expand_table([list(row) for row in _table_plan(source)])
    grid = "".join('<w:gridCol w:w="2400"/>' for _ in range(expanded.width))
    rows: list[str] = []
    for r, row in enumerate(expanded.slots):
        cells: list[str] = []
        c = 0
        while c < expanded.width:
            slot = row[c]
            cell = slot.cell
            if slot.covered:
                if slot.anchor_row < r and slot.anchor_col == c:
                    props = []
                    if cell.col_span > 1:
                        props.append(f'<w:gridSpan w:val="{cell.col_span}"/>')
                    props.append("<w:vMerge/>")
                    cells.append(f"<w:tc><w:tcPr>{''.join(props)}</w:tcPr><w:p/></w:tc>")
                    c += cell.col_span
                    continue
                c += 1
                continue
            props = ['<w:tcW w:w="2400" w:type="dxa"/>']
            if cell.col_span > 1:
                props.append(f'<w:gridSpan w:val="{cell.col_span}"/>')
            if cell.row_span > 1:
                props.append('<w:vMerge w:val="restart"/>')
            if cell.header:
                props.append('<w:shd w:fill="F1F5F9"/>')
            cells.append(f"<w:tc><w:tcPr>{''.join(props)}</w:tcPr>{_cell_paragraphs(cell.text)}</w:tc>")
            c += cell.col_span
        rows.append("<w:tr>" + "".join(cells) + "</w:tr>")
    return (
        '<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
        '<w:tblPr><w:tblBorders>'
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        "</w:tblBorders></w:tblPr>"
        f"<w:tblGrid>{grid}</w:tblGrid>"
        + "".join(rows)
        + "</w:tbl>"
    )


def table_to_openxml(source: str) -> str:
    return _cached_table_output("openxml", source)


def expand_tables_for_docx_markdown(text: str) -> str:
    if not text or "```solaire-table" not in text:
        return text

    def repl(match: re.Match[str]) -> str:
        return "\n\n```{=openxml}\n" + table_to_openxml(match.group(1)) + "\n```\n\n"

    return TABLE_FENCE_RE.sub(repl, text)


def separate_markdown_tables(text: str) -> str:
    """Keep pipe tables separate from paragraphs and generated question labels."""
    if not text or "|" not in text:
        return text
    lines = text.split("\n")
    output: list[str] = []
    fence: str | None = None
    for index, line in enumerate(lines):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence) and not line[marker.end():].strip():
                fence = None
        if fence is None and index + 1 < len(lines) and "|" in line and not line.startswith(("    ", "\t")):
            cells = lines[index + 1].strip().strip("|").split("|")
            if len(cells) >= 2 and all(re.fullmatch(r"\s*:?-+:?\s*", cell) for cell in cells):
                if not output:
                    output.extend(["", ""])
                elif output[-1].strip():
                    output.append("")
        output.append(line)
    return "\n".join(output)
