"""Tests for D13: edu_analysis job lifecycle adapter to unified task projection."""

import json
from pathlib import Path
from unittest.mock import patch
import pytest

from solaire.edu_analysis import core
from solaire.edu_analysis.storage import save_job
from solaire.web.task_tracking import get_task_projection, list_task_projections


@pytest.fixture
def analysis_project(tmp_path: Path) -> Path:
    proj = tmp_path / "edu_proj"
    proj.mkdir(parents=True, exist_ok=True)
    return proj


def test_analysis_builtin_job_projects_to_unified_store(analysis_project: Path):
    # Mock result port to compute stats
    with patch("solaire.edu_analysis.core.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = {
            "student_count": 30,
            "question_count": 10,
            "class_avg_ratio": 0.85,
            "class_avg_fuzzy": 0.82,
            "question_stats": [],
            "student_stats": [],
            "node_stats": [],
        }

        res = core.run_builtin(
            analysis_project,
            builtin_id="builtin:exam_stats_v1",
            exam_id="exam_001",
            batch_id="batch_001",
        )

        assert res["status"] == "succeeded"
        job_id = res["job_id"]

        # Verify unified projection
        proj = get_task_projection(analysis_project, job_id, owner="local")
        assert proj is not None
        assert proj.task_id == job_id
        assert proj.task_type == "analysis"
        assert proj.source_id == job_id
        assert proj.status == "succeeded"
        assert proj.progress == 1.0
        assert proj.is_retryable is False  # Analysis is deterministic read-only calculation
        assert proj.result_summary is not None
        assert proj.result_summary["kind"] == "builtin"
        assert proj.result_summary["exam_id"] == "exam_001"
        assert proj.result_summary["batch_id"] == "batch_001"
        # Crucial check: heavy tables/raw output must NOT be copied into projection!
        assert "tables" not in proj.result_summary
        assert "raw" not in proj.result_summary


def test_analysis_failed_job_projects_error_summary(analysis_project: Path):
    # Invalid builtin_id causes failure
    with pytest.raises(ValueError, match="Unknown builtin_id"):
        core.run_builtin(
            analysis_project,
            builtin_id="builtin:nonexistent",
            exam_id="exam_001",
            batch_id="batch_001",
        )

    # Job record exists on disk
    jobs = core.list_jobs_api(analysis_project)["jobs"]
    assert len(jobs) >= 1
    failed_job = jobs[0]
    assert failed_job["status"] == "failed"

    # Verify unified projection has error details
    proj = get_task_projection(analysis_project, failed_job["job_id"], owner="local")
    assert proj is not None
    assert proj.status == "failed"
    assert proj.is_retryable is False
    assert proj.error_summary is not None
    assert "Unknown builtin_id" in proj.error_summary["error"]


def test_idempotent_request_id_does_not_execute_twice(analysis_project: Path):
    req_id = "req_dedup_001"
    with patch("solaire.edu_analysis.core.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = {
            "student_count": 25,
            "question_count": 5,
            "question_stats": [],
        }

        # First execution
        first = core.run_builtin(
            analysis_project,
            builtin_id="builtin:exam_stats_v1",
            exam_id="exam_001",
            batch_id="batch_001",
            request_id=req_id,
        )
        assert first["status"] == "succeeded"
        call_count = mock_port.return_value.get_score_analysis.call_count
        assert call_count == 1

        # Second execution with same request_id
        second = core.run_builtin(
            analysis_project,
            builtin_id="builtin:exam_stats_v1",
            exam_id="exam_001",
            batch_id="batch_001",
            request_id=req_id,
        )
        assert second["job_id"] == first["job_id"]
        assert second["status"] == "succeeded"
        # Must NOT call compute/get again
        assert mock_port.return_value.get_score_analysis.call_count == call_count


def test_interrupted_stale_job_marked_unrecoverable(analysis_project: Path):
    # Simulate a job left in "running" status on disk after a previous crash/restart
    stale_job = {
        "job_id": "stale_job_123",
        "kind": "script",
        "script_id": "script_x",
        "exam_id": "e1",
        "batch_id": "b1",
        "status": "running",
        "error": None,
    }
    save_job(analysis_project, stale_job)

    # Calling get_job projects it
    res = core.get_job(analysis_project, job_id="stale_job_123")
    assert res["job"]["job_id"] == "stale_job_123"

    proj = get_task_projection(analysis_project, "stale_job_123", owner="local")
    assert proj is not None
    # Marked as failed/interrupted, cannot be auto-recovered
    assert proj.status == "failed"
    assert "需核对/不可恢复" in (proj.stage or "")
    assert proj.is_retryable is False
    assert proj.error_summary is not None
    assert proj.error_summary["error_code"] == "interrupted"


def test_existing_analysis_apis_maintain_original_structure(analysis_project: Path):
    with patch("solaire.edu_analysis.core.get_result_port") as mock_port:
        mock_port.return_value.get_score_analysis.return_value = {
            "student_count": 10,
            "question_count": 2,
            "question_stats": [],
        }

        run_res = core.run_builtin(
            analysis_project,
            builtin_id="builtin:exam_stats_v1",
            exam_id="e1",
            batch_id="b1",
        )
        assert set(run_res.keys()) == {"job_id", "status", "output"}

        get_res = core.get_job(analysis_project, job_id=run_res["job_id"])
        assert set(get_res.keys()) == {"job", "output"}
        assert get_res["job"]["job_id"] == run_res["job_id"]

        list_res = core.list_jobs_api(analysis_project)
        assert "jobs" in list_res
        assert isinstance(list_res["jobs"], list)
        assert any(j["job_id"] == run_res["job_id"] for j in list_res["jobs"])
