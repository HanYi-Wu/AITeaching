"""Common attachment capabilities and bounded, non-executing text extraction."""

from __future__ import annotations

import csv
import html
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from io import StringIO
from pathlib import Path
from typing import Any, Literal
from zipfile import BadZipFile, ZipFile


AttachmentStrategy = Literal["builtin", "ocr", "converter", "unsupported"]

TEXT_SUFFIXES = frozenset({".txt", ".md", ".yaml", ".yml", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".rtf"})
SPREADSHEET_SUFFIXES = frozenset({".xlsx", ".xls"})
DOCUMENT_SUFFIXES = frozenset({".docx", ".pdf"})
PRESENTATION_SUFFIXES = frozenset({".pptx"})
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"})
CONVERTER_SUFFIXES = frozenset({".doc", ".ppt", ".odt", ".ods", ".odp"})
SUPPORTED_UPLOAD_SUFFIXES = frozenset(
    TEXT_SUFFIXES
    | SPREADSHEET_SUFFIXES
    | DOCUMENT_SUFFIXES
    | PRESENTATION_SUFFIXES
    | IMAGE_SUFFIXES
    | CONVERTER_SUFFIXES
)

MAX_ARCHIVE_MEMBERS = 2_000
MAX_ARCHIVE_EXPANDED_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_MEMBER_BYTES = 20 * 1024 * 1024
MAX_SHEETS = 20
MAX_ROWS_PER_SHEET = 500
MAX_COLUMNS_PER_SHEET = 50
MAX_PDF_PAGES = 80
MAX_SLIDES = 200


@dataclass(frozen=True)
class AttachmentCapability:
    suffix: str
    kind: str
    strategy: AttachmentStrategy
    suggestion: str
    supported_extensions: tuple[str, ...] = field(
        default_factory=lambda: tuple(sorted(SUPPORTED_UPLOAD_SUFFIXES))
    )


@dataclass(frozen=True)
class AttachmentExtraction:
    kind: str
    content: str = ""
    truncated: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    error: str = ""
    suggestion: str = ""


def capability_for_filename(filename: str) -> AttachmentCapability:
    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return AttachmentCapability(suffix, "text", "builtin", "可直接读取并交给 AI 处理。")
    if suffix in SPREADSHEET_SUFFIXES:
        return AttachmentCapability(suffix, "spreadsheet", "builtin", "将按工作表、行和列提取为结构化文本。")
    if suffix in DOCUMENT_SUFFIXES:
        return AttachmentCapability(suffix, "document", "builtin", "将提取段落、表格或页面文本。")
    if suffix in PRESENTATION_SUFFIXES:
        return AttachmentCapability(suffix, "presentation", "builtin", "将按幻灯片提取标题和正文。")
    if suffix in IMAGE_SUFFIXES:
        return AttachmentCapability(
            suffix,
            "image",
            "ocr",
            "图片已支持上传；需要在“设置 → 扩展组件”配置文字识别（OCR）后由 AI 识别文字。",
        )
    if suffix in CONVERTER_SUFFIXES:
        modern = {".doc": ".docx", ".ppt": ".pptx", ".odt": ".docx", ".ods": ".xlsx", ".odp": ".pptx"}.get(suffix, ".pdf")
        return AttachmentCapability(
            suffix,
            "convertible",
            "converter",
            f"该旧格式可上传，但直接解析需要“设置 → 扩展组件 → 文档转换”；也可先转换为 {modern}。",
        )
    return AttachmentCapability(
        suffix,
        "unknown",
        "unsupported",
        "不支持此文件类型。请转换为 PDF、DOCX、XLSX、PPTX、常用文本或图片格式后重试。",
    )


