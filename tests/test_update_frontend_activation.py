from fastapi.testclient import TestClient

from solaire.web import offline_frontend
from tools.release_verify.frontend_activation import activate_frontend, rollback_frontend


def test_frontend_switch_exposes_new_index_without_restarting_http_process(monkeypatch, tmp_path):
    active = tmp_path / "active"
    active.mkdir()
    old = "assets/old-abcdefgh.js"
    (active / "assets").mkdir()
    (active / old).write_text("old scripts")
    (active / "index.html").write_text("old home")
    staged = tmp_path / "candidate"
    dist = staged / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / old).write_text("old scripts")
    new = "assets/new-abcdefgh.js"
    (dist / new).write_text("new scripts")
    (dist / "index.html").write_text("new home")
    store = tmp_path / "release-store"
    store.mkdir()
    monkeypatch.setattr(offline_frontend, "ROOT", active)
    monkeypatch.setattr(offline_frontend, "FRONTEND_RELEASE_STORE", store)
    with TestClient(offline_frontend.app) as client:
        assert client.get("/").text == "old home"
        activate_frontend(staged, active, store, "a" * 32, "1.7.5", (
            "web/dist/index.html", f"web/dist/{new}",
        ))
        assert client.get("/").text == "new home"
        assert client.get(f"/{old}").text == "old scripts"
        assert client.get(f"/{new}").text == "new scripts"
        assert client.get("/_eh_release").json()["frontend_version"] == "1.7.5"
        rollback_frontend(store, "a" * 32)
        rollback_frontend(store, "a" * 32)
        assert client.get("/").text == "old home"
        assert client.get(f"/{old}").text == "old scripts"
        assert client.get(f"/{new}").text == "new scripts"
        assert "frontend_version" not in client.get("/_eh_release").json()
