"""Exam result listings, summaries, and score CSV template generation."""

from __future__ import annotations

import csv
import io
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from solaire.exam_compiler.facade import ExamConfig
from solaire.web.exam_service import _iter_exam_workspace_dirs, _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.results.batches import _list_score_batches
from solaire.web.results.models import (
    _display_exam_metadata,
    _flatten_questions,
)
from solaire.web.security import assert_within_project


@dataclass(frozen=True, slots=True)
class _ExamCatalog:
    """Immutable, filesystem-derived metadata safe to cache between list reads."""

    title: Any
    subject: Any
    export_label: Any
    owner_teacher_id: Any
    template_ref: str
    question_count: int
    section_count: int


_CATALOG_CACHE_LIMIT = 256
_catalog_cache: OrderedDict[tuple[Any, ...], _ExamCatalog] = OrderedDict()
_catalog_cache_lock = threading.RLock()


def _catalog_cache_key(exam_yaml_path: Path) -> tuple[Any, ...]:
    path = exam_yaml_path.resolve()
    stat = path.stat()
    return (
        str(path),
        stat.st_mtime_ns,
        stat.st_ctime_ns,
        stat.st_size,
        getattr(stat, "st_ino", 0),
    )


def _load_exam_catalog(exam_yaml_path: Path) -> _ExamCatalog:
    """Parse only immutable list metadata, with bounded mtime-aware caching."""
    # A writer can replace exam.yaml while it is being parsed.  Retry a few
    # times when the filesystem fingerprint changes during the read, so a
    # transient old document is not installed in the cache for the new file.
    catalog: _ExamCatalog | None = None
    for _attempt in range(3):
        key = _catalog_cache_key(exam_yaml_path)
        with _catalog_cache_lock:
            cached = _catalog_cache.get(key)
            if cached is not None:
                _catalog_cache.move_to_end(key)
                return cached

        # Do not hold the process-wide LRU lock while doing filesystem I/O or
        # Pydantic/YAML work.  A cold parse for one large exam must not
        # serialize first reads for every other exam directory.  Duplicate
        # parses of the same key are harmless; the second commit below reuses
        # the winner.
        raw = yaml.safe_load(exam_yaml_path.read_text(encoding="utf-8"))
        exam = ExamConfig.model_validate(raw)
        metadata = dict(exam.metadata or {})
        for field, source in (("title", "name"), ("subject", "subject"), ("export_label", "export_label")):
            if not str(metadata.get(field) or "").strip():
                value = raw.get(source) if isinstance(raw, dict) else None
                if isinstance(value, str) and value.strip():
                    metadata[field] = value.strip()
        catalog = _ExamCatalog(
            title=metadata.get("title"),
            subject=metadata.get("subject"),
            export_label=metadata.get("export_label"),
            owner_teacher_id=metadata.get("owner_teacher_id"),
            template_ref=exam.template_ref,
            question_count=sum(len(section.question_ids) for section in exam.selected_items),
            section_count=len(exam.selected_items),
        )

        if _catalog_cache_key(exam_yaml_path) != key:
            continue

        with _catalog_cache_lock:
            # Another thread may have completed the same parse while this one
            # was outside the lock.  Reuse its immutable result and preserve
            # LRU order.
            cached = _catalog_cache.get(key)
            if cached is not None:
                _catalog_cache.move_to_end(key)
                return cached
            # Recheck while committing so a replacement that happened after
            # the first validation cannot evict a newer revision.
            if _catalog_cache_key(exam_yaml_path) != key:
                continue
            # Remove older revisions for this path so repeated edits cannot
            # retain stale entries until the global LRU fills up.
            path_key = key[0]
            for old_key in tuple(_catalog_cache):
                if old_key[0] == path_key:
                    _catalog_cache.pop(old_key, None)
            _catalog_cache[key] = catalog
            _catalog_cache.move_to_end(key)
            while len(_catalog_cache) > _CATALOG_CACHE_LIMIT:
                _catalog_cache.popitem(last=False)
            return catalog

    # A continuously edited file is not useful to cache.  Return the last
    # successfully parsed snapshot; the next request recomputes its key.
    if catalog is None:
        raise RuntimeError("failed to parse exam catalog")
    return catalog


def _score_batch_ids(result_dir: Path) -> list[str]:
    """Return score batch directory names without reading score payloads."""
    scores_dir = result_dir / "scores"
    if not scores_dir.is_dir():
        return []
    batches = [
        path
        for path in scores_dir.iterdir()
        if path.is_dir()
    ]
    batches.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [path.name for path in batches]


