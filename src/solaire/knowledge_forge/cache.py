"""In-memory mtime-based caching for KnowledgeForge."""

from __future__ import annotations

from pathlib import Path

from solaire.knowledge_forge.models import GraphMeta, GraphState

# 进程内缓存：按文件 mtime 失效，减少重复 YAML 读盘与解析
_meta_cache: dict[str, tuple[float, GraphMeta]] = {}
_state_cache: dict[tuple[str, str], tuple[float, GraphState]] = {}


def _graph_root_key(project_root: Path) -> str:
    return str(project_root.resolve())


def _invalidate_graph_cache(project_root: Path) -> None:
    """迁移或多文件变更后清空该工程下的缓存。"""
    rk = _graph_root_key(project_root)
    _meta_cache.pop(rk, None)
    for k in list(_state_cache.keys()):
        if k[0] == rk:
            del _state_cache[k]
