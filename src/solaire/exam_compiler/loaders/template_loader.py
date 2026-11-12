"""Locate and load template.yaml."""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from io import StringIO
from pathlib import Path
from threading import RLock
from typing import Any

import yaml

from solaire.exam_compiler.merge_util import deep_merge
from solaire.exam_compiler.models import ExamConfig, ExamTemplate
from solaire.exam_compiler.latex_jinja_paths import bundled_latex_dir, latex_jinja_loader_dirs

_BUNDLED_LATEX_DIR = bundled_latex_dir()

_TEMPLATE_CACHE_MAX_ENTRIES = 96
_TEMPLATE_CACHE_MAX_BYTES = 8 * 1024 * 1024
_TEMPLATE_CACHE: OrderedDict[
    tuple[str, str, str, str], tuple[ExamTemplate, int]
] = OrderedDict()
_TEMPLATE_CACHE_BYTES = 0
_TEMPLATE_CACHE_LOCK = RLock()


def _load_yaml_snapshot(path: Path, contents: bytes) -> Any:
    """Parse a byte snapshot like ``Path.open(encoding='utf-8')`` with file diagnostics."""
    text = contents.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    stream = StringIO(text)
    stream.name = str(path)
    return yaml.safe_load(stream)


def _template_cache_key(
    path: Path,
    template_bytes: bytes,
    defaults_path: Path,
    defaults_bytes: bytes | None,
) -> tuple[str, str, str, str]:
    return (
        str(path.absolute()),
        hashlib.sha256(template_bytes).hexdigest(),
        str(defaults_path.absolute()),
        hashlib.sha256(defaults_bytes).hexdigest() if defaults_bytes is not None else "<missing>",
    )


def _validate_latex_base_available(template_path: Path, latex_base: str) -> None:
    """Recheck current project-first resource availability without resolving unchanged roots."""
    if (template_path.parent / latex_base).is_file() or (_BUNDLED_LATEX_DIR / latex_base).is_file():
        return
    # Keep the canonical historical error message and search validation on a miss.
    latex_jinja_loader_dirs(template_path.parent, latex_base)


def _copy_cached_template(key: tuple[str, str, str, str]) -> ExamTemplate | None:
    with _TEMPLATE_CACHE_LOCK:
        entry = _TEMPLATE_CACHE.get(key)
        if entry is None:
            return None
        template, _weight = entry
        _TEMPLATE_CACHE.move_to_end(key)
        return template.model_copy(deep=True)


def _remember_template(
    key: tuple[str, str, str, str],
    template: ExamTemplate,
    template_bytes: bytes,
    defaults_bytes: bytes | None,
) -> None:
    global _TEMPLATE_CACHE_BYTES
    weight = max(4096, (len(template_bytes) + len(defaults_bytes or b"")) * 4)
    if weight > _TEMPLATE_CACHE_MAX_BYTES:
        return
    cached_copy = template.model_copy(deep=True)
    with _TEMPLATE_CACHE_LOCK:
        old = _TEMPLATE_CACHE.pop(key, None)
        if old is not None:
            _TEMPLATE_CACHE_BYTES -= old[1]
        _TEMPLATE_CACHE[key] = (cached_copy, weight)
        _TEMPLATE_CACHE_BYTES += weight
        while (
            len(_TEMPLATE_CACHE) > _TEMPLATE_CACHE_MAX_ENTRIES
            or _TEMPLATE_CACHE_BYTES > _TEMPLATE_CACHE_MAX_BYTES
        ):
            _old_key, (_old_template, old_weight) = _TEMPLATE_CACHE.popitem(last=False)
            _TEMPLATE_CACHE_BYTES -= old_weight


def _normalize_remediation_practice_template(data: dict) -> None:
    if data.get("template_id") != "remediation_practice":
        return
    sections = data.get("sections")
    if isinstance(sections, list):
        for sec in sections:
            if not isinstance(sec, dict):
                continue
            if sec.get("type") == "practice":
                sec.pop("describe", None)
                if sec.get("score_per_item") in (None, 0, 0.0):
                    sec["score_per_item"] = 5
    md = data.setdefault("metadata_defaults", {})
    if isinstance(md, dict):
        md.update(
            {
                "show_binding_line": False,
                "show_name_column": False,
                "show_page_number_footer": False,
                "show_student_sidebar": False,
                "preamble_notices": "",
                "title_block_style": "default",
                "section_heading_style": "section_star",
                "include_common_math_macros": True,
            }
        )


def resolve_template_yaml_path(exam_yaml: Path, exam: ExamConfig) -> Path:
    exam_dir = exam_yaml.resolve().parent
    if exam.template_path:
        p = (exam_dir / exam.template_path).resolve()
        if p.is_file():
            return p
        raise FileNotFoundError(f"template_path not found: {p}")

    cand = exam_dir / "templates" / exam.template_ref / "template.yaml"
    if cand.is_file():
        return cand.resolve()

    cand2 = exam_dir / "template.yaml"
    if cand2.is_file():
        return cand2.resolve()

    raise FileNotFoundError(
        f"Could not find template for template_ref={exam.template_ref!r}. "
        f"Set template_path in exam.yaml or place template at {cand} or {cand2}"
    )


def load_template(path: Path) -> ExamTemplate:
    template_bytes = path.read_bytes()
    defaults_path = path.parent / "defaults.yaml"
    defaults_bytes: bytes | None = None
    defaults_read_error: OSError | None = None
    if defaults_path.is_file():
        try:
            defaults_bytes = defaults_path.read_bytes()
        except OSError as error:
            # The historical order parses the template before opening defaults.yaml.
            # Defer this error until the primary source has been parsed once.
            defaults_read_error = error

    key = _template_cache_key(path, template_bytes, defaults_path, defaults_bytes)
    if defaults_read_error is None:
        cached = _copy_cached_template(key)
        if cached is not None:
            _validate_latex_base_available(path, cached.latex_base)
            return cached

    data = _load_yaml_snapshot(path, template_bytes) or {}
    if not isinstance(data, dict):
        data = {}
    if defaults_read_error is not None:
        raise defaults_read_error
    if defaults_bytes is not None:
        pkg = _load_yaml_snapshot(defaults_path, defaults_bytes) or {}
        if isinstance(pkg, dict):
            inner = pkg.get("metadata_defaults")
            base = inner if isinstance(inner, dict) else pkg
            data["metadata_defaults"] = deep_merge(dict(base), dict(data.get("metadata_defaults") or {}))
    _normalize_remediation_practice_template(data)
    t = ExamTemplate.model_validate(data)
    _validate_latex_base_available(path, t.latex_base)
    if defaults_read_error is None:
        _remember_template(key, t, template_bytes, defaults_bytes)
    return t
