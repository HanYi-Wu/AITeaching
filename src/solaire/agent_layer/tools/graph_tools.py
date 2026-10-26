"""Knowledge graph tools via knowledge_forge public API."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.web.actor_scope import teacher_graph_root
from solaire.knowledge_forge import (
    attach_file_to_node,
    bind_question_to_node,
    bind_questions_batch,
    count_nodes_by_kind,
    create_concept_node,
    create_graph,
    create_node_relation,
    delete_concept_node,
    delete_graph,
    delete_node_relation,
    generate_unique_node_id,
    get_concept_node,
    list_concept_nodes,
    list_graphs,
    list_node_relations,
    update_concept_node,
    update_node_relation,
)
from solaire.knowledge_forge.service import (
    bind_question_nodes_batch,
    create_concept_nodes_batch,
    create_node_relations_batch,
)


def _get_graph(args: dict[str, Any]) -> str | None:
    g = args.get("graph")
    return str(g).strip() or None if g else None


def _root(ctx: InvocationContext):
    return teacher_graph_root(ctx.project_root, ctx.platform_user)


def _validate_qualified_id(qid: str) -> str:
    s = str(qid or "").strip()
    if not s:
        raise ValueError("question_qualified_id 必填")
    if len(s) > 255:
        raise ValueError(f"question_qualified_id 长度不能超过 255 字符: {s[:30]}...")
    if "/" not in s:
        raise ValueError(f"question_qualified_id 必须包含 '/'（形如 科目/题集/题目）: {s}")
    parts = s.split("/")
    if any(not p.strip() or p.strip() == ".." for p in parts):
        raise ValueError(f"question_qualified_id 包含非法或空路径段: {s}")
    return s


def _validate_node_id(node_id: str) -> str:
    s = str(node_id or "").strip()
    if not s:
        raise ValueError("node_id 必填")
    if len(s) > 255:
        raise ValueError(f"node_id 长度不能超过 255 字符: {s[:30]}...")
    if "\0" in s:
        raise ValueError(f"node_id 包含空字符: {s}")
    parts = s.split("/")
    if any(p.strip() == ".." for p in parts):
        raise ValueError(f"node_id 包含非法相对跳转段 (..): {s}")
    return s


def tool_list_graphs(ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    """列出所有科目图谱。"""
    graphs = list_graphs(_root(ctx))
    return ToolResult(status="succeeded", data={"graphs": graphs})


def tool_create_graph(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    """创建新科目图谱。"""
    display_name = str(args.get("display_name") or "").strip()
    if not display_name:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="display_name 必填")
    slug_hint = str(args.get("slug") or "").strip() or None
    try:
        slug = create_graph(_root(ctx), display_name, slug_hint)
        return ToolResult(status="succeeded", data={"ok": True, "slug": slug})
    except ValueError as e:
        return ToolResult(status="failed", error_code="conflict", error_message=str(e))


def tool_delete_graph(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    """删除科目图谱（不可逆）。"""
    slug = str(args.get("slug") or "").strip()
    if not slug:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="slug 必填")
    delete_graph(_root(ctx), slug)
    return ToolResult(status="succeeded", data={"ok": True})


def tool_list_nodes(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    nk = args.get("node_kind")
    nk_s = str(nk).strip() if nk else None
    graph = _get_graph(args)
    try:
        nodes = list_concept_nodes(_root(ctx), node_kind=nk_s or None, graph=graph)
        counts = count_nodes_by_kind(_root(ctx), graph=graph)
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    return ToolResult(status="succeeded", data={"nodes": nodes, "kind_counts": counts})


def _node_payload_from_args(args: dict[str, Any]) -> dict[str, Any]:
    """Map agent args to ConceptNode fields (exclude None)."""
    keys = (
        "id",
        "canonical_name",
        "node_kind",
        "aliases",
        "subject",
        "level",
        "description",
        "tags",
        "source",
        "layout_x",
        "layout_y",
        "primary_parent_id",
    )
    out: dict[str, Any] = {}
    for k in keys:
        if k in args and args[k] is not None:
            out[k] = args[k]
    return out


def tool_create_node(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    root = _root(ctx)
    graph = _get_graph(args)
    body = _node_payload_from_args(args)
    canonical_name = str(body.get("canonical_name") or "").strip()
    if not canonical_name:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="canonical_name 必填")
    if len(canonical_name) > 128:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="canonical_name 长度不能超过 128 字符")
    node_id = str(args.get("id") or "").strip() or None
    parent = str(args.get("parent_node_id") or "").strip() or None
    if node_id:
        try:
            _validate_node_id(node_id)
        except ValueError as e:
            return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    if parent:
        try:
            _validate_node_id(parent)
        except ValueError as e:
            return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
        try:
            get_concept_node(root, parent, graph=graph)
        except FileNotFoundError:
            return ToolResult(status="failed", error_code="invalid_arguments", error_message=f"父节点不存在: {parent}")
    payload = {k: v for k, v in body.items() if k != "id"}
    try:
        if not node_id:
            if not parent:
                return ToolResult(
                    status="failed",
                    error_code="invalid_arguments",
                    error_message="新建节点需提供 parent_node_id 以自动生成标识，或显式提供 id",
                )
            nid = generate_unique_node_id(root, parent, canonical_name)
            payload["id"] = nid
            # Set primary_parent_id if not explicitly given
            if "primary_parent_id" not in payload:
                payload["primary_parent_id"] = parent
            create_concept_node(root, payload, graph=graph)
            create_node_relation(
                root,
                {"from_node_id": nid, "to_node_id": parent, "relation_type": "part_of"},
                graph=graph,
            )
            return ToolResult(status="succeeded", data={"ok": True, "node_id": nid})
        payload["id"] = node_id
        create_concept_node(root, payload, graph=graph)
        if parent:
            if "primary_parent_id" not in payload:
                payload["primary_parent_id"] = parent
                # update the node with primary_parent_id
                try:
                    existing = get_concept_node(root, node_id, graph=graph)
                    merged = {**existing, "primary_parent_id": parent}
                    update_concept_node(root, node_id, merged, graph=graph)
                except Exception:
                    pass
            create_node_relation(
                root,
                {"from_node_id": node_id, "to_node_id": parent, "relation_type": "part_of"},
                graph=graph,
            )
        return ToolResult(status="succeeded", data={"ok": True, "node_id": node_id})
    except ValueError as e:
        return ToolResult(status="failed", error_code="conflict", error_message=str(e))


def tool_update_node(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    root = _root(ctx)
    graph = _get_graph(args)
    node_id = str(args.get("node_id") or "").strip()
    if not node_id:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="node_id 必填")
    try:
        existing = get_concept_node(root, node_id, graph=graph)
    except FileNotFoundError:
        return ToolResult(status="failed", error_code="not_found", error_message="节点不存在")
    incoming = _node_payload_from_args(args)
    merged = {**existing, **incoming, "id": node_id}
    try:
        update_concept_node(root, node_id, merged, graph=graph)
    except (FileNotFoundError, ValueError) as e:
        return ToolResult(status="failed", error_code="runtime_error", error_message=str(e))
    return ToolResult(status="succeeded", data={"ok": True})


def tool_delete_node(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    graph = _get_graph(args)
    node_id = str(args.get("node_id") or "").strip()
    if not node_id:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="node_id 必填")
    delete_concept_node(_root(ctx), node_id, graph=graph)
    return ToolResult(status="succeeded", data={"ok": True})


def tool_create_relation(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    graph = _get_graph(args)
    try:
        rel_id = create_node_relation(_root(ctx), args, graph=graph)
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    return ToolResult(status="succeeded", data={"ok": True, "relation_id": rel_id})


def tool_delete_relation(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    graph = _get_graph(args)
    rid = str(args.get("relation_id") or "").strip()
    if not rid:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="relation_id 必填")
    delete_node_relation(_root(ctx), rid, graph=graph)
    return ToolResult(status="succeeded", data={"ok": True})


def tool_update_relation(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    """更新关系类型或颠倒方向。"""
    graph = _get_graph(args)
    rid = str(args.get("relation_id") or "").strip()
    if not rid:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="relation_id 必填")
    relation_type = str(args.get("relation_type") or "").strip() or None
    reverse = bool(args.get("reverse", False))
    try:
        update_node_relation(_root(ctx), rid, relation_type=relation_type, reverse=reverse, graph=graph)
    except FileNotFoundError:
        return ToolResult(status="failed", error_code="not_found", error_message="关系不存在")
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    return ToolResult(status="succeeded", data={"ok": True})


def tool_bind_question(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    graph = _get_graph(args)
    try:
        qid = _validate_qualified_id(str(args.get("question_qualified_id") or ""))
        nid = _validate_node_id(str(args.get("node_id") or ""))
        root = _root(ctx)
        try:
            get_concept_node(root, nid, graph=graph)
        except FileNotFoundError:
            return ToolResult(
                status="failed",
                error_code="not_found",
                error_message=f"目标知识点节点不存在: {nid}，未建立绑定",
            )
        bind_question_to_node(
            root,
            {
                "question_qualified_id": qid,
                "node_id": nid,
            },
            graph=graph,
        )
        return ToolResult(status="succeeded", data={"ok": True})
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))


def tool_attach_resource(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    graph = _get_graph(args)
    node_id = str(args.get("node_id") or "").strip()
    rel_path = str(args.get("relative_path") or "").strip()
    if not node_id or not rel_path:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="node_id 与 relative_path 必填")
    if ".." in rel_path.replace("\\", "/").split("/"):
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="relative_path 不得包含相对路径跳转 (..)")
    root = _root(ctx)
    try:
        _validate_node_id(node_id)
        get_concept_node(root, node_id, graph=graph)
    except FileNotFoundError:
        return ToolResult(status="failed", error_code="not_found", error_message=f"目标知识点节点不存在: {node_id}")
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    try:
        link_id = attach_file_to_node(root, node_id, rel_path, graph=graph)
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    return ToolResult(status="succeeded", data={"ok": True, "link_id": link_id})


def tool_list_relations(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    graph = _get_graph(args)
    rels = list_node_relations(_root(ctx), graph=graph)
    return ToolResult(status="succeeded", data={"relations": rels})


def _node_text_blob(n: dict[str, Any]) -> str:
    parts = [
        str(n.get("canonical_name") or ""),
        str(n.get("description") or ""),
        str(n.get("id") or ""),
    ]
    for a in n.get("aliases") or []:
        parts.append(str(a))
    return " ".join(parts).lower()


def tool_search_nodes(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    q_raw = str(args.get("query") or "").strip()
    if not q_raw:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="query 必填")
    nk = args.get("node_kind")
    nk_s = str(nk).strip() if nk else None
    graph = _get_graph(args)
    max_hits = args.get("max_hits")
    try:
        mh = int(max_hits) if max_hits is not None else 30
    except (TypeError, ValueError):
        mh = 30
    mh = max(1, min(mh, 200))
    try:
        nodes = list_concept_nodes(_root(ctx), node_kind=nk_s or None, graph=graph)
    except ValueError as e:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(e))
    q = q_raw.lower()
    tokens = [t for t in q.split() if t]
    hits: list[dict[str, Any]] = []
    for n in nodes:
        blob = _node_text_blob(n)
        if q in blob or (tokens and all(t in blob for t in tokens)):
            hits.append(n)
            if len(hits) >= mh:
                break
    return ToolResult(
        status="succeeded",
        data={"nodes": hits, "total_scanned": len(nodes), "max_hits": mh},
    )


def tool_batch_create_nodes(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    raw = args.get("nodes")
    if not isinstance(raw, list) or not raw:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="nodes 须为非空数组")
    root = _root(ctx)
    graph = _get_graph(args)
    try:
        nids = create_concept_nodes_batch(root, raw, graph=graph)
        created = [{"index": i, "node_id": nid} for i, nid in enumerate(nids)]
        return ToolResult(
            status="succeeded",
            data={
                "created": created,
                "errors": [],
                "ok_count": len(created),
                "error_count": 0,
                "partial_success": False,
            },
        )
    except ValueError as e:
        return ToolResult(
            status="failed",
            error_code="batch_all_failed",
            error_message=f"批量创建要点校验失败，未执行部分写入：{e}",
            data={
                "created": [],
                "errors": [{"error": str(e)}],
                "ok_count": 0,
                "error_count": len(raw),
                "partial_success": False,
            },
        )


def tool_batch_bind_questions(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    raw = args.get("bindings")
    if not isinstance(raw, list) or not raw:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="bindings 须为非空数组")
    root = _root(ctx)
    graph = _get_graph(args)
    try:
        stats = bind_question_nodes_batch(root, raw, graph=graph)
        return ToolResult(
            status="succeeded",
            data={
                "batches": [{"status": "applied", **stats}],
                "parse_errors": [],
                "ok_count": stats.get("added", 0),
                "error_count": 0,
                "partial_success": False,
            },
        )
    except ValueError as e:
        return ToolResult(
            status="failed",
            error_code="batch_all_failed",
            error_message=f"批量挂接题目校验失败，未执行部分写入：{e}",
            data={
                "batches": [],
                "parse_errors": [{"error": str(e)}],
                "ok_count": 0,
                "error_count": len(raw),
                "partial_success": False,
            },
        )


def tool_batch_create_relations(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    raw = args.get("relations")
    if not isinstance(raw, list) or not raw:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message="relations 须为非空数组")
    root = _root(ctx)
    graph = _get_graph(args)
    try:
        rids = create_node_relations_batch(root, raw, graph=graph)
        created = [{"index": i, "relation_id": rid} for i, rid in enumerate(rids)]
        return ToolResult(
            status="succeeded",
            data={
                "created": created,
                "errors": [],
                "ok_count": len(created),
                "error_count": 0,
                "partial_success": False,
            },
        )
    except ValueError as e:
        return ToolResult(
            status="failed",
            error_code="batch_all_failed",
            error_message=f"批量建立关联校验失败，未执行部分写入：{e}",
            data={
                "created": [],
                "errors": [{"error": str(e)}],
                "ok_count": 0,
                "error_count": len(raw),
                "partial_success": False,
            },
        )
