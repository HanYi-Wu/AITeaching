"""Reference DOCX preparation and Pandoc process execution."""

from __future__ import annotations

import subprocess
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from solaire.web.extension_registry import resolve_exe

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_XML_NAMESPACES = {
    "w": _W_NS,
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
}

for _prefix, _uri in _XML_NAMESPACES.items():
    ET.register_namespace(_prefix, _uri)


class PandocError(RuntimeError):
    """Raised when DOCX export cannot run or Pandoc fails."""

    def __init__(
        self,
        message: str,
        *,
        returncode: int | None = None,
        stdout: str = "",
        stderr: str = "",
    ) -> None:
        super().__init__(message)
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _tail(s: str, max_len: int = 2000) -> str:
    s = (s or "").strip()
    if len(s) <= max_len:
        return s
    return s[-max_len:]


def format_pandoc_failure_message(exc: PandocError) -> str:
    """Return a compact user-facing DOCX export failure message."""
    msg = str(exc).strip() or "Pandoc 文档转换失败。"
    if exc.returncode is None and not exc.stdout and not exc.stderr:
        return msg
    details = "\n".join(part for part in (_tail(exc.stderr), _tail(exc.stdout)) if part)
    if not details:
        return f"{msg}（退出码 {exc.returncode}）"
    return f"{msg}\n\n{details}"


def _w(name: str) -> str:
    return f"{{{_W_NS}}}{name}"


def _decode_process_output(data: bytes | str | None) -> str:
    if data is None:
        return ""
    if isinstance(data, bytes):
        return data.decode("utf-8", errors="replace")
    return data


def _ensure_child(parent: ET.Element, name: str) -> ET.Element:
    child = parent.find(_w(name))
    if child is None:
        child = ET.SubElement(parent, _w(name))
    return child


def _remove_children(parent: ET.Element, name: str) -> None:
    tag = _w(name)
    for child in list(parent):
        if child.tag == tag:
            parent.remove(child)


def _set_val(parent: ET.Element, name: str, value: str) -> ET.Element:
    child = _ensure_child(parent, name)
    child.set(_w("val"), value)
    return child


def _set_on_off(parent: ET.Element, name: str, enabled: bool) -> None:
    if enabled:
        child = _ensure_child(parent, name)
        child.attrib.pop(_w("val"), None)
    else:
        _remove_children(parent, name)


def _style_by_id(styles_root: ET.Element, style_id: str) -> ET.Element | None:
    for style in styles_root.findall(_w("style")):
        if style.get(_w("styleId")) == style_id:
            return style
    return None


def _find_or_create_style(
    styles_root: ET.Element,
    style_ids: tuple[str, ...],
    *,
    style_type: str,
    display_name: str,
) -> ET.Element:
    for style_id in style_ids:
        style = _style_by_id(styles_root, style_id)
        if style is not None:
            return style
    style = ET.SubElement(
        styles_root,
        _w("style"),
        {_w("type"): style_type, _w("styleId"): style_ids[0]},
    )
    _set_val(style, "name", display_name)
    return style


def _set_run_properties(
    rpr: ET.Element,
    *,
    east_asia_font: str,
    latin_font: str = "Times New Roman",
    size_half_points: int,
    bold: bool = False,
) -> None:
    fonts = _ensure_child(rpr, "rFonts")
    fonts.set(_w("ascii"), latin_font)
    fonts.set(_w("hAnsi"), latin_font)
    fonts.set(_w("eastAsia"), east_asia_font)
    fonts.set(_w("cs"), latin_font)
    _set_val(rpr, "sz", str(size_half_points))
    _set_val(rpr, "szCs", str(size_half_points))
    _set_val(rpr, "color", "000000")
    lang = _ensure_child(rpr, "lang")
    lang.set(_w("val"), "en-US")
    lang.set(_w("eastAsia"), "zh-CN")
    _set_on_off(rpr, "b", bold)
    _set_on_off(rpr, "bCs", bold)


def _set_paragraph_properties(
    ppr: ET.Element,
    *,
    before_twips: int,
    after_twips: int,
    line_twips: int,
    alignment: str | None = None,
    keep_next: bool = False,
) -> None:
    spacing = _ensure_child(ppr, "spacing")
    spacing.set(_w("before"), str(before_twips))
    spacing.set(_w("after"), str(after_twips))
    spacing.set(_w("line"), str(line_twips))
    spacing.set(_w("lineRule"), "exact")
    if alignment:
        _set_val(ppr, "jc", alignment)
    else:
        _remove_children(ppr, "jc")
    _set_on_off(ppr, "keepNext", keep_next)


