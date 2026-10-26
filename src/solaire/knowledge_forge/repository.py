"""Repository and persistent storage operations for KnowledgeForge graphs."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import yaml

from solaire.common.security import assert_within_project
from solaire.knowledge_forge.cache import (
    _graph_root_key,
    _meta_cache,
    _state_cache,
)
from solaire.knowledge_forge.migration import (
    _ensure_graph_dir_only,
    _migrate_legacy_graph_state,
    ensure_graph_layout,
)
from solaire.knowledge_forge.models import (
    _ALLOWED_NODE_KINDS,
    _ALLOWED_RELATION_TYPES,
    ConceptNode,
    GraphMeta,
    GraphState,
    NodeFileLink,
    NodeRelation,
    QuestionBinding,
    SubjectMeta,
    _now_utc,
    _validate_relation_endpoints,
)
from solaire.knowledge_forge.paths import (
    _legacy_state_path,
    _meta_path,
    _resolve_resource_path,
    _safe_slug,
    _slugify_name,
    _subject_state_path,
)


# ---------------------------------------------------------------------------
# _meta.yaml 读写
# ---------------------------------------------------------------------------


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
    mp.write_text(
        yaml.safe_dump(meta.model_dump(mode="json"), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    mtime = mp.stat().st_mtime
    _meta_cache[_graph_root_key(project_root)] = (mtime, meta.model_copy(deep=True))


# ---------------------------------------------------------------------------
# 科目图谱读写
# ---------------------------------------------------------------------------


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
    sp.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    mtime = sp.stat().st_mtime
    _state_cache[(_graph_root_key(project_root), slug)] = (mtime, state.model_copy(deep=True))


# ---------------------------------------------------------------------------
# 兼容旧式 _load_state（使用第一个科目，或 legacy）
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# 多图谱管理
# ---------------------------------------------------------------------------


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


def create_graph(project_root: Path, display_name: str, slug: str | None = None) -> str:
    """创建新科目图谱，返回 slug。"""
    ensure_graph_layout(project_root)
    if not display_name.strip():
        raise ValueError("display_name 不能为空")
    computed_slug = slug.strip() if slug and slug.strip() else _safe_slug(display_name)
    if not computed_slug:
        computed_slug = "graph"

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


def delete_graph(project_root: Path, slug: str) -> None:
    """删除科目图谱及其数据文件。"""
    ensure_graph_layout(project_root)
    sp = _subject_state_path(project_root, slug)
    assert_within_project(project_root, sp)
    if sp.is_file():
        sp.unlink()
    _state_cache.pop((_graph_root_key(project_root), slug), None)

    meta = _load_meta(project_root)
    meta.subjects = [sm for sm in meta.subjects if sm.slug != slug]
    _save_meta(project_root, meta)


def rename_graph(project_root: Path, slug: str, new_display_name: str) -> None:
    """修改科目图谱的显示名称。"""
    ensure_graph_layout(project_root)
    if not new_display_name.strip():
        raise ValueError("display_name 不能为空")
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
    # 兼容：从第一个科目 state 读 taxonomy（旧字段）
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


def set_taxonomy(project_root: Path, *, subjects: list[str] | None, levels: list[str] | None) -> None:
    ensure_graph_layout(project_root)
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
    # Keep the per-graph compatibility fields in sync.  ``get_taxonomy`` still
    # reads these fields for projects created before the multi-graph metadata
    # file existed, so updating only meta.yaml made a successful write appear
    # to be ignored on the next read.
    taxonomy_subjects = [sm.display_name for sm in meta.subjects]
    for subject_meta in meta.subjects:
        state = _load_subject_state(project_root, subject_meta.slug)
        if subjects is not None:
            state.taxonomy.subjects = taxonomy_subjects
        if levels is not None:
            state.taxonomy.levels = list(meta.levels)
        _save_subject_state(project_root, subject_meta.slug, state)


# ---------------------------------------------------------------------------
# 节点辅助查询
# ---------------------------------------------------------------------------


def _collect_node_ids_and_kinds(project_root: Path) -> tuple[set[str], dict[str, str]]:
    """单次遍历所有科目：全局节点 id 集合 + id -> node_kind（跨科目）。"""
    ensure_graph_layout(project_root)
    meta = _load_meta(project_root)
    all_ids: set[str] = set()
    kinds: dict[str, str] = {}
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        for n in state.nodes:
            all_ids.add(n.id)
            kinds[n.id] = n.node_kind
    return all_ids, kinds


def _find_node_slug(project_root: Path, node_id: str) -> str | None:
    """找到节点所在的科目 slug。"""
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        if any(n.id == node_id for n in state.nodes):
            return sm.slug
    return None


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


# ---------------------------------------------------------------------------
# 节点 CRUD（按科目）
# ---------------------------------------------------------------------------


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
                        rows = [n.model_dump(mode="json") for n in state.nodes]
                        if node_kind:
                            rows = [r for r in rows if r.get("node_kind") == node_kind]
                        return rows
            return []

    all_nodes: list[ConceptNode] = []
    all_file_counts: dict[str, int] = {}
    for slug in slugs:
        state = _load_subject_state(project_root, slug)
        all_nodes.extend(state.nodes)
        for l in state.file_links:
            all_file_counts[l.node_id] = all_file_counts.get(l.node_id, 0) + 1

    rows = [n.model_dump(mode="json") for n in all_nodes]
    if node_kind is not None:
        nk = node_kind.strip()
        if nk not in _ALLOWED_NODE_KINDS:
            raise ValueError(f"Invalid node_kind filter: {node_kind}")
        rows = [r for r in rows if r.get("node_kind") == nk]

    for r in rows:
        r["file_link_count"] = all_file_counts.get(r["id"], 0)
    return rows


def count_nodes_by_kind(project_root: Path, *, graph: str | None = None) -> dict[str, int]:
    ensure_graph_layout(project_root)
    out: dict[str, int] = {k: 0 for k in sorted(_ALLOWED_NODE_KINDS)}
    if graph:
        state = _load_subject_state(project_root, graph)
        for n in state.nodes:
            out[n.node_kind] = out.get(n.node_kind, 0) + 1
    else:
        meta = _load_meta(project_root)
        for sm in meta.subjects:
            state = _load_subject_state(project_root, sm.slug)
            for n in state.nodes:
                out[n.node_kind] = out.get(n.node_kind, 0) + 1
    return out


def get_concept_node(project_root: Path, node_id: str, *, graph: str | None = None) -> dict[str, Any]:
    ensure_graph_layout(project_root)
    if graph:
        state = _load_subject_state(project_root, graph)
        for n in state.nodes:
            if n.id == node_id:
                return n.model_dump(mode="json")
        raise FileNotFoundError(f"Node not found: {node_id}")
    slug = _find_node_slug(project_root, node_id)
    if slug is None:
        raise FileNotFoundError(f"Node not found: {node_id}")
    state = _load_subject_state(project_root, slug)
    for n in state.nodes:
        if n.id == node_id:
            return n.model_dump(mode="json")
    raise FileNotFoundError(f"Node not found: {node_id}")


def create_concept_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    node = ConceptNode.model_validate(payload)

    # 确定目标科目 slug
    target_slug: str
    if graph:
        target_slug = graph
    else:
        subj = (node.subject or "").strip()
        if subj:
            meta = _load_meta(project_root)
            matched = next((sm.slug for sm in meta.subjects if sm.display_name == subj), None)
            if matched:
                target_slug = matched
            else:
                target_slug = create_graph(project_root, subj)
        else:
            meta = _load_meta(project_root)
            if meta.subjects:
                target_slug = meta.subjects[0].slug
            else:
                target_slug = create_graph(project_root, "默认")

    state = _load_subject_state(project_root, target_slug)
    # 全局唯一性检查（节点 id 跨科目唯一）
    all_ids, _ = _collect_node_ids_and_kinds(project_root)
    if node.id in all_ids:
        raise ValueError(f"Node already exists: {node.id}")

    state.nodes.append(node)
    _save_subject_state(project_root, target_slug, state)
    return node.id


def update_concept_node(
    project_root: Path,
    node_id: str,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        raise FileNotFoundError(f"Node not found: {node_id}")

    state = _load_subject_state(project_root, slug)
    if not any(n.id == node_id for n in state.nodes):
        raise FileNotFoundError(f"Node not found: {node_id}")

    data = dict(payload)
    data["id"] = node_id
    updated = ConceptNode.model_validate(data)

    for i, n in enumerate(state.nodes):
        if n.id == node_id:
            updated.created_at = n.created_at
            updated.updated_at = _now_utc()
            state.nodes[i] = updated
            break

    _save_subject_state(project_root, slug, state)


def delete_concept_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> dict[str, Any]:
    """删除节点；返回被删节点与涉及的关系（供撤销/前端增量同步）。"""
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return {"deleted_node": None, "deleted_relations": []}

    state = _load_subject_state(project_root, slug)
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
    _save_subject_state(project_root, slug, state)
    return {"deleted_node": removed_node, "deleted_relations": removed_rels}


# ---------------------------------------------------------------------------
# 关系 CRUD
# ---------------------------------------------------------------------------


def _find_relation_slug(project_root: Path, relation_id: str) -> str | None:
    """找到关系所在的科目 slug。"""
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        if any(r.id == relation_id for r in state.relations):
            return sm.slug
    return None


def list_node_relations(project_root: Path, *, graph: str | None = None) -> list[dict[str, Any]]:
    ensure_graph_layout(project_root)
    if graph:
        state = _load_subject_state(project_root, graph)
        return [r.model_dump(mode="json") for r in state.relations]
    meta = _load_meta(project_root)
    all_rels: list[dict[str, Any]] = []
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        all_rels.extend(r.model_dump(mode="json") for r in state.relations)
    return all_rels


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

    # 确定目标科目
    if graph:
        target_slug = graph
    else:
        slug_from = _find_node_slug(project_root, from_node_id)
        slug_to = _find_node_slug(project_root, to_node_id)
        if slug_from is None and slug_to is None:
            raise ValueError("Both from/to nodes must exist before creating relation")
        target_slug = slug_from or slug_to  # type: ignore[assignment]

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


def delete_node_relation(
    project_root: Path,
    relation_id: str,
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    slug = graph or _find_relation_slug(project_root, relation_id)
    if slug is None:
        return  # 幂等
    state = _load_subject_state(project_root, slug)
    state.relations = [r for r in state.relations if r.id != relation_id]
    _save_subject_state(project_root, slug, state)


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


# ---------------------------------------------------------------------------
# 绑定
# ---------------------------------------------------------------------------


def bind_question_to_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    qid = str(payload.get("question_qualified_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    if not qid or not node_id:
        raise ValueError("binding requires question_qualified_id and node_id")

    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        raise ValueError(f"Node not found: {node_id}")
    state = _load_subject_state(project_root, slug)
    if not any(n.id == node_id for n in state.nodes):
        raise ValueError(f"Node not found: {node_id}")

    pair = (qid, node_id)
    if any((b.question_qualified_id, b.node_id) == pair for b in state.bindings):
        return
    state.bindings.append(QuestionBinding(question_qualified_id=qid, node_id=node_id))
    _save_subject_state(project_root, slug, state)


def unbind_question_from_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    qid = str(payload.get("question_qualified_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return
    state = _load_subject_state(project_root, slug)
    state.bindings = [
        b for b in state.bindings if not (b.question_qualified_id == qid and b.node_id == node_id)
    ]
    _save_subject_state(project_root, slug, state)


def list_questions_for_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> list[str]:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return []
    state = _load_subject_state(project_root, slug)
    qids = [b.question_qualified_id for b in state.bindings if b.node_id == node_id]
    seen: set[str] = set()
    out: list[str] = []
    for q in qids:
        if q in seen:
            continue
        seen.add(q)
        out.append(q)
    return out


def list_nodes_for_question(project_root: Path, question_qualified_id: str) -> list[ConceptNode]:
    """Return concept nodes that have a binding to the given question qualified id."""
    ensure_graph_layout(project_root)
    qid = (question_qualified_id or "").strip()
    if not qid:
        return []
    meta = _load_meta(project_root)
    out: list[ConceptNode] = []
    seen: set[str] = set()
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        node_ids = {b.node_id for b in state.bindings if b.question_qualified_id == qid}
        by_id = {n.id: n for n in state.nodes}
        for nid in sorted(node_ids):
            if nid in seen:
                continue
            n = by_id.get(nid)
            if n is not None:
                seen.add(nid)
                out.append(n)
    return out


def bind_questions_batch(
    project_root: Path,
    *,
    node_id: str,
    qualified_ids: list[str],
    graph: str | None = None,
) -> dict[str, Any]:
    """Bind multiple questions to one node; idempotent for existing pairs."""
    ensure_graph_layout(project_root)
    nid = (node_id or "").strip()
    if not nid:
        raise ValueError("node_id required")

    slug = graph or _find_node_slug(project_root, nid)
    if slug is None:
        raise ValueError(f"Node not found: {nid}")
    state = _load_subject_state(project_root, slug)
    if not any(n.id == nid for n in state.nodes):
        raise ValueError(f"Node not found: {nid}")

    added = 0
    skipped = 0
    existing_pairs = {(b.question_qualified_id, b.node_id) for b in state.bindings}
    for raw in qualified_ids:
        qid = (raw or "").strip()
        if not qid:
            skipped += 1
            continue
        pair = (qid, nid)
        if pair in existing_pairs:
            skipped += 1
            continue
        state.bindings.append(QuestionBinding(question_qualified_id=qid, node_id=nid))
        existing_pairs.add(pair)
        added += 1
    if added:
        _save_subject_state(project_root, slug, state)
    return {"added": added, "skipped": skipped}


def unbind_questions_batch(
    project_root: Path,
    *,
    node_id: str,
    qualified_ids: list[str],
    graph: str | None = None,
) -> dict[str, Any]:
    """Remove bindings for multiple questions from one node."""
    ensure_graph_layout(project_root)
    nid = (node_id or "").strip()
    if not nid:
        raise ValueError("node_id required")
    slug = graph or _find_node_slug(project_root, nid)
    if slug is None:
        return {"removed": 0}
    state = _load_subject_state(project_root, slug)
    target = {(q or "").strip() for q in qualified_ids if (q or "").strip()}
    if not target:
        return {"removed": 0}
    before = len(state.bindings)
    state.bindings = [
        b for b in state.bindings if not (b.node_id == nid and b.question_qualified_id in target)
    ]
    removed = before - len(state.bindings)
    if removed:
        _save_subject_state(project_root, slug, state)
    return {"removed": removed}


# ---------------------------------------------------------------------------
# 资料链接
# ---------------------------------------------------------------------------


def list_resource_files(project_root: Path, query: str = "", *, limit: int = 800) -> list[dict[str, Any]]:
    """列出 resource/ 下文件（相对路径），供资料关联选择。"""
    resource = (project_root / "resource").resolve()
    assert_within_project(project_root, resource)
    q = (query or "").strip().lower()
    out: list[dict[str, Any]] = []
    if not resource.is_dir():
        return out
    for p in resource.rglob("*"):
        if not p.is_file():
            continue
        try:
            rel = p.relative_to(resource).as_posix()
        except ValueError:
            continue
        if any(part.startswith(".") for part in Path(rel).parts):
            continue
        if q and q not in rel.lower():
            continue
        try:
            st = p.stat()
            sz = int(st.st_size)
        except OSError:
            sz = 0
        out.append({"path": rel, "size": sz})
        if len(out) >= limit * 4:
            break
    out.sort(key=lambda x: x["path"])
    return out[:limit]


def list_file_links_for_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> list[dict[str, Any]]:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        return []
    state = _load_subject_state(project_root, slug)
    return [l.model_dump(mode="json") for l in state.file_links if l.node_id == node_id]


def attach_file_to_node(
    project_root: Path,
    node_id: str,
    relative_path: str,
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    slug = graph or _find_node_slug(project_root, node_id)
    if slug is None:
        raise ValueError(f"Node not found: {node_id}")
    state = _load_subject_state(project_root, slug)
    if not any(n.id == node_id for n in state.nodes):
        raise ValueError(f"Node not found: {node_id}")
    rel = relative_path.strip().replace("\\", "/").lstrip("/")
    target = _resolve_resource_path(project_root, rel)
    if not target.is_file():
        raise ValueError("File does not exist")
    for l in state.file_links:
        if l.node_id == node_id and l.relative_path == rel:
            return l.id
    link_id = uuid.uuid4().hex
    state.file_links.append(NodeFileLink(id=link_id, node_id=node_id, relative_path=rel))
    _save_subject_state(project_root, slug, state)
    return link_id


def _find_file_link_slug(project_root: Path, link_id: str) -> str | None:
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state(project_root, sm.slug)
        if any(l.id == link_id for l in state.file_links):
            return sm.slug
    return None


def detach_file_link(
    project_root: Path,
    link_id: str,
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    slug = graph or _find_file_link_slug(project_root, link_id)
    if slug is None:
        return
    state = _load_subject_state(project_root, slug)
    state.file_links = [l for l in state.file_links if l.id != link_id]
    _save_subject_state(project_root, slug, state)
