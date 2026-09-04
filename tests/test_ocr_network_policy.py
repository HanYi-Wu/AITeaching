from pathlib import Path
import asyncio
from types import SimpleNamespace

import pytest
from PIL import Image

from solaire.agent_layer.attachments import extract_attachment
from solaire.agent_layer import ocr
from solaire.common.network import ai_http_options


def test_proxy_is_opt_in_and_never_used_for_local_hosts(monkeypatch):
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:1')
    monkeypatch.setenv('EH_EXTERNAL_PROXY_URL', 'http://192.168.0.4:7890')
    monkeypatch.setenv('EH_PROXY_HOSTS', 'api.openai.com,localhost,192.168.0.8')
    assert ai_http_options('https://api.deepseek.com') == {'trust_env': False}
    assert ai_http_options('https://api.openai.com')['proxy'].endswith(':7890')
    for url in ('http://localhost', 'http://192.168.0.8', 'https://api.openai.com.evil.test'):
        assert ai_http_options(url) == {'trust_env': False}


def test_image_attachment_uses_real_ocr_path(tmp_path, monkeypatch):
    path = tmp_path / 'page.png'
    Image.new('RGB', (100, 50), 'white').save(path)
    monkeypatch.setattr(ocr, 'resolve_exe', lambda *args: 'tesseract')
    calls = []
    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout='实际识别内容', stderr='')
    monkeypatch.setattr(ocr.subprocess, 'run', run)
    result = extract_attachment(path)
    assert result.content == '实际识别内容'
    assert not result.truncated
    assert result.metadata['engine'] == 'tesseract'
    assert calls[0][0][-2:] == ['-l', 'chi_sim+eng']
    assert calls[0][1]['timeout'] == 60


def test_missing_ocr_is_actionable(tmp_path, monkeypatch):
    path = tmp_path / 'page.png'
    path.write_bytes(b'image')
    monkeypatch.setattr(ocr, 'resolve_exe', lambda *args: None)
    result = extract_attachment(path)
    assert result.error_code == 'ocr_required'
    assert 'install-ocr-ubuntu.sh' in result.suggestion


def test_ocr_rejects_bad_language_and_corrupt_image(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr, 'resolve_exe', lambda *args: 'tesseract')
    path = tmp_path / 'page.png'
    path.write_bytes(b'bad')
    with pytest.raises(ValueError):
        ocr.extract_image_text(path, lang='--help')
    assert extract_attachment(path).error_code == 'ocr_failed'


def test_sdk_effective_env_url_is_used_for_network_policy(monkeypatch):
    from solaire.agent_layer.llm import openai_compat, openai_responses, anthropic_messages
    for module, adapter, env_key in (
        (openai_compat, openai_compat.OpenAICompatAdapter, 'OPENAI_BASE_URL'),
        (openai_responses, openai_responses.OpenAIResponsesAdapter, 'OPENAI_BASE_URL'),
        (anthropic_messages, anthropic_messages.AnthropicMessagesAdapter, 'ANTHROPIC_BASE_URL'),
    ):
        seen = []
        monkeypatch.setenv(env_key, 'http://localhost:11434/v1')
        monkeypatch.setattr(module, 'ai_http_options', lambda url: seen.append(url) or {'trust_env': False})
        instance = adapter(api_key='test-not-real', base_url=None, model='test')
        assert seen == ['http://localhost:11434/v1']
        assert str(instance._client.base_url).startswith(seen[0])
        asyncio.run(instance._client.close())


def test_installed_ocr_can_read_generated_printed_text(tmp_path):
    from PIL import ImageDraw, ImageFont
    if not ocr.resolve_exe('tesseract', 'tesseract'):
        pytest.skip('Tesseract not installed on this test host')
    image = Image.new('RGB', (700, 160), 'white')
    try:
        font = ImageFont.truetype('arial.ttf', 42)
    except OSError:
        font = ImageFont.load_default(size=42)
    ImageDraw.Draw(image).text((30, 40), 'EducationHelper 12345', fill='black', font=font)
    path = tmp_path / 'printed.png'
    image.save(path)
    assert '12345' in ocr.extract_image_text(path, lang='eng')
