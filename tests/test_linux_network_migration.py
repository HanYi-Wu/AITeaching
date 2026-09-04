from pathlib import Path
import os
import shutil
import subprocess
import pytest


def test_migration_removes_global_proxies_preserving_credentials(tmp_path):
    bash = shutil.which('bash')
    if not bash:
        pytest.skip('bash is not installed')
    script = (Path(__file__).parents[1] / 'scripts/upgrade-linux.sh').read_text(encoding='utf-8')
    block = script.split('runtime_env_file="$CONFIG_DIR/educationhelper.env"', 1)[1].split('tmp_dir="$(mktemp -d)"', 1)[0]
    config = tmp_path / 'educationhelper.env'
    config.write_text('HTTP_PROXY=http://192.168.0.4:7890\nhttps_proxy=http://192.168.0.4:7890\nALL_PROXY=http://192.168.0.4:7890\nSOLAIRE_CONTROL_TOKEN=keep-test-only\nEH_PROXY_HOSTS=api.openai.com\n', encoding='utf-8')
    path = config.as_posix()
    if os.name == 'nt':
        path = '/' + path[0].lower() + path[2:]
    result = subprocess.run([bash], input='set -euo pipefail\nsudo_cmd=()\nRUNTIME_PROXY_URL=""\nlog() { :; }\nruntime_env_file="' + path + '"\n' + block,
                            text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    text = config.read_text()
    assert '192.168.0.4' not in text
    assert 'SOLAIRE_CONTROL_TOKEN=keep-test-only' in text
    assert 'EH_PROXY_HOSTS=api.openai.com' in text
    assert Path(str(config) + '.before-network-migration').exists()
