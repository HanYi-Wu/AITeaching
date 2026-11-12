"""学情诊断（M2）：知识点维度、学生掌握矩阵、班级热力与复讲/补题建议草案。

数据来自成绩分析缓存（含每生每题得分率）与知识图谱题目绑定。
"""

from __future__ import annotations

from dataclasses import dataclass
from operator import itemgetter
from pathlib import Path
from typing import Any

from solaire.edu_analysis.ports import get_result_port
from solaire.knowledge_forge import list_questions_for_node, load_graph


def _analysis_or_raise(project_root: Path, exam_id: str, batch_id: str) -> dict[str, Any]:
    return get_result_port().get_score_analysis(project_root, exam_id, batch_id)


def _node_labels_from_state(state: Any) -> dict[str, tuple[str, str]]:
    return {n.id: (n.canonical_name, n.node_kind) for n in state.nodes}


def _question_index_map(raw: dict[str, Any]) -> dict[str, int]:
    order = raw.get("question_order") or []
    return {str(qid): i for i, qid in enumerate(order)}


def _node_to_question_indices_from_state(state: Any, qid_to_i: dict[str, int]) -> dict[str, list[int]]:
    node_to_qi: dict[str, list[int]] = {}
    for b in state.bindings:
        qi = qid_to_i.get(b.question_qualified_id)
        if qi is None:
            continue
        node_to_qi.setdefault(b.node_id, []).append(qi)
    for nid in node_to_qi:
        node_to_qi[nid] = sorted(set(node_to_qi[nid]))
    return node_to_qi


@dataclass(frozen=True, slots=True)
class _NodeMasteryProjection:
    indices: tuple[int, ...]
    max_index: int
    getter: itemgetter | None

    @classmethod
    def build(cls, indices: list[int] | tuple[int, ...]) -> _NodeMasteryProjection:
        ordered = tuple(indices)
        getter = itemgetter(*ordered) if len(ordered) > 1 else None
        return cls(ordered, max(ordered, default=-1), getter)

    def average_exact_floats(self, ratios: list[float]) -> float | None:
        if not self.indices:
            return None
        if self.getter is None:
            selected = (ratios[self.indices[0]],)
        else:
            selected = self.getter(ratios)
        return round(sum(selected) / len(self.indices), 4)


@dataclass(frozen=True, slots=True)
class _MasteryProjectionPlan:
    node_ids: tuple[str, ...]
    labels: dict[str, tuple[str, str]]
    projections: tuple[_NodeMasteryProjection, ...]
    max_index: int
    total_indices: int

    @classmethod
    def build(
        cls,
        node_to_qi: dict[str, list[int]],
        node_ids: list[str] | tuple[str, ...],
        labels: dict[str, tuple[str, str]],
    ) -> _MasteryProjectionPlan:
        ordered_nodes = tuple(node_ids)
        projections = tuple(_NodeMasteryProjection.build(node_to_qi[node_id]) for node_id in ordered_nodes)
        return cls(
            ordered_nodes,
            labels,
            projections,
            max((projection.max_index for projection in projections), default=-1),
            sum(len(projection.indices) for projection in projections),
        )

    def project(self, ratios: Any) -> list[float | None]:
        ratio_count = len(ratios)
        # Validate complete float rows once per student when enough questions
        # are bound to repay the full-row scan.
        if (
            type(ratios) is list
            and self.max_index >= 0
            and self.max_index < ratio_count
            and self.total_indices * 4 >= ratio_count * 3
            and all(type(value) is float for value in ratios)
        ):
            return [projection.average_exact_floats(ratios) for projection in self.projections]
        # Keep the sparse and irregular path close to the former loop: it avoids
        # both a full-row scan and one helper call per node/student.
        mastery_values: list[float | None] = []
        for projection in self.projections:
            vals = [
                ratios[index]
                for index in projection.indices
                if index < ratio_count and ratios[index] is not None
            ]
            if vals:
                mastery_values.append(round(sum(float(value) for value in vals) / len(vals), 4))
            else:
                mastery_values.append(None)
        return mastery_values


def _mastery_projection_plan(state: Any, qid_to_i: dict[str, int]) -> _MasteryProjectionPlan:
    node_to_qi = _node_to_question_indices_from_state(state, qid_to_i)
    labels = _node_labels_from_state(state)
    node_ids = sorted(node_to_qi)
    return _MasteryProjectionPlan.build(node_to_qi, node_ids, labels)


