import os
from pathlib import Path
import shutil
import subprocess

import pytest


def test_local_upgrade_passes_only_adjacent_release_files(tmp_path):
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash unavailable")
    source = Path(__file__).parents[1] / "scripts/upgrade-local.sh"
    assert source.is_file(), "Local upgrade entry must be included in the delivery"
    package = tmp_path / "update with spaces"
    package.mkdir()
    shutil.copyfile(source, package / "update.sh")
    (package / "release.json").write_text('{}', encoding='utf-8')
    (package / "educationhelper-source.tar.gz").write_bytes(b'test-only')
    (package / "upgrade-linux.sh").write_text(
        'set -eu\n[[ -f "$EH_MANIFEST_FILE" ]]\n[[ -f "$EH_ARCHIVE_FILE" ]]\n'
        'printf "local-files-ok\\n"\n', encoding='utf-8')
    path = (package / 'update.sh').as_posix()
    if os.name == 'nt':
        path = '/' + path[0].lower() + path[2:]
    result = subprocess.run([bash, path], text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert 'local-files-ok' in result.stdout


def test_local_update_refuses_missing_installation_without_bootstrap(tmp_path):
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash unavailable")
    script = Path(__file__).parents[1] / 'scripts/upgrade-linux.sh'
    # Use an existing malformed current link substitute to ensure a fast offline failure.
    env = {**os.environ, 'EH_APP_BASE': tmp_path.as_posix(),
           'EH_ARCHIVE_FILE': 'local-source.tar.gz', 'EH_MANIFEST_FILE': 'release.json'}
    path = script.as_posix()
    if os.name == 'nt':
        path = '/' + path[0].lower() + path[2:]
    result = subprocess.run([bash, path], env=env, text=True, capture_output=True, timeout=5)
    assert result.returncode != 0
    assert 'Local upgrade requires an existing installation' in result.stderr
