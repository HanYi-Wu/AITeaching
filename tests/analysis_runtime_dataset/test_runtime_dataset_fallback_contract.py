from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from solaire.edu_analysis.executor import build_runtime_dataset


def test_build_runtime_dataset_normal_flow(tmp_path: Path):
    expected_raw = {
        "exam_id": "exam_1",
        "batch_id": "batch_1",
        "student_count": 10,
        "question_count": 2,
        "question_stats": [{"header": "1.1", "error_rate": 0.1}],
        "node_stats": [{"node_id": "math"}, {"node_id": "math/algebra"}],
        "student_stats": [],
        "warnings": [],
        "class_avg_ratio": 0.8,
        "class_avg_fuzzy": 0.79,
    }

    with patch("solaire.edu_analysis.executor.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = expected_raw

        raw, graph = build_runtime_dataset(tmp_path, "exam_1", "batch_1")
        assert raw["exam_id"] == "exam_1"
        assert raw["student_count"] == 10
        assert len(graph["nodes"]) == 2
        assert len(graph["edges"]) == 1
        assert mock_port.return_value.get_score_analysis.called
        assert not mock_port.return_value.compute_statistics.called


def test_build_runtime_dataset_fallback_to_compute_when_question_stats_missing(tmp_path: Path):
    cached_without_qstats = {
        "exam_id": "exam_1",
        "batch_id": "batch_1",
        "question_stats": [],  # empty
    }
    computed_raw = {
        "exam_id": "exam_1",
        "batch_id": "batch_1",
        "student_count": 5,
        "question_count": 1,
        "question_stats": [{"header": "1.1", "error_rate": 0.2}],
        "node_stats": [],
        "student_stats": [],
        "warnings": [],
    }

    with patch("solaire.edu_analysis.executor.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = cached_without_qstats
        mock_port.return_value.compute_statistics.return_value = computed_raw

        raw, graph = build_runtime_dataset(tmp_path, "exam_1", "batch_1")
        assert raw["question_count"] == 1
        assert mock_port.return_value.get_score_analysis.called
        assert mock_port.return_value.compute_statistics.called


def test_build_runtime_dataset_catch_all_fallback_on_exception(tmp_path: Path):
    """Hypothesis 4 & Contract test: Port errors must fall back to zero-structure without raising."""
    with patch("solaire.edu_analysis.executor.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.side_effect = RuntimeError("Storage port disconnected")

        raw, graph = build_runtime_dataset(tmp_path, "missing_exam", "missing_batch")
        assert raw["exam_id"] == "missing_exam"
        assert raw["batch_id"] == "missing_batch"
        assert raw["student_count"] == 0
        assert raw["question_count"] == 0
        assert raw["question_stats"] == []
        assert raw["node_stats"] == []
        assert raw["student_stats"] == []
        assert raw["class_avg_ratio"] == 0.0
        assert raw["class_avg_fuzzy"] == 0.0
        assert graph == {"nodes": [], "edges": []}
