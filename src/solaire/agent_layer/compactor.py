"""L1 micro-compact: shrink tool outputs for LLM context (education-specific)."""

from __future__ import annotations

import json
from typing import Any


_SMALL_JSON_FAST_PATH_CHARS = 4096


def _small_json_candidate(obj: Any, *, limit: int) -> bool:
    """Quickly reject common large shapes before using the C JSON encoder."""
    if type(obj) is not dict or len(obj) > 64:
        return False

    for key, value in obj.items():
        if type(key) not in (str, bool, int, float) and key is not None:
            return False
        if type(key) is str and len(key) > limit:
            return False
        if type(value) is str:
            if len(value) > limit:
                return False
            continue
        if type(value) not in (dict, list, tuple):
            if value is None or type(value) in (bool, int, float):
                continue
            return False
        if len(value) > 64:
            return False
        children = value.values() if type(value) is dict else value
        for child in children:
            if type(child) is str:
                if len(child) > limit:
                    return False
                continue
            if child is None or type(child) in (bool, int, float):
                continue
            if type(child) not in (dict, list, tuple) or len(child) > 64:
                return False
            grandchildren = child.values() if type(child) is dict else child
            for grandchild in grandchildren:
                if type(grandchild) is str:
                    if len(grandchild) > limit:
                        return False
                elif grandchild is not None and type(grandchild) not in (bool, int, float, dict, list, tuple):
                    return False
                elif type(grandchild) in (dict, list, tuple) and len(grandchild) > 64:
                    return False
                elif type(grandchild) in (dict, list, tuple):
                    leaves = grandchild.values() if type(grandchild) is dict else grandchild
                    for leaf in leaves:
                        if type(leaf) is str:
                            if len(leaf) > limit:
                                return False
                        elif leaf is not None and type(leaf) not in (bool, int, float):
                            return False
    return True


def _json_size(obj: Any, *, stop_after: int | None = None) -> int:
    """Measure the same JSON text as ``json.dumps`` without joining fragments.

    When only testing a budget, return as soon as the lower bound exceeds it.
    This avoids allocating a serialized copy of very large tool payloads.
    """
    try:
        fast_limit = _SMALL_JSON_FAST_PATH_CHARS
        if stop_after is not None:
            fast_limit = min(fast_limit, stop_after)
        if _small_json_candidate(obj, limit=fast_limit):
            encoded = json.dumps(obj, ensure_ascii=False, default=str)
            if stop_after is None or len(encoded) <= stop_after:
                return len(encoded)

        encoder = json.JSONEncoder(ensure_ascii=False, default=str)
        size = 0
        for fragment in encoder.iterencode(obj):
            size += len(fragment)
            if stop_after is not None and size > stop_after:
                return size
        return size
    except Exception:
        return len(str(obj))


def compact_for_llm(payload: Any, *, max_chars: int = 12000) -> tuple[Any, bool]:
    """Return (possibly truncated payload, was_truncated)."""
    if _json_size(payload, stop_after=max_chars) <= max_chars:
        return payload, False
    if isinstance(payload, dict):
        return _compact_dict(payload, max_chars=max_chars)
    if isinstance(payload, list):
        return _compact_list(payload, max_chars=max_chars)
    s = str(payload)
    if len(s) <= max_chars:
        return s, False
    head = max_chars // 2
    tail = max_chars // 4
    return (
        s[:head] + f"\n…（省略 {len(s) - head - tail} 字符）…\n" + s[-tail:],
        True,
    )


def _slim_graph_node(n: dict[str, Any]) -> dict[str, Any]:
    """图谱节点压缩为模型检索所需的核心字段。"""
    return {
        "id": n.get("id"),
        "canonical_name": n.get("canonical_name"),
        "node_kind": n.get("node_kind") or "concept",
        "subject": n.get("subject"),
        "level": n.get("level"),
        "tags": (n.get("tags") or [])[:8] if isinstance(n.get("tags"), list) else n.get("tags"),
    }


def _slim_graph_relation(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r.get("id"),
        "from_node_id": r.get("from_node_id"),
        "to_node_id": r.get("to_node_id"),
        "relation_type": r.get("relation_type"),
    }


