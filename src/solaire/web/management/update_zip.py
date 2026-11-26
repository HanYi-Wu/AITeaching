"""Verify and stage signed application updates without executing their contents."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import stat
import subprocess
import tempfile
import unicodedata
import zipfile
from contextlib import contextmanager
from pathlib import Path

_VERSION = re.compile(r"[0-9]{1,8}(?:\.[0-9]{1,8}){2}")
_COMPONENT = re.compile(r"\w[\w.-]{0,127}")
_PRIVATE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".pfx", ".p12"}
_MAX_BYTES = 2 * 1024**3


def _path_allowed(path: str) -> bool:
    parts = path.split("/")
    return (len(parts) >= 3 and len(path.encode("utf-8")) <= 240 and unicodedata.normalize("NFC", path) == path
            and (path.startswith("src/solaire/") or path.startswith("web/dist/"))
            and Path(parts[-1]).suffix.lower() not in _PRIVATE_SUFFIXES
            and all(_COMPONENT.fullmatch(part) and not part.endswith(".")
                    and part.split(".", 1)[0].upper() not in
                    {"CON", "PRN", "AUX", "NUL", *(f"{prefix}{i}" for prefix in ("COM", "LPT") for i in range(10))}
                    for part in parts))


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate manifest key")
        result[key] = value
    return result


def file_sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def immutable_update_asset(name: str) -> bool:
    return name.startswith("web/dist/assets/") and bool(re.search(r"-[\w-]{8,}\.", Path(name).name))


def _valid_digest(value) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _verify_signature(manifest: bytes, signature: bytes, public_key: Path) -> None:
    # The key comes from trusted host configuration, never the uploaded ZIP.
    with tempfile.TemporaryDirectory(prefix="eh-update-verify-") as tmp:
        manifest_file = Path(tmp) / "manifest"
        signature_file = Path(tmp) / "signature"
        manifest_file.write_bytes(manifest)
        signature_file.write_bytes(signature)
        process = subprocess.run(
            ["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(public_key.resolve()),
             "-rawin", "-in", str(manifest_file), "-sigfile", str(signature_file)],
            capture_output=True, timeout=10, check=False,
        )
        if process.returncode != 0:
            raise ValueError("Invalid update signature")


def verify_update_zip(archive: Path, public_key: Path, installed_version: str) -> dict:
    return _verify_update_zip(archive, public_key, installed_version)


def _verify_update_zip(archive: Path, public_key: Path, installed_version: str,
                       candidate: Path | None = None, changed: list[str] | None = None) -> dict:
    if archive.stat().st_size > _MAX_BYTES:
        raise ValueError("Update archive is too large")
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        names = {entry.filename for entry in entries}
        if (len(names) != len(entries) or len(entries) > 20000
                or len({name.casefold() for name in names}) != len(names)
                or sum(entry.file_size for entry in entries) > _MAX_BYTES):
            raise ValueError("Duplicate entries or package limits exceeded")
        for entry in entries:
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if entry.is_dir() or mode not in (0, stat.S_IFREG) or entry.flag_bits & 1:
                raise ValueError("Update package contains a non-regular file")
        for name, maximum in (("manifest.json", 4_000_000), ("manifest.sig", 64)):
            if name not in names or not 0 < bundle.getinfo(name).file_size <= maximum:
                raise ValueError("Invalid update metadata size")
        raw = bundle.read("manifest.json")
        signature = bundle.read("manifest.sig")
        if len(signature) != 64:
            raise ValueError("Expected an Ed25519 signature")
        _verify_signature(raw, signature, public_key)
        manifest = json.loads(raw, object_pairs_hook=_unique_json)
        required = {"schema", "base", "version", "files"}
        if (not isinstance(manifest, dict) or not required <= manifest.keys()
                or manifest.keys() - required - {"deletions", "base_hashes"} or type(manifest.get("schema")) is not int or manifest["schema"] != 1):
            raise ValueError("Unsupported update manifest")
        base, version = manifest["base"], manifest["version"]
        if (not isinstance(base, str) or not isinstance(version, str)
                or not _VERSION.fullmatch(base) or not _VERSION.fullmatch(version)
                or base != installed_version or tuple(map(int, version.split("."))) <= tuple(map(int, base.split(".")))):
            raise ValueError("Incompatible update version")
        files = manifest["files"]
        deletions = manifest.get("deletions", {})
        base_hashes = manifest.get("base_hashes")
        if (not isinstance(files, dict) or not isinstance(deletions, dict) or not (files or deletions)
                or len(files) + len(deletions) > 20000 or names != {*files, "manifest.json", "manifest.sig"}):
            raise ValueError("Update file list does not match manifest")
        if base_hashes is not None and (not isinstance(base_hashes, dict) or base_hashes.keys() != files.keys()
                                        or any(value is not None and not _valid_digest(value) for value in base_hashes.values())):
            raise ValueError("Invalid update base hashes")
        overlap = {name.casefold() for name in files} & {name.casefold() for name in deletions}
        if overlap or len({name.casefold() for name in deletions}) != len(deletions):
            raise ValueError("Update deletion conflicts with another signed path")
        for name, digest in deletions.items():
            if not _path_allowed(name) or immutable_update_asset(name) or not _valid_digest(digest):
                raise ValueError("Invalid update deletion path or digest")
            if candidate is not None:
                target = candidate / name
                if not target.is_file() or file_sha256(target) != digest:
                    raise ValueError("Installed file does not match signed deletion base hash")
        if candidate is not None:
            for name in deletions:
                (candidate / name).unlink()
                if changed is not None:
                    changed.append(name)
        folded = {name.casefold() for name in files}
        for name, digest in files.items():
            if not _path_allowed(name) or not _valid_digest(digest):
                raise ValueError("Invalid update path or digest")
            if any("/".join(name.split("/")[:i]).casefold() in folded for i in range(1, name.count("/") + 1)):
                raise ValueError("Update file shadows a parent directory")
            with bundle.open(name) as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                    raise ValueError("Update payload hash mismatch")
            if candidate is not None:
                target = candidate / name
                old_hash = file_sha256(target) if target.is_file() else None
                if base_hashes is not None and old_hash != base_hashes[name]:
                    raise ValueError("Installed file does not match signed replacement base hash")
                if old_hash == digest:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                # Verify the actual staged bytes as well, so a concurrently
                # modified input archive cannot change what the candidate runs.
                with bundle.open(name) as stream, target.open("wb") as output:
                    shutil.copyfileobj(stream, output, length=1024 * 1024)
                with target.open("rb") as staged:
                    if hashlib.file_digest(staged, "sha256").hexdigest() != digest:
                        raise ValueError("Staged payload hash mismatch")
                if changed is not None:
                    changed.append(name)
    return manifest


def _copy_release_tree(source: Path, destination: Path) -> None:
    metadata = source.lstat()
    if source.is_symlink() or getattr(metadata, "st_file_attributes", 0) & 0x400:
        raise ValueError("Installed release contains a link or reparse point")
    if stat.S_ISDIR(metadata.st_mode):
        destination.mkdir()
        for child in source.iterdir():
            if child.name != "__pycache__":
                _copy_release_tree(child, destination / child.name)
    elif stat.S_ISREG(metadata.st_mode):
        shutil.copy2(source, destination)
    else:
        raise ValueError("Installed release contains a special file")


@contextmanager
def staged_update(archive: Path, public_key: Path, installed_version: str,
                  active_release: Path, staging_parent: Path, *, frontend_source: Path | None = None,
                  backend_source: Path | None = None):
    """Stage code and build assets only; never copy live project data/config.

    active_release and staging_parent are trusted deployment paths. The caller
    may move the candidate into a versioned release store after smoke checks.
    """
    active = active_release.resolve(strict=True)
    parent = staging_parent.resolve(strict=True)
    if parent.is_relative_to(active):
        raise ValueError("Staging must not write inside the active release")
    with tempfile.TemporaryDirectory(prefix="eh-candidate-", dir=parent) as temp:
        candidate = Path(temp) / "release"
        candidate.mkdir()
        _copy_release_tree((backend_source or active) / "src", candidate / "src")
        # Validate and copy the intermediate web directory without traversing
        # an intermediate junction or link to a different filesystem tree.
        web = active / "web"
        web_stat = web.lstat()
        if not stat.S_ISDIR(web_stat.st_mode) or getattr(web_stat, "st_file_attributes", 0) & 0x400:
            raise ValueError("Invalid installed web directory")
        (candidate / "web").mkdir()
        _copy_release_tree(frontend_source or (web / "dist"), candidate / "web" / "dist")
        changed: list[str] = []
        manifest = _verify_update_zip(archive, public_key, installed_version, candidate, changed)
        for name in changed:
            if not name.startswith("web/dist/") or name.endswith((".br", ".gz")):
                continue
            for suffix in (".br", ".gz"):
                if name + suffix not in manifest["files"]:
                    (candidate / (name + suffix)).unlink(missing_ok=True)
        yield candidate, manifest, tuple(changed)
