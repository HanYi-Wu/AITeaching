"""Resource file associations."""

from __future__ import annotations

from typing import Any
from solaire.knowledge_forge.models import NodeFileLink
from pathlib import Path
from solaire.knowledge_forge.node_index import _find_node_state
from solaire.knowledge_forge.storage import _load_meta
from solaire.knowledge_forge.storage import _load_subject_state_snapshot
from solaire.knowledge_forge.paths import _resolve_resource_path
from solaire.common.security import assert_within_project
from solaire.knowledge_forge.migration import ensure_graph_layout
from solaire.knowledge_forge.concurrency import graph_mutation
from solaire.knowledge_forge.mutation_session import GraphMutationSession
import uuid


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
    if graph:
        state = _load_subject_state_snapshot(project_root, graph)
    else:
        match = _find_node_state(project_root, node_id)
        if match is None:
            return []
        state = match[1]
    return [l.model_dump(mode="json") for l in state.file_links if l.node_id == node_id]


@graph_mutation
def attach_file_to_node(
    project_root: Path,
    node_id: str,
    relative_path: str,
    *,
    graph: str | None = None,
) -> str:
    ensure_graph_layout(project_root)
    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_node_slug(node_id)
        if slug is None:
            raise ValueError(f"Node not found: {node_id}")
        state = session.state(slug)
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
        session.save(slug)
    return link_id


def _find_file_link_slug(project_root: Path, link_id: str) -> str | None:
    meta = _load_meta(project_root)
    for sm in meta.subjects:
        state = _load_subject_state_snapshot(project_root, sm.slug)
        if any(l.id == link_id for l in state.file_links):
            return sm.slug
    return None


@graph_mutation
def detach_file_link(
    project_root: Path,
    link_id: str,
    *,
    graph: str | None = None,
) -> None:
    ensure_graph_layout(project_root)
    with GraphMutationSession(project_root) as session:
        slug = graph or session.find_file_link_slug(link_id)
        if slug is None:
            return
        state = session.state(slug)
        state.file_links = [l for l in state.file_links if l.id != link_id]
        session.save(slug)