def _compact_graph_nodes_dict(d: dict[str, Any], *, max_chars: int) -> dict[str, Any]:
    """graph.list_nodes 等大列表：保留总数、类型统计与代表性样本，避免压缩成空对象。"""
    out: dict[str, Any] = {}
    if "kind_counts" in d and isinstance(d["kind_counts"], dict):
        out["kind_counts"] = d["kind_counts"]
    if "nodes" not in d or not isinstance(d["nodes"], list):
        return out
    nodes = d["nodes"]
    out["node_total"] = len(nodes)
    head_n, tail_n = 25, 5
    slim: list[dict[str, Any]] = []
    for n in nodes[:head_n]:
        if isinstance(n, dict):
            slim.append(_slim_graph_node(n))
        else:
            slim.append({"_raw": str(n)[:200]})
    if len(nodes) > head_n + tail_n:
        slim.append({"_note": f"…共 {len(nodes)} 个节点，已省略中间…"})
        for n in nodes[-tail_n:]:
            if isinstance(n, dict):
                slim.append(_slim_graph_node(n))
            else:
                slim.append({"_raw": str(n)[:200]})
    elif len(nodes) > head_n:
        for n in nodes[head_n:]:
            if isinstance(n, dict):
                slim.append(_slim_graph_node(n))
            else:
                slim.append({"_raw": str(n)[:200]})
    out["nodes"] = slim
    # 若仍过大，只保留更短样本
    while _json_size(out, stop_after=max_chars) > max_chars and head_n > 8:
        head_n = max(8, head_n // 2)
        tail_n = min(tail_n, 3)
        slim = []
        for n in nodes[:head_n]:
            if isinstance(n, dict):
                slim.append(_slim_graph_node(n))
            else:
                slim.append({"_raw": str(n)[:200]})
        if len(nodes) > head_n + tail_n:
            slim.append({"_note": f"…共 {len(nodes)} 个节点，已省略中间…"})
            for n in nodes[-tail_n:]:
                if isinstance(n, dict):
                    slim.append(_slim_graph_node(n))
                else:
                    slim.append({"_raw": str(n)[:200]})
        elif len(nodes) > head_n:
            for n in nodes[head_n:]:
                if isinstance(n, dict):
                    slim.append(_slim_graph_node(n))
                else:
                    slim.append({"_raw": str(n)[:200]})
        out["nodes"] = slim
    return out


def _compact_graph_relations_dict(d: dict[str, Any], *, max_chars: int) -> dict[str, Any]:
    """graph.list_relations 大列表：保留总数与样本。"""
    out: dict[str, Any] = {}
    if "relations" not in d or not isinstance(d["relations"], list):
        return out
    rels = d["relations"]
    out["relation_total"] = len(rels)
    head_n, tail_n = 40, 5
    slim: list[dict[str, Any]] = []
    for r in rels[:head_n]:
        if isinstance(r, dict):
            slim.append(_slim_graph_relation(r))
        else:
            slim.append({"_raw": str(r)[:200]})
    if len(rels) > head_n + tail_n:
        slim.append({"_note": f"…共 {len(rels)} 条关系，已省略中间…"})
        for r in rels[-tail_n:]:
            if isinstance(r, dict):
                slim.append(_slim_graph_relation(r))
            else:
                slim.append({"_raw": str(r)[:200]})
    elif len(rels) > head_n:
        for r in rels[head_n:]:
            if isinstance(r, dict):
                slim.append(_slim_graph_relation(r))
            else:
                slim.append({"_raw": str(r)[:200]})
    out["relations"] = slim
    while _json_size(out, stop_after=max_chars) > max_chars and head_n > 10:
        head_n = max(10, head_n // 2)
        tail_n = min(tail_n, 3)
        slim = []
        for r in rels[:head_n]:
            if isinstance(r, dict):
                slim.append(_slim_graph_relation(r))
            else:
                slim.append({"_raw": str(r)[:200]})
        if len(rels) > head_n + tail_n:
            slim.append({"_note": f"…共 {len(rels)} 条关系，已省略中间…"})
            for r in rels[-tail_n:]:
                if isinstance(r, dict):
                    slim.append(_slim_graph_relation(r))
                else:
                    slim.append({"_raw": str(r)[:200]})
        elif len(rels) > head_n:
            for r in rels[head_n:]:
                if isinstance(r, dict):
                    slim.append(_slim_graph_relation(r))
                else:
                    slim.append({"_raw": str(r)[:200]})
        out["relations"] = slim
    return out


def _compact_dict(d: dict[str, Any], *, max_chars: int) -> tuple[dict[str, Any], bool]:
    out: dict[str, Any] = {}
    # Prefer summary-like keys
    for k in ("summary", "status", "job_id", "error", "error_code", "ok", "datasets", "builtins"):
        if k in d:
            out[k] = d[k]
    # 知识图谱：bank 与 graph 工具常见结构；勿在超限时丢成 {}，否则模型会误判「图谱为空」
    if "nodes" in d or "kind_counts" in d:
        gn = _compact_graph_nodes_dict(d, max_chars=max_chars)
        out.update(gn)
    if "relations" in d and isinstance(d["relations"], list):
        out.update(_compact_graph_relations_dict(d, max_chars=max_chars))
    if "tables" in d and isinstance(d["tables"], list):
        tables = []
        for t in d["tables"][:2]:
            if not isinstance(t, dict):
                continue
            rows = t.get("rows")
            if isinstance(rows, list) and len(rows) > 7:
                t = {
                    **{x: t.get(x) for x in ("id", "title")},
                    "rows": rows[:5] + [{"_note": f"…共 {len(rows)} 行，已省略中间…"}] + rows[-2:],
                }
            tables.append(t)
        out["tables"] = tables
    if "series" in d and isinstance(d["series"], list):
        series = []
        for s in d["series"][:3]:
            if isinstance(s, dict) and isinstance(s.get("points"), list):
                pts = s["points"]
                if len(pts) > 12:
                    s = {**s, "points": pts[:10] + [{"_truncated": len(pts) - 10}]}
            series.append(s)
        out["series"] = series
    if "raw" in d and _json_size(d["raw"], stop_after=max_chars // 2) > max_chars // 2:
        out["raw"] = {"_omitted": "体量过大，已省略；如需请用专用工具重新拉取。"}
    if _json_size(out, stop_after=max_chars) > max_chars:
        return {"_truncated": True, "preview_keys": list(d.keys())[:20]}, True
    return out, True


def _compact_list(items: list[Any], *, max_chars: int) -> tuple[list[Any], bool]:
    if len(items) > 30:
        return items[:15] + [f"…共 {len(items)} 条，已省略…"] + items[-5:], True
    return items[:50], len(items) > 50


def summarize_tool_result(tool_name: str, data: dict[str, Any]) -> str:
    """One-line summary for SSE cards."""
    if tool_name == 'bank.create_items':
        return f"整批创建 → 成功 {data.get('created', 0)} 题，失败 {data.get('failed', 0)} 题"
    if tool_name == "graph.list_nodes":
        nodes = data.get("nodes")
        if isinstance(nodes, list):
            return f"{tool_name} → {len(nodes)} 个节点"
    if tool_name == "graph.search_nodes":
        nodes = data.get("nodes")
        if isinstance(nodes, list):
            return f"{tool_name} → {len(nodes)} 条匹配"
    if tool_name in ("graph.batch_create_nodes", "graph.batch_create_relations"):
        ok_c = data.get("ok_count")
        err_c = data.get("error_count")
        if isinstance(ok_c, int) and isinstance(err_c, int):
            if err_c and ok_c:
                return f"{tool_name} → 成功 {ok_c} 项，未成功 {err_c} 项"
            if err_c and not ok_c:
                return f"{tool_name} → 未成功 {err_c} 项"
            return f"{tool_name} → 成功 {ok_c} 项"
        created = data.get("created")
        if isinstance(created, list):
            return f"{tool_name} → 成功 {len(created)} 项"
    if tool_name == "graph.batch_bind_questions":
        ok_c = data.get("ok_count")
        err_c = data.get("error_count")
        if isinstance(ok_c, int) and isinstance(err_c, int):
            if err_c and ok_c:
                return f"{tool_name} → 成功 {ok_c} 组要点，另有 {err_c} 项未成功"
            if err_c and not ok_c:
                return f"{tool_name} → 未成功 {err_c} 项"
            return f"{tool_name} → 成功 {ok_c} 组要点"
        batches = data.get("batches")
        if isinstance(batches, list):
            return f"{tool_name} → {len(batches)} 组节点"
    if tool_name == "web.search":
        results = data.get("results")
        if isinstance(results, list):
            return f"{tool_name} → {len(results)} 条摘要"
    if tool_name == "agent.run_tool_pipeline":
        steps = data.get("steps")
        if isinstance(steps, list):
            return f"{tool_name} → {len(steps)} 步"
    if tool_name == "graph.list_relations":
        rels = data.get("relations")
        if isinstance(rels, list):
            return f"{tool_name} → {len(rels)} 条关系"
    st = data.get("status")
    if st:
        return f"{tool_name} → {st}"
    if "job_id" in data:
        return f"{tool_name} → job {data.get('job_id')}"
    if data.get("ok") is True:
        return f"{tool_name} → 成功"
    if err := data.get("error") or data.get("error_message"):
        return f"{tool_name} → 失败：{err!s}"[:200]
    return f"{tool_name} → 已完成"
