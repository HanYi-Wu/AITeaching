"""Public clients can isolate drafts without learning server paths."""

import shutil
from concurrent.futures import ThreadPoolExecutor

from solaire.web import public_access
from solaire.web.project_scope import project_scope_id


def test_public_project_info_has_a_stable_opaque_scope(web_client, monkeypatch):
    local = web_client.get("/api/project/info").json()
    monkeypatch.setenv("SOLAIRE_PUBLIC_MODE", "1")
    monkeypatch.setattr(
        public_access,
        "_authenticated_user",
        lambda request: {"id": "teacher", "role": "teacher", "status": "active"},
    )
    first = web_client.get("/api/project/info").json()
    second = web_client.get("/api/project/info").json()
    assert first == second
    assert first["root"] == ""
    assert first["project_id"] == local["project_id"]
    assert local["root"] not in first["project_id"]


def test_copied_projects_do_not_share_browser_drafts(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    identity = project_scope_id(first)
    shutil.copytree(first, second)
    assert project_scope_id(second) != identity
    assert project_scope_id(first) == identity


def test_concurrent_initial_requests_agree_on_project_scope(tmp_path):
    with ThreadPoolExecutor(max_workers=4) as pool:
        scopes = list(pool.map(lambda _: project_scope_id(tmp_path), range(8)))
    assert len(set(scopes)) == 1
