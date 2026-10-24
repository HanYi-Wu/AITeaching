"""routers graph."""

from __future__ import annotations

import uuid
from typing import Any
from fastapi import Body, File, HTTPException, Query, UploadFile
from solaire.web import state
from solaire.web.bank_service import get_question_detail
from solaire.web.graph_service import attach_file_to_node, bind_question_to_node, bind_questions_batch, count_nodes_by_kind, create_concept_node, create_graph, create_node_relation, delete_concept_node, delete_graph, delete_node_relation, detach_file_link, export_graph, generate_unique_node_id, get_concept_node, get_taxonomy, import_graph, list_concept_nodes, list_file_links_for_node, list_graphs, list_node_relations, list_nodes_for_question, list_questions_for_node, list_resource_files, rename_graph, set_taxonomy, unbind_question_from_node, unbind_questions_batch, update_concept_node, update_node_relation
from solaire.web.project_layout import ensure_project_layout
from solaire.web.security import assert_within_project, safe_filename_component
from fastapi import APIRouter
from solaire.web.request_context import _require_root
from solaire.web.schemas.graph import GraphBindingBatchBody, GraphBindingCreateBody, GraphCreateBody, GraphFileLinkBody, GraphImportBody, GraphNodeCreateBody, GraphRelationCreateBody, GraphRelationUpdateBody, GraphRenameBody, GraphTaxonomyBody

router = APIRouter()


def _preview_text(s: str | None, n: int = 240) -> str:
    t = (s or "").replace("\n", " ").strip()
    return t if len(t) <= n else t[: n - 3] + "..."


@router.get("/api/graph/graphs")
def graph_list_all() -> dict[str, Any]:
    """列出所有科目图谱。"""
    root = _require_root()
    return {"graphs": list_graphs(root)}


@router.post("/api/graph/graphs")
def graph_create(body: GraphCreateBody) -> dict[str, Any]:
    """创建新科目图谱。"""
    root = _require_root()
    try:
        slug = create_graph(root, body.display_name, body.slug)
        return {"ok": True, "slug": slug}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/graph/graphs/{slug}/export")
