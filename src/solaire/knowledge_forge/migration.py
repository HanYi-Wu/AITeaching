"""Legacy single-file state.yaml migration and graph directory initialization."""

from __future__ import annotations

from pathlib import Path

import yaml

from solaire.common.security import assert_within_project
from solaire.knowledge_forge.concurrency import graph_mutation
from solaire.knowledge_forge.models import (
    GraphMeta,
    GraphState,
    NodeRelation,
    SubjectMeta,
)
from solaire.knowledge_forge.paths import (
    _graph_dir,
    _legacy_state_path,
    _meta_path,
    _safe_slug,
)


def _ensure_graph_dir_only(project_root: Path) -> None:
    """仅创建目录，不触发迁移逻辑（避免迁移函数内循环调用）。"""
    graph_dir = _graph_dir(project_root)
    graph_dir.mkdir(parents=True, exist_ok=True)
    assert_within_project(project_root, graph_dir)


@graph_mutation
def ensure_graph_layout(project_root: Path) -> None:
    """Ensure resource/graph/ exists. Migrate legacy state.yaml if needed."""
    graph_dir = _graph_dir(project_root)
    graph_dir.mkdir(parents=True, exist_ok=True)
    assert_within_project(project_root, graph_dir)

    legacy = _legacy_state_path(project_root)
    meta_p = _meta_path(project_root)

    if legacy.is_file() and not meta_p.is_file():
        _migrate_legacy_to_multi(project_root)


# 给 _save_meta 用的不触发迁移的版本
ensure_graph_layout.__wrapped__ = _ensure_graph_dir_only  # type: ignore[attr-defined]


def _migrate_legacy_graph_state(state: GraphState) -> bool:
    """将旧版 uses_skill 关系迁移为 related，并对完全一致的关系幂等收敛。"""
    changed = False
    new_rels: list[NodeRelation] = []
    seen: dict[str, list[NodeRelation]] = {}
    for r in state.relations:
        current_r = r
        if r.relation_type == "uses_skill":
            current_r = NodeRelation(
                id=r.id,
                from_node_id=r.from_node_id,
                to_node_id=r.to_node_id,
                relation_type="related",
            )
            changed = True

        existing_relations = seen.get(current_r.id)
        if existing_relations:
            if any(
                existing.from_node_id == current_r.from_node_id
                and existing.to_node_id == current_r.to_node_id
                and existing.relation_type == current_r.relation_type
                for existing in existing_relations
            ):
                changed = True
                continue
            existing_relations.append(current_r)
            new_rels.append(current_r)
        else:
            seen[current_r.id] = [current_r]
            new_rels.append(current_r)
    state.relations = new_rels
    return changed


def _migrate_legacy_to_multi(project_root: Path) -> None:
    """将旧 state.yaml 按 node.subject 字段拆分为多科目文件。"""
    from solaire.knowledge_forge.storage import _save_meta, _save_subject_state

    legacy = _legacy_state_path(project_root)
    if not legacy.is_file():
        return

    raw = legacy.read_text(encoding="utf-8")
    if not raw.strip():
        legacy.rename(legacy.with_suffix(".yaml.bak"))
        return

    data = yaml.safe_load(raw)
    if not isinstance(data, dict):
        legacy.rename(legacy.with_suffix(".yaml.bak"))
        return

    old_state = GraphState.model_validate(data)
    _migrate_legacy_graph_state(old_state)

    # 推断每个节点的 primary_parent_id（取第一个 part_of 父节点）
    parent_map: dict[str, str] = {}
    for r in old_state.relations:
        if r.relation_type == "part_of" and r.from_node_id not in parent_map:
            parent_map[r.from_node_id] = r.to_node_id

    for n in old_state.nodes:
        if n.primary_parent_id is None and n.id in parent_map:
            n.primary_parent_id = parent_map[n.id]

    # 按科目分组
    groups: dict[str, list[str]] = {}
    no_subject_slug = "_default"
    for n in old_state.nodes:
        subj = (n.subject or "").strip() or no_subject_slug
        slug = _safe_slug(subj)
        groups.setdefault(slug, [])
        if n.id not in groups[slug]:
            groups[slug].append(n.id)

    meta = GraphMeta(
        subjects=[],
        levels=list(old_state.taxonomy.levels) if old_state.taxonomy.levels else ["高中", "高考"],
    )

    for slug, node_ids in groups.items():
        id_set = set(node_ids)
        nodes = [n for n in old_state.nodes if n.id in id_set]
        relations = [
            r for r in old_state.relations if r.from_node_id in id_set or r.to_node_id in id_set
        ]
        bindings = [b for b in old_state.bindings if b.node_id in id_set]
        file_links = [l for l in old_state.file_links if l.node_id in id_set]

        new_state = GraphState(
            nodes=nodes,
            relations=relations,
            bindings=bindings,
            file_links=file_links,
        )
        _ensure_graph_dir_only(project_root)
        _save_subject_state(project_root, slug, new_state)

        display_name = slug
        if nodes:
            first_subject = nodes[0].subject
            if first_subject and first_subject.strip():
                display_name = first_subject.strip()
        meta.subjects.append(SubjectMeta(slug=slug, display_name=display_name, node_count=len(nodes)))

    _ensure_graph_dir_only(project_root)
    _save_meta(project_root, meta)

    bak = legacy.with_name("state.yaml.bak")
    legacy.rename(bak)
