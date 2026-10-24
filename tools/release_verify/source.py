"""Streaming archive-to-Git verification derived from the 1.6.7 delivery checks."""

from __future__ import annotations

import hashlib
import io
import subprocess
import tarfile
import zipfile
from pathlib import Path, PurePosixPath


class VerificationError(ValueError):
    pass


def git(repo: Path, *args: str) -> bytes:
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], stderr=subprocess.PIPE
    )


def git_tree(repo: Path, ref: str, *paths: str):
    expected = {}
    for item in git(repo, "ls-tree", "-r", "-l", "-z", ref, "--", *paths).split(b"\0"):
        if not item:
            continue
        metadata, path = item.split(b"\t", 1)
        mode, kind, blob, size = metadata.split()
        if kind != b"blob":
            raise VerificationError(
                "Source archives with submodules require a separate submodule check"
            )
        expected[path.decode("utf-8")] = (blob.decode(), int(size), mode.decode())
    return expected


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_archive_name(name: str) -> str:
    if "\\" in name or "\0" in name:
        raise VerificationError(f"Unsafe archive member: {name!r}")
    path = PurePosixPath(name)
    if (
        path.is_absolute()
        or ".." in path.parts
        or (path.parts and ":" in path.parts[0])
    ):
        raise VerificationError(f"Unsafe archive member: {name!r}")
    return str(path)


def blob_hash(stream, size: int, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    digest.update(f"blob {size}\0".encode())
    consumed = 0
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        consumed += len(chunk)
        if consumed > size:
            raise VerificationError("Archive member exceeds the size recorded in Git")
        digest.update(chunk)
    if consumed != size:
        raise VerificationError("Truncated archive member")
    return digest.hexdigest()


class TreeVerifier:
    def __init__(self, expected, *, algorithm="sha1", strip_prefix=False):
        self.expected, self.algorithm = expected, algorithm
        self.strip_prefix = strip_prefix
        self.prefix = None
        self.seen = set()

    def check(self, name, size, stream, *, symlink=False):
        name = safe_archive_name(name)
        if self.strip_prefix and self.prefix is None:
            if name in self.expected:
                self.prefix = ""
            elif "/" in name and name.split("/", 1)[1] in self.expected:
                self.prefix = name.split("/", 1)[0] + "/"
            else:
                raise VerificationError(f"Unexpected source file: {name}")
        if self.prefix:
            if not name.startswith(self.prefix):
                raise VerificationError("Inconsistent archive root directory")
            name = name[len(self.prefix) :]
        if name in self.seen:
            raise VerificationError(f"Duplicate archive member: {name}")
        if name not in self.expected:
            raise VerificationError(f"Unexpected source file: {name}")
        blob, expected_size, mode = self.expected[name]
        if size != expected_size or symlink != (mode == "120000"):
            raise VerificationError(f"Source size/type mismatch: {name}")
        if blob_hash(stream, size, self.algorithm) != blob:
            raise VerificationError(f"Source content mismatch: {name}")
        self.seen.add(name)

    def finish(self):
        missing = self.expected.keys() - self.seen
        if missing:
            raise VerificationError(
                "Missing source files: " + ", ".join(sorted(missing)[:10])
            )
        return len(self.seen)


def verify_source_archive(archive: Path, repo: Path, ref="HEAD") -> dict:
    """Compare tracked bytes without extracting any untrusted archive paths."""
    commit = git(repo, "rev-parse", "--verify", ref + "^{commit}").decode().strip()
    algorithm = git(repo, "rev-parse", "--show-object-format").decode().strip()
    verifier = TreeVerifier(
        git_tree(repo, commit), algorithm=algorithm, strip_prefix=True
    )
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                safe_archive_name(member.filename)
                if not member.is_dir():
                    symlink = (member.external_attr >> 16) & 0o170000 == 0o120000
                    with source.open(member) as stream:
                        verifier.check(
                            member.filename, member.file_size, stream, symlink=symlink
                        )
    else:
        with tarfile.open(archive, "r|*") as source:
            for member in source:
                safe_archive_name(member.name)
                if member.isdir():
                    continue
                if member.issym():
                    body = member.linkname.encode("utf-8")
                    verifier.check(
                        member.name, len(body), io.BytesIO(body), symlink=True
                    )
                elif member.isfile():
                    verifier.check(member.name, member.size, source.extractfile(member))
                else:
                    raise VerificationError(
                        f"Unsupported archive member: {member.name}"
                    )
    return {
        "archive": str(archive),
        "commit": commit,
        "source_files_verified": verifier.finish(),
        "sha256": sha256(archive),
        "bytes": archive.stat().st_size,
    }
