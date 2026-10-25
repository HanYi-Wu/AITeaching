"""Exercise the real release guard with a local Git stub and no network."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml


@pytest.mark.parametrize("tag_commit,fetch_result,expected", [("a" * 40, 0, 0), ("b" * 40, 0, 1), ("a" * 40, 1, 1)])
def test_release_tag_must_match_build_before_upload(tmp_path, tag_commit, fetch_result, expected):
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash unavailable")
    root = Path(__file__).parents[1]
    workflow = yaml.safe_load((root / ".github/workflows/linux-offline.yml").read_text(encoding="utf-8"))
    step = next(step for step in workflow["jobs"]["build"]["steps"] if step.get("name") == "Protect existing release tag")
    (tmp_path / "pyproject.toml").write_bytes(b'version = "1.6.7"\n')
    stub = '''git() {
      if [ "$1" = fetch ]; then return "$MOCK_FETCH_RESULT"; fi
      if [ "$1" = rev-parse ]; then printf '%s\\n' "$MOCK_TAG_COMMIT"; return 0; fi
      return 99
    }
    '''
    env = dict(os.environ, GITHUB_REF_NAME="upgrade/core", GITHUB_REF_TYPE="branch", GITHUB_SHA="a" * 40, MOCK_TAG_COMMIT=tag_commit, MOCK_FETCH_RESULT=str(fetch_result))
    result = subprocess.run([bash], input=stub + step["run"], cwd=tmp_path, env=env, text=True, encoding="utf-8", capture_output=True, timeout=10)
    assert result.returncode == expected, result.stdout + result.stderr
    if tag_commit != "a" * 40:
        assert "Refusing to replace" in result.stdout
