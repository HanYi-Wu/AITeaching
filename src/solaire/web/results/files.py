"""File location and external opener handlers for exported exam materials."""

from __future__ import annotations

import os
import platform
import subprocess
from pathlib import Path
from typing import Literal

from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.security import assert_within_project


def find_exported_pdf_path(
    project_root: Path,
    exam_id: str,
    *,
    variant: Literal["student", "teacher"],
) -> Path:
    """Return path to student or teacher PDF under ``exams/<标签>/<学科>/`` (export naming uses 学生版 / 教师版)."""
    d = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, d)
    if not d.is_dir():
        raise FileNotFoundError(f"未找到考试目录: {exam_id}")
    marker = "学生版" if variant == "student" else "教师版"
    for p in sorted(d.glob("*.pdf")):
        if marker in p.name:
            return p
    raise FileNotFoundError(f"目录中未找到含「{marker}」的 PDF")


def find_exported_docx_path(
    project_root: Path,
    exam_id: str,
    *,
    variant: Literal["student", "teacher"],
) -> Path:
    """Return path to student or teacher DOCX under ``exams/<label>/<subject>/``."""
    d = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, d)
    if not d.is_dir():
        raise FileNotFoundError(f"未找到考试目录: {exam_id}")
    marker = "学生版" if variant == "student" else "教师版"
    for p in sorted(d.glob("*.docx")):
        if marker in p.name:
            return p
    raise FileNotFoundError(f"目录中未找到含“{marker}”的 Word 文档")


def open_pdf_with_default_app(path: Path) -> None:
    """Open a PDF with the OS default handler (local backend only)."""
    target = path.resolve()
    if not target.is_file():
        raise FileNotFoundError(str(target))
    system = platform.system()
    if system == "Windows":
        os.startfile(str(target))  # type: ignore[attr-defined]
    elif system == "Darwin":
        subprocess.run(["open", str(target)], check=False)
    else:
        subprocess.run(["xdg-open", str(target)], check=False)


def open_docx_with_default_app(path: Path) -> None:
    """Open a DOCX with the OS default handler (local backend only)."""
    target = path.resolve()
    if not target.is_file():
        raise FileNotFoundError(str(target))
    system = platform.system()
    if system == "Windows":
        os.startfile(str(target))  # type: ignore[attr-defined]
    elif system == "Darwin":
        subprocess.run(["open", str(target)], check=False)
    else:
        subprocess.run(["xdg-open", str(target)], check=False)
