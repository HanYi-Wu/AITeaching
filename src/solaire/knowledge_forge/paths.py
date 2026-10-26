"""Path resolution and slug safety helpers for KnowledgeForge."""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from solaire.common.security import assert_within_project

_GRAPH_DIR_NAME = "graph"
_STATE_FILENAME = "state.yaml"
_META_FILENAME = "_meta.yaml"


def _graph_dir(project_root: Path) -> Path:
    return (project_root / "resource" / _GRAPH_DIR_NAME).resolve()


def _legacy_state_path(project_root: Path) -> Path:
    return (_graph_dir(project_root) / _STATE_FILENAME).resolve()


def _meta_path(project_root: Path) -> Path:
    return (_graph_dir(project_root) / _META_FILENAME).resolve()


def _subject_state_path(project_root: Path, slug: str) -> Path:
    safe = _safe_slug(slug)
    return (_graph_dir(project_root) / f"{safe}.yaml").resolve()


def _safe_slug(s: str) -> str:
    """将任意字符串转换为文件名安全的 slug（保留中文、字母、数字、连字符）。"""
    s = s.strip()
    buf: list[str] = []
    for ch in s:
        cat = unicodedata.category(ch)
        if ch.isascii() and ch.isalnum():
            buf.append(ch.lower())
        elif "\u4e00" <= ch <= "\u9fff":
            buf.append(ch)
        elif ch in " \t-_/":
            buf.append("-")
        elif cat.startswith("L") or cat.startswith("N"):
            buf.append(ch)
    result = "".join(buf).strip("-")
    result = re.sub(r"-+", "-", result)
    return (result[:48] if result else "graph") or "graph"


def _slugify_name(name: str) -> str:
    buf: list[str] = []
    for ch in (name or "").strip():
        if ch.isascii() and ch.isalnum():
            buf.append(ch.lower())
        elif ch in " \t-_/":
            buf.append("-")
        elif "\u4e00" <= ch <= "\u9fff":
            buf.append(ch)
    s = "".join(buf).strip("-")
    s = re.sub(r"-+", "-", s)
    return (s[:48] if s else "node") or "node"


def _resolve_resource_path(project_root: Path, relative_under_resource: str) -> Path:
    rel = relative_under_resource.strip().replace("\\", "/").lstrip("/")
    resource = (project_root / "resource").resolve()
    target = (resource / rel).resolve()
    try:
        target.relative_to(resource)
    except ValueError as e:
        raise ValueError("Path must stay under resource/") from e
    assert_within_project(project_root, target)
    return target