def _bounded(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    marker = "\n\n[内容已截断，请缩小文件或分批处理]"
    keep = max(0, max_chars - len(marker))
    return f"{text[:keep]}{marker}"[:max_chars], True


def _archive_error(path: Path) -> str | None:
    try:
        with ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) > MAX_ARCHIVE_MEMBERS:
                return f"压缩容器包含 {len(members)} 个条目，超过安全上限 {MAX_ARCHIVE_MEMBERS}。"
            expanded = 0
            for member in members:
                if member.file_size > MAX_ARCHIVE_MEMBER_BYTES:
                    return f"压缩条目 {member.filename} 解压后过大。"
                expanded += member.file_size
                if expanded > MAX_ARCHIVE_EXPANDED_BYTES:
                    return "文件解压后的总大小超过 50MB 安全上限。"
    except BadZipFile:
        return "文件不是有效的 Office 压缩容器。"
    return None


def _display_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _markdown_table(rows: list[list[Any]]) -> str:
    if not rows:
        return "(空表)"
    width = max(len(row) for row in rows)
    normalized = [[_display_cell(row[i]) if i < len(row) else "" for i in range(width)] for row in rows]
    header = normalized[0]
    body = normalized[1:]
    lines = [f"| {' | '.join(header)} |", f"| {' | '.join(['---'] * width)} |"]
    lines.extend(f"| {' | '.join(row)} |" for row in body)
    return "\n".join(lines)


def _decode_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _extract_text(path: Path) -> str:
    text = _decode_text(path)
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
        text = re.sub(r"\s+", " ", text).strip()
    elif suffix == ".rtf":
        text = re.sub(r"\\[a-z]+\d* ?|[{}]", "", text, flags=re.IGNORECASE)
    elif suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        rows = [row[:MAX_COLUMNS_PER_SHEET] for _, row in zip(range(MAX_ROWS_PER_SHEET), csv.reader(StringIO(text), delimiter=delimiter))]
        text = _markdown_table(rows)
    return text


def _extract_xlsx(path: Path, *, max_chars: int = 40_000) -> tuple[str, dict[str, Any]]:
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True, keep_links=False)
    chunks: list[str] = []
    content_chars = 0
    char_limit_reached = False
    sheet_count = 0

    def append(text: str) -> None:
        nonlocal content_chars, char_limit_reached
        if char_limit_reached or not text:
            return
        remaining = max_chars + 1 - content_chars
        if remaining <= 0:
            char_limit_reached = True
            return
        fragment = text[:remaining]
        chunks.append(fragment)
        content_chars += len(fragment)
        if len(fragment) < len(text) or content_chars > max_chars:
            char_limit_reached = True

    def render_row(row: tuple[Any, ...] | list[Any], width: int) -> list[str]:
        return [
            _display_cell(row[index]) if index < len(row) else ""
            for index in range(width)
        ]

    try:
        for sheet_index, sheet in enumerate(workbook.worksheets[:MAX_SHEETS]):
            sheet_count += 1
            if sheet_index:
                append("\n\n")
            append(f"## 工作表: {sheet.title}\n\n")

            rows = iter(sheet.iter_rows(values_only=True))
            first_row = next(rows, None)
            if first_row is None:
                append("(空表)")
                continue

            first_values = list(first_row[:MAX_COLUMNS_PER_SHEET])
            declared_width = sheet.max_column
            if (
                not char_limit_reached
                and declared_width is None
                and len(first_values) < MAX_COLUMNS_PER_SHEET
            ):
                # An unsized worksheet can have ragged rows. Keep the legacy maximum
                # width across the bounded rows before formatting its table.
                table_rows = [first_values]
                for index, row in enumerate(rows, start=1):
                    if index >= MAX_ROWS_PER_SHEET:
                        break
                    table_rows.append(list(row[:MAX_COLUMNS_PER_SHEET]))
                append(_markdown_table(table_rows))
                continue

            width = (
                min(declared_width, MAX_COLUMNS_PER_SHEET)
                if declared_width is not None
                else MAX_COLUMNS_PER_SHEET
            )
            if not char_limit_reached:
                header = render_row(first_values, width)
                append(f"| {' | '.join(header)} |\n")
                append(f"| {' | '.join(['---'] * width)} |")

            # Continue consuming rows even after the output budget is known. This
            # preserves errors raised while parsing rows within the legacy limit.
            for index, row in enumerate(rows, start=1):
                if index >= MAX_ROWS_PER_SHEET:
                    break
                if not char_limit_reached:
                    values = list(row[:width])
                    body = render_row(values, width)
                    append(f"\n| {' | '.join(body)} |")
    finally:
        workbook.close()

    return "".join(chunks), {"sheets": sheet_count}


