"""Provenance verification tests for offline releases, frontend build stamping, and build script error stops."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

import pytest

from scripts.build_stamp import (
    FORMAT_VERSION,
    SCHEMA_NAME,
    compute_input_fingerprint,
    create_stamp,
    validate_stamp_schema,
    verify_stamp,
    write_stamp,
)
from tools.release_verify.offline import verify_offline_bundle
from tools.release_verify.source import VerificationError, git, git_tree


def _tar(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, body in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(body)
            archive.addfile(member, io.BytesIO(body))
    return buffer.getvalue()


def _create_test_repo(tmp_path: Path) -> Path:
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
        "web/package.json": b'{"name": "test-web", "version": "1.0.0"}\n',
        "web/src/index.ts": b'console.log("hello");\n',
    }
    for name, body in files.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    dist = repo / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_bytes(
        b'<html><head><link rel="stylesheet" href="/assets/app.css"></head>'
        b'<body><script src="/assets/app.js"></script></body></html>\n'
    )
    (dist / "assets" / "app.js").write_bytes(b"console.log('fixture');\n")
    (dist / "assets" / "app.js.gz").write_bytes(b"compressed gzip fixture")
    (dist / "assets" / "app.js.br").write_bytes(b"compressed brotli fixture")
    (dist / "assets" / "app.css").write_bytes(b"body { color: black; }\n")
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
            "fixture commit",
        ],
        check=True,
    )
    return repo


def _build_offline_bundle(
    tmp_path: Path,
    repo: Path,
    *,
    with_stamp: bool = True,
    stamp_override: dict | bytes | None = None,
    manifest_frontend_override: dict | str | None = None,
    omit_manifest_frontend: bool = False,
    app_commit_override: str | None = None,
    dist_overrides: dict[str, bytes | None] | None = None,
) -> Path:
    commit = git(repo, "rev-parse", "HEAD").decode().strip()
    effective_commit = app_commit_override or commit

    files = {
        "scripts/offline/install.sh": b"#!/bin/sh\n",
        "scripts/offline/installer.py": b"print('install')\n",
        "docs/linux-offline-install.md": b"Install instructions\n",
    }

    app_files = {
        name: git(repo, "show", f"{effective_commit}:{name}")
        for name in git_tree(
            repo, effective_commit, "src", "pyproject.toml", "README.md", "LICENSE"
        )
    }
    for output in (repo / "web" / "dist").rglob("*"):
        if output.is_file() and output.name != "build-stamp.json":
            relative = output.relative_to(repo).as_posix()
            app_files[relative] = output.read_bytes()

    stamp = None
    if with_stamp:
        stamp = create_stamp(repo / "web", repo)
        if isinstance(stamp_override, bytes):
            app_files["web/dist/build-stamp.json"] = stamp_override
        elif isinstance(stamp_override, dict):
            stamp = stamp_override
            app_files["web/dist/build-stamp.json"] = json.dumps(stamp).encode("utf-8")
        else:
            app_files["web/dist/build-stamp.json"] = json.dumps(stamp).encode("utf-8")

    if dist_overrides:
        for relative_path, body in dist_overrides.items():
            archive_path = "web/dist/" + relative_path
            if body is None:
                app_files.pop(archive_path, None)
            else:
                app_files[archive_path] = body

    runtime_files = {
        f"lib/python3.12/site-packages/{name.removeprefix('src/')}": body
        for name, body in app_files.items()
        if name.startswith("src/solaire/")
    }
    runtime_files[
        "lib/python3.12/site-packages/solaire_education-1.6.7.dist-info/METADATA"
    ] = b"Version: 1.6.7\n"
    runtime_files.update(
        {
            f"share/tessdata/{lang}.traineddata": b"x" * 100_001
            for lang in ("eng", "chi_sim")
        }
    )

    nested = {
        "app.tar.gz": _tar(app_files),
        "runtime.tar.gz": _tar(runtime_files),
    }

    manifest: dict = {
        "format": 1,
        "version": "1.6.7",
        "commit": commit,
        "arch": "x86_64",
        "sha256": {
            name: hashlib.sha256(body).hexdigest() for name, body in nested.items()
        },
    }

    if not omit_manifest_frontend:
        if isinstance(manifest_frontend_override, dict):
            manifest["frontend"] = manifest_frontend_override
        elif with_stamp and stamp is not None and isinstance(stamp, dict):
            manifest["frontend"] = {
                "schema": stamp.get("schema", SCHEMA_NAME),
                "format_version": stamp.get("format_version", FORMAT_VERSION),
                "fingerprint": stamp.get("fingerprint"),
                "output_fingerprint": stamp.get("output_fingerprint"),
                "revision": stamp.get("revision"),
                "git_dirty": stamp.get("git_dirty", False),
            }

    outer = nested | {
        "manifest.json": json.dumps(manifest, indent=2).encode("utf-8"),
        "python-dependencies.txt": b"solaire-education==1.6.7\n",
        "install.sh": files["scripts/offline/install.sh"],
        "installer.py": files["scripts/offline/installer.py"],
        "使用说明.md": files["docs/linux-offline-install.md"],
    }

    bundle = tmp_path / f"offline-{commit[:8]}.tar.gz"
    bundle.write_bytes(_tar({"bundle/" + name: body for name, body in outer.items()}))
    bundle.with_suffix(".gz.sha256").write_text(
        f"{hashlib.sha256(bundle.read_bytes()).hexdigest()}  {bundle.name}\n",
        encoding="utf-8",
    )
    return bundle


# ---------------------------------------------------------------------------
# Windows build script stops on npm failure
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    sys.platform != "win32",
    reason="requires Windows cmd.exe and PowerShell to execute scripts/build.ps1",
)
def test_build_ps1_stops_on_npm_ci_and_build_failure(tmp_path: Path):
    """Exercise the production build script with fake external commands."""
    powershell = shutil.which("powershell") or shutil.which("powershell.exe")
    if not powershell or not shutil.which("cmd.exe"):
        pytest.skip("requires Windows PowerShell and cmd.exe")

    repo_root = tmp_path / "build fixture"
    scripts_dir = repo_root / "scripts"
    web_dir = repo_root / "web"
    dist_dir = web_dir / "dist"
    assets_dir = dist_dir / "assets"
    fake_bin = tmp_path / "fake commands"
    scripts_dir.mkdir(parents=True)
    assets_dir.mkdir(parents=True)
    fake_bin.mkdir()

    source_root = Path(__file__).resolve().parents[1]
    shutil.copy2(source_root / "scripts" / "build.ps1", scripts_dir / "build.ps1")
    shutil.copy2(
        source_root / "scripts" / "build_stamp.py", scripts_dir / "build_stamp.py"
    )
    (web_dir / "package.json").write_text(
        '{"name":"build-script-fixture","version":"1.0.0"}\n', encoding="utf-8"
    )
    (web_dir / "src").mkdir()
    (web_dir / "src" / "App.tsx").write_text("export const App = 1;\n", encoding="utf-8")
    (dist_dir / "index.html").write_text(
        '<html><body><script src="/assets/app.js"></script></body></html>\n',
        encoding="utf-8",
    )
    (assets_dir / "app.js").write_text("console.log('fixture');\n", encoding="utf-8")

    subprocess.run(["git", "init", "-q", str(repo_root)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo_root), "config", "core.autocrlf", "false"], check=True
    )
    subprocess.run(["git", "-C", str(repo_root), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(repo_root),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-qm",
            "build script fixture",
        ],
        check=True,
    )

    npm_log = tmp_path / "npm calls.txt"
    verifier_log = tmp_path / "verifier calls.txt"
    (fake_bin / "npm.cmd").write_text(
        "\r\n".join(
            [
                "@echo off",
                '>>"%FAKE_NPM_LOG%" echo %*',
                'if /I "%FAKE_NPM_MODE%"=="ci-fail" if /I "%~1"=="ci" exit /b 42',
                'if /I "%FAKE_NPM_MODE%"=="build-fail" if /I "%~1"=="run" if /I "%~2"=="build" exit /b 84',
                'if /I "%~1"=="run" if /I "%~2"=="build" (',
                '  "%TEST_PYTHON%" "%FAKE_PROJECT_ROOT%\\scripts\\build_stamp.py" generate --web-dir "%FAKE_PROJECT_ROOT%\\web" --repo-root "%FAKE_PROJECT_ROOT%" --output "%FAKE_PROJECT_ROOT%\\web\\dist\\build-stamp.json"',
                "  if errorlevel 1 exit /b 1",
                ")",
                "exit /b 0",
                "",
            ]
        ),
        encoding="ascii",
    )
    (fake_bin / "py.cmd").write_text(
        "\r\n".join(
            [
                "@echo off",
                '>>"%FAKE_VERIFIER_LOG%" echo %*',
                'if /I "%~1"=="-3" goto without_version',
                '"%TEST_PYTHON%" %*',
                "exit /b %errorlevel%",
                ":without_version",
                "shift",
                '"%TEST_PYTHON%" %1 %2 %3 %4 %5 %6 %7 %8 %9',
                "exit /b %errorlevel%",
                "",
            ]
        ),
        encoding="ascii",
    )

    env = os.environ.copy()
    env.update(
        {
            "PATH": str(fake_bin) + os.pathsep + env.get("PATH", ""),
            "FAKE_NPM_LOG": str(npm_log),
            "FAKE_VERIFIER_LOG": str(verifier_log),
            "FAKE_PROJECT_ROOT": str(repo_root),
            "TEST_PYTHON": sys.executable,
        }
    )

    def run_build(mode: str) -> subprocess.CompletedProcess:
        npm_log.write_text("", encoding="utf-8")
        verifier_log.write_text("", encoding="utf-8")
        call_env = env | {"FAKE_NPM_MODE": mode}
        return subprocess.run(
            [
                powershell,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(scripts_dir / "build.ps1"),
                "-SkipRust",
                "-SkipPythonRuntime",
                "-SkipTauri",
            ],
            cwd=repo_root,
            env=call_env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    proc_ci = run_build("ci-fail")
    assert proc_ci.returncode == 42, proc_ci.stdout + proc_ci.stderr
    assert npm_log.read_text(encoding="utf-8").splitlines() == ["ci"]
    assert verifier_log.read_text(encoding="utf-8") == ""

    proc_build = run_build("build-fail")
    assert proc_build.returncode == 84, proc_build.stdout + proc_build.stderr
    assert npm_log.read_text(encoding="utf-8").splitlines() == ["ci", "run build"]
    assert verifier_log.read_text(encoding="utf-8") == ""

    proc_ok = run_build("success")
    assert proc_ok.returncode == 0, proc_ok.stdout + proc_ok.stderr
    assert npm_log.read_text(encoding="utf-8").splitlines() == ["ci", "run build"]
    assert "verify" in verifier_log.read_text(encoding="utf-8")
    assert "Build stamp verified:" in proc_ok.stdout


# ---------------------------------------------------------------------------
# Frontend build product source fingerprinting
# ---------------------------------------------------------------------------


def test_fingerprint_deterministic_and_sensitive_to_changes(tmp_path: Path):
    """Same sources produce identical fingerprint; source edits alter fingerprint; excluded dirs ignored."""
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    (web_dir / "package.json").write_text('{"name": "test"}', encoding="utf-8")
    (web_dir / "src").mkdir()
    (web_dir / "src/App.tsx").write_text("export const App = 1;", encoding="utf-8")

    fp1, inputs1 = compute_input_fingerprint(web_dir)
    fp2, inputs2 = compute_input_fingerprint(web_dir)
    assert fp1 == fp2
    assert len(inputs1) == 2

    # Edits to excluded dirs should not change fingerprint
    (web_dir / "dist").mkdir()
    (web_dir / "dist/bundle.js").write_text("bundle", encoding="utf-8")
    (web_dir / "node_modules").mkdir()
    (web_dir / "node_modules/dep.js").write_text("dep", encoding="utf-8")
    (web_dir / "build-stamp.json").write_text("{}", encoding="utf-8")

    fp_after_excluded, _ = compute_input_fingerprint(web_dir)
    assert fp_after_excluded == fp1

    # Modification to source file changes fingerprint
    (web_dir / "src/App.tsx").write_text("export const App = 2;", encoding="utf-8")
    fp3, _ = compute_input_fingerprint(web_dir)
    assert fp3 != fp1


def test_build_stamp_create_and_verify(tmp_path: Path):
    """create_stamp generates valid schema, and verify_stamp accepts matching stamp and rejects mismatches."""
    repo = _create_test_repo(tmp_path)
    web_dir = repo / "web"
    dist_dir = web_dir / "dist"
    dist_dir.mkdir(exist_ok=True)

    stamp = create_stamp(web_dir, repo)
    validate_stamp_schema(stamp)
    assert stamp["schema"] == SCHEMA_NAME
    assert stamp["format_version"] == FORMAT_VERSION
    assert stamp["input_count"] > 0
    assert stamp["output_count"] > 0
    output_paths = {item["path"] for item in stamp["outputs"]}
    assert "assets/app.js.gz" in output_paths
    assert "assets/app.js.br" in output_paths
    assert stamp["git_dirty"] is False
    assert len(stamp["revision"]) == 40

    write_stamp(stamp, dist_dir / "build-stamp.json")

    # Valid stamp verifies successfully
    verified = verify_stamp(dist_dir, web_dir=web_dir, expected_revision=stamp["revision"])
    assert verified["fingerprint"] == stamp["fingerprint"]

    # Mismatched expected revision rejected
    with pytest.raises(ValueError, match="Revision mismatch"):
        verify_stamp(dist_dir, expected_revision="0000000000000000000000000000000000000000")

    unknown_stamp = copy.deepcopy(stamp)
    unknown_stamp["revision"] = "unknown"
    write_stamp(unknown_stamp, dist_dir / "build-stamp.json")
    with pytest.raises(ValueError, match="Revision mismatch"):
        verify_stamp(dist_dir, expected_revision=stamp["revision"])
    write_stamp(stamp, dist_dir / "build-stamp.json")

    # Mismatched expected fingerprint rejected
    with pytest.raises(ValueError, match="Fingerprint mismatch"):
        verify_stamp(dist_dir, expected_fingerprint="bad_fingerprint")

    # Missing stamp rejected
    with pytest.raises(FileNotFoundError):
        verify_stamp(tmp_path / "non_existent_dist")

    # Corrupted stamp JSON rejected
    (dist_dir / "build-stamp.json").write_text("not json", encoding="utf-8")
    with pytest.raises(ValueError, match="Corrupted or invalid"):
        verify_stamp(dist_dir)


@pytest.mark.parametrize(
    "relative_path",
    (
        "index.html",
        "assets/app.js",
        "assets/app.js.gz",
        "assets/app.js.br",
    ),
)
def test_build_stamp_rejects_changed_dist_outputs(tmp_path: Path, relative_path: str):
    """The stamp covers the index, source assets, and each served compression variant."""
    repo = _create_test_repo(tmp_path)
    web_dir = repo / "web"
    dist_dir = web_dir / "dist"
    stamp = create_stamp(web_dir, repo)
    write_stamp(stamp, dist_dir / "build-stamp.json")

    output = dist_dir / relative_path
    original = output.read_bytes()
    output.write_bytes(original + b"changed")
    try:
        with pytest.raises(ValueError, match="Frontend output content mismatch"):
            verify_stamp(dist_dir, web_dir=web_dir, expected_revision=stamp["revision"])
    finally:
        output.write_bytes(original)


def test_build_stamp_rejects_missing_referenced_dist_asset(tmp_path: Path):
    """An index cannot keep referring to a local output that disappeared after build."""
    repo = _create_test_repo(tmp_path)
    web_dir = repo / "web"
    dist_dir = web_dir / "dist"
    stamp = create_stamp(web_dir, repo)
    write_stamp(stamp, dist_dir / "build-stamp.json")
    (dist_dir / "assets" / "app.js").unlink()

    with pytest.raises(ValueError, match="references missing local resource"):
        verify_stamp(dist_dir, web_dir=web_dir, expected_revision=stamp["revision"])


# ---------------------------------------------------------------------------
# Offline verifier accepts legacy bundles and rejects provenance mismatches
# ---------------------------------------------------------------------------


def test_verifier_accepts_legacy_package_as_unknown_provenance(tmp_path: Path):
    """Existing packages without provenance stamp continue to pass with legacy unknown status."""
    repo = _create_test_repo(tmp_path)
    bundle = _build_offline_bundle(tmp_path, repo, with_stamp=False)

    result = verify_offline_bundle(bundle, repo)
    assert result["app_sources_verified"] > 0
    assert result["frontend_provenance"]["status"] == "unknown"
    assert result["frontend_provenance"]["legacy"] is True


def test_verifier_accepts_provenance_verified_bundle(tmp_path: Path):
    """Bundles with valid frontend stamp and manifest frontend metadata pass verification."""
    repo = _create_test_repo(tmp_path)
    bundle = _build_offline_bundle(tmp_path, repo, with_stamp=True)

    result = verify_offline_bundle(bundle, repo)
    assert result["frontend_provenance"]["status"] == "verified"
    assert result["frontend_provenance"]["legacy"] is False
    assert result["frontend_provenance"]["revision"] == result["commit"]
    assert result["frontend_provenance"]["input_count"] > 0
    assert result["frontend_provenance"]["output_count"] > 0


@pytest.mark.parametrize(
    "relative_path",
    (
        "index.html",
        "assets/app.js",
        "assets/app.js.gz",
        "assets/app.js.br",
    ),
)
def test_verifier_rejects_changed_packaged_dist_outputs(
    tmp_path: Path, relative_path: str
):
    """An archive cannot carry frontend files that differ from its build stamp."""
    repo = _create_test_repo(tmp_path)
    expected = (repo / "web" / "dist" / relative_path).read_bytes()
    bundle = _build_offline_bundle(
        tmp_path,
        repo,
        dist_overrides={relative_path: expected + b"changed"},
    )

    with pytest.raises(VerificationError, match="artifacts do not match"):
        verify_offline_bundle(bundle, repo)


def test_verifier_rejects_missing_packaged_index_resource(tmp_path: Path):
    """A packaged index cannot refer to a local resource omitted from dist."""
    repo = _create_test_repo(tmp_path)
    bundle = _build_offline_bundle(
        tmp_path,
        repo,
        dist_overrides={"assets/app.js": None},
    )

    with pytest.raises(VerificationError, match="artifacts do not match"):
        verify_offline_bundle(bundle, repo)


def test_verifier_rejects_dist_from_different_commit(tmp_path: Path):
    """When frontend dist was built from commit A but release bundle is for commit B, verifier rejects."""
    repo = _create_test_repo(tmp_path)
    old_commit = "1111111111111111111111111111111111111111"
    stamp = create_stamp(repo / "web", repo)
    stamp["revision"] = old_commit

    manifest_fe = copy.deepcopy(stamp)

    bundle = _build_offline_bundle(
        tmp_path,
        repo,
        with_stamp=True,
        stamp_override=stamp,
        manifest_frontend_override=manifest_fe,
    )

    with pytest.raises(VerificationError, match="Frontend dist was built from revision"):
        verify_offline_bundle(bundle, repo)


def test_verifier_rejects_unknown_revision_and_dirty_frontend(tmp_path: Path):
    """A release commit cannot turn unknown or dirty frontend inputs into verified provenance."""
    repo = _create_test_repo(tmp_path)
    stamp = create_stamp(repo / "web", repo)
    stamp["revision"] = "unknown"
    stamp["git_dirty"] = "unknown"
    manifest_fe = {
        key: stamp[key]
        for key in (
            "schema", "format_version", "fingerprint", "output_fingerprint",
            "revision", "git_dirty",
        )
    }
    bundle_unknown = _build_offline_bundle(
        tmp_path, repo, stamp_override=stamp, manifest_frontend_override=manifest_fe
    )
    with pytest.raises(VerificationError, match="Frontend dist was built from revision unknown"):
        verify_offline_bundle(bundle_unknown, repo)

    stamp = create_stamp(repo / "web", repo)
    stamp["git_dirty"] = True
    manifest_fe = {
        key: stamp[key]
        for key in (
            "schema", "format_version", "fingerprint", "output_fingerprint",
            "revision", "git_dirty",
        )
    }
    bundle_dirty = _build_offline_bundle(
        tmp_path, repo, stamp_override=stamp, manifest_frontend_override=manifest_fe
    )
    with pytest.raises(VerificationError, match="build sources are dirty"):
        verify_offline_bundle(bundle_dirty, repo)


def test_verifier_rejects_frontend_manifest_schema_mismatch(tmp_path: Path):
    """Every supported frontend provenance field in the package manifest matches the archive stamp."""
    repo = _create_test_repo(tmp_path)
    stamp = create_stamp(repo / "web", repo)
    manifest_fe = {
        key: stamp[key]
        for key in (
            "schema", "format_version", "fingerprint", "output_fingerprint",
            "revision", "git_dirty",
        )
    }
    manifest_fe["format_version"] = FORMAT_VERSION + 1
    bundle = _build_offline_bundle(
        tmp_path, repo, stamp_override=stamp, manifest_frontend_override=manifest_fe
    )

    with pytest.raises(VerificationError, match="Frontend format_version mismatch"):
        verify_offline_bundle(bundle, repo)


def test_verifier_rejects_stamp_inputs_not_in_release_commit(tmp_path: Path):
    """A self-consistent input hash list must also match the declared Git revision."""
    repo = _create_test_repo(tmp_path)
    stamp = create_stamp(repo / "web", repo)
    stamp["inputs"][0]["sha256"] = "0" * 64
    recalculated = hashlib.sha256()
    for item in sorted(stamp["inputs"], key=lambda entry: entry["path"]):
        recalculated.update(f"{item['path']}:{item['sha256']}\n".encode("utf-8"))
    stamp["fingerprint"] = recalculated.hexdigest()
    manifest_fe = {
        key: stamp[key]
        for key in (
            "schema", "format_version", "fingerprint", "output_fingerprint",
            "revision", "git_dirty",
        )
    }
    bundle = _build_offline_bundle(
        tmp_path, repo, stamp_override=stamp, manifest_frontend_override=manifest_fe
    )

    with pytest.raises(VerificationError, match="inputs do not match the release commit"):
        verify_offline_bundle(bundle, repo)


def test_verifier_rejects_corrupted_or_mismatched_stamp(tmp_path: Path):
    """Corrupted stamp JSON or mismatched archive vs manifest raises VerificationError."""
    repo = _create_test_repo(tmp_path)

    # 1. Corrupted stamp inside archive
    bundle_corrupt = _build_offline_bundle(
        tmp_path, repo, with_stamp=True, stamp_override=b"invalid-json{"
    )
    with pytest.raises(VerificationError, match="Damaged or unparseable frontend build stamp"):
        verify_offline_bundle(bundle_corrupt, repo)

    # 2. Fingerprint mismatch between archive stamp and manifest
    stamp = create_stamp(repo / "web", repo)
    bad_manifest_fe = copy.deepcopy(stamp)
    bad_manifest_fe["fingerprint"] = "mismatched_fingerprint"
    bundle_fp_mismatch = _build_offline_bundle(
        tmp_path,
        repo,
        with_stamp=True,
        stamp_override=stamp,
        manifest_frontend_override=bad_manifest_fe,
    )
    with pytest.raises(VerificationError, match="Frontend fingerprint mismatch"):
        verify_offline_bundle(bundle_fp_mismatch, repo)

    # 3. Archive has stamp but manifest omitted frontend
    bundle_omit_manifest = _build_offline_bundle(
        tmp_path, repo, with_stamp=True, omit_manifest_frontend=True
    )
    with pytest.raises(VerificationError, match="app archive contains web/dist/build-stamp.json, but package manifest lacks"):
        verify_offline_bundle(bundle_omit_manifest, repo)

    # 4. Manifest has frontend but archive lacks stamp
    bundle_omit_archive = _build_offline_bundle(
        tmp_path,
        repo,
        with_stamp=False,
        manifest_frontend_override={
            "schema": SCHEMA_NAME,
            "format_version": FORMAT_VERSION,
            "fingerprint": "xyz",
            "output_fingerprint": "0" * 64,
            "revision": git(repo, "rev-parse", "HEAD").decode().strip(),
        },
    )
    with pytest.raises(VerificationError, match="package manifest declared frontend metadata, but app archive lacks"):
        verify_offline_bundle(bundle_omit_archive, repo)


def test_build_linux_offline_validates_stamp_and_stops_on_mismatch(tmp_path: Path, monkeypatch):
    """build_linux_offline.py halts when stamp is missing, damaged, or mismatched."""
    from scripts import build_linux_offline

    repo = _create_test_repo(tmp_path)
    web_dir = repo / "web"
    dist_dir = web_dir / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    (dist_dir / "index.html").write_text("<html>App</html>", encoding="utf-8")

    monkeypatch.setattr(build_linux_offline.platform, "system", lambda: "Linux")
    monkeypatch.setattr(build_linux_offline.platform, "machine", lambda: "x86_64")

    fake_runtime = tmp_path / "fake_runtime"
    fake_runtime.mkdir()

    # 1. Missing build-stamp.json
    with pytest.raises(SystemExit, match="缺少 build-stamp.json"):
        build_linux_offline.build(fake_runtime, tmp_path / "out", root=repo)

    # 2. Corrupted build-stamp.json
    (dist_dir / "build-stamp.json").write_text("corrupted{", encoding="utf-8")
    with pytest.raises(SystemExit, match="损坏或无法解析"):
        build_linux_offline.build(fake_runtime, tmp_path / "out", root=repo)

    # 3. Fingerprint mismatch
    stamp = create_stamp(web_dir, repo)
    stamp["fingerprint"] = "0" * 64
    write_stamp(stamp, dist_dir / "build-stamp.json")
    with pytest.raises(SystemExit, match="指纹与当前 web 源码不匹配"):
        build_linux_offline.build(fake_runtime, tmp_path / "out", root=repo)

    # 4. Revision mismatch
    stamp = create_stamp(web_dir, repo)
    stamp["revision"] = "0000000000000000000000000000000000000000"
    write_stamp(stamp, dist_dir / "build-stamp.json")
    with pytest.raises(SystemExit, match="revision .* 不匹配"):
        build_linux_offline.build(fake_runtime, tmp_path / "out", root=repo)

    # 5. Unknown revision cannot be treated as a match for a known release commit
    stamp = create_stamp(web_dir, repo)
    stamp["revision"] = "unknown"
    write_stamp(stamp, dist_dir / "build-stamp.json")
    with pytest.raises(SystemExit, match=r"revision \(unknown\) 与发布 commit"):
        build_linux_offline.build(fake_runtime, tmp_path / "out", root=repo)

    # 6. Dirty sources cannot be packaged with a HEAD-only application archive
    stamp = create_stamp(web_dir, repo)
    stamp["git_dirty"] = True
    write_stamp(stamp, dist_dir / "build-stamp.json")
    with pytest.raises(SystemExit, match="工作区未 clean"):
        build_linux_offline.build(fake_runtime, tmp_path / "out", root=repo)

    # 7. A current source stamp cannot authorize a changed compressed output
    stamp = create_stamp(web_dir, repo)
    write_stamp(stamp, dist_dir / "build-stamp.json")
    compressed = dist_dir / "assets" / "app.js.gz"
    original = compressed.read_bytes()
    compressed.write_bytes(original + b"stale")
    try:
        with pytest.raises(SystemExit, match="实际产物与 build-stamp.json 不匹配"):
            build_linux_offline.build(fake_runtime, tmp_path / "out", root=repo)
    finally:
        compressed.write_bytes(original)
