"""与 ``*.tex.j2`` 同目录配套的 ``*.metadata_ui.yaml``：声明模板工作台可编辑的 metadata 扩展字段。"""

from __future__ import annotations

import copy
import hashlib
import logging
from collections import OrderedDict
from io import StringIO
from pathlib import Path
from threading import RLock
from typing import Any

import yaml
from pydantic import BaseModel, Field

from solaire.exam_compiler.latex_jinja_paths import bundled_latex_dir, latex_jinja_loader_dirs

logger = logging.getLogger(__name__)

_METADATA_UI_CACHE_MAX_ENTRIES = 64
_METADATA_UI_CACHE_MAX_BYTES = 4 * 1024 * 1024
_METADATA_UI_CACHE: OrderedDict[
    tuple[tuple[str, ...], str, str], tuple[tuple[dict[str, Any], ...], tuple[str, ...], int]
] = OrderedDict()
_METADATA_UI_CACHE_BYTES = 0
_METADATA_UI_CACHE_LOCK = RLock()
_BUNDLED_LATEX_DIR = bundled_latex_dir()
_TEMPLATE_DIR_CACHE_MAX_ENTRIES = 64
_TEMPLATE_DIR_CACHE: OrderedDict[str, Path] = OrderedDict()


def _resolved_template_dir(path: Path) -> Path:
    key = str(path.absolute())
    with _METADATA_UI_CACHE_LOCK:
        resolved = _TEMPLATE_DIR_CACHE.get(key)
        if resolved is not None:
            _TEMPLATE_DIR_CACHE.move_to_end(key)
            return resolved
    resolved = path.resolve()
    with _METADATA_UI_CACHE_LOCK:
        _TEMPLATE_DIR_CACHE[key] = resolved
        while len(_TEMPLATE_DIR_CACHE) > _TEMPLATE_DIR_CACHE_MAX_ENTRIES:
            _TEMPLATE_DIR_CACHE.popitem(last=False)
    return resolved


class MetadataUiSelectOption(BaseModel):
    value: str
    label: str


class MetadataUiField(BaseModel):
    """单字段；``kind`` 决定前端控件类型。"""

    key: str
    label: str
    kind: str  # text | textarea | select | number | checkbox
    hint: str | None = None
    placeholder: str | None = None
    rows: int | None = Field(default=None, ge=1, le=40)
    options: list[MetadataUiSelectOption] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    # 若当前值等于列表中任一项（字符串化后比较），保存 YAML 时省略该键
    omit_values: list[Any] = Field(default_factory=list)


def metadata_ui_companion_filename(latex_base: str) -> str:
    """``exam-zh-base.tex.j2`` → ``exam-zh-base.metadata_ui.yaml``。"""
    if latex_base.endswith(".tex.j2"):
        stem = latex_base[: -len(".tex.j2")]
    else:
        stem = Path(latex_base).stem
    return f"{stem}.metadata_ui.yaml"


def load_latex_metadata_ui_fields(
    template_yaml_dir: Path,
    latex_base: str,
) -> tuple[list[dict[str, Any]], Path | None, list[str]]:
    """
    按 Jinja 搜索顺序（模板目录优先，其次内置目录）查找第一个存在的配套 YAML。

    Returns:
        (fields, source_path_or_none, warnings). Invalid field entries are skipped;
        each skip appends to ``warnings`` and is logged.

    文件格式::

        version: 1
        fields:
          - key: school
            label: 卷首抬头
            kind: textarea
            ...
    """
    project_dir = _resolved_template_dir(template_yaml_dir)
    project_template = project_dir / latex_base
    bundled_template = _BUNDLED_LATEX_DIR / latex_base
    if not project_template.is_file() and not bundled_template.is_file():
        latex_jinja_loader_dirs(project_dir, latex_base)
    dirs: list[Path] = []
    if project_dir.is_dir():
        dirs.append(project_dir)
    if _BUNDLED_LATEX_DIR.is_dir() and _BUNDLED_LATEX_DIR not in dirs:
        dirs.append(_BUNDLED_LATEX_DIR)
    name = metadata_ui_companion_filename(latex_base)
    priority = tuple(str(directory.absolute()) for directory in dirs)
    for d in dirs:
        candidate = d / name
        if candidate.is_file():
            p = candidate.resolve() if candidate.is_symlink() else candidate
        else:
            continue
        if p.is_file():
            contents = p.read_bytes()
            checksum = hashlib.sha256(contents).hexdigest()
            cache_key = (priority, str(p), checksum)
            global _METADATA_UI_CACHE_BYTES
            with _METADATA_UI_CACHE_LOCK:
                entry = _METADATA_UI_CACHE.get(cache_key)
                if entry is not None:
                    fields, warnings, _weight = entry
                    _METADATA_UI_CACHE.move_to_end(cache_key)
                    return copy.deepcopy(list(fields)), p, list(warnings)

            text = contents.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
            stream = StringIO(text)
            stream.name = str(p)
            data = yaml.safe_load(stream) or {}
            warnings: list[str] = []
            if not isinstance(data, dict):
                msg = f"metadata_ui root must be a mapping in {p}"
                logger.warning(msg)
                return [], p, [msg]
            raw_fields = data.get("fields")
            if raw_fields is None:
                inner = data.get("metadata_ui")
                if isinstance(inner, dict):
                    raw_fields = inner.get("fields")
            if not isinstance(raw_fields, list):
                parsed: list[dict[str, Any]] = []
            else:
                parsed = []
                for item in raw_fields:
                    if not isinstance(item, dict):
                        warning = f"Skipping non-dict metadata_ui field entry in {p.name}: {item!r}"
                        warnings.append(warning)
                        logger.warning(warning)
                        continue
                    try:
                        field = MetadataUiField.model_validate(item)
                    except Exception as error:
                        key = item.get("key", "?")
                        warning = f"Invalid metadata_ui field {key!r} in {p.name}: {error}"
                        warnings.append(warning)
                        logger.warning(warning, exc_info=True)
                        continue
                    parsed.append(field.model_dump(mode="json", exclude_none=True))

            weight = max(1024, len(contents) * 4)
            if weight <= _METADATA_UI_CACHE_MAX_BYTES:
                frozen_fields = tuple(copy.deepcopy(parsed))
                frozen_warnings = tuple(warnings)
                with _METADATA_UI_CACHE_LOCK:
                    old = _METADATA_UI_CACHE.pop(cache_key, None)
                    if old is not None:
                        _METADATA_UI_CACHE_BYTES -= old[2]
                    _METADATA_UI_CACHE[cache_key] = (frozen_fields, frozen_warnings, weight)
                    _METADATA_UI_CACHE_BYTES += weight
                    while (
                        len(_METADATA_UI_CACHE) > _METADATA_UI_CACHE_MAX_ENTRIES
                        or _METADATA_UI_CACHE_BYTES > _METADATA_UI_CACHE_MAX_BYTES
                    ):
                        _old_key, _old_entry = _METADATA_UI_CACHE.popitem(last=False)
                        _METADATA_UI_CACHE_BYTES -= _old_entry[2]
            return copy.deepcopy(parsed), p, warnings
    return [], None, []
