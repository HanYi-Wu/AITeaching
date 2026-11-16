"""Question binding operations."""

from __future__ import annotations

from typing import Any
from solaire.knowledge_forge.models import ConceptNode
from pathlib import Path
from solaire.knowledge_forge.models import QuestionBinding
from solaire.knowledge_forge.node_index import _find_node_state
from solaire.knowledge_forge.paths import _meta_path
from solaire.knowledge_forge.storage import _load_meta
from solaire.knowledge_forge.storage import _load_subject_state_snapshot
from solaire.knowledge_forge.migration import ensure_graph_layout
from solaire.knowledge_forge.concurrency import graph_mutation
from solaire.knowledge_forge.mutation_session import GraphMutationSession


@graph_mutation
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

    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_node_slug(node_id)
        if slug is None:
            raise ValueError(f"Node not found: {node_id}")

        state = session.state(slug)
        if not any(n.id == node_id for n in state.nodes):
            raise ValueError(f"Node not found: {node_id}")

        pair = (qid, node_id)
        if any((b.question_qualified_id, b.node_id) == pair for b in state.bindings):
            return
        state.bindings.append(QuestionBinding(question_qualified_id=qid, node_id=node_id))
        session.save(slug)


@graph_mutation
def unbind_question_from_node(
    project_root: Path,
    payload: dict[str, Any],
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    qid = str(payload.get("question_qualified_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_node_slug(node_id)
        if slug is None:
            return
        state = session.state(slug)
        state.bindings = [
            b for b in state.bindings if not (b.question_qualified_id == qid and b.node_id == node_id)
        ]
        session.save(slug)


def list_questions_for_node(
    project_root: Path,
    node_id: str,
    *,
    graph: str | None = None,
) -> list[str]:
    ensure_graph_layout(project_root)
    if graph:
        state = _load_subject_state_snapshot(project_root, graph)
    else:
        match = _find_node_state(project_root, node_id)
        if match is None:
            return []
        state = match[1]
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
        state = _load_subject_state_snapshot(project_root, sm.slug)
        node_ids = {b.node_id for b in state.bindings if b.question_qualified_id == qid}
        by_id = {n.id: n for n in state.nodes}
        for nid in sorted(node_ids):
            if nid in seen:
                continue
            n = by_id.get(nid)
            if n is not None:
                seen.add(nid)
                out.append(n.model_copy(deep=True))
    return out


@graph_mutation
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

    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_node_slug(nid)
        if slug is None:
            raise ValueError(f"Node not found: {nid}")

        state = session.state(slug)
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
            session.save(slug)
    return {"added": added, "skipped": skipped}


@graph_mutation
def bind_question_nodes_batch(
    project_root: Path,
    bindings: list[dict[str, Any]],
    *,
    graph: str | None = None,
) -> dict[str, Any]:
    """Atomically bind question-to-node pairs after pre-validating entire batch."""
    ensure_graph_layout(project_root)
    if not isinstance(bindings, list) or not bindings:
        raise ValueError("bindings 须为非空列表")

    with GraphMutationSession(project_root) as session:
        all_node_ids, _ = session.node_index()
        validated: list[tuple[str, str]] = []

        # 1. 整批预校验结构与节点引用（全部通过才落盘）
        for i, item in enumerate(bindings):
            if not isinstance(item, dict):
                raise ValueError(f"条目 #{i} 须为对象")
            qid = str(item.get("question_qualified_id") or "").strip()
            nid = str(item.get("node_id") or "").strip()
            if not qid or not nid:
                raise ValueError(f"条目 #{i} 缺少 question_qualified_id 或 node_id")
            if "/" not in qid or ".." in qid.split("/"):
                raise ValueError(f"条目 #{i} 题目标识格式非法: {qid}")
            if nid not in all_node_ids:
                raise ValueError(f"条目 #{i} 节点不存在: {nid}")
            validated.append((qid, nid))

        # 按节点所在科目分组落盘
        by_slug: dict[str, list[tuple[str, str]]] = {}
        for qid, nid in validated:
            slug = graph or session.find_node_slug(nid)
            if slug is None:
                raise ValueError(f"无法确定节点所在科目: {nid}")
            by_slug.setdefault(slug, []).append((qid, nid))

        total_added = 0
        total_skipped = 0
        # 2. 一致性落盘
        for slug, pairs in by_slug.items():
            state = session.state(slug)
            local_ids = {n.id for n in state.nodes}
            if any(nid not in local_ids for _, nid in pairs):
                raise ValueError(f"绑定节点不在指定图谱中: {slug}")
            existing = {(b.question_qualified_id, b.node_id) for b in state.bindings}
            for qid, nid in pairs:
                if (qid, nid) in existing:
                    total_skipped += 1
                    continue
                state.bindings.append(QuestionBinding(question_qualified_id=qid, node_id=nid))
                existing.add((qid, nid))
                total_added += 1
            session.save(slug)

    return {"added": total_added, "skipped": total_skipped, "total": len(validated)}


@graph_mutation
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
    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_node_slug(nid)
        if slug is None:
            return {"removed": 0}
        state = session.state(slug)
        target = {(q or "").strip() for q in qualified_ids if (q or "").strip()}
        if not target:
            return {"removed": 0}
        before = len(state.bindings)
        state.bindings = [
            b for b in state.bindings if not (b.node_id == nid and b.question_qualified_id in target)
        ]
        removed = before - len(state.bindings)
        if removed:
            session.save(slug)
    return {"removed": removed}


@graph_mutation
def rename_question_bindings(project_root: Path, old_qid: str, new_qid: str) -> int:
    """Update question_qualified_id across subject knowledge graphs after a rename."""
    if not old_qid or not new_qid or old_qid == new_qid:
        return 0
    if not _meta_path(project_root).is_file():
        return 0
    ensure_graph_layout(project_root)
    updated = 0
    with GraphMutationSession(project_root) as session:
        for subject in _load_meta(project_root).subjects:
            state = session.state(subject.slug)
            if not any(b.question_qualified_id == old_qid for b in state.bindings):
                continue
            seen: set[tuple[str, str]] = set()
            next_bindings: list[QuestionBinding] = []
            for binding in state.bindings:
                if binding.question_qualified_id == old_qid:
                    updated += 1
                    candidate = binding.model_copy(update={"question_qualified_id": new_qid})
                else:
                    candidate = binding
                pair = (candidate.question_qualified_id, candidate.node_id)
                if pair in seen:
                    continue
                seen.add(pair)
                next_bindings.append(candidate)
            state.bindings = next_bindings
            session.save(subject.slug)
    return updated
