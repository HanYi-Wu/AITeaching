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


def _extract_xlsx(path: Path) -> tuple[str, dict[str, Any]]:
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True, keep_links=False)
    chunks: list[str] = []
    sheet_count = 0
    for sheet in workbook.worksheets[:MAX_SHEETS]:
        sheet_count += 1
        rows: list[list[Any]] = []
        for index, row in enumerate(sheet.iter_rows(values_only=True)):
            if index >= MAX_ROWS_PER_SHEET:
                break
            rows.append(list(row[:MAX_COLUMNS_PER_SHEET]))
        chunks.append(f"## 工作表: {sheet.title}\n\n{_markdown_table(rows)}")
    workbook.close()
    return "\n\n".join(chunks), {"sheets": sheet_count}


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


def _extract_pdf(path: Path) -> tuple[str, dict[str, Any]]:
    import pdfplumber

    pages: list[str] = []
    with pdfplumber.open(path) as pdf:
        for index, page in enumerate(pdf.pages[:MAX_PDF_PAGES], 1):
            pages.append(f"## 第 {index} 页\n\n{page.extract_text() or ''}")
        total = len(pdf.pages)
    return "\n\n".join(pages), {"pages": min(total, MAX_PDF_PAGES), "total_pages": total}


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
        return AttachmentExtraction(
            capability.kind,
            error_code="ocr_required",
            error="图片需要文字识别后才能作为文本交给 AI。",
            suggestion=capability.suggestion,
        )

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
            content, metadata = _extract_xlsx(path)
        elif suffix == ".xls":
            content, metadata = _extract_xls(path)
        elif suffix == ".docx":
            content, metadata = _extract_docx(path)
        elif suffix == ".pptx":
            content, metadata = _extract_pptx(path)
        elif suffix == ".pdf":
            content, metadata = _extract_pdf(path)
        else:
            return AttachmentExtraction(capability.kind, error_code="unsupported_file_type", error="没有可用解析器。", suggestion=capability.suggestion)
        bounded, truncated = _bounded(content, max_chars)
        return AttachmentExtraction(capability.kind, content=bounded, truncated=truncated, metadata=metadata)
    except Exception as exc:
        return AttachmentExtraction(
            capability.kind,
            error_code="extract_failed",
            error=f"文件解析失败：{exc}",
            suggestion="请确认文件未损坏、未加密；必要时另存为 PDF 或现代 Office 格式后重试。",
        )
