"""Tests for D11: durable, owner-isolated task projection store and contract."""

import math
from pathlib import Path
import pytest

from solaire.web.task_tracking import (
    TaskEvent,
    TaskProjectionRecord,
    TaskProjectionStore,
    create_or_update_projection,
    get_project_scope_id,
    get_task_projection,
    list_task_projections,
    normalize_owner,
    normalize_progress,
)


@pytest.fixture
def project_a(tmp_path: Path) -> Path:
    proj = tmp_path / "project_a"
    proj.mkdir(parents=True, exist_ok=True)
    return proj


@pytest.fixture
def project_b(tmp_path: Path) -> Path:
    proj = tmp_path / "project_b"
    proj.mkdir(parents=True, exist_ok=True)
    return proj


def test_projection_persistence_and_restart(project_a: Path):
    scope = get_project_scope_id(project_a)
    event = TaskEvent(
        task_id="task_persisted_1",
        task_type="export",
        owner="teacher:101",
        project_scope=scope,
        source_id="exp_001",
        attempt=1,
        status="running",
        event_version=1,
        progress=0.45,
        stage="rendering_pdf",
        title="期末试卷导出",
        result_summary={"format": "pdf"},
        error_summary=None,
        is_retryable=True,
    )
    rec1 = create_or_update_projection(project_a, event)
    assert rec1.task_id == "task_persisted_1"
    assert rec1.progress == 0.45
    assert rec1.status == "running"

    # Simulate restart by creating fresh store instance
    reloaded = get_task_projection(project_a, "task_persisted_1", owner="teacher:101")
    assert reloaded is not None
    assert reloaded.task_id == "task_persisted_1"
    assert reloaded.owner == "teacher:101"
    assert reloaded.status == "running"
    assert reloaded.progress == 0.45
    assert reloaded.stage == "rendering_pdf"
    assert reloaded.is_retryable is True
    assert reloaded.result_summary == {"format": "pdf"}


def test_two_owners_and_two_projects_isolation(project_a: Path, project_b: Path):
    scope_a = get_project_scope_id(project_a)
    scope_b = get_project_scope_id(project_b)

    # Owner 1 in Project A
    create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_a_1",
            task_type="export",
            owner="teacher:1",
            project_scope=scope_a,
            source_id="src_a_1",
            status="running",
            event_version=1,
        ),
    )

    # Owner 2 in Project A
    create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_a_2",
            task_type="export",
            owner="teacher:2",
            project_scope=scope_a,
            source_id="src_a_2",
            status="running",
            event_version=1,
        ),
    )

    # Project B task
    create_or_update_projection(
        project_b,
        TaskEvent(
            task_id="task_b_1",
            task_type="export",
            owner="teacher:1",
            project_scope=scope_b,
            source_id="src_b_1",
            status="running",
            event_version=1,
        ),
    )

    # Owner isolation within same project
    assert get_task_projection(project_a, "task_a_1", owner="teacher:1") is not None
    assert get_task_projection(project_a, "task_a_1", owner="teacher:2") is None
    assert get_task_projection(project_a, "task_a_2", owner="teacher:1") is None
    assert get_task_projection(project_a, "task_a_2", owner="teacher:2") is not None

    list_t1 = list_task_projections(project_a, owner="teacher:1")
    assert len(list_t1) == 1
    assert list_t1[0].task_id == "task_a_1"

    # Project isolation
    assert get_task_projection(project_a, "task_b_1", owner="teacher:1") is None
    assert get_task_projection(project_b, "task_a_1", owner="teacher:1") is None

    # Mismatched owner cannot hijack task
    with pytest.raises(PermissionError):
        create_or_update_projection(
            project_a,
            TaskEvent(
                task_id="task_a_1",
                task_type="export",
                owner="teacher:attacker",
                project_scope=scope_a,
                status="failed",
                event_version=2,
            ),
        )


def test_event_version_prevents_state_regression(project_a: Path):
    scope = get_project_scope_id(project_a)

    # V1: Queued
    rec1 = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_seq_1",
            task_type="analysis",
            owner="teacher:1",
            project_scope=scope,
            source_id="job_1",
            attempt=1,
            status="queued",
            event_version=1,
            progress=0.0,
        ),
    )
    assert rec1.status == "queued"
    assert rec1.event_version == 1

    # V2: Running at 50%
    rec2 = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_seq_1",
            task_type="analysis",
            owner="teacher:1",
            project_scope=scope,
            source_id="job_1",
            attempt=1,
            status="running",
            event_version=2,
            progress=0.5,
        ),
    )
    assert rec2.status == "running"
    assert rec2.progress == 0.5
    assert rec2.event_version == 2

    # Out of order replay: V1 arrives again -> must be ignored!
    rec_replayed = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_seq_1",
            task_type="analysis",
            owner="teacher:1",
            project_scope=scope,
            source_id="job_1",
            attempt=1,
            status="queued",
            event_version=1,
            progress=0.1,
        ),
    )
    assert rec_replayed.status == "running"
    assert rec_replayed.progress == 0.5
    assert rec_replayed.event_version == 2

    # V3: Succeeded
    rec3 = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_seq_1",
            task_type="analysis",
            owner="teacher:1",
            project_scope=scope,
            source_id="job_1",
            attempt=1,
            status="succeeded",
            event_version=3,
            progress=1.0,
        ),
    )
    assert rec3.status == "succeeded"

    # Terminal state cannot regress to running in the same attempt even with higher version
    rec_stray = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_seq_1",
            task_type="analysis",
            owner="teacher:1",
            project_scope=scope,
            source_id="job_1",
            attempt=1,
            status="running",
            event_version=4,
            progress=0.8,
        ),
    )
    assert rec_stray.status == "succeeded"


