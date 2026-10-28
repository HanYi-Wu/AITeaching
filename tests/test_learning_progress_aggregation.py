"""Unit tests for learning progress mastery aggregation and calculation rules (C15)."""

from __future__ import annotations

import math
from solaire.web.learning_progress.aggregation import (
    calculate_class_comparison,
    calculate_knowledge_score_rate,
    calculate_student_comparison,
)


def test_score_rate_percentage_points_calculation() -> None:
    # 2/4 = 50%, 3/4 = 75% -> +25.0 percentage points (not +50%)
    baseline_items = [
        {
            "student_id": "stu-1",
            "knowledge_node_id": "math/equations",
            "effective_score": 2.0,
            "effective_max_score": 4.0,
            "weight": 0.5,
            "status": "valid",
        }
    ]
    target_items = [
        {
            "student_id": "stu-1",
            "knowledge_node_id": "math/equations",
            "score": 3.0,
            "max_score": 4.0,
            "weight": 1.0,
            "status": "valid",
        }
    ]

    res = calculate_student_comparison(baseline_items, target_items)
    assert res["status"] == "valid"
    assert len(res["node_comparisons"]) == 1
    node = res["node_comparisons"][0]
    assert node["pre_rate"] == 0.5
    assert node["pre_percentage"] == 50.0
    assert node["post_rate"] == 0.75
    assert node["post_percentage"] == 75.0
    assert node["delta_percentage_points"] == 25.0


def test_score_rate_exclusions_preserve_reasons() -> None:
    items = [
        # Valid item
        {"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": 4.0, "effective_max_score": 5.0},
        # NaN score
        {"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": float("nan"), "effective_max_score": 5.0},
        # Inf score
        {"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": float("inf"), "effective_max_score": 5.0},
        # 0 max score
        {"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": 2.0, "effective_max_score": 0.0},
        # Negative max score
        {"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": 2.0, "effective_max_score": -4.0},
        # Missing student_id
        {"student_id": "", "knowledge_node_id": "k1", "effective_score": 3.0, "effective_max_score": 5.0},
        # Missing knowledge_node_id
        {"student_id": "stu-1", "knowledge_node_id": None, "effective_score": 3.0, "effective_max_score": 5.0},
    ]

    agg = calculate_knowledge_score_rate(items)
    assert agg["valid_count"] == 1
    assert agg["excluded_count"] == 6
    assert agg["score_rate"] == 0.8
    assert agg["percentage"] == 80.0
    assert "non_finite_score" in agg["excluded_reasons"]
    assert "invalid_or_zero_denominator" in agg["excluded_reasons"]
    assert "missing_reliable_student_id" in agg["excluded_reasons"]
    assert "missing_reliable_knowledge_node" in agg["excluded_reasons"]


def test_statuses_distinguished_and_not_converted_to_zero() -> None:
    baseline = [
        {"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": 2.0, "effective_max_score": 4.0}
    ]

    # Target unsubmitted
    target_unsubmitted = [
        {"student_id": "stu-1", "knowledge_node_id": "k1", "status": "target_unsubmitted", "score": None, "max_score": 4.0}
    ]
    res_unsub = calculate_student_comparison(baseline, target_unsubmitted)
    node_unsub = res_unsub["node_comparisons"][0]
    assert node_unsub["status"] == "target_unsubmitted"
    assert node_unsub["post_rate"] is None
    assert node_unsub["delta_percentage_points"] is None

    # Target ungraded
    target_ungraded = [
        {"student_id": "stu-1", "knowledge_node_id": "k1", "status": "target_ungraded", "score": None, "max_score": 4.0}
    ]
    res_ungraded = calculate_student_comparison(baseline, target_ungraded)
    node_ungraded = res_ungraded["node_comparisons"][0]
    assert node_ungraded["status"] == "target_ungraded"
    assert node_ungraded["post_rate"] is None

    # Source missing
    res_missing = calculate_student_comparison(
        baseline,
        [{"student_id": "stu-1", "knowledge_node_id": "k1", "status": "valid", "score": 3.0, "max_score": 4.0}],
        source_status={"status": "source_missing", "is_missing": True},
    )
    assert res_missing["status"] == "source_missing"
    assert res_missing["node_comparisons"][0]["status"] == "source_missing"
    assert res_missing["node_comparisons"][0]["delta_percentage_points"] is None


