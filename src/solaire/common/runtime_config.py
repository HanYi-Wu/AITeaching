"""Load the single deployment configuration file without executing shell code."""

from __future__ import annotations

import os
import re
from pathlib import Path

_KEY = re.compile(r"^(?:EH_|SOLAIRE_|OPENAI_|ANTHROPIC_|DEEPSEEK_|TAVILY_API_KEY$)[A-Z0-9_]*$")


def load_runtime_config() -> None:
    """Load EH_CONFIG_FILE, preserving explicitly provided process variables."""
    filename = os.environ.get("EH_CONFIG_FILE", "").strip()
    if not filename:
        return
    path = Path(filename).expanduser()
    if not path.is_file():
        raise RuntimeError(f"运行配置文件不存在：{path}")
    for number, original in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = original.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise RuntimeError(f"运行配置第 {number} 行缺少 =")
        key, value = line.split("=", 1)
        key = key.strip()
        if not _KEY.fullmatch(key):
            raise RuntimeError(f"运行配置第 {number} 行的配置名无效：{key}")
        value = value.strip()
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise RuntimeError(f"运行配置第 {number} 行引号不匹配")
            value = value[1:-1]
        os.environ.setdefault(key, value)
