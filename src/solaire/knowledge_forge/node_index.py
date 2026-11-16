"""Stable node lookup and subject resolution."""

from __future__ import annotations

from pathlib import Path
from solaire.knowledge_forge.models import ConceptNode, GraphState
from solaire.knowledge_forge.storage import _load_meta
from solaire.knowledge_forge.storage import _load_subject_state_snapshot
from solaire.knowledge_forge.paths import _slugify_name
from solaire.knowledge_forge.subjects import create_graph
from solaire.knowledge_forge.migration import ensure_graph_layout
import uuid


def _collect_node_ids_and_kinds(project_root: Path) -> tuple[set[str], dict[str, str]]:
    """单次遍历所有科目：全局节点 id 集合 + id -> node_kind（跨科目）。"""
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    all_ids: set[str] = set()
    kinds: dict[str, str] = {}
    for sm in meta.subjects:
        state = _load_subject_state_snapshot(project_root, sm.slug)
        for n in state.nodes:
            all_ids.add(n.id)
            kinds[n.id] = n.node_kind
    return all_ids, kinds


def _find_node_state(project_root: Path, node_id: str) -> tuple[str, GraphState, ConceptNode] | None:
    """Find the first matching node and its cache-owned subject snapshot."""
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state_snapshot(project_root, sm.slug)
        for node in state.nodes:
            if node.id == node_id:
                return sm.slug, state, node
    return None


def _find_node_slug(project_root: Path, node_id: str) -> str | None:
    """找到节点所在的科目 slug。"""
    match = _find_node_state(project_root, node_id)
    return match[0] if match is not None else None


def generate_unique_node_id(project_root: Path, parent_node_id: str, canonical_name: str) -> str:
    parent = parent_node_id.strip().rstrip("/")
    if not parent:
        raise ValueError("parent_node_id required")
    base = f"{parent}/{_slugify_name(canonical_name)}"
    all_ids, _ = _collect_node_ids_and_kinds(project_root)
    if base not in all_ids:
        return base
    for _ in range(24):
        cand = f"{base}-{uuid.uuid4().hex[:6]}"
        if cand not in all_ids:
            return cand
    raise ValueError("Could not generate unique node id")


def _resolve_target_subject_slug(
    project_root: Path,
    *,
    graph: str | None = None,
    subject_name: str | None = None,
) -> str:
    if graph:
        if not any(sm.slug == graph for sm in _load_meta(project_root).subjects):
            raise ValueError(f"科目图谱不存在: {graph}")
        return graph
    subj = (subject_name or "").strip()
    meta = _load_meta(project_root)
    if subj:
        matched = next((sm.slug for sm in meta.subjects if sm.display_name == subj), None)
        if matched:
            return matched
        return create_graph(project_root, subj)
    if meta.subjects:
        return meta.subjects[0].slug
    return create_graph(project_root, "默认")
