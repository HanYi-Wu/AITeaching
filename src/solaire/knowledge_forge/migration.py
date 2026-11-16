"""Legacy single-file state.yaml migration and graph directory initialization."""

from __future__ import annotations

from pathlib import Path

import yaml

from solaire.common.security import assert_within_project
from solaire.knowledge_forge.concurrency import graph_mutation
from solaire.knowledge_forge.models import (
    ConceptNode,
    GraphMeta,
    GraphState,
    NodeFileLink,
    NodeRelation,
    QuestionBinding,
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
    seen: dict[str, set[tuple[str, str, str]]] = {}
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

        signature = (current_r.from_node_id, current_r.to_node_id, current_r.relation_type)
        signatures = seen.setdefault(current_r.id, set())
        if signature in signatures:
            changed = True
            continue
        signatures.add(signature)
        new_rels.append(current_r)
    state.relations = new_rels
    return changed


def _partition_legacy_graph_state(
    old_state: GraphState,
) -> tuple[
    dict[str, set[str]],
    dict[str, list[ConceptNode]],
    dict[str, list[NodeRelation]],
    dict[str, list[QuestionBinding]],
    dict[str, list[NodeFileLink]],
]:
    """Partition source rows by subject in ordered passes, including duplicate IDs."""
    groups: dict[str, set[str]] = {}
    slugs_by_node_id: dict[str, list[str]] = {}
    no_subject_slug = "_default"
    for node in old_state.nodes:
        subject = (node.subject or "").strip() or no_subject_slug
        slug = _safe_slug(subject)
        ids = groups.setdefault(slug, set())
        if node.id in ids:
            continue
        ids.add(node.id)
        slugs_by_node_id.setdefault(node.id, []).append(slug)

    # The legacy implementation filtered every row against every subject's ID
    # list. Distribute each source row once across the subjects containing its
    # endpoint IDs, preserving subject order and per-file source order.
    nodes_by_slug: dict[str, list[ConceptNode]] = {slug: [] for slug in groups}
    relations_by_slug: dict[str, list[NodeRelation]] = {slug: [] for slug in groups}
    bindings_by_slug: dict[str, list[QuestionBinding]] = {slug: [] for slug in groups}
    file_links_by_slug: dict[str, list[NodeFileLink]] = {slug: [] for slug in groups}

    for node in old_state.nodes:
        for slug in slugs_by_node_id.get(node.id, ()):
            nodes_by_slug[slug].append(node)
    for relation in old_state.relations:
        target_slugs = dict.fromkeys((
            *slugs_by_node_id.get(relation.from_node_id, ()),
            *slugs_by_node_id.get(relation.to_node_id, ()),
        ))
        for slug in target_slugs:
            relations_by_slug[slug].append(relation)
    for binding in old_state.bindings:
        for slug in slugs_by_node_id.get(binding.node_id, ()):
            bindings_by_slug[slug].append(binding)
    for link in old_state.file_links:
        for slug in slugs_by_node_id.get(link.node_id, ()):
            file_links_by_slug[slug].append(link)

    return groups, nodes_by_slug, relations_by_slug, bindings_by_slug, file_links_by_slug


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

    groups, nodes_by_slug, relations_by_slug, bindings_by_slug, file_links_by_slug = (
        _partition_legacy_graph_state(old_state)
    )

    meta = GraphMeta(
        subjects=[],
        levels=list(old_state.taxonomy.levels) if old_state.taxonomy.levels else ["高中", "高考"],
    )

    for slug in groups:
        nodes = nodes_by_slug[slug]
        relations = relations_by_slug[slug]
        bindings = bindings_by_slug[slug]
        file_links = file_links_by_slug[slug]

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