def _patch_paragraph_style(
    styles_root: ET.Element,
    style_ids: tuple[str, ...],
    *,
    display_name: str,
    east_asia_font: str,
    size_half_points: int,
    bold: bool,
    before_twips: int,
    after_twips: int,
    line_twips: int,
    alignment: str | None = None,
    keep_next: bool = False,
) -> None:
    style = _find_or_create_style(
        styles_root,
        style_ids,
        style_type="paragraph",
        display_name=display_name,
    )
    ppr = _ensure_child(style, "pPr")
    rpr = _ensure_child(style, "rPr")
    _set_paragraph_properties(
        ppr,
        before_twips=before_twips,
        after_twips=after_twips,
        line_twips=line_twips,
        alignment=alignment,
        keep_next=keep_next,
    )
    _set_run_properties(
        rpr,
        east_asia_font=east_asia_font,
        size_half_points=size_half_points,
        bold=bold,
    )


def _patch_table_style(styles_root: ET.Element) -> None:
    style = _find_or_create_style(
        styles_root,
        ("Table", "TableGrid"),
        style_type="table",
        display_name="Table",
    )
    rpr = _ensure_child(style, "rPr")
    _set_run_properties(rpr, east_asia_font="SimSun", size_half_points=21)
    tbl_pr = _ensure_child(style, "tblPr")
    cell_mar = _ensure_child(tbl_pr, "tblCellMar")
    for side in ("top", "left", "bottom", "right"):
        cell = _ensure_child(cell_mar, side)
        cell.set(_w("w"), "90")
        cell.set(_w("type"), "dxa")


