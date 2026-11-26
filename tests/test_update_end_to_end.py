"""Signed ZIP upload through the API, real candidate login, hot switch and repeat."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from solaire.exam_compiler import __version__
from solaire.web import offline_frontend
from solaire.web.management import update_inbox
from tools.release_verify.build_update_zip import build_update_zip
from tools.release_verify.update_worker import run_due_preflight


def test_repeat_update_upload_preflight_activation_and_rollback_without_restart(monkeypatch, tmp_path):
    if not shutil.which("openssl"):
        pytest.skip("OpenSSL not installed")
    repo = Path(__file__).resolve().parents[1]
    base = tmp_path / "base"
    shutil.copytree(repo / "src" / "solaire", base / "src" / "solaire", ignore=shutil.ignore_patterns("__pycache__"))
    index = base / "web" / "dist" / "index.html"
    index.parent.mkdir(parents=True)
    index.write_text("<html><body>original release</body></html>", encoding="utf-8")
    upcoming = tmp_path / "upcoming"
    shutil.copytree(base, upcoming)
    next_index = upcoming / "web" / "dist" / "index.html"
    next_index.write_text("<html><body>first update</body></html>", encoding="utf-8")
    after = tmp_path / "after"
    shutil.copytree(upcoming, after)
    (after / "web" / "dist" / "index.html").write_text("<html><body>second update</body></html>", encoding="utf-8")
    inbox, store, output = (tmp_path / name for name in ("inbox", "store", "packages"))
    store.mkdir()
    output.mkdir()
    private_key, public_key = tmp_path / "private.pem", tmp_path / "public.pem"
    subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(private_key)], check=True, timeout=10)
    subprocess.run(["openssl", "pkey", "-in", str(private_key), "-pubout", "-out", str(public_key)], check=True, timeout=10)
    major, minor, patch = map(int, __version__.split("."))
    first, second = (f"{major}.{minor}.{patch + step}" for step in (1, 2))
    packages = [build_update_zip(base, upcoming, __version__, first, private_key, output),
                build_update_zip(upcoming, after, first, second, private_key, output)]
    monkeypatch.setenv("EH_UPDATE_PUBLIC_KEY_FILE", str(public_key))
    monkeypatch.setenv("EH_FRONTEND_RELEASE_STORE", str(store))
    monkeypatch.setattr(update_inbox, "inbox_root", lambda: inbox)
    monkeypatch.setattr(offline_frontend, "ROOT", index.parent)
    monkeypatch.setattr(offline_frontend, "FRONTEND_RELEASE_STORE", store)
    api = FastAPI()
    api.include_router(update_inbox.router, prefix="/api")
    api.dependency_overrides[update_inbox.current_platform_user] = lambda: {"role": "admin"}
    url = "/api/admin/system/update-package"
    args = (inbox, public_key, __version__, base, tmp_path, Path(sys.executable))
    with TestClient(api) as admin, TestClient(offline_frontend.app) as public:
        assert "original release" in public.get("/").text
        for package, version in zip(packages, (first, second), strict=True):
            uploaded = admin.post(url, content=package.read_bytes(), headers={"Content-Type": "application/zip"})
            assert uploaded.status_code == 201, uploaded.text
            package_id = uploaded.json()["package_id"]
            assert admin.post(url + "/schedule", json={"package_id": package_id}).status_code == 202
            assert run_due_preflight(*args, frontend_store=store) == "frontend_applied"
            assert public.get("/_eh_release").json()["frontend_version"] == version
            if version == first:
                assert admin.delete(url + "/" + package_id).status_code == 200
                assert admin.get(url).json()["pending"] is None
                assert "first update" in public.get("/").text
        assert "second update" in public.get("/").text
        assert admin.post(url + "/rollback", json={"package_id": package_id}).status_code == 202
        assert run_due_preflight(*args, frontend_store=store) == "frontend_rolled_back"
        assert "first update" in public.get("/").text
        assert "original release" in index.read_text(encoding="utf-8")
