"""Concept node queries and mutations."""

from __future__ import annotations

from typing import Any
from solaire.knowledge_forge.models import ConceptNode
from solaire.knowledge_forge.models import GraphState
from solaire.knowledge_forge.models import NodeRelation
from pathlib import Path
from solaire.knowledge_forge.models import _ALLOWED_NODE_KINDS
from solaire.knowledge_forge.node_index import _find_node_state
from solaire.knowledge_forge.paths import _legacy_state_path
from solaire.knowledge_forge.storage import _load_meta
from solaire.knowledge_forge.storage import _load_subject_state_snapshot
from solaire.knowledge_forge.migration import _migrate_legacy_graph_state
from solaire.knowledge_forge.models import _now_utc
from solaire.knowledge_forge.node_index import _resolve_target_subject_slug
from solaire.knowledge_forge.migration import ensure_graph_layout
from solaire.knowledge_forge.concurrency import graph_mutation
from solaire.knowledge_forge.mutation_session import GraphMutationSession
import uuid
import yaml


def list_concept_nodes(
    project_root: Path,
    *,
    node_kind: str | None = None,
    graph: str | None = None,
) -> list[dict[str, Any]]:
    ensure_graph_layout(project_root)
    if graph:
        slugs = [graph]
    else:
        meta = _load_meta(project_root)
        slugs = [sm.slug for sm in meta.subjects]
        if not slugs:
            # 兼容旧 state.yaml
            legacy = _legacy_state_path(project_root)
            if legacy.is_file():
                raw = legacy.read_text(encoding="utf-8")
                if raw.strip():
                    data = yaml.safe_load(raw)
                    if isinstance(data, dict):
                        state = GraphState.model_validate(data)
                        _migrate_legacy_graph_state(state)
                        if node_kind:
                            return [
                                node.model_dump(mode="json")
                                for node in state.nodes
                                if node.node_kind == node_kind
                            ]
                        return [node.model_dump(mode="json") for node in state.nodes]
            return []

    all_nodes: list[ConceptNode] = []
    states: list[GraphState] = []
    for slug in slugs:
        state = _load_subject_state_snapshot(project_root, slug)
        states.append(state)
        all_nodes.extend(state.nodes)

    filter_kind: str | None = None
    if node_kind is not None:
        filter_kind = node_kind.strip()
        if filter_kind not in _ALLOWED_NODE_KINDS:
            raise ValueError(f"Invalid node_kind filter: {node_kind}")

    matching_nodes = [node for node in all_nodes if filter_kind is None or node.node_kind == filter_kind]
    matching_ids = {node.id for node in matching_nodes}
    all_file_counts: dict[str, int] = {}
    for state in states:
        for link in state.file_links:
            if link.node_id in matching_ids:
                all_file_counts[link.node_id] = all_file_counts.get(link.node_id, 0) + 1

    rows = []
    for node in matching_nodes:
        row = node.model_dump(mode="json")
        row["file_link_count"] = all_file_counts.get(node.id, 0)
        rows.append(row)
    return rows


def count_nodes_by_kind(project_root: Path, *, graph: str | None = None) -> dict[str, int]:
    ensure_graph_layout(project_root)
    out: dict[str, int] = {k: 0 for k in sorted(_ALLOWED_NODE_KINDS)}
    if graph:
        state = _load_subject_state_snapshot(project_root, graph)
        for n in state.nodes:
            out[n.node_kind] = out.get(n.node_kind, 0) + 1
    else:
        meta = _load_meta(project_root)
        for sm in meta.subjects:
            state = _load_subject_state_snapshot(project_root, sm.slug)
            for n in state.nodes:
                out[n.node_kind] = out.get(n.node_kind, 0) + 1
    return out


def get_concept_node(project_root: Path, node_id: str, *, graph: str | None = None) -> dict[str, Any]:
    ensure_graph_layout(project_root)
    if graph:
        state = _load_subject_state_snapshot(project_root, graph)
        for n in state.nodes:
            if n.id == node_id:
                return n.model_dump(mode="json")
        raise FileNotFoundError(f"Node not found: {node_id}")
    match = _find_node_state(project_root, node_id)
    if match is not None:
        return match[2].model_dump(mode="json")
    raise FileNotFoundError(f"Node not found: {node_id}")


@graph_mutation
def create_concept_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    node = ConceptNode.model_validate(payload).model_copy(deep=True)
    target_slug = _resolve_target_subject_slug(project_root, graph=graph, subject_name=node.subject)

    with GraphMutationSession(project_root) as session:
        state = session.state(target_slug)
        all_ids, _ = session.node_index()
        if node.id in all_ids:
            raise ValueError(f"Node already exists: {node.id}")
        state.nodes.append(node)
        session.save(target_slug)
    return node.id