def _patch_reference_styles_xml(styles_xml: bytes) -> bytes:
    root = ET.fromstring(styles_xml)
    defaults = _ensure_child(root, "docDefaults")
    default_rpr = _ensure_child(_ensure_child(defaults, "rPrDefault"), "rPr")
    default_ppr = _ensure_child(_ensure_child(defaults, "pPrDefault"), "pPr")
    _set_run_properties(default_rpr, east_asia_font="SimSun", size_half_points=21)
    _set_paragraph_properties(
        default_ppr,
        before_twips=0,
        after_twips=60,
        line_twips=360,
    )

    body_styles = (
        ("Normal",),
        ("BodyText",),
        ("FirstParagraph",),
        ("Compact",),
        ("BlockText",),
    )
    for style_ids in body_styles:
        _patch_paragraph_style(
            root,
            style_ids,
            display_name=style_ids[0],
            east_asia_font="SimSun",
            size_half_points=21,
            bold=False,
            before_twips=0,
            after_twips=60,
            line_twips=360,
        )

    _patch_paragraph_style(
        root,
        ("Title",),
        display_name="Title",
        east_asia_font="SimHei",
        size_half_points=36,
        bold=True,
        before_twips=0,
        after_twips=240,
        line_twips=440,
        alignment="center",
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Heading1",),
        display_name="Heading 1",
        east_asia_font="SimHei",
        size_half_points=36,
        bold=True,
        before_twips=0,
        after_twips=240,
        line_twips=440,
        alignment="center",
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Heading2",),
        display_name="Heading 2",
        east_asia_font="SimHei",
        size_half_points=24,
        bold=True,
        before_twips=160,
        after_twips=80,
        line_twips=360,
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Heading3",),
        display_name="Heading 3",
        east_asia_font="SimHei",
        size_half_points=22,
        bold=True,
        before_twips=120,
        after_twips=60,
        line_twips=340,
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Caption",),
        display_name="Caption",
        east_asia_font="SimSun",
        size_half_points=18,
        bold=False,
        before_twips=40,
        after_twips=60,
        line_twips=300,
        alignment="center",
    )
    _patch_table_style(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _patch_reference_document_xml(document_xml: bytes) -> bytes:
    root = ET.fromstring(document_xml)
    body = root.find(_w("body"))
    if body is None:
        return document_xml
    sect_pr = body.find(_w("sectPr"))
    if sect_pr is None:
        sect_pr = ET.SubElement(body, _w("sectPr"))
    pg_sz = _ensure_child(sect_pr, "pgSz")
    pg_sz.set(_w("w"), "11906")
    pg_sz.set(_w("h"), "16838")
    pg_mar = _ensure_child(sect_pr, "pgMar")
    pg_mar.set(_w("top"), "1134")
    pg_mar.set(_w("bottom"), "1134")
    pg_mar.set(_w("left"), "1021")
    pg_mar.set(_w("right"), "1021")
    pg_mar.set(_w("header"), "567")
    pg_mar.set(_w("footer"), "567")
    pg_mar.set(_w("gutter"), "0")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _patch_reference_docx(reference_docx: Path) -> None:
    tmp = reference_docx.with_name(f"{reference_docx.stem}.tmp.docx")
    with zipfile.ZipFile(reference_docx, "r") as zin:
        names = set(zin.namelist())
        replacements: dict[str, bytes] = {}
        if "word/styles.xml" in names:
            replacements["word/styles.xml"] = _patch_reference_styles_xml(
                zin.read("word/styles.xml")
            )
        if "word/document.xml" in names:
            replacements["word/document.xml"] = _patch_reference_document_xml(
                zin.read("word/document.xml")
            )
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = replacements.get(item.filename)
                if data is None:
                    data = zin.read(item.filename)
                zout.writestr(item, data)
    tmp.replace(reference_docx)


def _ensure_gaokao_reference_docx(
    reference_docx: Path,
    pandoc: str,
    *,
    subprocess_run: Callable[..., Any] = subprocess.run,
    patch_reference_docx: Callable[[Path], None] = _patch_reference_docx,
    error_type: type[PandocError] = PandocError,
) -> Path:
    if reference_docx.is_file() and reference_docx.stat().st_size > 0:
        return reference_docx
    reference_docx.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess_run(
            [pandoc, "--print-default-data-file=reference.docx"],
            capture_output=True,
            timeout=60,
            check=False,
        )
    except FileNotFoundError as e:
        raise error_type(
            "未检测到用于导出 Word 的文档转换组件 Pandoc。请在“设置/扩展组件”中安装或指定 Pandoc 后重试。"
        ) from e
    except subprocess.TimeoutExpired as e:
        raise error_type(
            "Pandoc 生成 Word 样式模板超时。",
            stdout=_decode_process_output(e.stdout),
            stderr=_decode_process_output(e.stderr),
        ) from e
    if proc.returncode != 0 or not proc.stdout:
        raise error_type(
            "Pandoc 生成 Word 样式模板失败。",
            returncode=proc.returncode,
            stdout=_decode_process_output(proc.stdout),
            stderr=_decode_process_output(proc.stderr),
        )
    reference_docx.write_bytes(proc.stdout)
    try:
        patch_reference_docx(reference_docx)
    except (OSError, zipfile.BadZipFile, ET.ParseError) as e:
        raise error_type(f"无法准备 Word 样式模板: {e}") from e
    return reference_docx


def _run_pandoc(
    md_path: Path,
    docx_path: Path,
    *,
    pandoc_path: str | None = None,
    reference_docx: Path | None = None,
    resolve_executable: Callable[[str, str], str | None] = resolve_exe,
    ensure_reference_docx: Callable[[Path, str], Path] = _ensure_gaokao_reference_docx,
    subprocess_run: Callable[..., Any] = subprocess.run,
    error_type: type[PandocError] = PandocError,
) -> None:
    pandoc = pandoc_path or resolve_executable("pandoc", "pandoc")
    if not pandoc:
        raise error_type(
            "未检测到用于导出 Word 的文档转换组件 Pandoc。请在“设置/扩展组件”中安装或指定 Pandoc 后重试。"
        )
    docx_path.parent.mkdir(parents=True, exist_ok=True)
    reference = reference_docx or ensure_reference_docx(
        md_path.parent / "gaokao_reference.docx",
        pandoc,
    )
    cmd = [
        pandoc,
        md_path.name,
        "-f",
        "markdown+tex_math_dollars+pipe_tables+raw_tex+raw_attribute",
        "-t",
        "docx",
        "--standalone",
        "--wrap=none",
        "--reference-doc",
        str(reference.resolve()),
        "-o",
        docx_path.name,
    ]
    try:
        proc = subprocess_run(
            cmd,
            cwd=md_path.parent,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            check=False,
        )
    except FileNotFoundError as e:
        raise error_type(
            "未检测到用于导出 Word 的文档转换组件 Pandoc。请在“设置/扩展组件”中安装或指定 Pandoc 后重试。"
        ) from e
    except subprocess.TimeoutExpired as e:
        raise error_type(
            "Pandoc 转换 Word 超时。",
            stdout=e.stdout or "",
            stderr=e.stderr or "",
        ) from e
    if proc.returncode != 0:
        raise error_type(
            f"Pandoc 转换 Word 失败（退出码 {proc.returncode}）。",
            returncode=proc.returncode,
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
        )
    if not docx_path.is_file():
        raise error_type("Pandoc reported success but DOCX not found.")
