"""Exam result listings, summaries, and score CSV template generation."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from solaire.web.exam_service import _iter_exam_workspace_dirs, _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.results.batches import _list_score_batches
from solaire.web.results.models import (
    _display_exam_metadata,
    _flatten_questions,
)
from solaire.web.security import assert_within_project


def list_exam_results(project_root: Path) -> list[dict[str, Any]]:
    """Return list of past exams (newest first) with basic metadata."""
    exams: list[dict[str, Any]] = []
    for exam_id, dir_path, exam_yaml_path in _iter_exam_workspace_dirs(project_root):
        mtime = datetime.fromtimestamp(dir_path.stat().st_mtime, tz=timezone.utc)
        try:
            exam = _load_exam_config(exam_yaml_path)
            meta = _display_exam_metadata(exam, exam_yaml_path)
            questions = _flatten_questions(exam)
            score_batches = _list_score_batches(dir_path)
            exams.append({
                "exam_id": exam_id,
                "exam_title": meta.get("title", exam_id),
                "subject": meta.get("subject"),
                "owner_teacher_id": meta.get("owner_teacher_id"),
                "export_label": meta.get("export_label"),
                "template_ref": exam.template_ref,
                "question_count": len(questions),
                "section_count": len(exam.selected_items),
                "score_batch_count": len(score_batches),
                "has_score": len(score_batches) > 0,
                "has_pdf": any(dir_path.glob("*.pdf")),
                "has_docx": any(dir_path.glob("*.docx")),
                "latest_batch_id": score_batches[0]["batch_id"] if score_batches else None,
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
