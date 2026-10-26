"""Data models and common helpers for exam results."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from solaire.exam_compiler.facade import ExamConfig


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _safe_float(val: str | None, default: float | None = None) -> float | None:
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


class ExamQuestion:
    """Flattened question from selected_items."""

    section_idx: int
    section_id: str
    question_in_section: int  # 1-based
    question_id: str
    score_per_item: float

    def csv_header(self) -> str:
        return f"{self.section_idx}.{self.question_in_section}"


def _flatten_questions(exam: ExamConfig) -> list[ExamQuestion]:
    """Flatten selected_items to ordered ExamQuestion list."""
    questions: list[ExamQuestion] = []
    for sec_idx, section in enumerate(exam.selected_items, start=1):
        overrides = section.score_overrides or {}
        default_sec = section.score_per_item if section.score_per_item is not None else 5.0
        for qi, qid in enumerate(section.question_ids, start=1):
            if qid in overrides:
                spc = float(overrides[qid])
            else:
                spc = float(default_sec)
            q = ExamQuestion()
            q.section_idx = sec_idx
            q.section_id = section.section_id
            q.question_in_section = qi
            q.question_id = qid
            q.score_per_item = spc
            questions.append(q)
    return questions


def _display_exam_metadata(exam: ExamConfig, exam_yaml_path: Path) -> dict[str, Any]:
    """Read workspace display fields without changing compiler or conflict metadata."""
    metadata = dict(exam.metadata or {})
    fields = (("title", "name"), ("subject", "subject"), ("export_label", "export_label"))
    missing = [(key, source) for key, source in fields if not str(metadata.get(key) or "").strip()]
    if not missing:
        return metadata
    raw = yaml.safe_load(exam_yaml_path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        for key, source in missing:
            value = raw.get(source)
            if isinstance(value, str) and value.strip():
                metadata[key] = value.strip()
    return metadata
