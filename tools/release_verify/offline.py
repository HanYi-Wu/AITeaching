"""Version-independent offline bundle checks adapted from 1.6.7 acceptance."""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
import tomllib
from pathlib import Path

from .source import TreeVerifier, VerificationError, blob_hash, git, git_tree, safe_archive_name, sha256


class HashReader:
    def __init__(self, source):
        self.source = source
        self.hash = hashlib.sha256()

    def read(self, size=-1):
        body = self.source.read(size)
        self.hash.update(body)
        return body


def _verify_app(body, expected, algorithm):
    verifier = TreeVerifier(expected, algorithm=algorithm)
    frontend = False
    with tarfile.open(fileobj=io.BytesIO(body), mode="r|gz") as app:
        for member in app:
            name = safe_archive_name(member.name)
            if member.isdir():
                continue
            if name.startswith("web/dist/"):
                if not member.isfile():
                    raise VerificationError("Frontend artifacts must be regular files")
                frontend |= name == "web/dist/index.html" and member.size > 0
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
    return verifier.finish()


def _verify_runtime(stream, expected, version, package_name, algorithm):
    reader = HashReader(stream)
    python_files = {name.removeprefix("src/"): value for name, value in expected.items() if name.startswith("src/solaire/") and name.endswith(".py")}
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
                if member.size != size or blob_hash(runtime.extractfile(member), size, algorithm) != blob:
                    raise VerificationError("Installed runtime source mismatch: " + installed)
                checked.add(installed)
            for language in ("eng", "chi_sim"):
                if name.endswith(f"share/tessdata/{language}.traineddata") and member.size > 100_000:
                    languages.add(language)
            if installed == f"{package_name}-{version}.dist-info/METADATA":
                data = runtime.extractfile(member).read().decode("utf-8")
                metadata_ok = f"Version: {version}\n" in data.replace("\r\n", "\n")
    for _ in iter(lambda: reader.read(1024 * 1024), b""):
        pass
    if checked != python_files.keys():
        raise VerificationError("Installed Python sources missing: " + ", ".join(sorted(python_files.keys() - checked)[:10]))
    if languages != {"eng", "chi_sim"} or not metadata_ok:
        raise VerificationError("Runtime package version or OCR language data is missing")
    return reader.hash.hexdigest(), len(checked)


def verify_offline_bundle(bundle: Path, repo: Path, ref="HEAD", *, checksum: Path | None = None):
    commit = git(repo, "rev-parse", "--verify", ref + "^{commit}").decode().strip()
    project = tomllib.loads(git(repo, "show", commit + ":pyproject.toml").decode("utf-8"))["project"]
    version = project["version"]
    package_name = project["name"].replace("-", "_")
    checksum = checksum or Path(str(bundle) + ".sha256")
    fields = checksum.read_text(encoding="utf-8-sig").strip().split(maxsplit=1)
    outer_hash = sha256(bundle)
    if len(fields) != 2 or fields[0].lower() != outer_hash or fields[1].lstrip("*") != bundle.name:
        raise VerificationError("Offline bundle checksum or filename mismatch")
    algorithm = git(repo, "rev-parse", "--show-object-format").decode().strip()
    expected = git_tree(repo, commit, "src", "pyproject.toml", "README.md", "LICENSE")
    ancillary = {
        "install.sh": "scripts/offline/install.sh",
        "installer.py": "scripts/offline/installer.py",
        "使用说明.md": "docs/linux-offline-install.md",
    }
    allowed = set(ancillary) | {"manifest.json", "app.tar.gz", "runtime.tar.gz", "python-dependencies.txt"}
    seen, calculated = set(), {}
    manifest = None
    app_count = runtime_count = 0
    with tarfile.open(bundle, "r|gz") as outer:
        for member in outer:
            safe_archive_name(member.name)
            if member.isdir():
                continue
            if not member.isfile() or "/" not in member.name:
                raise VerificationError("Invalid offline bundle member: " + member.name)
            name = member.name.split("/", 1)[1]
            if name not in allowed or name in seen:
                raise VerificationError("Unexpected or duplicate offline bundle member: " + name)
            seen.add(name)
            source = outer.extractfile(member)
            if name == "manifest.json":
                if member.size > 64 * 1024:
                    raise VerificationError("Offline manifest is too large")
                manifest = json.load(source)
            elif name == "app.tar.gz":
                if member.size > 256 * 1024 * 1024:
                    raise VerificationError("Application source archive is unexpectedly large")
                body = source.read()
                calculated[name] = hashlib.sha256(body).hexdigest()
                app_count = _verify_app(body, expected, algorithm)
            elif name == "runtime.tar.gz":
                calculated[name], runtime_count = _verify_runtime(source, expected, version, package_name, algorithm)
            elif name in ancillary:
                if source.read() != git(repo, "show", commit + ":" + ancillary[name]):
                    raise VerificationError("Offline installer/document mismatch: " + name)
    if seen != allowed:
        raise VerificationError("Offline package members missing: " + ", ".join(sorted(allowed - seen)))
    if not isinstance(manifest, dict) or any(manifest.get(key) != value for key, value in {"format": 1, "version": version, "commit": commit, "arch": "x86_64"}.items()):
        raise VerificationError("Offline manifest does not match version, commit or architecture")
    if manifest.get("sha256") != calculated:
        raise VerificationError("Nested application/runtime hash mismatch")
    return {"bundle": str(bundle), "commit": commit, "version": version, "sha256": outer_hash, "bytes": bundle.stat().st_size, "app_sources_verified": app_count, "installed_python_sources_verified": runtime_count, "ocr_languages": ["eng", "chi_sim"]}
