from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from solaire.edu_analysis import diagnosis


def _graph() -> SimpleNamespace:
    return SimpleNamespace(
        nodes=[
            SimpleNamespace(id="n1", canonical_name="数与运算", node_kind="concept"),
            SimpleNamespace(id="n2", canonical_name="数量关系", node_kind="concept"),
        ],
        bindings=[
            SimpleNamespace(question_qualified_id="q1", node_id="n2"),
            SimpleNamespace(question_qualified_id="q2", node_id="n2"),
            SimpleNamespace(question_qualified_id="q1", node_id="n2"),
            SimpleNamespace(question_qualified_id="q3", node_id="n1"),
            SimpleNamespace(question_qualified_id="q4", node_id="n1"),
        ],
    )


def _raw() -> dict[str, Any]:
    return {
        "question_order": ["q1", "q2", "q3", "q4"],
        "student_mastery_rows": [
            {"name": "甲", "student_id": "s1", "ratios": [0.1, 0.2, 0.4, 0.8]},
            {"name": "乙", "student_id": "s2", "ratios": [None, 0.3, 0.5]},
            {"name": "丙", "student_id": "s3", "ratios": ["0.2", "0.6", 0.8, 0.4]},
        ],
    }


@pytest.fixture
def analysis_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(diagnosis, "_analysis_or_raise", lambda *_: _raw())
    monkeypatch.setattr(diagnosis, "load_graph", lambda *_: _graph())


def test_heatmap_and_student_diagnosis_keep_order_and_values(
    analysis_sources: None, tmp_path: Path
) -> None:
    heatmap = diagnosis.class_heatmap_v1(tmp_path, "exam", "batch")
    assert heatmap == {
        "exam_id": "exam",
        "batch_id": "batch",
        "rows": [
            {"name": "甲", "student_id": "s1"},
            {"name": "乙", "student_id": "s2"},
            {"name": "丙", "student_id": "s3"},
        ],
        "columns": [
            {"node_id": "n1", "canonical_name": "数与运算"},
            {"node_id": "n2", "canonical_name": "数量关系"},
        ],
        "matrix": [
            [0.6, 0.15],
            [0.5, 0.3],
            [0.6, 0.4],
        ],
    }

    students = diagnosis.student_knowledge_diagnosis_v1(
        tmp_path, "exam", "batch", student_id="s2"
    )
    assert students["node_ids"] == ["n1", "n2"]
    assert students["students"] == [
        {
            "name": "乙",
            "student_id": "s2",
            "by_node": {
                "n1": {"mastery": 0.5, "canonical_name": "数与运算", "node_kind": "concept"},
                "n2": {"mastery": 0.3, "canonical_name": "数量关系", "node_kind": "concept"},
            },
        }
    ]


@pytest.mark.parametrize(
    ("ratios", "indices", "expected"),
    [
        ([1.0e16, 1.0, -1.0e16], [0, 1, 2], round(sum(float(x) for x in [1.0e16, 1.0, -1.0e16]) / 3, 4)),
        ([0.4], [2, 0], 0.4),
        ([None, "0.25", "0.75"], [1, 2], 0.5),
        ([0.2, 0.4], [1, 0, 1], round((0.4 + 0.2 + 0.4) / 3, 4)),
        ([None, None], [0, 1], None),
        ([True, 0.5], [0, 1], 0.75),
    ],
)
def test_mastery_projection_fallbacks_preserve_legacy_sum_semantics(
    ratios: list[Any], indices: list[int], expected: float | None
) -> None:
    plan = diagnosis._MasteryProjectionPlan.build({"node": indices}, ["node"], {})
    assert plan.project(ratios) == [expected]


def test_sparse_projection_skips_the_full_row_scan(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_on_scan(_values: Any) -> None:
        pytest.fail("Sparse projection should inspect only the bound questions")

    monkeypatch.setattr(diagnosis, "all", fail_on_scan, raising=False)
    plan = diagnosis._MasteryProjectionPlan.build({"node": [0, 99]}, ["node"], {})
    assert plan.project([0.25] * 99 + [0.75]) == [0.5]


def test_mastery_projection_keeps_float_conversion_errors(
    tmp_path: Path, analysis_sources: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw = _raw()
    raw["student_mastery_rows"] = [
        {"name": "坏值", "student_id": "broken", "ratios": [0.1, 0.2, object(), 0.4]}
    ]
    monkeypatch.setattr(diagnosis, "_analysis_or_raise", lambda *_: raw)
    with pytest.raises(TypeError):
        diagnosis.class_heatmap_v1(tmp_path, "exam", "batch")
