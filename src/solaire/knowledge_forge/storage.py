"""YAML persistence and cache access."""

from __future__ import annotations

from solaire.knowledge_forge.cache import _invalidate_graph_cache

from solaire.knowledge_forge.models import GraphMeta
from solaire.knowledge_forge.models import GraphState
from pathlib import Path
from solaire.knowledge_forge.migration import _ensure_graph_dir_only
from solaire.knowledge_forge.cache import _graph_root_key
from solaire.knowledge_forge.cache import _meta_cache
from solaire.knowledge_forge.paths import _meta_path
from solaire.knowledge_forge.migration import _migrate_legacy_graph_state
from solaire.knowledge_forge.cache import _state_cache
from solaire.knowledge_forge.paths import _subject_state_path
from solaire.common.security import assert_within_project
from solaire.knowledge_forge.migration import ensure_graph_layout
from solaire.knowledge_forge.concurrency import graph_lock
from solaire.common.atomic_files import write_text_atomic
import yaml


def _load_meta(project_root: Path) -> GraphMeta:
    mp = _meta_path(project_root)
    assert_within_project(project_root, mp)
    rk = _graph_root_key(project_root)
    if not mp.is_file():
        return GraphMeta().model_copy(deep=True)
    mtime = mp.stat().st_mtime
    hit = _meta_cache.get(rk)
    if hit is not None and hit[0] == mtime:
        return hit[1].model_copy(deep=True)
    raw = mp.read_text(encoding="utf-8")
    if not raw.strip():
        empty = GraphMeta()
        _meta_cache[rk] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    data = yaml.safe_load(raw)
    if not isinstance(data, dict):
        empty = GraphMeta()
        _meta_cache[rk] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    gm = GraphMeta.model_validate(data)
    _meta_cache[rk] = (mtime, gm.model_copy(deep=True))
    return gm.model_copy(deep=True)


def _save_meta(project_root: Path, meta: GraphMeta) -> None:
    ensure_graph_layout.__wrapped__(project_root)  # just mkdir, no migration loop
    mp = _meta_path(project_root)
    assert_within_project(project_root, mp)
    content = yaml.safe_dump(meta.model_dump(mode="json"), allow_unicode=True, sort_keys=False)
    with graph_lock(project_root, "_meta"):
        write_text_atomic(mp, content)
        mtime = mp.stat().st_mtime
        _meta_cache[_graph_root_key(project_root)] = (mtime, meta.model_copy(deep=True))


def _load_subject_state(project_root: Path, slug: str) -> GraphState:
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    rk = _graph_root_key(project_root)
    cache_key = (rk, slug)
    if not sp.is_file():
        return GraphState().model_copy(deep=True)
    mtime = sp.stat().st_mtime
    hit = _state_cache.get(cache_key)
    if hit is not None and hit[0] == mtime:
        return hit[1].model_copy(deep=True)
    raw = sp.read_text(encoding="utf-8")
    if not raw.strip():
        empty = GraphState()
        _state_cache[cache_key] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    data = yaml.safe_load(raw)
    if data is None:
        empty = GraphState()
        _state_cache[cache_key] = (mtime, empty.model_copy(deep=True))
        return empty.model_copy(deep=True)
    if not isinstance(data, dict):
        raise ValueError(f"Invalid graph state file for subject {slug!r}")
    state = GraphState.model_validate(data)
    if _migrate_legacy_graph_state(state):
        _save_subject_state(project_root, slug, state)
        return _load_subject_state(project_root, slug)
    _state_cache[cache_key] = (mtime, state.model_copy(deep=True))
    return state.model_copy(deep=True)


def _save_subject_state(project_root: Path, slug: str, state: GraphState) -> None:
    _ensure_graph_dir_only(project_root)
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    payload = state.model_dump(mode="json")
    content = yaml.safe_dump(payload, allow_unicode=True, sort_keys=False)
    with graph_lock(project_root, slug):
        write_text_atomic(sp, content)
        mtime = sp.stat().st_mtime
        _state_cache[(_graph_root_key(project_root), slug)] = (mtime, state.model_copy(deep=True))


def _get_default_slug(project_root: Path) -> str | None:
    """返回元数据中第一个科目的 slug，若无则返回 None。"""
    meta = _load_meta(project_root)
    if meta.subjects:
        return meta.subjects[0].slug
    return None


def _load_state(project_root: Path) -> GraphState:
    """兼容接口：从第一个科目或 legacy 文件读取。"""
    ensure_graph_layout(project_root)
    slug = _get_default_slug(project_root)
    if slug:
        return _load_subject_state(project_root, slug)
    # 没有任何科目图谱：返回空状态
    return GraphState()


def load_graph(project_root: Path) -> GraphState:
    """Load persisted graph state from the first subject (public API, legacy compat)."""
    return _load_state(project_root)


def _save_subject_states(project_root: Path, states: dict[str, GraphState]) -> None:
    """Validate/serialize all files before replacing any; roll back handled write failures.

    Each replacement is atomic. This is not a transaction across a machine crash.
    Callers hold the project graph lock throughout planning and persistence.
    """
    contents = {
        slug: yaml.safe_dump(state.model_dump(mode="json"), allow_unicode=True, sort_keys=False)
        for slug, state in states.items()
    }
    originals = {}
    for slug in states:
        path = _subject_state_path(project_root, slug)
        assert_within_project(project_root, path)
        originals[slug] = path.read_text(encoding="utf-8") if path.is_file() else None
    written = []
    try:
        for slug, content in contents.items():
            write_text_atomic(_subject_state_path(project_root, slug), content)
            written.append(slug)
    except OSError:
        for slug in reversed(written):
            path = _subject_state_path(project_root, slug)
            if originals[slug] is None:
                path.unlink(missing_ok=True)
            else:
                write_text_atomic(path, originals[slug])
        raise
    finally:
        _invalidate_graph_cache(project_root)
