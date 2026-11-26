import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.release_verify import update_worker


@pytest.mark.parametrize("healthy", [True, False])
def test_worker_honors_schedule_and_reports_isolated_preflight(monkeypatch, tmp_path, healthy):
    pending = tmp_path / "pending"
    pending.mkdir()
    package_id = "1" * 32
    receipt = {"package_id": package_id, "base": "1.7.4", "version": "1.7.5"}
    (pending / "receipt.json").write_text(json.dumps(receipt))
    now = datetime.now(timezone.utc)
    due = now + timedelta(hours=1)
    (pending / f"schedule-{package_id}.json").write_text(json.dumps({"run_at": due.isoformat()}))
    status_file = pending / f"worker-{package_id}.json"
    calls = []

    @contextmanager
    def check(archive, key, installed, active, staging, python):
        calls.append(archive)
        assert archive == pending / "update.zip"
        assert installed == "1.7.4"
        assert json.loads(status_file.read_text())["state"] == "preflighting"
        if not healthy:
            raise ValueError("smoke failed")
        yield staging / "candidate", receipt, ("web/dist/index.html",)

    monkeypatch.setattr(update_worker, "checked_candidate", check)
    args = (tmp_path, Path("key"), "1.7.4", Path("active"), tmp_path, Path("python"))
    assert update_worker.run_due_preflight(*args, now=now) == "waiting"
    assert not calls
    if healthy:
        assert update_worker.run_due_preflight(*args, now=due) == "preflight_passed"
        status = json.loads(status_file.read_text())
        assert status["changed_count"] == 1
        assert status["backend_changed"] is False
    else:
        with pytest.raises(ValueError, match="smoke failed"):
            update_worker.run_due_preflight(*args, now=due)
        assert json.loads(status_file.read_text())["state"] == "preflight_failed"
    assert update_worker.run_due_preflight(*args, now=due) == "already_checked"
    assert len(calls) == 1


def test_worker_can_activate_backend_only_after_snapshot_rehearsal(monkeypatch, tmp_path):
    pending = tmp_path / "pending"
    pending.mkdir()
    ids = "d" * 32
    receipt = {"package_id": ids, "base": "1.7.4", "version": "1.7.5"}
    (pending / "receipt.json").write_text(json.dumps(receipt))
    now = datetime.now(timezone.utc)
    (pending / f"schedule-{ids}.json").write_text(json.dumps({"run_at": now.isoformat()}))

    @contextmanager
    def check(*args, **kwargs):
        yield tmp_path / "candidate", receipt, ("src/solaire/example.py",)

    monkeypatch.setattr(update_worker, "checked_candidate", check)
    calls = []
    config = SimpleNamespace(store=tmp_path, publish=lambda *args, **kw: calls.append((args, kw)) or 0.5)
    args = (tmp_path, Path("key"), "1.7.4", Path("active"), tmp_path, Path("python"))
    status_path = pending / f"worker-{ids}.json"
    assert update_worker.run_due_preflight(*args, now=now, backend_slots=config) == "preflight_passed"
    assert not calls
    monkeypatch.setattr(update_worker, "rehearse_platform_migration", lambda *a: {"schema_unchanged": True})
    assert update_worker.run_due_preflight(*args, now=now, backend_slots=config, platform_db=tmp_path / "db") == "backend_applied"
    assert calls[0][0][1:] == (ids, "1.7.5") and calls[0][1]["schema_unchanged"] is True
    assert json.loads(status_path.read_text())["switch_seconds"] == 0.5


def test_failed_github_download_does_not_retry_on_worker_timer(monkeypatch, tmp_path):
    pending = tmp_path / "pending"
    pending.mkdir()
    ids = "e" * 32
    receipt = {"package_id": ids, "base": "1.7.4", "version": "1.7.5", "source": "github", "asset": {"tag": "v1.7.5"}}
    (pending / "receipt.json").write_text(json.dumps(receipt))
    now = datetime.now(timezone.utc)
    (pending / f"schedule-{ids}.json").write_text(json.dumps({"run_at": now.isoformat()}))
    attempts = []

    def download(*args):
        attempts.append(args)
        raise TimeoutError("download timed out")

    monkeypatch.setattr(update_worker, "download_github_update", download)
    args = (tmp_path, Path("key"), "1.7.4", Path("active"), tmp_path, Path("python"))
    with pytest.raises(TimeoutError):
        update_worker.run_due_preflight(*args, now=now)
    assert update_worker.run_due_preflight(*args, now=now) == "already_checked"
    assert json.loads((pending / f"worker-{ids}.json").read_text())["state"] == "download_failed"
    assert len(attempts) == 1
