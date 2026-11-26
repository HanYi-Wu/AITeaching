from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from solaire.web.management import update_inbox


def test_online_update_queues_only_discovered_version_and_can_clear_failure(monkeypatch, tmp_path):
    app = FastAPI()
    app.include_router(update_inbox.router, prefix="/api")
    app.dependency_overrides[update_inbox.current_platform_user] = lambda: {"role": "admin"}
    app.state.release_discovery = SimpleNamespace(
        snapshot=lambda: {"installed": "1.7.4", "latest": "1.7.5", "online_package_available": True},
        asset={"tag": "v1.7.5", "size": 64, "sha256": None})
    monkeypatch.setattr(update_inbox, "inbox_root", lambda: tmp_path)
    monkeypatch.setattr(update_inbox, "verification_key", lambda: tmp_path / "key")
    url = "/api/admin/system/update-package"
    with TestClient(app) as client:
        assert client.post(url + "/github", json={"version": "1.7.6"}).status_code == 409
        accepted = client.post(url + "/github", json={"version": "1.7.5"})
        assert accepted.status_code == 202
        receipt = accepted.json()
        assert receipt["state"] == "download_queued" and "asset" not in receipt
        assert client.get(url).json()["pending"] == receipt
        discard = url + "/" + receipt["package_id"]
        assert client.delete(discard).status_code == 409
        (tmp_path / "pending" / f"worker-{receipt['package_id']}.json").write_text('{"state":"download_failed"}')
        assert client.delete(discard).status_code == 200
        assert client.get(url).json()["pending"] is None


@pytest.mark.parametrize("delay_days", [None, 1, 31])
def test_update_inbox_limits_access_and_publishes_only_verified_package(monkeypatch, tmp_path, delay_days):
    app = FastAPI()
    app.include_router(update_inbox.router, prefix="/api")
    identity = {"role": "teacher"}
    app.dependency_overrides[update_inbox.current_platform_user] = lambda: identity
    root = tmp_path / "inbox"
    key = tmp_path / "key.pem"
    key.write_text("fixture")
    monkeypatch.setenv("EH_UPDATE_PUBLIC_KEY_FILE", str(key))
    monkeypatch.setattr(update_inbox, "inbox_root", lambda: root)
    monkeypatch.setattr(update_inbox, "MAX_UPLOAD", 32)

    def verify(package, public_key, version):
        assert public_key == key
        if package.read_bytes() != b"verified":
            raise ValueError("not signed")
        return {"version": "9.0.0", "base": version, "files": {"src/test.py": "hash"}}

    monkeypatch.setattr(update_inbox, "verify_update_zip", verify)
    url = "/api/admin/system/update-package"
    headers = {"Content-Type": "application/zip"}
    with TestClient(app) as client:
        assert client.post(url, content=b"verified", headers=headers).status_code == 403
        assert not root.exists()
        identity["role"] = "admin"
        monkeypatch.delenv("EH_UPDATE_PUBLIC_KEY_FILE")
        assert client.get(url).json() == {"enabled": False, "pending": None}
        assert client.post(url, content=b"verified", headers=headers).status_code == 503
        monkeypatch.setenv("EH_UPDATE_PUBLIC_KEY_FILE", str(key))
        assert client.post(url, content=b"x" * 33, headers=headers).status_code == 413
        assert client.post(url, content=b"bad", headers=headers).status_code == 422
        assert not list(root.iterdir())
        accepted = client.post(url, content=b"verified", headers=headers)
        assert accepted.status_code == 201
        assert client.get(url).json()["pending"] == accepted.json()
        assert (root / "pending" / "update.zip").read_bytes() == b"verified"
        assert client.post(url, content=b"verified", headers=headers).status_code == 409
        schedule = url + "/schedule"
        package_id = accepted.json()["package_id"]
        identity["role"] = "teacher"
        assert client.post(schedule, json={"package_id": package_id}).status_code == 403
        identity["role"] = "admin"
        assert client.post(schedule, json={"package_id": "0" * 32}).status_code == 409
        assert client.post(schedule, json={"package_id": package_id, "run_at": "2026-01-01T01:00"}).status_code == 422
        run_at = (datetime.now(timezone.utc) + timedelta(days=delay_days)).isoformat() if delay_days else None
        result = client.post(schedule, json={"package_id": package_id, "run_at": run_at})
        if delay_days == 31:
            assert result.status_code == 400
        else:
            assert result.status_code == 202
            assert client.get(url).json()["pending"] == result.json()
            assert result.json()["state"] == "scheduled"
            if run_at:
                assert result.json()["run_at"] == run_at
            assert client.post(schedule, json={"package_id": package_id}).status_code == 409
            worker = root / "pending" / f"worker-{package_id}.json"
            worker.write_text(json.dumps({"state": "frontend_applied"}))
            rollback = url + "/rollback"
            identity["role"] = "teacher"
            assert client.post(rollback, json={"package_id": package_id}).status_code == 403
            identity["role"] = "admin"
            assert client.post(rollback, json={"package_id": package_id}).status_code == 202
            assert client.get(url).json()["pending"]["state"] == "rollback_requested"
            assert client.post(rollback, json={"package_id": package_id}).status_code == 409