def _extract_xls(path: Path) -> tuple[str, dict[str, Any]]:
    import xlrd

    workbook = xlrd.open_workbook(path, on_demand=True)
    chunks: list[str] = []
    names = workbook.sheet_names()[:MAX_SHEETS]
    for name in names:
        sheet = workbook.sheet_by_name(name)
        rows = [
            [sheet.cell_value(row, col) for col in range(min(sheet.ncols, MAX_COLUMNS_PER_SHEET))]
            for row in range(min(sheet.nrows, MAX_ROWS_PER_SHEET))
        ]
        chunks.append(f"## 工作表: {name}\n\n{_markdown_table(rows)}")
    workbook.release_resources()
    return "\n\n".join(chunks), {"sheets": len(names)}


def _extract_docx(path: Path) -> tuple[str, dict[str, Any]]:
    from docx import Document

    document = Document(path)
    parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for index, table in enumerate(document.tables, 1):
        rows = [[cell.text for cell in row.cells] for row in table.rows[:MAX_ROWS_PER_SHEET]]
        parts.append(f"## 表格 {index}\n\n{_markdown_table(rows)}")
    return "\n\n".join(parts), {"paragraphs": len(document.paragraphs), "tables": len(document.tables)}


def _extract_pptx(path: Path) -> tuple[str, dict[str, Any]]:
    from pptx import Presentation

    presentation = Presentation(path)
    chunks: list[str] = []
    slide_count = 0
    for index, slide in enumerate(presentation.slides, 1):
        if index > MAX_SLIDES:
            break
        slide_count = index
        texts: list[str] = []
        for shape in slide.shapes:
            value = getattr(shape, "text", "")
            if isinstance(value, str) and value.strip():
                texts.append(value.strip())
        chunks.append(f"## 幻灯片 {index}\n\n" + "\n\n".join(texts))
    return "\n\n".join(chunks), {"slides": slide_count, "total_slides": len(presentation.slides)}


def _extract_pdf(path: Path, *, max_chars: int = 40_000) -> tuple[str, dict[str, Any]]:
    import pdfplumber
    from pdfminer.pdfpage import PDFPage

    pages: list[str] = []
    content_length = 0
    extracted_pages = 0
    char_budget_exceeded = False
    # Avoid constructing pdfplumber.Page wrapper objects for unextracted pages (> MAX_PDF_PAGES)
    with pdfplumber.open(path, pages=list(range(1, MAX_PDF_PAGES + 1))) as pdf:
        # Traverse lightweight page index for exact total_pages without full Page wrappers
        total = sum(1 for _ in PDFPage.create_pages(pdf.doc))
        selected_page_count = min(total, MAX_PDF_PAGES)
        for index, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            heading = f"## 第 {index} 页\n\n"
            separator = "\n\n" if pages else ""
            projected_length = content_length + len(separator) + len(heading) + len(text)
            if projected_length > max_chars:
                char_budget_exceeded = True
                content_before_page = "\n\n".join(pages)
                chars_needed = max_chars + 1 - len(content_before_page) - len(separator) - len(heading)
                raw_prefix = content_before_page + separator + heading + text[:max(0, chars_needed)]
                pages = [_bounded(raw_prefix, max_chars)[0]]
                extracted_pages = index
                break

            pages.append(heading + text)
            content_length = projected_length
            extracted_pages = index
            if content_length == max_chars and index < selected_page_count:
                # The current page fits exactly, but a later selected page would be omitted.
                content_before_page = "\n\n".join(pages)
                pages = [_bounded(content_before_page + "\0", max_chars)[0]]
                char_budget_exceeded = True
                break

        # Explicitly close pages and clear pages_to_parse to prevent pdf.close()
        # from re-instantiating Page objects when flush_cache() deletes _pages
        if hasattr(pdf, "_pages"):
            for p in list(pdf._pages):
                p.close()
        pdf.pages_to_parse = []

    metadata: dict[str, Any] = {
        "pages": min(total, MAX_PDF_PAGES),
        "total_pages": total,
        "page_budget": MAX_PDF_PAGES,
        "extracted_pages": extracted_pages,
    }
    if total > MAX_PDF_PAGES:
        metadata["page_truncated"] = True
    if char_budget_exceeded:
        metadata["char_truncated"] = True
    return "\n\n".join(pages), metadata