def list_exam_results(project_root: Path) -> list[dict[str, Any]]:
    """Return list of past exams (newest first) with basic metadata."""
    exams: list[dict[str, Any]] = []
    for exam_id, dir_path, exam_yaml_path in _iter_exam_workspace_dirs(project_root):
        mtime = datetime.fromtimestamp(dir_path.stat().st_mtime, tz=timezone.utc)
        try:
            catalog = _load_exam_catalog(exam_yaml_path)
            score_batch_ids = _score_batch_ids(dir_path)
            exams.append({
                "exam_id": exam_id,
                "exam_title": catalog.title if catalog.title is not None else exam_id,
                "subject": catalog.subject,
                "owner_teacher_id": catalog.owner_teacher_id,
                "export_label": catalog.export_label,
                "template_ref": catalog.template_ref,
                "question_count": catalog.question_count,
                "section_count": catalog.section_count,
                "score_batch_count": len(score_batch_ids),
                "has_score": bool(score_batch_ids),
                "has_pdf": any(dir_path.glob("*.pdf")),
                "has_docx": any(dir_path.glob("*.docx")),
                "latest_batch_id": score_batch_ids[0] if score_batch_ids else None,
                "exam_dir": exam_id,
                "mtime": mtime.isoformat(),
            })
        except Exception:
            # 旧版目录结构或不完整exam.yaml，降级显示
            exams.append({
                "exam_id": exam_id,
                "exam_title": exam_id,
                "subject": None,
                "export_label": exam_id,
                "template_ref": None,
                "question_count": 0,
                "section_count": 0,
                "score_batch_count": 0,
                "has_score": False,
                "has_pdf": any(dir_path.glob("*.pdf")),
                "has_docx": any(dir_path.glob("*.docx")),
                "latest_batch_id": None,
                "exam_dir": exam_id,
                "mtime": mtime.isoformat(),
            })
    return exams


def get_exam_summary(project_root: Path, exam_id: str) -> dict[str, Any]:
    """Return exam detail: metadata + question list with scores."""
    dir_path = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, dir_path)
    if not dir_path.is_dir():
        raise FileNotFoundError(f"Exam not found: {exam_id}")

    exam_yaml = dir_path / "exam.yaml"
    if not exam_yaml.is_file():
        raise FileNotFoundError(f"exam.yaml not found for: {exam_id}")

    exam = _load_exam_config(exam_yaml)
    meta = _display_exam_metadata(exam, exam_yaml)
    questions = _flatten_questions(exam)
    score_batches = _list_score_batches(dir_path)

    return {
        "exam_id": exam_id,
        "exam_title": meta.get("title", exam_id),
        "subject": meta.get("subject"),
        "export_label": meta.get("export_label"),
        "template_ref": exam.template_ref,
        "questions": [
            {
                "idx": q.section_idx,
                "section_id": q.section_id,
                "question_in_section": q.question_in_section,
                "question_id": q.question_id,
                "score_per_item": q.score_per_item,
                "header": q.csv_header(),
            }
            for q in questions
        ],
        "section_count": len(exam.selected_items),
        "question_count": len(questions),
        "score_batches": score_batches,
        "has_pdf": any(dir_path.glob("*.pdf")),
        "has_docx": any(dir_path.glob("*.docx")),
        "exam_dir": exam_id,
    }


def generate_score_template(project_root: Path, exam_id: str) -> tuple[str, str]:
    """
    Generate a score CSV template for the given exam.
    Returns (csv_content, suggested_filename).
    """
    summary = get_exam_summary(project_root, exam_id)
    questions = summary["questions"]

    buf = io.StringIO()
    # Header row
    headers = ["姓名", "学号"] + [q["header"] for q in questions]
    writer = csv.writer(buf)
    writer.writerow(headers)

    # Example hint row (填入实际成绩)
    hint_row = ["张三", "001"] + ["" for _ in questions]
    writer.writerow(hint_row)

    # Second example
    writer.writerow(["李四", "002"])

    csv_content = buf.getvalue()
    title_slug = (summary.get("exam_title") or exam_id).replace("/", "-")
    subject_slug = (summary.get("subject") or "").replace("/", "-")
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"成绩表_{title_slug}_{subject_slug}_{date_str}.csv"
    return csv_content, filename
