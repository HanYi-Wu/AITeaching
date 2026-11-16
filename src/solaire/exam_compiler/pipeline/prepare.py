"""Validated inputs shared by one exam export's validation and rendering."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from solaire.exam_compiler.loaders.questions import LoadedQuestions, load_all_questions
from solaire.exam_compiler.loaders.template_loader import load_template, resolve_template_yaml_path
from solaire.exam_compiler.models import ExamConfig, ExamTemplate
from solaire.exam_compiler.pipeline.validate import (
    _normalize_and_validate_exam_preview,
    validate_exam,
)


@dataclass(frozen=True)
class PreparedExam:
    exam_yaml: Path
    exam: ExamConfig
    loaded: LoadedQuestions
    template_path: Path
    template: ExamTemplate
    preview_relaxed: bool = False
    preview_warnings: tuple[str, ...] = ()

    def check_source(self, exam_yaml: Path, *, preview_relaxed: bool = False) -> None:
        if self.exam_yaml != exam_yaml.resolve() or self.preview_relaxed != preview_relaxed:
            raise ValueError("Prepared exam belongs to a different source or validation mode")


def prepare_exam(
    exam_yaml: Path,
    *,
    preview_relaxed: bool = False,
    selected_questions_only: bool = False,
) -> PreparedExam:
    exam_yaml = exam_yaml.resolve()
    with exam_yaml.open(encoding="utf-8") as stream:
        exam = ExamConfig.model_validate(yaml.safe_load(stream))
    warnings: list[str] = []
    libraries = [(lib.namespace, lib.path) for lib in exam.question_libraries]
    if selected_questions_only:
        # Preview normalization only reorders or drops existing ids, so the
        # source selections are a safe superset. Load banks first to preserve
        # the established library-before-template error order.
        selected_ids = {qid for section in exam.selected_items for qid in section.question_ids}
        loaded = load_all_questions(
            exam_yaml,
            libraries,
            selected_qualified_ids=selected_ids,
        )
    else:
        loaded = load_all_questions(exam_yaml, libraries)

    template_path = resolve_template_yaml_path(exam_yaml, exam)
    template = load_template(template_path)
    if preview_relaxed:
        exam, warnings = _normalize_and_validate_exam_preview(exam, template, loaded)
    else:
        validate_exam(exam, template, loaded)

    return PreparedExam(exam_yaml, exam, loaded, template_path, template, preview_relaxed, tuple(warnings))
