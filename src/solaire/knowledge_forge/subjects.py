"""Subject catalog and taxonomy operations."""

from __future__ import annotations

from typing import Any
from solaire.knowledge_forge.models import GraphState
from pathlib import Path
from solaire.knowledge_forge.models import SubjectMeta
from solaire.knowledge_forge.storage import _get_default_slug
from solaire.knowledge_forge.cache import _graph_root_key
from solaire.knowledge_forge.storage import _load_meta
from solaire.knowledge_forge.storage import _load_subject_state
from solaire.knowledge_forge.paths import _safe_slug
from solaire.knowledge_forge.storage import _save_meta
from solaire.knowledge_forge.storage import _save_subject_state
from solaire.knowledge_forge.cache import _state_cache
from solaire.knowledge_forge.paths import _subject_state_path
from solaire.common.security import assert_within_project
from solaire.knowledge_forge.migration import ensure_graph_layout
from solaire.knowledge_forge.concurrency import graph_lock
from solaire.knowledge_forge.concurrency import graph_mutation
from solaire.knowledge_forge.cache import _invalidate_graph_cache
from solaire.common.atomic_files import write_bytes_atomic
import uuid


def list_graphs(project_root: Path) -> list[dict[str, Any]]:
    """列出所有科目图谱，含节点数统计。"""
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    result = []
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        result.append(
            {
                "slug": sm.slug,
                "display_name": sm.display_name,
                "node_count": len(state.nodes),
            }
        )
    return result


@graph_mutation
def create_graph(project_root: Path, display_name: str, slug: str | None = None) -> str:
    """创建新科目图谱，返回 slug。"""
    ensure_graph_layout(project_root)
    if not display_name.strip():
        raise ValueError("display_name 不能为空")
    computed_slug = slug.strip() if slug and slug.strip() else _safe_slug(display_name)
    if not computed_slug:
        computed_slug = "graph"

    with graph_lock(project_root, "_meta"):
        meta = _load_meta(project_root)
        existing_slugs = {sm.slug for sm in meta.subjects}
        final_slug = computed_slug
        if final_slug in existing_slugs:
            # 追加随机后缀避免冲突
            for _ in range(12):
                cand = f"{computed_slug}-{uuid.uuid4().hex[:4]}"
                if cand not in existing_slugs:
                    final_slug = cand
                    break
            else:
                raise ValueError(f"无法生成唯一科目 slug: {computed_slug}")

        sp = _subject_state_path(project_root, final_slug)
        assert_within_project(project_root, sp)
        empty = GraphState()
        _save_subject_state(project_root, final_slug, empty)

        meta.subjects.append(SubjectMeta(slug=final_slug, display_name=display_name.strip(), node_count=0))
        _save_meta(project_root, meta)
    return final_slug


@graph_mutation
def delete_graph(project_root: Path, slug: str) -> None:
    """删除科目图谱及其数据文件。

    若 metadata 保存失败，使用原子写恢复原图状态并保证文件内容 hash 一致；
    若恢复也失败，异常必须指出受影响路径。
    """
    ensure_graph_layout(project_root)
    with graph_lock(project_root, slug):
        sp = _subject_state_path(project_root, slug)
        assert_within_project(project_root, sp)
        meta = _load_meta(project_root)
        meta.subjects = [sm for sm in meta.subjects if sm.slug != slug]

        original_bytes: bytes | None = None
        if sp.is_file():
            original_bytes = sp.read_bytes()

        if sp.is_file():
            sp.unlink()
        _state_cache.pop((_graph_root_key(project_root), slug), None)

        try:
            _save_meta(project_root, meta)
        except OSError as exc:
            if original_bytes is not None:
                try:
                    write_bytes_atomic(sp, original_bytes)
                except Exception as restore_exc:
                    raise OSError(
                        f"Failed to restore graph file at {sp} during rollback of delete_graph: {restore_exc}"
                    ) from exc
            _invalidate_graph_cache(project_root)
            raise