@graph_mutation
def create_concept_nodes_batch(
    project_root: Path,
    nodes: list[dict[str, Any]],
    *,
    graph: str | None = None,
) -> list[str]:
    """Atomically create a batch of concept nodes after pre-validating structure and references."""
    ensure_graph_layout(project_root)
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("nodes 须为非空列表")

    with GraphMutationSession(project_root) as session:
        all_existing_ids, _ = session.node_index()
        working_ids = set(all_existing_ids)

        validated_nodes: list[ConceptNode] = []
        validated_relations: list[NodeRelation] = []
        created_ids: list[str] = []

        # 1. 结构与引用整批预校验（全通过或全失败，绝不部分写入）
        for i, item in enumerate(nodes):
            if not isinstance(item, dict):
                raise ValueError(f"条目 #{i} 须为对象")
            canonical_name = str(item.get("canonical_name") or "").strip()
            if not canonical_name:
                raise ValueError(f"条目 #{i} canonical_name 必填")
            node_id = str(item.get("id") or "").strip() or None
            parent = str(item.get("parent_node_id") or "").strip() or None

            if not node_id:
                if not parent:
                    raise ValueError(f"条目 #{i} 需提供 parent_node_id 或 id")
                if parent not in working_ids:
                    raise ValueError(f"条目 #{i} 所引用的父节点不存在: {parent}")
                nid = session.generate_unique_node_id(
                    parent, canonical_name, reserved_ids=working_ids
                )
            else:
                nid = node_id
                if nid in working_ids:
                    raise ValueError(f"条目 #{i} 节点标识已存在或在批次中重复: {nid}")
                if parent and parent not in working_ids:
                    raise ValueError(f"条目 #{i} 所引用的父节点不存在: {parent}")

            body = {k: v for k, v in item.items() if k not in ("parent_node_id", "graph")}
            body["id"] = nid
            if parent and "primary_parent_id" not in body:
                body["primary_parent_id"] = parent

            node = ConceptNode.model_validate(body).model_copy(deep=True)
            validated_nodes.append(node)
            working_ids.add(nid)
            created_ids.append(nid)

            if parent:
                rel = NodeRelation(
                    id=uuid.uuid4().hex,
                    from_node_id=nid,
                    to_node_id=parent,
                    relation_type="part_of",
                )
                validated_relations.append(rel)

        # 2. 一致性落盘：事务在项目级排他锁内统一提交。
        for node in validated_nodes:
            if node.primary_parent_id and node.primary_parent_id not in working_ids:
                raise ValueError(f"父节点不存在: {node.primary_parent_id}")
        targets = {}
        for node in validated_nodes:
            target = _resolve_target_subject_slug(project_root, graph=graph, subject_name=node.subject)
            targets[node.id] = target
            state = session.state(target)
            state.nodes.append(node)
            session.save(target)
        for relation in validated_relations:
            target = targets[relation.from_node_id]
            session.state(target).relations.append(relation)
            session.save(target)

    return created_ids


@graph_mutation
def update_concept_node(
    project_root: Path,
    node_id: str,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_node_slug(node_id)
        if slug is None:
            raise FileNotFoundError(f"Node not found: {node_id}")

        state = session.state(slug)
        if not any(n.id == node_id for n in state.nodes):
            raise FileNotFoundError(f"Node not found: {node_id}")

        data = dict(payload)
        data["id"] = node_id
        updated = ConceptNode.model_validate(data).model_copy(deep=True)

        for i, n in enumerate(state.nodes):
            if n.id == node_id:
                updated.created_at = n.created_at
                updated.updated_at = _now_utc()
                state.nodes[i] = updated
                break

        session.save_node_update(slug, node_id)


@graph_mutation
def delete_concept_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> dict[str, Any]:
    """删除节点；返回被删节点与涉及的关系（供撤销/前端增量同步）。"""
    ensure_graph_layout(project_root)
    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_node_slug(node_id)
        if slug is None:
            return {"deleted_node": None, "deleted_relations": []}

        state = session.state(slug)
        removed_node: dict[str, Any] | None = None
        for n in state.nodes:
            if n.id == node_id:
                removed_node = n.model_dump(mode="json")
                break
        removed_rels = [
            r.model_dump(mode="json")
            for r in state.relations
            if r.from_node_id == node_id or r.to_node_id == node_id
        ]
        state.nodes = [n for n in state.nodes if n.id != node_id]
        state.relations = [
            r for r in state.relations if r.from_node_id != node_id and r.to_node_id != node_id
        ]
        state.bindings = [b for b in state.bindings if b.node_id != node_id]
        state.file_links = [l for l in state.file_links if l.node_id != node_id]
        session.save(slug)
        return {"deleted_node": removed_node, "deleted_relations": removed_rels}
