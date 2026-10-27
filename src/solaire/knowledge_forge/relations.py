"""Validated relation operations."""

from __future__ import annotations

from solaire.knowledge_forge.storage import _save_subject_states

from typing import Any
from solaire.knowledge_forge.models import NodeRelation
from pathlib import Path
from solaire.knowledge_forge.models import _ALLOWED_RELATION_TYPES
from solaire.knowledge_forge.node_index import _collect_node_ids_and_kinds
from solaire.knowledge_forge.node_index import _find_node_slug
from solaire.knowledge_forge.storage import _get_default_slug
from solaire.knowledge_forge.storage import _load_meta
from solaire.knowledge_forge.storage import _load_subject_state
from solaire.knowledge_forge.storage import _save_subject_state
from solaire.knowledge_forge.migration import ensure_graph_layout
from solaire.knowledge_forge.concurrency import graph_lock
from solaire.knowledge_forge.concurrency import graph_mutation
import uuid


def _find_relation_slug(project_root: Path, relation_id: str) -> str | None:
    """找到关系所在的科目 slug。"""
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        if any(r.id == relation_id for r in state.relations):
            return sm.slug
    return None


def _is_equivalent_relation(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """判断两条关系记录是否在稳定身份、端点及全部语义 payload 完全一致。"""
    id_a = a.get("id")
    id_b = b.get("id")
    if not id_a or not id_b or id_a != id_b:
        return False
    if a.get("from_node_id") != b.get("from_node_id") or a.get("to_node_id") != b.get("to_node_id"):
        return False
    ignored = {"conflict", "conflict_reason"}
    payload_a = {k: v for k, v in a.items() if k not in ignored}
    payload_b = {k: v for k, v in b.items() if k not in ignored}
    return payload_a == payload_b


def _deduplicate_relations(relations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """对稳定身份、端点及全部语义 payload 完全相同的记录做幂等去重，保留现有排序。

    遇到同 ID 不同 payload，保留两份且明确暴露冲突，不擅自覆盖或删减。
    """
    result: list[dict[str, Any]] = []
    by_id: dict[str, list[dict[str, Any]]] = {}

    for item in relations:
        rel_id = item.get("id")
        if not rel_id or not isinstance(rel_id, str):
            result.append(dict(item))
            continue

        if rel_id not in by_id:
            entry = dict(item)
            by_id[rel_id] = [entry]
            result.append(entry)
            continue

        existing_entries = by_id[rel_id]
        if any(_is_equivalent_relation(existing, item) for existing in existing_entries):
            # 身份、端点及全部 payload 均一致：幂等收敛，不重复追加
            continue

        # 同 ID 但 payload 冲突：两份均保留并显式暴露冲突标记
        entry = dict(item)
        entry["conflict"] = True
        entry["conflict_reason"] = "duplicate_id_conflicting_payload"
        for existing in existing_entries:
            existing["conflict"] = True
            existing["conflict_reason"] = "duplicate_id_conflicting_payload"
        existing_entries.append(entry)
        result.append(entry)

    return result


def list_node_relations(project_root: Path, *, graph: str | None = None) -> list[dict[str, Any]]:
    ensure_graph_layout(project_root)
    if graph:
        state = _load_subject_state(project_root, graph)
        return _deduplicate_relations([r.model_dump(mode="json") for r in state.relations])
    meta = _load_meta(project_root)
    all_rels: list[dict[str, Any]] = []
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        all_rels.extend(r.model_dump(mode="json") for r in state.relations)
    return _deduplicate_relations(all_rels)


@graph_mutation
def create_node_relation(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    from_node_id = str(payload.get("from_node_id") or "").strip()
    to_node_id = str(payload.get("to_node_id") or "").strip()
    relation_type = str(payload.get("relation_type") or "").strip()

    if not from_node_id or not to_node_id or not relation_type:
        raise ValueError("relation requires from_node_id, to_node_id, relation_type")
    if relation_type not in _ALLOWED_RELATION_TYPES:
        raise ValueError(f"Invalid relation_type: {relation_type}")

    if graph:
        target_slug = graph
    else:
        slug_from = _find_node_slug(project_root, from_node_id)
        slug_to = _find_node_slug(project_root, to_node_id)
        if slug_from is None and slug_to is None:
            raise ValueError("Both from/to nodes must exist before creating relation")
        target_slug = slug_from or slug_to  # type: ignore[assignment]

    with graph_lock(project_root, target_slug):
        state = _load_subject_state(project_root, target_slug)
        all_node_ids, kinds = _collect_node_ids_and_kinds(project_root)

        if from_node_id not in all_node_ids or to_node_id not in all_node_ids:
            raise ValueError("Both from/to nodes must exist before creating relation")

        kf = kinds.get(from_node_id, "concept")
        kt = kinds.get(to_node_id, "concept")
        if kf != "concept" and kt != "concept":
            raise ValueError("关系仅允许至少一端为知识点节点（技能与因果节点之间不可互连）")

        # 幂等
        for r in state.relations:
            if (
                r.from_node_id == from_node_id
                and r.to_node_id == to_node_id
                and r.relation_type == relation_type
            ):
                return r.id

        rel_id = uuid.uuid4().hex
        rel = NodeRelation(
            id=rel_id,
            from_node_id=from_node_id,
            to_node_id=to_node_id,
            relation_type=relation_type,
        )
        state.relations.append(rel)
        _save_subject_state(project_root, target_slug, state)
    return rel_id


@graph_mutation
def create_node_relations_batch(
    project_root: Path,
    relations: list[dict[str, Any]],
    *,
    graph: str | None = None,
) -> list[str]:
    """Atomically create a batch of relations after validating all endpoints and structure."""
    ensure_graph_layout(project_root)
    if not isinstance(relations, list) or not relations:
        raise ValueError("relations 须为非空列表")

    all_node_ids, kinds = _collect_node_ids_and_kinds(project_root)

    validated: list[tuple[str, str, str]] = []
    # 1. 整批预校验
    for i, item in enumerate(relations):
        if not isinstance(item, dict):
            raise ValueError(f"条目 #{i} 须为对象")
        from_node_id = str(item.get("from_node_id") or "").strip()
        to_node_id = str(item.get("to_node_id") or "").strip()
        relation_type = str(item.get("relation_type") or "").strip()

        if not from_node_id or not to_node_id or not relation_type:
            raise ValueError(f"条目 #{i} 缺少必填字段: from_node_id, to_node_id, relation_type")
        if relation_type not in _ALLOWED_RELATION_TYPES:
            raise ValueError(f"条目 #{i} 关系类型无效: {relation_type}")
        if from_node_id not in all_node_ids or to_node_id not in all_node_ids:
            raise ValueError(f"条目 #{i} 关联节点必须均已存在: from={from_node_id}, to={to_node_id}")

        kf = kinds.get(from_node_id, "concept")
        kt = kinds.get(to_node_id, "concept")
        if kf != "concept" and kt != "concept":
            raise ValueError(f"条目 #{i} 关系仅允许至少一端为知识点节点（技能与因果节点之间不可互连）")

        validated.append((from_node_id, to_node_id, relation_type))

    created_ids: list[str] = [""] * len(validated)
    by_slug = {}
    states = {}
    for index, (from_nid, to_nid, r_type) in enumerate(validated):
        target_slug = graph or _find_node_slug(project_root, from_nid) or _find_node_slug(project_root, to_nid)
        by_slug.setdefault(target_slug, []).append((index, from_nid, to_nid, r_type))
    for target_slug, pairs in by_slug.items():
        state = _load_subject_state(project_root, target_slug)
        if graph and not any(sm.slug == graph for sm in _load_meta(project_root).subjects):
            raise ValueError(f"科目图谱不存在: {graph}")
        existing_pairs = {(r.from_node_id, r.to_node_id, r.relation_type): r.id for r in state.relations}
        for index, from_nid, to_nid, r_type in pairs:
            key = (from_nid, to_nid, r_type)
            if key in existing_pairs:
                created_ids[index] = existing_pairs[key]
                continue
            rid = uuid.uuid4().hex
            rel = NodeRelation(id=rid, from_node_id=from_nid, to_node_id=to_nid, relation_type=r_type)
            state.relations.append(rel)
            existing_pairs[key] = rid
            created_ids[index] = rid
        states[target_slug] = state

    _save_subject_states(project_root, states)

    return created_ids


@graph_mutation
def delete_node_relation(
    project_root: Path,
    relation_id: str,
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    if graph:
        with graph_lock(project_root, graph):
            state = _load_subject_state(project_root, graph)
            state.relations = [r for r in state.relations if r.id != relation_id]
            _save_subject_state(project_root, graph, state)
        return
    meta = _load_meta(project_root)
    matches: list[str] = []
    reference: NodeRelation | None = None
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        found = [r for r in state.relations if r.id == relation_id]
        if not found:
            continue
        for rel in found:
            if reference is None:
                reference = rel
            elif (
                reference.from_node_id != rel.from_node_id
                or reference.to_node_id != rel.to_node_id
                or reference.relation_type != rel.relation_type
            ):
                raise ValueError(f"关系 ID 存在内容冲突，请指定科目图谱后再删除: {relation_id}")
        matches.append(sm.slug)

    for slug in matches:
        with graph_lock(project_root, slug):
            state = _load_subject_state(project_root, slug)
            state.relations = [r for r in state.relations if r.id != relation_id]
            _save_subject_state(project_root, slug, state)


@graph_mutation
def update_node_relation(
    project_root: Path,
    relation_id: str,
    *,
    relation_type: str | None = None,
    reverse: bool = False,
    graph: str | None = None,
) -> None:
    """更新关系：可修改类型或颠倒方向。"""
    ensure_graph_layout(project_root)
    slug = graph or _find_relation_slug(project_root, relation_id)
    if slug is None:
        raise FileNotFoundError(f"Relation not found: {relation_id}")
    with graph_lock(project_root, slug):
        state = _load_subject_state(project_root, slug)
        for i, r in enumerate(state.relations):
            if r.id == relation_id:
                new_from = r.to_node_id if reverse else r.from_node_id
                new_to = r.from_node_id if reverse else r.to_node_id
                new_type = (relation_type or r.relation_type).strip()
                if new_type not in _ALLOWED_RELATION_TYPES:
                    raise ValueError(f"Invalid relation_type: {new_type}")
                state.relations[i] = NodeRelation(
                    id=r.id,
                    from_node_id=new_from,
                    to_node_id=new_to,
                    relation_type=new_type,
                )
                break
        _save_subject_state(project_root, slug, state)
