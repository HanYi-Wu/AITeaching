"""Delivery verification checks Git bytes, archive shape and unsafe members."""

import io
import subprocess
import tarfile
import zipfile

import pytest

from tools.release_verify.source import VerificationError, verify_source_archive


@pytest.fixture
def source_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "中文.txt").write_bytes("校验源码\n".encode("utf-8"))
    (repo / "bytes.bin").write_bytes(bytes(range(256)))
    subprocess.run(["git", "init", "-q", str(repo)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "config", "core.autocrlf", "false"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=Verification Test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", "commit", "-qm", "fixture"], check=True, capture_output=True)
    return repo


@pytest.mark.parametrize("format,extension,prefix", [("zip", "zip", ""), ("zip", "zip", "project/"), ("tar.gz", "tar.gz", "project/")])
def test_git_archives_with_or_without_wrapper_match_commit(source_repo, tmp_path, format, extension, prefix):
    archive = tmp_path / ("source." + extension)
    subprocess.run(["git", "-C", str(source_repo), "archive", "--format=" + format, "--prefix=" + prefix, "--output=" + str(archive), "HEAD"], check=True, capture_output=True)
    assert verify_source_archive(archive, source_repo)["source_files_verified"] == 2


@pytest.mark.parametrize("change", ["tamper", "missing", "extra", "duplicate", "traversal"])
def test_modified_or_unsafe_archive_is_rejected(source_repo, tmp_path, change):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("project/中文.txt", "changed\n" if change == "tamper" else "校验源码\n")
        if change != "missing":
            output.writestr("project/bytes.bin", bytes(range(256)))
        if change == "extra":
            output.writestr("project/private.env", "not tracked")
        if change == "duplicate":
            output.writestr("project/bytes.bin", bytes(range(256)))
        if change == "traversal":
            output.writestr("project/../escape.txt", "escape")
    with pytest.raises(VerificationError):
        verify_source_archive(archive, source_repo)
    assert not (tmp_path / "escape.txt").exists()


def test_tar_hardlink_is_rejected_without_extracting(source_repo, tmp_path):
    archive = tmp_path / "link.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        link = tarfile.TarInfo("project/bytes.bin")
        link.type, link.linkname = tarfile.LNKTYPE, "../../outside"
        output.addfile(link)
    with pytest.raises(VerificationError):
        verify_source_archive(archive, source_repo)
