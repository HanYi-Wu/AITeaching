"""Offline verification checks application sources and either runtime layout."""

import hashlib
import io
import json
import subprocess
import tarfile

import pytest

from tools.release_verify.offline import verify_offline_bundle
from tools.release_verify.source import VerificationError, git, git_tree


def _tar(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, body in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(body)
            archive.addfile(member, io.BytesIO(body))
    return buffer.getvalue()


def _package(tmp_path, *, tamper=None, source_redirect=False):
    repo = tmp_path / "repo"
    repo.mkdir()
    files = {
        "pyproject.toml": b'[project]\nname="solaire-education"\nversion="1.6.7"\n',
        "README.md": b"README\n",
        "LICENSE": b"LICENSE\n",
        "src/solaire/__init__.py": b'"""Package."""\n',
        "src/solaire/web/app.py": b"app = None\n",
        "scripts/offline/install.sh": b"#!/bin/sh\n",
        "scripts/offline/installer.py": b"print('install')\n",
        "docs/linux-offline-install.md": b"Install instructions\n",
    }
    for name, body in files.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    subprocess.run(["git", "init", "-q", str(repo)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "config", "core.autocrlf", "false"], check=True
    )
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-qm",
            "fixture",
        ],
        check=True,
    )
    commit = git(repo, "rev-parse", "HEAD").decode().strip()
    app = {
        name: files[name]
        for name in git_tree(
            repo, commit, "src", "pyproject.toml", "README.md", "LICENSE"
        )
    }
    app["web/dist/index.html"] = b"<html>App</html>"
    runtime = {
        "lib/python3.12/site-packages/" + name.removeprefix("src/"): body
        for name, body in files.items()
        if name.startswith("src/")
    }
    runtime[
        "lib/python3.12/site-packages/solaire_education-1.6.7.dist-info/METADATA"
    ] = b"Version: 1.6.7\n"
    runtime.update(
        {
            f"share/tessdata/{lang}.traineddata": b"x" * 100_001
            for lang in ("eng", "chi_sim")
        }
    )
    redirect_name = "lib/python3.12/site-packages/solaire-source.pth"
    if source_redirect:
        runtime = {
            name: body for name, body in runtime.items()
            if "/site-packages/solaire/" not in name
        }
        runtime[redirect_name] = b"../../../../src\n"
    if tamper == "missing-redirect":
        runtime.pop(redirect_name)
    elif tamper == "redirect-target":
        runtime[redirect_name] = b"../../../../old-src\n"
    elif tamper == "mixed-runtime":
        runtime["lib/python3.12/site-packages/solaire/local_override.py"] = b"pass\n"
    elif tamper == "duplicate-redirect":
        runtime["lib/python3.13/site-packages/solaire-source.pth"] = runtime[redirect_name]
    elif tamper == "misplaced-redirect":
        runtime["lib/python3.13/site-packages/solaire-source.pth"] = runtime.pop(redirect_name)
    elif tamper == "metadata":
        runtime.pop("lib/python3.12/site-packages/solaire_education-1.6.7.dist-info/METADATA")
    elif tamper == "ocr":
        runtime.pop("share/tessdata/chi_sim.traineddata")
    if tamper == "runtime":
        runtime["lib/python3.12/site-packages/solaire/web/app.py"] = (
            b"app = 'wrong version'\n"
        )
    if tamper == "app":
        app["src/solaire/web/app.py"] = b"app = 'wrong version'\n"
    nested = {"app.tar.gz": _tar(app), "runtime.tar.gz": _tar(runtime)}
    manifest = {
        "format": 1,
        "version": "1.6.7",
        "commit": commit,
        "arch": "x86_64",
        "sha256": {
            name: hashlib.sha256(body).hexdigest() for name, body in nested.items()
        },
    }
    if tamper == "manifest":
        manifest["version"] = "1.0.0"
    outer = nested | {
        "manifest.json": json.dumps(manifest).encode(),
        "python-dependencies.txt": b"solaire-education==1.6.7\n",
        "install.sh": files["scripts/offline/install.sh"],
        "installer.py": files["scripts/offline/installer.py"],
        "使用说明.md": files["docs/linux-offline-install.md"],
    }
    bundle = tmp_path / "offline.tar.gz"
    bundle.write_bytes(_tar({"bundle/" + name: body for name, body in outer.items()}))
    bundle.with_suffix(".gz.sha256").write_text(
        hashlib.sha256(bundle.read_bytes()).hexdigest() + "  " + bundle.name,
        encoding="utf-8",
    )
    return bundle, repo


def test_offline_app_and_installed_runtime_both_match_commit(tmp_path):
    bundle, repo = _package(tmp_path)
    result = verify_offline_bundle(bundle, repo)
    assert result["app_sources_verified"] == 5
    assert result["installed_python_sources_verified"] == 2
    assert result["runtime_python_source_layout"] == "installed-package"
    assert result["runtime_source_redirect_verified"] is False


@pytest.mark.parametrize("tamper", ["runtime", "app", "manifest"])
def test_consistently_rehashed_but_wrong_code_or_version_is_rejected(tmp_path, tamper):
    bundle, repo = _package(tmp_path, tamper=tamper)
    with pytest.raises(VerificationError):
        verify_offline_bundle(bundle, repo)


def test_offline_runtime_imports_verified_application_sources(tmp_path):
    bundle, repo = _package(tmp_path, source_redirect=True)
    result = verify_offline_bundle(bundle, repo)
    assert result["app_sources_verified"] == 5
    assert result["installed_python_sources_verified"] == 0
    assert result["runtime_python_source_layout"] == "application-source"
    assert result["runtime_source_redirect_verified"] is True


@pytest.mark.parametrize(
    ("tamper", "message"),
    [
        ("app", "Source .* mismatch"),
        ("missing-redirect", "Installed Python sources missing"),
        ("redirect-target", "redirect contents"),
        ("mixed-runtime", "shadows"),
        ("duplicate-redirect", "Duplicate runtime"),
        ("misplaced-redirect", "outside the application package site"),
        ("metadata", "outside the application package site"),
        ("ocr", "OCR language data is missing"),
    ],
)
def test_source_redirect_cannot_bypass_code_or_dependency_checks(tmp_path, tamper, message):
    bundle, repo = _package(tmp_path, source_redirect=True, tamper=tamper)
    with pytest.raises(VerificationError, match=message):
        verify_offline_bundle(bundle, repo)