def extract_attachment(path: Path, *, max_chars: int = 40_000) -> AttachmentExtraction:
    capability = capability_for_filename(path.name)
    if not path.is_file():
        return AttachmentExtraction(capability.kind, error_code="not_found", error="文件不存在。")
    if capability.strategy == "unsupported":
        return AttachmentExtraction(
            capability.kind,
            error_code="unsupported_file_type",
            error="不支持的文件类型。",
            suggestion=capability.suggestion,
        )
    if capability.strategy == "converter":
        return AttachmentExtraction(
            capability.kind,
            error_code="converter_required",
            error="该格式需要文档转换组件。",
            suggestion=capability.suggestion,
        )
    if capability.strategy == "ocr":
        from solaire.agent_layer.ocr import extract_image_text, INSTALL_HINT
        try:
            content, truncated = _bounded(extract_image_text(path), max_chars)
            return AttachmentExtraction(capability.kind, content=content, truncated=truncated,
                                        metadata={"engine": "tesseract", "lang": "chi_sim+eng"})
        except Exception as exc:
            return AttachmentExtraction(capability.kind,
                error_code="ocr_required" if isinstance(exc, FileNotFoundError) else "ocr_failed",
                error=str(exc), suggestion=INSTALL_HINT)

    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".docx", ".pptx"}:
        archive_error = _archive_error(path)
        if archive_error:
            return AttachmentExtraction(
                capability.kind,
                error_code="unsafe_archive",
                error=archive_error,
                suggestion="请使用 Office 重新另存文件后再试；不要上传异常压缩包。",
            )
    try:
        metadata: dict[str, Any] = {}
        if suffix in TEXT_SUFFIXES:
            content = _extract_text(path)
        elif suffix == ".xlsx":
            content, metadata = _extract_xlsx(path, max_chars=max_chars)
        elif suffix == ".xls":
            content, metadata = _extract_xls(path)
        elif suffix == ".docx":
            content, metadata = _extract_docx(path)
        elif suffix == ".pptx":
            content, metadata = _extract_pptx(path)
        elif suffix == ".pdf":
            content, metadata = _extract_pdf(path, max_chars=max_chars)
        else:
            return AttachmentExtraction(capability.kind, error_code="unsupported_file_type", error="没有可用解析器。", suggestion=capability.suggestion)
        bounded, is_char_bounded = _bounded(content, max_chars)
        page_truncated = bool(metadata.pop("page_truncated", False))
        char_truncated = bool(metadata.pop("char_truncated", False)) or is_char_bounded
        truncated = is_char_bounded or page_truncated or char_truncated
        if page_truncated and char_truncated:
            metadata["truncation_reason"] = "page_limit,char_limit"
        elif page_truncated:
            metadata["truncation_reason"] = "page_limit"
        elif char_truncated:
            metadata["truncation_reason"] = "char_limit"
        return AttachmentExtraction(capability.kind, content=bounded, truncated=truncated, metadata=metadata)
    except Exception as exc:
        return AttachmentExtraction(
            capability.kind,
            error_code="extract_failed",
            error=f"文件解析失败：{exc}",
            suggestion="请确认文件未损坏、未加密；必要时另存为 PDF 或现代 Office 格式后重试。",
        )
