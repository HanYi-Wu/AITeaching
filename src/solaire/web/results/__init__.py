"""Results service package for exam score templates, batches, and statistics."""

from __future__ import annotations

from solaire.web.results.adapter import ResultServiceAdapter
from solaire.web.results.batches import (
    _list_score_batches,
    delete_exam_result,
    delete_score_batch,
    import_scores,
)
from solaire.web.results.files import (
    find_exported_docx_path,
    find_exported_pdf_path,
    open_docx_with_default_app,
    open_pdf_with_default_app,
)
from solaire.web.results.models import (
    ExamQuestion,
    _display_exam_metadata,
    _flatten_questions,
    _now_utc,
    _safe_float,
)
from solaire.web.results.statistics import (
    compute_statistics,
    get_score_analysis,
)
from solaire.web.results.summary import (
    generate_score_template,
    get_exam_summary,
    list_exam_results,
)

__all__ = [
    "ExamQuestion",
    "ResultServiceAdapter",
    "_display_exam_metadata",
    "_flatten_questions",
    "_list_score_batches",
    "_now_utc",
    "_safe_float",
    "compute_statistics",
    "delete_exam_result",
    "delete_score_batch",
    "find_exported_docx_path",
    "find_exported_pdf_path",
    "generate_score_template",
    "get_exam_summary",
    "get_score_analysis",
    "import_scores",
    "list_exam_results",
    "open_docx_with_default_app",
    "open_pdf_with_default_app",
]
