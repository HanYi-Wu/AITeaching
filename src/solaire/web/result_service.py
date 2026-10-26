"""考试目录（``exams/<标签>/<学科>/``）的成绩模板、导入与统计分析。

导出 PDF 时写入同目录（见 ``exam_service.export_pdfs``），成绩批次位于 ``scores/<batch_id>/``。
"""

from __future__ import annotations

from solaire.web.results import (
    ExamQuestion,
    ResultServiceAdapter,
    _display_exam_metadata,
    _flatten_questions,
    _list_score_batches,
    _now_utc,
    _safe_float,
    compute_statistics,
    delete_exam_result,
    delete_score_batch,
    find_exported_docx_path,
    find_exported_pdf_path,
    generate_score_template,
    get_exam_summary,
    get_score_analysis,
    import_scores,
    list_exam_results,
    open_docx_with_default_app,
    open_pdf_with_default_app,
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