def test_class_aggregation_only_includes_paired_students() -> None:
    # Student 1: 2/4 (50%) -> 3/4 (75%)  [Paired]
    # Student 2: 1/2 (50%) -> unsubmitted [Excluded from paired average]
    # Student 3: no baseline -> 2/2 (100%) [Excluded from paired average]
    baselines = {
        "stu-1": [{"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": 2.0, "effective_max_score": 4.0, "source_question_id": "q1"}],
        "stu-2": [{"student_id": "stu-2", "knowledge_node_id": "k1", "effective_score": 1.0, "effective_max_score": 2.0, "source_question_id": "q1"}],
    }
    targets = {
        "stu-1": [{"student_id": "stu-1", "knowledge_node_id": "k1", "status": "valid", "score": 3.0, "max_score": 4.0, "question_id": "t1"}],
        "stu-2": [{"student_id": "stu-2", "knowledge_node_id": "k1", "status": "target_unsubmitted", "score": None, "max_score": 2.0, "question_id": "t1"}],
        "stu-3": [{"student_id": "stu-3", "knowledge_node_id": "k1", "status": "valid", "score": 2.0, "max_score": 2.0, "question_id": "t1"}],
    }

    cls_res = calculate_class_comparison(baselines, targets)
    assert cls_res["total_student_count"] == 3
    assert len(cls_res["node_summaries"]) == 1
    summary = cls_res["node_summaries"][0]
    assert summary["matched_student_count"] == 1
    assert summary["unpaired_student_count"] == 2
    assert summary["unpaired_reasons"]["target_unsubmitted"] == 1
    assert summary["unpaired_reasons"]["missing_baseline"] == 1
    # Only stu-1 is in the paired sample: 50% -> 75%, +25.0 pp
    assert summary["pre_percentage"] == 50.0
    assert summary["post_percentage"] == 75.0
    assert summary["delta_percentage_points"] == 25.0


def test_class_aggregation_preserves_status_priority_and_modified_source() -> None:
    baselines = {
        "stu-d": [{"student_id": "stu-d", "knowledge_node_id": "k1", "effective_score": 0.1, "effective_max_score": 3.0, "source_question_id": "b-d"}],
        "stu-c": [{"student_id": "stu-c", "knowledge_node_id": "k1", "effective_score": 0.2, "effective_max_score": 3.0, "source_question_id": "b-c"}],
        "stu-b": [{"student_id": "stu-b", "knowledge_node_id": "k1", "effective_score": 0.3, "effective_max_score": 3.0, "source_question_id": "b-b"}],
        "stu-a": [{"student_id": "stu-a", "knowledge_node_id": "k1", "effective_score": 0.4, "effective_max_score": 3.0, "source_question_id": "b-a"}],
    }
    targets = {
        "stu-d": [{"student_id": "stu-d", "knowledge_node_id": "k1", "effective_score": 1.0, "effective_max_score": 3.0, "question_id": "t-d", "status": "graded"}],
        "stu-c": [
            {"student_id": "stu-c", "knowledge_node_id": "k1", "effective_score": None, "effective_max_score": 3.0, "question_id": "t-c1", "status": "target_ungraded"},
            {"student_id": "stu-c", "knowledge_node_id": "k1", "effective_score": None, "effective_max_score": 3.0, "question_id": "t-c2", "status": "target_unreleased"},
        ],
        "stu-b": [
            {"student_id": "stu-b", "knowledge_node_id": "k1", "effective_score": None, "effective_max_score": 3.0, "question_id": "t-b1", "status": "target_unsubmitted"},
            {"student_id": "stu-b", "knowledge_node_id": "k1", "effective_score": None, "effective_max_score": 3.0, "question_id": "t-b2", "status": "target_ungraded"},
        ],
        "stu-a": [{"student_id": "stu-a", "knowledge_node_id": "k1", "effective_score": 1.0, "effective_max_score": 3.0, "question_id": "t-a", "status": "graded"}],
    }

    result = calculate_class_comparison(
        baselines,
        targets,
        source_status={"status": "source_modified", "is_modified": True},
    )
    summary = result["node_summaries"][0]
    assert result["status"] == "source_modified"
    assert summary["status"] == "source_modified"
    assert summary["is_modified"] is True
    assert summary["matched_student_count"] == 2
    assert summary["unpaired_reasons"] == {
        "target_unsubmitted": 1,
        "target_ungraded": 1,
    }
    # Sorting student IDs before summing keeps the historical round-to-4 policy.
    assert summary["pre_score_rate"] == 0.0833
    assert summary["pre_percentage"] == 8.3
    assert summary["post_score_rate"] == 0.3333
    assert summary["post_percentage"] == 33.3
    assert summary["delta_percentage_points"] == 25.0

    missing_source = calculate_class_comparison(
        {"stu-1": [{"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": 2.0, "effective_max_score": 4.0}]},
        {"stu-1": [{"student_id": "stu-1", "knowledge_node_id": "k1", "effective_score": 3.0, "effective_max_score": 4.0, "status": "graded"}]},
        source_status={"status": "source_missing", "is_missing": True},
    )
    missing_summary = missing_source["node_summaries"][0]
    assert missing_source["status"] == "source_missing"
    assert missing_summary["status"] == "source_missing"
    assert missing_summary["matched_student_count"] == 0
    assert missing_summary["unpaired_reasons"] == {"source_missing": 1}
    assert missing_summary["delta_percentage_points"] is None


