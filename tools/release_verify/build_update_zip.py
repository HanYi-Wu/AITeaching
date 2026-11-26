"""Build a signed OriginReach ZIP delta from two trusted, built release trees."""

from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path

from solaire.web.management.update_sources import MAX_UPDATE_DOWNLOAD_BYTES
from solaire.web.management.update_zip import _VERSION, _path_allowed, file_sha256, immutable_update_asset, verify_update_zip


def inventory(root: Path) -> dict[str, str]:
    root = root.resolve(strict=True)
    files: dict[str, str] = {}

    def crawl(path: Path):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError(f"Release tree contains a link: {path.name}")
        if stat.S_ISDIR(info.st_mode):
            for item in sorted(path.iterdir()):
                if item.name not in {"__pycache__"} and not item.name.startswith("."):
                    crawl(item)
            return
        name = path.relative_to(root).as_posix()
        if not stat.S_ISREG(info.st_mode) or not _path_allowed(name):
            raise ValueError(f"Unsupported release file: {name}")
        files[name] = file_sha256(path)

    for name in ("src/solaire", "web/dist"):
        directory = root / name
        if directory.resolve(strict=True) != directory or not directory.is_dir():
            raise ValueError(f"Missing or linked release directory: {name}")
        crawl(directory)
    if len({name.casefold() for name in files}) != len(files):
        raise ValueError("Release files conflict on a case-insensitive filesystem")
    return files


def build_update_zip(base: Path, candidate: Path, base_version: str, version: str,
                     private_key: Path, output: Path) -> Path:
    if not _VERSION.fullmatch(base_version) or not _VERSION.fullmatch(version):
        raise ValueError("Expected stable semantic versions")
    base, candidate = base.resolve(strict=True), candidate.resolve(strict=True)
    private_key = private_key.resolve(strict=True)
    output = output.resolve(strict=True)
    if base == candidate or any(output.is_relative_to(root) or private_key.is_relative_to(root) for root in (base, candidate)):
        raise ValueError("The release trees must be distinct and must not contain the signing key or output")
    old, new = inventory(base), inventory(candidate)
    changed = {name: digest for name, digest in new.items() if old.get(name) != digest}
    if any(name in old and immutable_update_asset(name) for name in changed):
        raise ValueError("New frontend content must not reuse an existing immutable URL")
    removals = {name: digest for name, digest in old.items() if name not in new and not immutable_update_asset(name)}
    manifest = {"schema": 1, "base": base_version, "version": version, "files": changed,
                "base_hashes": {name: old.get(name) for name in changed}, "deletions": removals}
    target = output / f"OriginReach-update-v{version}.zip"
    if target.exists():
        raise FileExistsError("Refusing to overwrite a previously built version")
    with tempfile.TemporaryDirectory(dir=output, prefix=".eh-sign-") as temporary:
        temp = Path(temporary)
        metadata = temp / "manifest.json"
        signature = temp / "manifest.sig"
        public_key = temp / "verification.pem"
        metadata.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")), encoding="utf-8")
        subprocess.run(["openssl", "pkeyutl", "-sign", "-inkey", str(private_key), "-rawin", "-in", str(metadata),
                        "-out", str(signature)], check=True, timeout=15, stdin=subprocess.DEVNULL)
        subprocess.run(["openssl", "pkey", "-in", str(private_key), "-pubout", "-out", str(public_key)],
                       check=True, timeout=15, stdin=subprocess.DEVNULL)
        staged = temp / "release.zip"
        with zipfile.ZipFile(staged, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            bundle.write(metadata, "manifest.json")
            bundle.write(signature, "manifest.sig")
            for name in sorted(changed):
                bundle.write(candidate / name, name)
        if staged.stat().st_size > MAX_UPDATE_DOWNLOAD_BYTES:
            raise ValueError("ZIP delta exceeds the update inbox limit; use a full offline installation")
        verify_update_zip(staged, public_key, base_version)
        # Same filesystem: publish a fully verified file without overwriting.
        os.link(staged, target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("base", "candidate", "private-key", "output"):
        parser.add_argument(f"--{flag}", type=Path, required=True)
    parser.add_argument("--base-version", required=True)
    parser.add_argument("--version", required=True)
    print(build_update_zip(**vars(parser.parse_args())))


if __name__ == "__main__":
    main()
