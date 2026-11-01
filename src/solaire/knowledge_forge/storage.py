"""YAML persistence and cache access."""

from __future__ import annotations
from solaire.knowledge_forge.snapshot_commands.yaml_codec import safe_yaml_dump, safe_yaml_load

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
from solaire.knowledge_forge.node_serialization import (
    invalidate_node_yaml_cache,
    publish_node_yaml_snapshot,
    serialize_single_node_update,
)
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


def _load_subject_state_snapshot(project_root: Path, slug: str) -> GraphState:
    """Return the cache-owned snapshot for internal copy-on-write transactions.

    Mutation callers hold ``graph_lock``. This object must never be handed to a
    public caller or mutated directly; sessions fork its mutable containers first.
    """
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    rk = _graph_root_key(project_root)
    cache_key = (rk, slug)
    if not sp.is_file():
        return GraphState()
    mtime = sp.stat().st_mtime
    hit = _state_cache.get(cache_key)
    if hit is not None and hit[0] == mtime:
        return hit[1]
    raw = sp.read_text(encoding="utf-8")
    if not raw.strip():
        state = GraphState()
    else:
        data = safe_yaml_load(raw)
        if data is None:
            state = GraphState()
        else:
            if not isinstance(data, dict):
                raise ValueError(f"Invalid graph state file for subject {slug!r}")
            state = GraphState.model_validate(data)
            if _migrate_legacy_graph_state(state):
                _save_subject_state(project_root, slug, state)
                return _load_subject_state_snapshot(project_root, slug)
    _state_cache[cache_key] = (mtime, state)
    return state


def _load_subject_state(project_root: Path, slug: str) -> GraphState:
    """Return a caller-isolated graph state, including all nested model data."""
    return _load_subject_state_snapshot(project_root, slug).model_copy(deep=True)


def _save_subject_state(project_root: Path, slug: str, state: GraphState) -> None:
    _ensure_graph_dir_only(project_root)
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    payload = state.model_dump(mode="json")
    content = safe_yaml_dump(payload)
    with graph_lock(project_root, slug):
        write_text_atomic(sp, content)
        invalidate_node_yaml_cache(project_root, slug)
        mtime = sp.stat().st_mtime
        _state_cache[(_graph_root_key(project_root), slug)] = (mtime, state.model_copy(deep=True))


def _save_subject_state_owned(project_root: Path, slug: str, state: GraphState) -> None:
    """Atomically save a state owned by a mutation session without cloning it."""
    _ensure_graph_dir_only(project_root)
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    content = safe_yaml_dump(state.model_dump(mode="json"))
    with graph_lock(project_root, slug):
        write_text_atomic(sp, content)
        invalidate_node_yaml_cache(project_root, slug)
        mtime = sp.stat().st_mtime
        _state_cache[(_graph_root_key(project_root), slug)] = (mtime, state)


def _save_subject_state_node_update_owned(
    project_root: Path,
    slug: str,
    state: GraphState,
    changed_node_id: str,
) -> None:
    """Persist one explicit COW node replacement, with native-dump fallback."""
    _ensure_graph_dir_only(project_root)
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    with graph_lock(project_root, slug):
        prepared = serialize_single_node_update(project_root, slug, sp, state, changed_node_id)
        write_text_atomic(sp, prepared.content)
        mtime = sp.stat().st_mtime
        _state_cache[(_graph_root_key(project_root), slug)] = (mtime, state)
        publish_node_yaml_snapshot(project_root, slug, sp, prepared.snapshot)


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


def _persist_subject_states(
    project_root: Path,
    states: dict[str, GraphState],
    *,
    publish_private_snapshots: bool,
) -> None:
    """Validate/serialize all files before replacing any; roll back handled write failures.

    Each replacement is atomic. This is not a transaction across a machine crash.
    Callers hold the project graph lock throughout planning and persistence.
    """
    contents = {
        slug: safe_yaml_dump(state.model_dump(mode="json"))
        for slug, state in states.items()
    }
    originals = {}
    for slug in states:
        path = _subject_state_path(project_root, slug)
        assert_within_project(project_root, path)
        originals[slug] = path.read_text(encoding="utf-8") if path.is_file() else None
    written = []
    succeeded = False
    try:
        for slug, content in contents.items():
            write_text_atomic(_subject_state_path(project_root, slug), content)
            written.append(slug)
        succeeded = True
    except OSError:
        for slug in reversed(written):
            path = _subject_state_path(project_root, slug)
            if originals[slug] is None:
                path.unlink(missing_ok=True)
            else:
                write_text_atomic(path, originals[slug])
        raise
    finally:
        if not succeeded:
            _invalidate_graph_cache(project_root)
            invalidate_node_yaml_cache(project_root)
    for slug in states:
        invalidate_node_yaml_cache(project_root, slug)
    if publish_private_snapshots:
        rk = _graph_root_key(project_root)
        try:
            mtimes = {
                slug: _subject_state_path(project_root, slug).stat().st_mtime
                for slug in states
            }
        except OSError:
            _invalidate_graph_cache(project_root)
            raise
        for slug, state in states.items():
            _state_cache[(rk, slug)] = (mtimes[slug], state)
    else:
        _invalidate_graph_cache(project_root)


def _save_subject_states(project_root: Path, states: dict[str, GraphState]) -> None:
    _persist_subject_states(project_root, states, publish_private_snapshots=False)


def _save_subject_states_owned(project_root: Path, states: dict[str, GraphState]) -> None:
    """Persist states privately owned by a mutation session, then publish them to cache."""
    _persist_subject_states(project_root, states, publish_private_snapshots=True)
