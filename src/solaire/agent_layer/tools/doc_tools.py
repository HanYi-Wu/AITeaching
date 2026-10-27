"""Document conversion tools: Word→Markdown, PDF→text, image→OCR.

加固文档与OCR输出边界，施加明确的格式、容量与路径边界约束。
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.web.extension_registry import resolve_exe

_MAX_DOC_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
_MAX_PDF_PAGES = 100
_SUPPORTED_DOC_EXTS = frozenset(
    {".docx", ".doc", ".odt", ".rtf", ".html", ".htm", ".txt", ".epub", ".md"}
)
_SUPPORTED_IMAGE_EXTS = frozenset(
    {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp"}
)


def _resolve(ctx: InvocationContext, rel: str) -> Path:
    from solaire.agent_layer.tools.file_tools import _resolve as resolve_file

    return resolve_file(ctx, rel)


def _configured_tesseract_cmd() -> str | None:
    return resolve_exe("tesseract", "tesseract")


def _configured_pandoc_cmd() -> str | None:
    return resolve_exe("pandoc", "pandoc")


def tool_doc_convert_to_markdown(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    rel = str(args.get("path") or "").strip()
    if not rel:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="path 参数必填")
    if ".." in rel.replace("\\", "/").split("/"):
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="path 不得包含相对路径跳转 (..)",
        )
    try:
        p = _resolve(ctx, rel)
    except Exception as e:
        return ToolResult(status="failed", error_code="path_error", error_message=str(e))
    if not p.is_file():
        return ToolResult(status="failed", error_code="not_found", error_message=f"文件不存在: {rel}")

    suffix = p.suffix.lower()
    if suffix not in _SUPPORTED_DOC_EXTS:
        return ToolResult(
            status="failed",
            error_code="unsupported_format",
            error_message=f"不支持的文档格式: {p.suffix}，仅支持 Word/ODT/RTF/HTML/文本文档",
        )

    try:
        file_size = p.stat().st_size
    except OSError as e:
        return ToolResult(status="failed", error_code="io_error", error_message=f"无法读取文件信息: {e}")

    if file_size > _MAX_DOC_FILE_SIZE:
        return ToolResult(
            status="failed",
            error_code="file_too_large",
            error_message=f"文档大小超过限制（最大 50 MB）：当前为 {file_size} 字节",
        )

    pandoc_exe = _configured_pandoc_cmd()
    if pandoc_exe is None:
        return ToolResult(
            status="failed",
            error_code="tool_not_installed",
            error_message="本机未安装文档转换组件，无法进行转换。请打开「设置 → 扩展组件」安装「文档转换」后重试。",
        )
    try:
        result = subprocess.run(
            [pandoc_exe, str(p), "-t", "markdown", "--wrap=none"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        err_tail = (result.stderr or "")[:500]
        if result.returncode != 0:
            return ToolResult(
                status="failed",
                error_code="pandoc_failed",
                error_message=f"pandoc 转换失败: {err_tail}",
            )
        # Windows 下偶发 stdout 为 None（控制台/编码边界），须归一为 str 再写入文件
        md = result.stdout if isinstance(result.stdout, str) else ""
        if not md.strip() and err_tail.strip():
            return ToolResult(
                status="failed",
                error_code="pandoc_empty",
                error_message=f"pandoc 未输出内容，请确认源文件格式受支持。详情：{err_tail[:500]}",
            )
        out_rel = str(Path(rel).with_suffix(".md"))
        out_path = _resolve(ctx, out_rel)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(md, encoding="utf-8")
        return ToolResult(
            status="succeeded",
            data={
                "source": rel,
                "output": out_rel,
                "chars": len(md),
                "preview": md[:2000],
            },
        )
    except subprocess.TimeoutExpired:
        return ToolResult(status="failed", error_code="timeout", error_message="pandoc 转换超时（60秒）")
    except Exception as e:
        return ToolResult(status="failed", error_code="runtime_error", error_message=f"转换出错: {e}")


def tool_doc_extract_pdf_text(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    rel = str(args.get("path") or "").strip()
    if not rel:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="path 参数必填")
    if ".." in rel.replace("\\", "/").split("/"):
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="path 不得包含相对路径跳转 (..)",
        )
    try:
        p = _resolve(ctx, rel)
    except Exception as e:
        return ToolResult(status="failed", error_code="path_error", error_message=str(e))
    if not p.is_file():
        return ToolResult(status="failed", error_code="not_found", error_message=f"文件不存在: {rel}")

    if p.suffix.lower() != ".pdf":
        return ToolResult(
            status="failed",
            error_code="unsupported_format",
            error_message=f"仅支持提取 PDF 文件，收到: {p.suffix}",
        )

    try:
        file_size = p.stat().st_size
    except OSError as e:
        return ToolResult(status="failed", error_code="io_error", error_message=f"无法读取文件信息: {e}")

    if file_size > _MAX_DOC_FILE_SIZE:
        return ToolResult(
            status="failed",
            error_code="file_too_large",
            error_message=f"PDF 大小超过限制（最大 50 MB）：当前为 {file_size} 字节",
        )

    try:
        import pdfplumber
    except ImportError:
        return ToolResult(
            status="failed",
            error_code="tool_not_installed",
            error_message="无法提取 PDF 文本：缺少必要的阅读组件。请使用官方安装包或维护说明补全本机运行环境后重试。",
        )
    try:
        pages_text: list[str] = []
        with pdfplumber.open(str(p)) as pdf:
            if len(pdf.pages) > _MAX_PDF_PAGES:
                return ToolResult(
                    status="failed",
                    error_code="exceeds_page_limit",
                    error_message=f"PDF 超过 {_MAX_PDF_PAGES} 页限制（共 {len(pdf.pages)} 页），请拆分后提取",
                )
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages_text.append(text)
        full = "\n\n---\n\n".join(pages_text)
        if not full.strip():
            return ToolResult(
                status="failed",
                error_code="no_text_found",
                error_message="PDF 未提取到可读文本，可能为纯扫描图片页面，请转为图片后使用 doc.ocr_image 识别。",
            )
        return ToolResult(
            status="succeeded",
            data={
                "source": rel,
                "pages": len(pages_text),
                "chars": len(full),
                "content": full[:20000],
            },
        )
    except Exception as e:
        return ToolResult(status="failed", error_code="pdf_extract_failed", error_message=f"PDF 提取失败: {e}")


def tool_doc_ocr_image(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    rel = str(args.get("path") or "").strip()
    lang = str(args.get("lang") or "chi_sim+eng").strip()
    if not rel:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="path 参数必填")
    if ".." in rel.replace("\\", "/").split("/"):
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="path 不得包含相对路径跳转 (..)",
        )
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*", lang):
        return ToolResult(
            status="failed",
            error_code="invalid_arguments",
            error_message="OCR 语言参数无效，仅支持形如 chi_sim、eng、chi_sim+eng 的语言标识",
        )

    try:
        p = _resolve(ctx, rel)
    except Exception as e:
        return ToolResult(status="failed", error_code="path_error", error_message=str(e))
    if not p.is_file():
        return ToolResult(status="failed", error_code="not_found", error_message=f"文件不存在: {rel}")

    if p.suffix.lower() not in _SUPPORTED_IMAGE_EXTS:
        return ToolResult(
            status="failed",
            error_code="unsupported_format",
            error_message=f"仅支持常见图片格式（PNG/JPG/JPEG/BMP/TIFF/WEBP），收到: {p.suffix}",
        )

    try:
        from solaire.agent_layer.ocr import extract_image_text

        text = extract_image_text(p, lang=lang)
        return ToolResult(
            status="succeeded",
            data={
                "source": rel,
                "lang": lang,
                "chars": len(text),
                "content": text[:20000],
            },
        )
    except FileNotFoundError as e:
        return ToolResult(status="failed", error_code="ocr_not_installed", error_message=str(e))
    except ValueError as e:
        return ToolResult(status="failed", error_code="ocr_failed", error_message=str(e))
    except Exception as e:
        return ToolResult(status="failed", error_code="runtime_error", error_message=f"OCR 识别失败: {e}")