def knowledge_diagnosis_v1(project_root: Path, exam_id: str, batch_id: str) -> dict[str, Any]:
    """班级知识点薄弱排序（附节点显示名）。"""
    raw = _analysis_or_raise(project_root, exam_id, batch_id)
    labels = _node_labels_from_state(load_graph(project_root))
    nodes_out: list[dict[str, Any]] = []
    for ns in raw.get("node_stats", []) or []:
        nid = str(ns.get("node_id") or "")
        name, kind = labels.get(nid, (nid, "concept"))
        nodes_out.append(
            {
                **ns,
                "canonical_name": name,
                "node_kind": kind,
            },
        )
    nodes_sorted = sorted(nodes_out, key=lambda x: float(x.get("error_rate", 0) or 0), reverse=True)
    return {
        "exam_id": exam_id,
        "batch_id": batch_id,
        "nodes": nodes_sorted,
        "class_avg_ratio": raw.get("class_avg_ratio"),
        "class_avg_fuzzy": raw.get("class_avg_fuzzy"),
        "unbound_warnings": raw.get("warnings", []),
    }


def student_knowledge_diagnosis_v1(
    project_root: Path,
    exam_id: str,
    batch_id: str,
    *,
    student_id: str | None = None,
) -> dict[str, Any]:
    """每位学生（或指定学号）在各知识点的平均得分率。"""
    raw = _analysis_or_raise(project_root, exam_id, batch_id)
    rows = raw.get("student_mastery_rows") or []
    qid_to_i = _question_index_map(raw)
    state = load_graph(project_root)
    plan = _mastery_projection_plan(state, qid_to_i)
    sorted_nodes = list(plan.node_ids)
    labels = plan.labels

    out_students: list[dict[str, Any]] = []
    for row in rows:
        sid = str(row.get("student_id") or "")
        if student_id is not None and sid != student_id:
            continue
        by_node: dict[str, Any] = {}
        ratios = row.get("ratios") or []
        for nid, m in zip(sorted_nodes, plan.project(ratios)):
            if m is not None:
                nm, k = labels.get(nid, (nid, "concept"))
                by_node[nid] = {"mastery": m, "canonical_name": nm, "node_kind": k}
        out_students.append(
            {
                "name": row.get("name"),
                "student_id": sid,
                "by_node": by_node,
            },
        )
    return {
        "exam_id": exam_id,
        "batch_id": batch_id,
        "students": out_students,
        "node_ids": sorted_nodes,
    }


def class_heatmap_v1(project_root: Path, exam_id: str, batch_id: str) -> dict[str, Any]:
    """学生 × 知识点 得分率矩阵（用于热力图）。"""
    raw = _analysis_or_raise(project_root, exam_id, batch_id)
    rows = raw.get("student_mastery_rows") or []
    qid_to_i = _question_index_map(raw)
    state = load_graph(project_root)
    plan = _mastery_projection_plan(state, qid_to_i)
    labels = plan.labels
    node_ids = list(plan.node_ids)
    matrix: list[list[float | None]] = []
    result_rows: list[dict[str, Any]] = []
    for st in rows:
        sid = str(st.get("student_id") or "")
        result_rows.append({"name": st.get("name"), "student_id": sid})
        ratios: list[Any] = st.get("ratios") or []
        matrix.append(plan.project(ratios))
    columns = []
    for nid in node_ids:
        nm, _ = labels.get(nid, (nid, "concept"))
        columns.append({"node_id": nid, "canonical_name": nm})
    return {
        "exam_id": exam_id,
        "batch_id": batch_id,
        "rows": result_rows,
        "columns": columns,
        "matrix": matrix,
    }


def teaching_suggestions_v1(
    project_root: Path,
    exam_id: str,
    batch_id: str,
    *,
    weak_limit: int = 8,
    practice_per_node: int = 12,
) -> dict[str, Any]:
    """复讲优先级（按知识点错误率高到低）+ 薄弱点关联题库题目草案。"""
    kd = knowledge_diagnosis_v1(project_root, exam_id, batch_id)
    nodes = kd.get("nodes") or []
    weak = nodes[: max(1, weak_limit)]
    retell_priority: list[dict[str, Any]] = []
    for i, n in enumerate(weak):
        retell_priority.append(
            {
                "priority": i + 1,
                "node_id": n.get("node_id"),
                "canonical_name": n.get("canonical_name"),
                "error_rate": n.get("error_rate"),
                "mastery_fuzzy": n.get("mastery_fuzzy"),
                "bound_question_count": n.get("bound_question_count"),
            },
        )
    practice_drafts: list[dict[str, Any]] = []
    for n in weak[:5]:
        nid = str(n.get("node_id") or "")
        if not nid:
            continue
        qids = list_questions_for_node(project_root, nid)[:practice_per_node]
        practice_drafts.append(
            {
                "node_id": nid,
                "canonical_name": n.get("canonical_name"),
                "suggested_question_ids": qids,
                "count": len(qids),
            },
        )
    return {
        "exam_id": exam_id,
        "batch_id": batch_id,
        "retell_priority": retell_priority,
        "practice_drafts": practice_drafts,
    }
