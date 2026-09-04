"""Bounded, offline image text extraction shared by attachments and AI tools."""
from pathlib import Path
import re
import subprocess
import tempfile

from PIL import Image, ImageOps
from solaire.web.extension_registry import resolve_exe

INSTALL_HINT = 'Ubuntu 请运行 scripts/install-ocr-ubuntu.sh；其他系统请在设置 → 扩展组件安装 OCR 及中文语言包。'


def extract_image_text(path: Path, *, lang: str = 'chi_sim+eng') -> str:
    engine = resolve_exe('tesseract', 'tesseract')
    if not engine:
        raise FileNotFoundError(INSTALL_HINT)
    if not re.fullmatch(r'[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*', lang):
        raise ValueError('OCR 语言参数无效')
    if path.stat().st_size > 25 * 1024 * 1024:
        raise ValueError('OCR 图片不能超过 25 MB')
    with Image.open(path) as image:
        if image.width * image.height > 40_000_000:
            raise ValueError('OCR 图片不能超过 4000 万像素，请分割后上传')
        with tempfile.TemporaryDirectory(prefix='eh-ocr-') as directory:
            normalized = Path(directory) / 'image.png'
            ImageOps.exif_transpose(image).convert('RGB').save(normalized)
            result = subprocess.run(
                [engine, str(normalized), 'stdout', '-l', lang],
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60,
            )
    if result.returncode:
        raise ValueError('OCR 执行失败，请检查图片及语言包。' + result.stderr[:300])
    text = result.stdout.strip()
    if not text:
        raise ValueError('未识别到文字，请上传清晰正向图片；手写、公式及图形请人工核对。')
    return text
