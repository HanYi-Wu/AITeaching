"""Shared paper API validation and error adaptation."""

from __future__ import annotations

import logging
import sqlite3
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from solaire.web import state
from solaire.web.auth_api import current_platform_user
from solaire.web.papers.grading_versions import GradingVersionConflict
from solaire.web.project_layout import ensure_project_layout

logger = logging.getLogger("solaire.web.paper_api")

OFFLINE_SCAN_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}

OFFLINE_SCAN_MAX_FILES = 20

OFFLINE_SCAN_MAX_FILE_BYTES = 15 * 1024 * 1024

OFFLINE_SCAN_MAX_TOTAL_BYTES = 100 * 1024 * 1024

OFFLINE_UPLOADER_EXE = Path(__file__).resolve().parents[1] / "assets" / "tools" / "EducationHelper-Offline-Answer-Uploader.exe"

class _ScanOutputTooLarge(Exception):
    pass


class _BoundedScanBuffer(BytesIO):
    def __init__(self, limit: int):
        super().__init__()
        self.limit = limit

    def write(self, data: bytes) -> int:
        if self.tell() + len(data) > self.limit:
            raise _ScanOutputTooLarge
        return super().write(data)


def _scan_buffer(limit: int | None) -> BytesIO:
    return BytesIO() if limit is None else _BoundedScanBuffer(limit)


def _normalize_offline_scan(name: str, content: bytes, *, max_output_bytes: int | None = None) -> tuple[str, str, bytes]:
    extension = Path(name).suffix.lower()
    try:
        if extension in {".heic", ".heif"}:
            from pillow_heif import register_heif_opener

            register_heif_opener()
        with Image.open(BytesIO(content)) as opened:
            if opened.width * opened.height > 50_000_000:
                raise ValueError("图片像素超过 5000 万")
            opened.load()
            image = ImageOps.exif_transpose(opened)
            if extension in {".jpg", ".jpeg"}:
                if image.mode not in {"RGB", "L"}:
                    image = image.convert("RGB")
                output = _scan_buffer(max_output_bytes)
                image.save(output, format="JPEG", quality=92, optimize=True)
                return f"{Path(name).stem}.jpg", "image/jpeg", output.getvalue()
            if image.mode not in {"RGB", "RGBA", "L"}:
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            output = _scan_buffer(max_output_bytes)
            try:
                image.save(output, format="PNG", compress_level=3)
            except _ScanOutputTooLarge:
                # Keep the existing size policy: an image fitting with the original
                # compression must still be accepted when the faster pass is larger.
                output = _scan_buffer(max_output_bytes)
                image.save(output, format="PNG", optimize=True)
            return f"{Path(name).stem}.png", "image/png", output.getvalue()
    except _ScanOutputTooLarge as exc:
        raise HTTPException(status_code=413, detail=f"文件 {name} 转换后超过 15MB，请降低照片分辨率") from exc
    except (ImportError, OSError, UnidentifiedImageError, Image.DecompressionBombError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"文件 {name} 不是可读取的答卷图片：{exc}") from exc


def _optimize_normalized_png(content: bytes) -> bytes:
    with Image.open(BytesIO(content)) as image:
        output = _scan_buffer(OFFLINE_SCAN_MAX_FILE_BYTES)
        try:
            image.save(output, format="PNG", optimize=True)
        except _ScanOutputTooLarge:
            return content
        result = output.getvalue()
    return result if len(result) < len(content) else content

def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, GradingVersionConflict):
        raise HTTPException(status_code=409, detail=str(exc), headers={"ETag": f'"{exc.current_version}"'}) from exc
    if isinstance(exc, PermissionError):
        logger.warning("paper api permission denied: %s", exc, exc_info=True)
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, FileNotFoundError):
        logger.warning("paper api missing resource: %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if isinstance(exc, (ValueError, sqlite3.IntegrityError)):
        logger.warning("paper api invalid request: %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc

def require_content_project_root():
    root = state.get_content_root()
    ensure_project_layout(root)
    return root

def current_organizer_teacher(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    if user.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="此操作仅限教师")
    return user
