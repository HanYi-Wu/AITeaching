import hashlib
import json
import shutil
import subprocess
import zipfile

import pytest

from solaire.web.management.update_zip import staged_update, verify_update_zip


@pytest.mark.parametrize("path, payload, accepted", [
    ("src/solaire/example.py", b"original", True),
    ("src/solaire/example.py", b"modified", False),
    ("src/../data/config", b"original", False),
])
def test_update_zip_signed_payload(tmp_path, path, payload, accepted):
    if not shutil.which("openssl"):
        pytest.skip("OpenSSL not installed")
    manifest = {"schema": 1, "base": "1.7.4", "version": "1.7.5",
                "files": {path: hashlib.sha256(b"original").hexdigest()}}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for args in (
        ["genpkey", "-algorithm", "ED25519", "-out", "private.pem"],
        ["pkey", "-in", "private.pem", "-pubout", "-out", "public.pem"],
        ["pkeyutl", "-sign", "-inkey", "private.pem", "-rawin", "-in", "manifest.json", "-out", "manifest.sig"],
    ):
        subprocess.run(["openssl", *args], cwd=tmp_path, check=True, timeout=10)
    archive = tmp_path / "update.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        for name in ("manifest.json", "manifest.sig"):
            bundle.write(tmp_path / name, name)
        bundle.writestr(path, payload)
    if accepted:
        assert verify_update_zip(archive, tmp_path / "public.pem", "1.7.4") == manifest
        with pytest.raises(ValueError, match="Incompatible"):
            verify_update_zip(archive, tmp_path / "public.pem", "1.7.3")
        active = tmp_path / "active"
        (active / "src" / "solaire").mkdir(parents=True)
        (active / "web" / "dist").mkdir(parents=True)
        (active / "web" / "dist" / "index.html").write_text("unchanged")
        (active / "production.sqlite3").write_bytes(b"must not copy")
        (active / path).write_bytes(b"old")
        with staged_update(archive, tmp_path / "public.pem", "1.7.4", active, tmp_path) as (candidate, metadata, changed):
            assert metadata == manifest
            assert changed == (path,)
            assert (candidate / path).read_bytes() == b"original"
            assert (active / path).read_bytes() == b"old"
            assert (candidate / "web" / "dist" / "index.html").read_text() == "unchanged"
            assert not (candidate / "production.sqlite3").exists()
        assert not candidate.exists()
        (active / path).write_bytes(payload)
        with staged_update(archive, tmp_path / "public.pem", "1.7.4", active, tmp_path) as (_, _, changed):
            assert changed == ()
    else:
        with pytest.raises(ValueError):
            verify_update_zip(archive, tmp_path / "public.pem", "1.7.4")
