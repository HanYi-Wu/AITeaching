"""Version-independent offline bundle checks adapted from 1.6.7 acceptance."""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import tarfile
import tomllib
from pathlib import Path

from scripts.build_stamp import (
    EXCLUDED_DIRS,
    EXCLUDED_FILES,
    validate_frontend_references,
    validate_stamp_schema,
)
from .source import (
    TreeVerifier,
    VerificationError,
    blob_hash,
    git,
    git_tree,
    safe_archive_name,
    sha256,
)


class HashReader:
    def __init__(self, source):
        self.source = source
        self.hash = hashlib.sha256()

    def read(self, size=-1):
        body = self.source.read(size)
        self.hash.update(body)
        return body


def _frontend_inputs_at_commit(repo: Path, commit: str) -> list[dict[str, str]]:
    """Read the normalized frontend input list directly from the release commit."""
    source_tree = git_tree(repo, commit, "web")
    selected: list[tuple[str, str, int]] = []
    for path, (blob, size, mode) in source_tree.items():
        if mode not in {"100644", "100755"}:
            continue
        relative_path = path.removeprefix("web/")
        if any(part in EXCLUDED_DIRS for part in relative_path.split("/")):
            continue
        if relative_path.rsplit("/", 1)[-1] in EXCLUDED_FILES:
            continue
        selected.append((relative_path, blob, size))
    selected.sort(key=lambda item: item[0])

    process = subprocess.Popen(
        ["git", "-C", str(repo), "cat-file", "--batch"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.stdin is None or process.stdout is None or process.stderr is None:
        process.kill()
        process.wait()
        raise VerificationError("Unable to read frontend source archive")

    items: list[dict[str, str]] = []
    try:
        for relative_path, blob, expected_size in selected:
            process.stdin.write(blob.encode("ascii") + b"\n")
            process.stdin.flush()
            header = process.stdout.readline().split()
            if len(header) != 3 or header[1] != b"blob":
                raise VerificationError("Unable to read frontend source: " + relative_path)
            size = int(header[2])
            if size != expected_size:
                raise VerificationError("Frontend source size changed at release commit: " + relative_path)
            digest = hashlib.sha256()
            remaining = size
            while remaining:
                chunk = process.stdout.read(min(65_536, remaining))
                if not chunk:
                    raise VerificationError("Truncated frontend source at release commit: " + relative_path)
                digest.update(chunk)
                remaining -= len(chunk)
            if process.stdout.read(1) != b"\n":
                raise VerificationError("Malformed Git object response for frontend source: " + relative_path)
            items.append({"path": relative_path, "sha256": digest.hexdigest()})

        process.stdin.close()
        returncode = process.wait()
        error = process.stderr.read().decode("utf-8", errors="replace")
        if returncode != 0:
            raise VerificationError("Unable to read frontend source at release commit: " + error.strip())
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdin.close()
        process.stdout.close()
        process.stderr.close()

    return items


def _verify_app(body, expected, algorithm):
    verifier = TreeVerifier(expected, algorithm=algorithm)
    frontend = False
    stamp_raw = None
    frontend_outputs = []
    index_html = None
    with tarfile.open(fileobj=io.BytesIO(body), mode="r|gz") as app:
        for member in app:
            name = safe_archive_name(member.name)
            if member.isdir():
                continue
            if name.startswith("web/dist/"):
                if not member.isfile():
                    raise VerificationError("Frontend artifacts must be regular files")
                frontend |= name == "web/dist/index.html" and member.size > 0
                if name == "web/dist/build-stamp.json":
                    stamp_raw = app.extractfile(member).read()
                    continue
                relative_path = name.removeprefix("web/dist/")
                source = app.extractfile(member)
                if relative_path == "index.html":
                    index_html = source.read()
                    digest = hashlib.sha256(index_html).hexdigest()
                else:
                    hasher = hashlib.sha256()
                    remaining = member.size
                    while remaining:
                        chunk = source.read(min(65_536, remaining))
                        if not chunk:
                            raise VerificationError(
                                "Truncated frontend artifact: " + relative_path
                            )
                        hasher.update(chunk)
                        remaining -= len(chunk)
                    digest = hasher.hexdigest()
                frontend_outputs.append({"path": relative_path, "sha256": digest})
                continue
            if member.issym():
                data = member.linkname.encode("utf-8")
                verifier.check(name, len(data), io.BytesIO(data), symlink=True)
            elif member.isfile():
                verifier.check(name, member.size, app.extractfile(member))
            else:
                raise VerificationError("Unsupported app archive member: " + name)
    if not frontend:
        raise VerificationError("Compiled frontend index is missing")
    frontend_outputs.sort(key=lambda item: item["path"])
    return verifier.finish(), stamp_raw, frontend_outputs, index_html


def _verify_runtime(stream, expected, version, package_name, algorithm):
    reader = HashReader(stream)
    python_files = {
        name.removeprefix("src/"): value
        for name, value in expected.items()
        if name.startswith("src/solaire/") and name.endswith(".py")
    }
    checked, languages = set(), set()
    metadata_ok = False
    with tarfile.open(fileobj=reader, mode="r|gz") as runtime:
        for member in runtime:
            name = safe_archive_name(member.name)
            if not member.isfile():
                continue
            installed = name.split("/site-packages/", 1)[-1]
            if installed in python_files:
                blob, size, _ = python_files[installed]
                if (
                    member.size != size
                    or blob_hash(runtime.extractfile(member), size, algorithm) != blob
                ):
                    raise VerificationError(
                        "Installed runtime source mismatch: " + installed
                    )
                checked.add(installed)
            for language in ("eng", "chi_sim"):
                if (
                    name.endswith(f"share/tessdata/{language}.traineddata")
                    and member.size > 100_000
                ):
                    languages.add(language)
            if installed == f"{package_name}-{version}.dist-info/METADATA":
                data = runtime.extractfile(member).read().decode("utf-8")
                metadata_ok = f"Version: {version}\n" in data.replace("\r\n", "\n")
    for _ in iter(lambda: reader.read(1024 * 1024), b""):
        pass
    if checked != python_files.keys():
        raise VerificationError(
            "Installed Python sources missing: "
            + ", ".join(sorted(python_files.keys() - checked)[:10])
        )
    if languages != {"eng", "chi_sim"} or not metadata_ok:
        raise VerificationError(
            "Runtime package version or OCR language data is missing"
        )
    return reader.hash.hexdigest(), len(checked)


def verify_offline_bundle(
    bundle: Path, repo: Path, ref="HEAD", *, checksum: Path | None = None
):
    commit = git(repo, "rev-parse", "--verify", ref + "^{commit}").decode().strip()
    project = tomllib.loads(
        git(repo, "show", commit + ":pyproject.toml").decode("utf-8")
    )["project"]
    version = project["version"]
    package_name = project["name"].replace("-", "_")
    checksum = checksum or Path(str(bundle) + ".sha256")
    fields = checksum.read_text(encoding="utf-8-sig").strip().split(maxsplit=1)
    outer_hash = sha256(bundle)
    if (
        len(fields) != 2
        or fields[0].lower() != outer_hash
        or fields[1].lstrip("*") != bundle.name
    ):
        raise VerificationError("Offline bundle checksum or filename mismatch")
    algorithm = git(repo, "rev-parse", "--show-object-format").decode().strip()
    expected = git_tree(repo, commit, "src", "pyproject.toml", "README.md", "LICENSE")
    ancillary = {
        "install.sh": "scripts/offline/install.sh",
        "installer.py": "scripts/offline/installer.py",
        "使用说明.md": "docs/linux-offline-install.md",
    }
    allowed = set(ancillary) | {
        "manifest.json",
        "app.tar.gz",
        "runtime.tar.gz",
        "python-dependencies.txt",
    }
    seen, calculated = set(), {}
    manifest = None
    app_count = runtime_count = 0
    stamp_raw = None
    frontend_outputs = None
    index_html = None
    with tarfile.open(bundle, "r|gz") as outer:
        for member in outer:
            safe_archive_name(member.name)
            if member.isdir():
                continue
            if not member.isfile() or "/" not in member.name:
                raise VerificationError("Invalid offline bundle member: " + member.name)
            name = member.name.split("/", 1)[1]
            if name not in allowed or name in seen:
                raise VerificationError(
                    "Unexpected or duplicate offline bundle member: " + name
                )
            seen.add(name)
            source = outer.extractfile(member)
            if name == "manifest.json":
                if member.size > 64 * 1024:
                    raise VerificationError("Offline manifest is too large")
                manifest = json.load(source)
            elif name == "app.tar.gz":
                if member.size > 256 * 1024 * 1024:
                    raise VerificationError(
                        "Application source archive is unexpectedly large"
                    )
                body = source.read()
                calculated[name] = hashlib.sha256(body).hexdigest()
                app_count, stamp_raw, frontend_outputs, index_html = _verify_app(
                    body, expected, algorithm
                )
            elif name == "runtime.tar.gz":
                calculated[name], runtime_count = _verify_runtime(
                    source, expected, version, package_name, algorithm
                )
            elif name in ancillary:
                if source.read() != git(repo, "show", commit + ":" + ancillary[name]):
                    raise VerificationError(
                        "Offline installer/document mismatch: " + name
                    )
    if seen != allowed:
        raise VerificationError(
            "Offline package members missing: " + ", ".join(sorted(allowed - seen))
        )
    if not isinstance(manifest, dict) or any(
        manifest.get(key) != value
        for key, value in {
            "format": 1,
            "version": version,
            "commit": commit,
            "arch": "x86_64",
        }.items()
    ):
        raise VerificationError(
            "Offline manifest does not match version, commit or architecture"
        )
    if manifest.get("sha256") != calculated:
        raise VerificationError("Nested application/runtime hash mismatch")

    manifest_fe = manifest.get("frontend")

    # 兼容既有格式（Legacy bundle 判别）
    if manifest_fe is None and stamp_raw is None:
        frontend_provenance = {
            "status": "unknown",
            "legacy": True,
            "reason": "Legacy bundle without frontend build stamp",
        }
    elif manifest_fe is not None and stamp_raw is None:
        raise VerificationError(
            "Frontend provenance mismatch: package manifest declared frontend metadata, but app archive lacks web/dist/build-stamp.json"
        )
    elif manifest_fe is None and stamp_raw is not None:
        raise VerificationError(
            "Frontend provenance mismatch: app archive contains web/dist/build-stamp.json, but package manifest lacks frontend metadata"
        )
    else:
        try:
            stamp = json.loads(stamp_raw.decode("utf-8"))
        except Exception as e:
            raise VerificationError(
                f"Damaged or unparseable frontend build stamp in app archive: {e}"
            ) from e

        try:
            validate_stamp_schema(stamp)
        except ValueError as e:
            raise VerificationError(f"Malformed frontend build stamp: {e}") from e

        if stamp["outputs"] != frontend_outputs:
            raise VerificationError(
                "Frontend build stamp artifacts do not match the packaged dist files"
            )
        try:
            validate_frontend_references(
                index_html, {item["path"] for item in frontend_outputs}
            )
        except (UnicodeDecodeError, ValueError) as e:
            raise VerificationError(f"Invalid frontend index resources: {e}") from e

        if not isinstance(manifest_fe, dict):
            raise VerificationError("Manifest frontend metadata must be a dictionary")

        for key in (
            "schema",
            "format_version",
            "fingerprint",
            "output_fingerprint",
            "revision",
            "git_dirty",
        ):
            if stamp.get(key) != manifest_fe.get(key):
                raise VerificationError(
                    f"Frontend {key} mismatch: archive stamp has '{stamp.get(key)}', but manifest declared '{manifest_fe.get(key)}'"
                )

        stamp_rev = stamp["revision"]
        if stamp_rev != commit:
            raise VerificationError(
                f"Frontend dist was built from revision {stamp_rev}, expected release commit {commit}"
            )

        if stamp["git_dirty"] is not False:
            raise VerificationError(
                "Frontend build sources are dirty or their Git status is unknown; they cannot be verified against the release commit"
            )

        commit_inputs = _frontend_inputs_at_commit(repo, commit)
        if stamp["inputs"] != commit_inputs:
            raise VerificationError(
                "Frontend build stamp inputs do not match the release commit's web sources"
            )

        recalculated = hashlib.sha256()
        for item in sorted(stamp["inputs"], key=lambda x: x["path"]):
            recalculated.update(f"{item['path']}:{item['sha256']}\n".encode("utf-8"))
        if recalculated.hexdigest() != stamp["fingerprint"]:
            raise VerificationError("Frontend build stamp internal fingerprint mismatch")

        frontend_provenance = {
            "status": "verified",
            "legacy": False,
            "fingerprint": stamp["fingerprint"],
            "output_fingerprint": stamp["output_fingerprint"],
            "revision": stamp.get("revision"),
            "git_dirty": stamp.get("git_dirty", False),
            "input_count": len(stamp["inputs"]),
            "output_count": len(stamp["outputs"]),
        }

    return {
        "bundle": str(bundle),
        "commit": commit,
        "version": version,
        "sha256": outer_hash,
        "bytes": bundle.stat().st_size,
        "app_sources_verified": app_count,
        "installed_python_sources_verified": runtime_count,
        "ocr_languages": ["eng", "chi_sim"],
        "frontend_provenance": frontend_provenance,
    }
