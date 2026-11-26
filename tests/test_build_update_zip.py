import shutil
import subprocess

import pytest

from solaire.web.management.update_zip import staged_update, verify_update_zip
from tools.release_verify.build_update_zip import build_update_zip


def test_build_signed_delta_applies_add_change_remove_and_retains_old_assets(tmp_path):
    if not shutil.which("openssl"):
        pytest.skip("OpenSSL not installed")
    old, new, output = (tmp_path / name for name in ("base", "candidate", "output"))
    output.mkdir()
    for root, index in ((old, "old"), (new, "new")):
        (root / "src" / "solaire" / "数学").mkdir(parents=True)
        (root / "web" / "dist" / "assets").mkdir(parents=True)
        (root / "web" / "dist" / "index.html").write_text(index)
        (root / "src" / "solaire" / "数学" / "keep.txt").write_text("same")
    removed = "src/solaire/retired.py"
    (old / removed).write_text("old code")
    (old / "secrets.env").write_text("never included")
    immutable = "web/dist/assets/main-abcdefgh.js"
    (old / immutable).write_text("existing tab")
    added = "src/solaire/数学/new.py"
    (new / added).write_text("new code")
    private_key, public_key = tmp_path / "release-key.pem", tmp_path / "public.pem"
    for args in (["genpkey", "-algorithm", "ED25519", "-out", str(private_key)],
                 ["pkey", "-in", str(private_key), "-pubout", "-out", str(public_key)]):
        subprocess.run(["openssl", *args], check=True, timeout=10)
    package = build_update_zip(old, new, "1.7.4", "1.7.5", private_key, output)
    assert package.name == "OriginReach-update-v1.7.5.zip"
    manifest = verify_update_zip(package, public_key, "1.7.4")
    assert set(manifest["files"]) == {added, "web/dist/index.html"}
    assert set(manifest["deletions"]) == {removed}
    assert manifest["base_hashes"][added] is None
    with staged_update(package, public_key, "1.7.4", old, tmp_path) as (candidate, _, changed):
        assert set(changed) == {added, removed, "web/dist/index.html"}
        assert (candidate / added).read_text() == "new code" and not (candidate / removed).exists()
        assert (candidate / immutable).read_text() == "existing tab"
        assert (candidate / "web/dist/index.html").read_text() == "new"
        assert not (candidate / "secrets.env").exists()
    assert (old / removed).read_text() == "old code"
    (old / "web/dist/index.html").write_text("locally modified")
    with pytest.raises(ValueError, match="replacement base hash"):
        with staged_update(package, public_key, "1.7.4", old, tmp_path):
            pytest.fail("must not expose a mismatched candidate")
    assert (old / removed).is_file()
    with pytest.raises(FileExistsError):
        build_update_zip(old, new, "1.7.4", "1.7.5", private_key, output)