@graph_mutation
def rename_graph(project_root: Path, slug: str, new_display_name: str) -> None:
    """修改科目图谱的显示名称。"""
    ensure_graph_layout(project_root)
    if not new_display_name.strip():
        raise ValueError("display_name 不能为空")
    with graph_lock(project_root, "_meta"):
        meta = _load_meta(project_root)
        found = False
        for sm in meta.subjects:
            if sm.slug == slug:
                sm.display_name = new_display_name.strip()
                found = True
                break
        if not found:
            raise FileNotFoundError(f"科目图谱不存在: {slug!r}")
        _save_meta(project_root, meta)


def export_graph(project_root: Path, slug: str) -> dict[str, Any]:
    """Export one subject graph as a portable JSON-serializable bundle."""
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    subject = next((sm for sm in meta.subjects if sm.slug == slug), None)
    if subject is None:
        raise FileNotFoundError(f"科目图谱不存在: {slug!r}")
    state = _load_subject_state(project_root, slug)
    return {
        "kind": "solaire.graph",
        "version": 1,
        "slug": slug,
        "display_name": subject.display_name,
        "levels": meta.levels,
        "state": state.model_dump(mode="json"),
    }


@graph_mutation
def import_graph(project_root: Path, bundle: dict[str, Any], *, slug: str | None = None) -> str:
    """Import a graph bundle as a new subject graph and return the new slug."""
    ensure_graph_layout(project_root)
    if not isinstance(bundle, dict):
        raise ValueError("graph bundle must be an object")
    raw_state = bundle.get("state") if isinstance(bundle.get("state"), dict) else bundle
    state = GraphState.model_validate(raw_state)
    display_name = str(bundle.get("display_name") or bundle.get("name") or "导入图谱").strip() or "导入图谱"
    slug_hint = slug or str(bundle.get("slug") or "").strip() or None
    new_slug = create_graph(project_root, display_name, slug_hint)
    _save_subject_state(project_root, new_slug, state)
    with graph_lock(project_root, "_meta"):
        meta = _load_meta(project_root)
        for sm in meta.subjects:
            if sm.slug == new_slug:
                sm.node_count = len(state.nodes)
                sm.display_name = display_name
                break
        levels = bundle.get("levels")
        if isinstance(levels, list):
            meta.levels = [str(item).strip() for item in levels if str(item).strip()]
        _save_meta(project_root, meta)
    return new_slug


def get_taxonomy(project_root: Path) -> dict[str, Any]:
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    slug = _get_default_slug(project_root)
    subjects_list = [sm.display_name for sm in meta.subjects]
    levels = meta.levels
    if slug:
        state = _load_subject_state(project_root, slug)
        if state.taxonomy.subjects:
            subjects_list = state.taxonomy.subjects
        if state.taxonomy.levels:
            levels = state.taxonomy.levels
    return {"subjects": subjects_list, "levels": levels}


@graph_mutation
def set_taxonomy(project_root: Path, *, subjects: list[str] | None, levels: list[str] | None) -> None:
    ensure_graph_layout(project_root)
    with graph_lock(project_root, "_meta"):
        meta = _load_meta(project_root)
        if levels is not None:
            meta.levels = [s.strip() for s in levels if s.strip()]
        if subjects is not None:
            cleaned = [s.strip() for s in subjects if s.strip()]
            existing_slugs = {sm.slug for sm in meta.subjects}
            existing_names = {sm.display_name for sm in meta.subjects}
            for name in cleaned:
                if name not in existing_names:
                    slug = _safe_slug(name)
                    if slug in existing_slugs:
                        for _ in range(12):
                            cand = f"{slug}-{uuid.uuid4().hex[:4]}"
                            if cand not in existing_slugs:
                                slug = cand
                                break
                    meta.subjects.append(SubjectMeta(slug=slug, display_name=name, node_count=0))
                    existing_slugs.add(slug)
                    existing_names.add(name)
                    sp = _subject_state_path(project_root, slug)
                    assert_within_project(project_root, sp)
                    if not sp.is_file():
                        _save_subject_state(project_root, slug, GraphState())
        _save_meta(project_root, meta)
        taxonomy_subjects = [sm.display_name for sm in meta.subjects]
        for subject_meta in meta.subjects:
            state = _load_subject_state(project_root, subject_meta.slug)
            if subjects is not None:
                state.taxonomy.subjects = taxonomy_subjects
            if levels is not None:
                state.taxonomy.levels = list(meta.levels)
            _save_subject_state(project_root, subject_meta.slug, state)
