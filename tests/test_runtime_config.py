import os

import pytest

from solaire.common.runtime_config import load_runtime_config


def test_file_loads_known_keys_without_replacing_process_environment(tmp_path, monkeypatch):
    monkeypatch.setattr(os, 'environ', dict(os.environ))
    config = tmp_path / 'educationhelper.env'
    config.write_text('EH_PROXY_HOSTS=example.com\nSOLAIRE_LLM_MODEL="example-model"\n', encoding='utf-8')
    monkeypatch.setenv('EH_CONFIG_FILE', str(config))
    monkeypatch.setenv('EH_PROXY_HOSTS', 'override.example')
    load_runtime_config()
    assert os.environ['EH_PROXY_HOSTS'] == 'override.example'
    assert os.environ['SOLAIRE_LLM_MODEL'] == 'example-model'


def test_file_rejects_commands_and_unknown_keys(tmp_path, monkeypatch):
    monkeypatch.setattr(os, 'environ', dict(os.environ))
    config = tmp_path / 'educationhelper.env'
    config.write_text('PATH=/evil\n', encoding='utf-8')
    monkeypatch.setenv('EH_CONFIG_FILE', str(config))
    with pytest.raises(RuntimeError, match='配置名无效'):
        load_runtime_config()
