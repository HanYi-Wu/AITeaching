from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from solaire.edu_analysis import core, storage


@pytest.fixture
def test_project(tmp_path: Path) -> Path:
    proj = tmp_path / "analysis_differential_proj"
    proj.mkdir(parents=True, exist_ok=True)
    return proj


def test_builtin_protocol_output_structure_and_contracts(test_project: Path):
    mock_raw = {
        "student_count": 25,
        "question_count": 5,
        "class_avg_ratio": 0.82,
        "class_avg_fuzzy": 0.80,
        "question_stats": [
            {"header": "1.1", "error_rate": 0.25},
            {"header": "1.2", "error_rate": 0.15},
            {"header": "1.3", "error_rate": 0.40},
        ],
        "student_stats": [
            {"student_id": "s1", "name": "Alice", "score": 90.0},
        ],
        "node_stats": [
            {"node_id": "math"},
            {"node_id": "math/calculus"},
        ],
        "warnings": [{"type": "warn", "message": "sample warning"}],
    }

    with patch("solaire.edu_analysis.core.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = mock_raw

        res = core.run_builtin(
            test_project,
            builtin_id="builtin:exam_stats_v1",
            exam_id="math/final",
            batch_id="batch_01",
            request_id="req_builtin_001",
        )

        assert res["status"] == "succeeded"
        assert "job_id" in res
        output = res["output"]
        assert output["summary"]["title"] == "内置考试统计分析"
        assert output["summary"]["student_count"] == 25
        assert output["summary"]["question_count"] == 5
        assert len(output["tables"]) == 3
        assert len(output["chart_specs"]) == 1
        assert len(output["series"]) == 1
        assert len(output["pictures"]) == 1
        assert output["pictures"][0]["type"] == "svg"
        assert "<rect" in output["pictures"][0]["content"]
        assert output["warnings"] == ["sample warning"]
        assert output["context"] == {"exam_id": "math/final", "batch_id": "batch_01", "source": "builtin:exam_stats_v1"}
        assert output["raw"] == mock_raw

        # Verify idempotency
        idempotent_res = core.run_builtin(
            test_project,
            builtin_id="builtin:exam_stats_v1",
            exam_id="math/final",
            batch_id="batch_01",
            request_id="req_builtin_001",
        )
        assert idempotent_res["job_id"] == res["job_id"]
        assert idempotent_res["status"] == "succeeded"
        assert idempotent_res["output"]["summary"] == output["summary"]


def test_script_execution_chart_and_dict_modes(test_project: Path):
    mock_raw = {
        "student_count": 15,
        "question_count": 2,
        "question_stats": [{"header": "1.1", "error_rate": 0.2}],
        "node_stats": [{"node_id": "math"}],
        "student_stats": [],
        "warnings": [],
        "class_avg_ratio": 0.75,
        "class_avg_fuzzy": 0.74,
    }

    with patch("solaire.edu_analysis.executor.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = mock_raw

        # 1. Chart mode
        code_chart = (
            "raw = get_rawdata()\n"
            "RESULT = HistogramChart(title='错题分布', data=[{'label': '1.1', 'value': 0.2}])\n"
        )
        doc1 = core.save_script_doc(test_project, name="chart_script", code=code_chart)
        s1 = doc1["script"]["script_id"]

        res1 = core.run_script_with_request_id(
            test_project, script_id=s1, exam_id="e1", batch_id="b1", request_id="req_chart_1"
        )
        assert res1["status"] == "succeeded"
        assert "pictures" in res1["output"]
        assert res1["output"]["pictures"][0]["type"] == "svg"

        # 2. Dict mode
        code_dict = (
            "raw = get_rawdata()\n"
            "kg = get_graph()\n"
            "RESULT = {'summary': {'custom_metric': 99}, 'nodes_count': len(kg['nodes'])}\n"
        )
        doc2 = core.save_script_doc(test_project, name="dict_script", code=code_dict)
        s2 = doc2["script"]["script_id"]

        res2 = core.run_script_with_request_id(
            test_project, script_id=s2, exam_id="e1", batch_id="b1", request_id="req_dict_1"
        )
        assert res2["status"] == "succeeded"
        assert res2["output"]["summary"]["custom_metric"] == 99
        assert res2["output"]["nodes_count"] == 1


def test_script_error_and_violation_semantics(test_project: Path):
    mock_raw = {
        "student_count": 1,
        "question_count": 1,
        "question_stats": [{"header": "1.1", "error_rate": 0.5}],
        "node_stats": [],
        "student_stats": [],
        "warnings": [],
        "class_avg_ratio": 0.5,
        "class_avg_fuzzy": 0.5,
    }

    with patch("solaire.edu_analysis.executor.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = mock_raw

        # 1. Sandbox violation: blocked import os
        doc_viol = core.save_script_doc(test_project, name="viol", code="import os\n")
        res_viol = core.run_script(test_project, script_id=doc_viol["script"]["script_id"], exam_id="e1", batch_id="b1")
        assert res_viol["status"] == "failed"
        assert res_viol["error_code"] == "sandbox_violation"
        assert "is blocked" in res_viol["error"]

        # 2. Runtime error: ZeroDivisionError
        doc_err = core.save_script_doc(test_project, name="err", code="x = 1 / 0\n")
        res_err = core.run_script(test_project, script_id=doc_err["script"]["script_id"], exam_id="e1", batch_id="b1")
        assert res_err["status"] == "failed"
        assert res_err["error_code"] == "runtime_error"
        assert "division by zero" in res_err["error"]

        # 3. Output limit exceeded: printing > 20000 bytes
        doc_limit = core.save_script_doc(test_project, name="limit", code="print('Z' * 30000)\nRESULT = 1\n")
        res_limit = core.run_script(test_project, script_id=doc_limit["script"]["script_id"], exam_id="e1", batch_id="b1")
        assert res_limit["status"] == "failed"
        assert res_limit["error_code"] == "resource_exceeded"
        assert res_limit["output"]["truncated"] is True
        assert res_limit["output"]["killed_reason"] == "output_limit"