def test_new_attempt_allows_state_reset(project_a: Path):
    scope = get_project_scope_id(project_a)

    # Attempt 1 failed
    create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_retry_1",
            task_type="export",
            owner="teacher:1",
            project_scope=scope,
            source_id="exp_r1",
            attempt=1,
            status="failed",
            event_version=2,
            error_summary={"status": 500, "detail": "disk full"},
            is_retryable=True,
        ),
    )

    # Attempt 2 queued (retry)
    rec_retried = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_retry_1",
            task_type="export",
            owner="teacher:1",
            project_scope=scope,
            source_id="exp_r1",
            attempt=2,
            status="queued",
            event_version=1,
            progress=0.0,
            is_retryable=True,
        ),
    )
    assert rec_retried.attempt == 2
    assert rec_retried.status == "queued"
    assert rec_retried.event_version == 1

    # Stale attempt 1 event arrives later -> ignored
    rec_late = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_retry_1",
            task_type="export",
            owner="teacher:1",
            project_scope=scope,
            source_id="exp_r1",
            attempt=1,
            status="failed",
            event_version=3,
        ),
    )
    assert rec_late.attempt == 2
    assert rec_late.status == "queued"


def test_progress_validation_and_normalization():
    assert normalize_progress(None) is None
    assert normalize_progress(0.0) == 0.0
    assert normalize_progress(1.0) == 1.0
    assert normalize_progress(0.45678) == 0.4568
    # Clamp negative
    assert normalize_progress(-0.5) == 0.0
    # Normalize 0..100 percentage
    assert normalize_progress(75) == 0.75
    # Clamp > 100
    assert normalize_progress(120) == 1.0

    # Non-finite and invalid types must raise ValueError
    with pytest.raises(ValueError, match="finite"):
        normalize_progress(float("nan"))
    with pytest.raises(ValueError, match="finite"):
        normalize_progress(float("inf"))
    with pytest.raises(ValueError, match="finite"):
        normalize_progress(float("-inf"))
    with pytest.raises(ValueError, match="boolean"):
        normalize_progress(True)
    with pytest.raises(ValueError, match="numeric"):
        normalize_progress("50%")


def test_no_source_id_marked_not_retryable(project_a: Path):
    scope = get_project_scope_id(project_a)

    rec = create_or_update_projection(
        project_a,
        TaskEvent(
            task_id="task_no_src",
            task_type="export",
            owner="teacher:1",
            project_scope=scope,
            source_id=None,
            status="failed",
            is_retryable=True,  # Claimed retryable but no source_id
        ),
    )
    # Must NOT claim retryable without source_id
    assert rec.is_retryable is False


def test_terminal_pruning_and_active_capacity(project_a: Path):
    scope = get_project_scope_id(project_a)

    # Create 105 terminal records
    for i in range(105):
        create_or_update_projection(
            project_a,
            TaskEvent(
                task_id=f"term_task_{i:03d}",
                task_type="export",
                owner="teacher:1",
                project_scope=scope,
                source_id=f"src_{i:03d}",
                status="succeeded",
                event_version=1,
            ),
        )

    projections = list_task_projections(project_a, owner="teacher:1", limit=100)
    # Bounded to 100 records
    assert len(projections) == 100

    # Test active task capacity
    for i in range(20):
        create_or_update_projection(
            project_a,
            TaskEvent(
                task_id=f"active_task_{i:02d}",
                task_type="export",
                owner="teacher:capacity",
                project_scope=scope,
                source_id=f"src_act_{i}",
                status="running",
                event_version=1,
            ),
        )

    # 21st active task should exceed limit
    with pytest.raises(RuntimeError, match="上限"):
        create_or_update_projection(
            project_a,
            TaskEvent(
                task_id="active_task_21",
                task_type="export",
                owner="teacher:capacity",
                project_scope=scope,
                source_id="src_act_21",
                status="queued",
                event_version=1,
            ),
        )


def test_owner_normalization():
    assert normalize_owner(None) == "local"
    assert normalize_owner("") == "local"
    assert normalize_owner("teacher:abc") == "teacher:abc"
    assert normalize_owner({"role": "teacher", "id": "t123"}) == "teacher:t123"
    assert normalize_owner({"role": "admin", "id": "adm1"}) == "admin:adm1"
    assert normalize_owner({"role": "guest"}) == "local"