def test_class_aggregation_preserves_stringified_node_id_matching() -> None:
    baselines = {
        "stu-1": [
            {"student_id": "stu-1", "knowledge_node_id": "0", "effective_score": 1.0, "effective_max_score": 2.0, "source_question_id": "q-string-zero"},
            {"student_id": "stu-1", "knowledge_node_id": 0, "effective_score": 1.0, "effective_max_score": 2.0, "source_question_id": "q-int-zero"},
            {"student_id": "stu-1", "knowledge_node_id": "None", "effective_score": 1.0, "effective_max_score": 2.0, "source_question_id": "q-string-none"},
            {"student_id": "stu-1", "knowledge_node_id": None, "effective_score": 1.0, "effective_max_score": 2.0, "source_question_id": "q-missing"},
        ]
    }
    targets = {
        "stu-1": [
            {"student_id": "stu-1", "knowledge_node_id": "0", "effective_score": 1.5, "effective_max_score": 2.0, "question_id": "t-string-zero", "status": "graded"},
            {"student_id": "stu-1", "knowledge_node_id": 0, "effective_score": 1.5, "effective_max_score": 2.0, "question_id": "t-int-zero", "status": "graded"},
            {"student_id": "stu-1", "knowledge_node_id": "None", "effective_score": 1.5, "effective_max_score": 2.0, "question_id": "t-string-none", "status": "graded"},
            {"student_id": "stu-1", "knowledge_node_id": None, "effective_score": 1.5, "effective_max_score": 2.0, "question_id": "t-missing", "status": "graded"},
        ]
    }

    result = calculate_class_comparison(baselines, targets)
    assert [item["knowledge_node_id"] for item in result["node_summaries"]] == ["0", "None"]
    by_node = {item["knowledge_node_id"]: item for item in result["node_summaries"]}
    assert by_node["0"]["pre_question_count"] == 2
    assert by_node["0"]["post_question_count"] == 2
    assert by_node["0"]["pre_score_rate"] == 0.5
    assert by_node["0"]["post_score_rate"] == 0.75
    # As in the old str(value) filter, None rows match a literal "None" node.
    assert by_node["None"]["pre_question_count"] == 2
    assert by_node["None"]["post_question_count"] == 2
    assert by_node["None"]["pre_score_rate"] == 0.5
    assert by_node["None"]["post_score_rate"] == 0.75


def test_class_aggregation_preserves_builtin_float_sum_cancellation() -> None:
    scores_by_student = {"stu-a": 1e16, "stu-b": 1.0, "stu-c": -1e16}
    baselines = {
        sid: [{"student_id": sid, "knowledge_node_id": "k1", "effective_score": score, "effective_max_score": 1.0}]
        for sid, score in scores_by_student.items()
    }
    targets = {
        sid: [{"student_id": sid, "knowledge_node_id": "k1", "effective_score": score, "effective_max_score": 1.0, "status": "graded"}]
        for sid, score in scores_by_student.items()
    }

    summary = calculate_class_comparison(baselines, targets)["node_summaries"][0]
    expected_rate = round(round(sum(scores_by_student.values()), 4) / 3.0, 4)
    assert summary["pre_score_rate"] == expected_rate
    assert summary["post_score_rate"] == expected_rate
