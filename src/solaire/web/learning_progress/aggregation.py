"""Pure calculation and aggregation models for learning progress mastery evidence."""

from __future__ import annotations

import math
from typing import Any


def calculate_knowledge_score_rate(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Calculate knowledge point score rate from evidence items.

    Formula:
        score_rate = sum(effective_score) / sum(effective_max_score)
        where effective_score and effective_max_score represent the score * weight
        and max_score * weight under the frozen equal-split rule.

    Exclusion rules:
        - Non-finite score/max_score (NaN, Inf)
        - Zero or negative max_score
        - Missing or blank student_id or knowledge_node_id
        - Items with status in {missing_knowledge_node, incomparable_identity, target_unsubmitted, target_ungraded}
    """
    valid_items: list[dict[str, Any]] = []
    excluded_items: list[dict[str, Any]] = []

    for item in items:
        status = item.get("status")
        if status in {"missing_knowledge_node", "incomparable_identity", "target_unsubmitted", "target_ungraded"}:
            excluded_items.append({"item": item, "reason": item.get("incomparable_reason") or status})
            continue

        student_id = item.get("student_id")
        if not student_id or not str(student_id).strip():
            excluded_items.append({"item": item, "reason": "missing_reliable_student_id"})
            continue

        knowledge_node_id = item.get("knowledge_node_id")
        if not knowledge_node_id or not str(knowledge_node_id).strip():
            excluded_items.append({"item": item, "reason": "missing_reliable_knowledge_node"})
            continue

        score = item.get("effective_score") if "effective_score" in item else item.get("score")
        if score is None:
            excluded_items.append({"item": item, "reason": item.get("incomparable_reason") or "missing_score"})
            continue

        try:
            score_f = float(score)
            if math.isnan(score_f) or math.isinf(score_f):
                excluded_items.append({"item": item, "reason": "non_finite_score"})
                continue
        except (ValueError, TypeError):
            excluded_items.append({"item": item, "reason": "invalid_score_value"})
            continue

        max_score = item.get("effective_max_score") if "effective_max_score" in item else item.get("max_score")
        if max_score is None:
            excluded_items.append({"item": item, "reason": "missing_max_score"})
            continue

        try:
            max_score_f = float(max_score)
            if math.isnan(max_score_f) or math.isinf(max_score_f) or max_score_f <= 0:
                excluded_items.append({"item": item, "reason": "invalid_or_zero_denominator"})
                continue
        except (ValueError, TypeError):
            excluded_items.append({"item": item, "reason": "invalid_max_score_value"})
            continue

        valid_items.append({**item, "_score": score_f, "_max_score": max_score_f})

    if not valid_items:
        return {
            "total_score": 0.0,
            "total_max_score": 0.0,
            "score_rate": None,
            "percentage": None,
            "valid_count": 0,
            "excluded_count": len(excluded_items),
            "excluded_reasons": [ex["reason"] for ex in excluded_items],
        }

    total_score = round(sum(it["_score"] for it in valid_items), 4)
    total_max_score = round(sum(it["_max_score"] for it in valid_items), 4)
    rate = round(total_score / total_max_score, 4) if total_max_score > 0 else None
    percentage = round(rate * 100, 2) if rate is not None else None

    return {
        "total_score": total_score,
        "total_max_score": total_max_score,
        "score_rate": rate,
        "percentage": percentage,
        "valid_count": len(valid_items),
        "excluded_count": len(excluded_items),
        "excluded_reasons": [ex["reason"] for ex in excluded_items],
    }


def calculate_student_comparison(
    baseline_items: list[dict[str, Any]],
    target_items: list[dict[str, Any]],
    *,
    source_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compare baseline mastery with practice target mastery for a single student."""
    is_source_missing = bool(source_status and source_status.get("status") == "source_missing")
    is_source_modified = bool(source_status and source_status.get("is_modified"))

    # Group items by knowledge node
    nodes_set: set[str] = set()
    b_by_node: dict[str, list[dict[str, Any]]] = {}
    t_by_node: dict[str, list[dict[str, Any]]] = {}

    for b in baseline_items:
        nid = b.get("knowledge_node_id")
        if nid:
            nodes_set.add(str(nid))
            b_by_node.setdefault(str(nid), []).append(b)

    for t in target_items:
        nid = t.get("knowledge_node_id")
        if nid:
            nodes_set.add(str(nid))
            t_by_node.setdefault(str(nid), []).append(t)

    node_comparisons: list[dict[str, Any]] = []

    for nid in sorted(nodes_set):
        b_list = b_by_node.get(nid, [])
        t_list = t_by_node.get(nid, [])

        pre_agg = calculate_knowledge_score_rate(b_list)
        post_agg = calculate_knowledge_score_rate(t_list)

        pre_questions = sorted({it.get("source_question_id") for it in b_list if it.get("source_question_id")})
        post_questions = sorted({it.get("question_id") for it in t_list if it.get("question_id")})
        q_diff = len(post_questions) - len(pre_questions)

        # Check statuses in target
        target_statuses = {it.get("status") for it in t_list}
        if is_source_missing:
            comp_status = "source_missing"
            reason = "来源考试已被删除或撤回，历史基线不可比"
        elif not b_list or pre_agg["score_rate"] is None:
            comp_status = "missing_baseline"
            reason = "缺少首考基线数据"
        elif "target_unsubmitted" in target_statuses:
            comp_status = "target_unsubmitted"
            reason = "复练答卷尚未提交"
        elif "target_ungraded" in target_statuses:
            comp_status = "target_ungraded"
            reason = "复练答卷正在批改中"
        elif "target_unreleased" in target_statuses:
            comp_status = "target_unreleased"
            reason = "复练成绩尚未发布"
        elif is_source_modified:
            comp_status = "source_modified"
            reason = "来源首考成绩已被教师复核修改（基线保持冻结原值）"
        elif post_agg["score_rate"] is None:
            comp_status = "missing_target"
            reason = "缺少复练有效答题数据"
        else:
            comp_status = "valid"
            reason = None

        delta_pp: float | None = None
        if comp_status in {"valid", "source_modified"} and pre_agg["score_rate"] is not None and post_agg["score_rate"] is not None:
            delta_pp = round((post_agg["score_rate"] - pre_agg["score_rate"]) * 100, 1)

        node_comparisons.append({
            "knowledge_node_id": nid,
            "status": comp_status,
            "is_modified": is_source_modified,
            "pre_score": pre_agg["total_score"],
            "pre_max_score": pre_agg["total_max_score"],
            "pre_rate": pre_agg["score_rate"],
            "pre_percentage": pre_agg["percentage"],
            "post_score": post_agg["total_score"],
            "post_max_score": post_agg["total_max_score"],
            "post_rate": post_agg["score_rate"],
            "post_percentage": post_agg["percentage"],
            "delta_percentage_points": delta_pp,
            "pre_question_count": len(pre_questions),
            "post_question_count": len(post_questions),
            "question_difference": q_diff,
            "incomparable_reason": reason,
        })

    return {
        "status": "source_missing" if is_source_missing else ("source_modified" if is_source_modified else "valid"),
        "is_source_modified": is_source_modified,
        "is_source_missing": is_source_missing,
        "node_comparisons": node_comparisons,
    }


def calculate_class_comparison(
    baselines_by_student: dict[str, list[dict[str, Any]]],
    targets_by_student: dict[str, list[dict[str, Any]]],
    *,
    source_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Aggregate paired comparisons across students in a class.

    Only students who have both valid baseline and valid target evidence for a node
    are included in that node's paired class average.
    """
    is_source_missing = bool(source_status and source_status.get("status") == "source_missing")
    is_source_modified = bool(source_status and source_status.get("is_modified"))

    all_nodes: set[str] = set()
    for items in baselines_by_student.values():
        for it in items:
            nid = it.get("knowledge_node_id")
            if nid:
                all_nodes.add(str(nid))
    for items in targets_by_student.values():
        for it in items:
            nid = it.get("knowledge_node_id")
            if nid:
                all_nodes.add(str(nid))

    all_student_ids = sorted(set(baselines_by_student.keys()) | set(targets_by_student.keys()))
    node_summaries: list[dict[str, Any]] = []

    for nid in sorted(all_nodes):
        paired_students: list[str] = []
        pre_scores: list[float] = []
        pre_max_scores: list[float] = []
        post_scores: list[float] = []
        post_max_scores: list[float] = []
        pre_all_questions: set[str] = set()
        post_all_questions: set[str] = set()

        unpaired_reasons: dict[str, int] = {}

        for sid in all_student_ids:
            b_items = [it for it in baselines_by_student.get(sid, []) if str(it.get("knowledge_node_id")) == nid]
            t_items = [it for it in targets_by_student.get(sid, []) if str(it.get("knowledge_node_id")) == nid]

            pre_agg = calculate_knowledge_score_rate(b_items)
            post_agg = calculate_knowledge_score_rate(t_items)

            for it in b_items:
                if it.get("source_question_id"):
                    pre_all_questions.add(str(it["source_question_id"]))
            for it in t_items:
                if it.get("question_id"):
                    post_all_questions.add(str(it["question_id"]))

            target_statuses = {it.get("status") for it in t_items}

            if is_source_missing:
                unpaired_reasons["source_missing"] = unpaired_reasons.get("source_missing", 0) + 1
                continue

            if not b_items or pre_agg["score_rate"] is None:
                unpaired_reasons["missing_baseline"] = unpaired_reasons.get("missing_baseline", 0) + 1
                continue

            if not t_items or "target_unsubmitted" in target_statuses:
                unpaired_reasons["target_unsubmitted"] = unpaired_reasons.get("target_unsubmitted", 0) + 1
                continue

            if "target_ungraded" in target_statuses:
                unpaired_reasons["target_ungraded"] = unpaired_reasons.get("target_ungraded", 0) + 1
                continue

            if "target_unreleased" in target_statuses:
                unpaired_reasons["target_unreleased"] = unpaired_reasons.get("target_unreleased", 0) + 1
                continue

            if post_agg["score_rate"] is None:
                unpaired_reasons["missing_target"] = unpaired_reasons.get("missing_target", 0) + 1
                continue

            # Student is fully paired
            paired_students.append(sid)
            pre_scores.append(pre_agg["total_score"])
            pre_max_scores.append(pre_agg["total_max_score"])
            post_scores.append(post_agg["total_score"])
            post_max_scores.append(post_agg["total_max_score"])

        sum_pre_score = round(sum(pre_scores), 4)
        sum_pre_max = round(sum(pre_max_scores), 4)
        sum_post_score = round(sum(post_scores), 4)
        sum_post_max = round(sum(post_max_scores), 4)

        pre_rate = round(sum_pre_score / sum_pre_max, 4) if sum_pre_max > 0 else None
        post_rate = round(sum_post_score / sum_post_max, 4) if sum_post_max > 0 else None

        pre_pct = round(pre_rate * 100, 1) if pre_rate is not None else None
        post_pct = round(post_rate * 100, 1) if post_rate is not None else None

        delta_pp: float | None = None
        if pre_pct is not None and post_pct is not None and not is_source_missing:
            delta_pp = round(post_pct - pre_pct, 1)

        q_diff = len(post_all_questions) - len(pre_all_questions)

        node_summaries.append({
            "knowledge_node_id": nid,
            "status": "source_missing" if is_source_missing else ("source_modified" if is_source_modified else "valid"),
            "is_modified": is_source_modified,
            "matched_student_count": len(paired_students),
            "unpaired_student_count": len(all_student_ids) - len(paired_students),
            "unpaired_reasons": unpaired_reasons,
            "pre_score_rate": pre_rate,
            "pre_percentage": pre_pct,
            "post_score_rate": post_rate,
            "post_percentage": post_pct,
            "delta_percentage_points": delta_pp,
            "pre_question_count": len(pre_all_questions),
            "post_question_count": len(post_all_questions),
            "question_difference": q_diff,
        })

    return {
        "status": "source_missing" if is_source_missing else ("source_modified" if is_source_modified else "valid"),
        "is_source_modified": is_source_modified,
        "is_source_missing": is_source_missing,
        "total_student_count": len(all_student_ids),
        "node_summaries": node_summaries,
    }