def graph_export(slug: str) -> dict[str, Any]:
    """导出单个科目图谱。"""
    root = _require_root()
    try:
        return {"bundle": export_graph(root, slug)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/api/graph/graphs/import")
def graph_import(body: GraphImportBody) -> dict[str, Any]:
    """导入图谱为新的科目图谱。"""
    root = _require_root()
    try:
        slug = import_graph(root, body.bundle, slug=body.slug)
        return {"ok": True, "slug": slug}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/api/graph/graphs/{slug}")
def graph_rename(slug: str, body: GraphRenameBody) -> dict[str, Any]:
    """修改科目图谱名称。"""
    root = _require_root()
    try:
        rename_graph(root, slug, body.display_name)
        return {"ok": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/api/graph/graphs/{slug}")
def graph_delete(slug: str) -> dict[str, Any]:
    """删除科目图谱（不可恢复）。"""
    root = _require_root()
    delete_graph(root, slug)
    return {"ok": True}


@router.get("/api/graph/nodes")
def graph_nodes_list(
    node_kind: str | None = Query(None, description="按节点类型筛选：concept / skill / causal"),
    graph: str | None = Query(None, description="科目图谱 slug；留空则返回所有科目"),
) -> dict[str, Any]:
    root = _require_root()
    try:
        nodes = list_concept_nodes(root, node_kind=node_kind, graph=graph)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"nodes": nodes, "kind_counts": count_nodes_by_kind(root, graph=graph)}


def _graph_node_payload(body: GraphNodeCreateBody) -> dict[str, Any]:
    d = body.model_dump(exclude_none=True)
    d.pop("parent_node_id", None)
    return d


@router.post("/api/graph/nodes")
def graph_nodes_create(
    body: GraphNodeCreateBody,
    graph: str | None = Query(None, description="科目图谱 slug"),
) -> dict[str, Any]:
    root = _require_root()
    try:
        node_id = (body.id or "").strip() or None
        parent = (body.parent_node_id or "").strip() or None
        payload = _graph_node_payload(body)
        if not node_id:
            if not parent:
                raise HTTPException(
                    status_code=400,
                    detail="请选择父级知识点以自动生成标识，或填写标识",
                )
            nid = generate_unique_node_id(root, parent, body.canonical_name)
            payload["id"] = nid
            create_concept_node(root, payload, graph=graph)
            create_node_relation(
                root,
                {"from_node_id": nid, "to_node_id": parent, "relation_type": "part_of"},
                graph=graph,
            )
            node = get_concept_node(root, nid, graph=graph)
            rels = list_node_relations(root, graph=graph)
            part_rel = next(
                (
                    r
                    for r in rels
                    if r.get("from_node_id") == nid
                    and r.get("to_node_id") == parent
                    and r.get("relation_type") == "part_of"
                ),
                None,
            )
            return {"ok": True, "node_id": nid, "node": node, "relation": part_rel}
        payload["id"] = node_id
        create_concept_node(root, payload, graph=graph)
        part_rel = None
        if parent:
            create_node_relation(
                root,
                {"from_node_id": node_id, "to_node_id": parent, "relation_type": "part_of"},
                graph=graph,
            )
            rels = list_node_relations(root, graph=graph)
            part_rel = next(
                (
                    r
                    for r in rels
                    if r.get("from_node_id") == node_id
                    and r.get("to_node_id") == parent
                    and r.get("relation_type") == "part_of"
                ),
                None,
            )
        node = get_concept_node(root, node_id, graph=graph)
        return {"ok": True, "node_id": node_id, "node": node, "relation": part_rel}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/graph/nodes/{node_id}")
def graph_nodes_get(node_id: str, graph: str | None = Query(None)) -> dict[str, Any]:
    root = _require_root()
    try:
        return {"node": get_concept_node(root, node_id, graph=graph)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.put("/api/graph/nodes/{node_id:path}")
def graph_nodes_update(
    node_id: str,
    body: GraphNodeCreateBody,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        existing = get_concept_node(root, node_id, graph=graph)
        incoming = _graph_node_payload(body)
        merged = {**existing, **incoming, "id": node_id}
        update_concept_node(root, node_id, merged, graph=graph)
        return {"ok": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/graph/relations")
def graph_relations_create(
    body: GraphRelationCreateBody,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        rel_id = create_node_relation(root, body.model_dump(), graph=graph)
        return {"ok": True, "relation_id": rel_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/graph/relations")
def graph_relations_list(graph: str | None = Query(None)) -> dict[str, Any]:
    root = _require_root()
    return {"relations": list_node_relations(root, graph=graph)}


@router.delete("/api/graph/relations/{relation_id}")
def graph_relations_delete(
    relation_id: str,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    delete_node_relation(root, relation_id, graph=graph)
    return {"ok": True}


@router.put("/api/graph/relations/{relation_id}")
def graph_relations_update(
    relation_id: str,
    body: GraphRelationUpdateBody,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    """更新关系类型或颠倒方向。"""
    root = _require_root()
    try:
        update_node_relation(
            root,
            relation_id,
            relation_type=body.relation_type,
            reverse=body.reverse,
            graph=graph,
        )
        return {"ok": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/graph/bindings")
def graph_bindings_create(
    body: GraphBindingCreateBody,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        bind_question_to_node(root, body.model_dump(), graph=graph)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/graph/bindings/unbind")
def graph_bindings_unbind(
    body: GraphBindingCreateBody,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        unbind_question_from_node(root, body.model_dump(), graph=graph)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/graph/nodes/{node_id:path}/bind-batch")
def graph_nodes_bind_batch(
    node_id: str,
    body: GraphBindingBatchBody,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        return bind_questions_batch(root, node_id=node_id, qualified_ids=body.qualified_ids, graph=graph)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/api/graph/nodes/{node_id:path}/unbind-batch")
def graph_nodes_unbind_batch(
    node_id: str,
    body: GraphBindingBatchBody = Body(...),
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        return unbind_questions_batch(root, node_id=node_id, qualified_ids=body.qualified_ids, graph=graph)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/graph/question-nodes")
def graph_question_nodes(qualified_id: str = Query(..., min_length=1)) -> dict[str, Any]:
    root = _require_root()
    nodes = list_nodes_for_question(root, qualified_id)
    return {
        "nodes": [
            {
                "id": n.id,
                "canonical_name": n.canonical_name,
                "node_kind": n.node_kind,
                "subject": n.subject,
            }
            for n in nodes
        ]
    }


@router.get("/api/graph/question-bindings-index")
def graph_question_bindings_index(graph: str | None = Query(None)) -> dict[str, Any]:
    """单次返回「题目全限定 id → 已关联知识点节点」摘要，供题库列表展示标签。"""
    root = _require_root()
    from solaire.knowledge_forge.service import _load_meta, _load_subject_state  # noqa: PLC0415

    _ensure_root_graph_loaded = lambda: None  # noqa: E731
    acc: dict[str, list[dict[str, Any]]] = {}

    from solaire.knowledge_forge import ensure_graph_layout  # noqa: PLC0415
    ensure_graph_layout(root)

    from solaire.knowledge_forge.service import _load_meta as lm, _load_subject_state as lss  # noqa: PLC0415
    meta = lm(root)
    slugs = [graph] if graph else [sm.slug for sm in meta.subjects]
    for slug in slugs:
        state = lss(root, slug)
        node_by_id = {n.id: n for n in state.nodes}
        for b in state.bindings:
            n = node_by_id.get(b.node_id)
            if n is None:
                continue
            acc.setdefault(b.question_qualified_id, []).append(
                {"id": n.id, "canonical_name": n.canonical_name, "node_kind": n.node_kind}
            )
    for qid in list(acc.keys()):
        seen: set[str] = set()
        uniq: list[dict[str, Any]] = []
        for x in acc[qid]:
            nid = str(x.get("id") or "")
            if nid in seen:
                continue
            seen.add(nid)
            uniq.append(x)
        acc[qid] = uniq
    return {"index": acc}


@router.get("/api/graph/nodes/{node_id:path}/questions")
def graph_nodes_questions(node_id: str, graph: str | None = Query(None)) -> dict[str, Any]:
    root = _require_root()
    content_root = state.get_content_root()
    ensure_project_layout(content_root)
    qids = list_questions_for_node(root, node_id, graph=graph)
    questions: list[dict[str, Any]] = []
    for qid in qids:
        try:
            d = get_question_detail(content_root, qid)
        except FileNotFoundError:
            # 图谱绑定可能指向已删除题目；本阶段保持“跳过缺失题目”，不阻断列表。
            continue
        typ: str = "unknown"
        preview: str = ""
        if d.get("question") is not None:
            typ = d["question"].get("type") or "single_choice"
            preview = _preview_text(d.get("question_display", {}).get("content"))
        elif d.get("question_group") is not None:
            typ = "group"
            preview = _preview_text(d["question_group"].get("material"))
        questions.append(
            {
                "qualified_id": d.get("qualified_id") or qid,
                "type": typ,
                "content_preview": preview,
            }
        )
    return {"questions": questions}


@router.get("/api/graph/taxonomy")
def graph_taxonomy_get() -> dict[str, Any]:
    root = _require_root()
    return get_taxonomy(root)


@router.put("/api/graph/taxonomy")
def graph_taxonomy_put(body: GraphTaxonomyBody) -> dict[str, Any]:
    root = _require_root()
    set_taxonomy(root, subjects=body.subjects, levels=body.levels)
    return {"ok": True}


@router.get("/api/graph/resource-files")
def graph_resource_files_list(q: str = "", limit: int = Query(800, ge=1, le=5000)) -> dict[str, Any]:
    root = _require_root()
    return {"files": list_resource_files(root, q, limit=limit)}


@router.get("/api/graph/nodes/{node_id:path}/files")
def graph_node_files_list(node_id: str, graph: str | None = Query(None)) -> dict[str, Any]:
    root = _require_root()
    return {"links": list_file_links_for_node(root, node_id, graph=graph)}


@router.delete("/api/graph/nodes/{node_id:path}")
def graph_nodes_delete(node_id: str, graph: str | None = Query(None)) -> dict[str, Any]:
    root = _require_root()
    result = delete_concept_node(root, node_id, graph=graph)
    return {"ok": True, **result}


@router.post("/api/graph/file-links")
def graph_file_links_create(
    body: GraphFileLinkBody,
    graph: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        link_id = attach_file_to_node(root, body.node_id, body.relative_path, graph=graph)
        return {"ok": True, "link_id": link_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/api/graph/file-links/{link_id}")
def graph_file_links_delete(link_id: str, graph: str | None = Query(None)) -> dict[str, Any]:
    root = _require_root()
    detach_file_link(root, link_id, graph=graph)
    return {"ok": True}


@router.post("/api/graph/upload")
async def graph_upload_material(file: UploadFile = File(...)) -> dict[str, Any]:
    """上传资料到 resource/资料/uploads/，返回相对 resource/ 的路径。"""
    root = _require_root()
    resource = (root / "resource").resolve()
    dest_dir = (resource / "资料" / "uploads").resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    assert_within_project(root, dest_dir)
    raw_name = file.filename or "file"
    safe = safe_filename_component(raw_name) or "file"
    name = f"{uuid.uuid4().hex}_{safe}"
    target = (dest_dir / name).resolve()
    assert_within_project(root, target)
    content = await file.read()
    target.write_bytes(content)
    rel = target.relative_to(resource).as_posix()
    return {"ok": True, "relative_path": rel}
