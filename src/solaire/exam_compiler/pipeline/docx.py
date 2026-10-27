"""Pandoc-backed DOCX export pipeline."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.paths import exam_parent_dir, work_dir_for_exam
from solaire.exam_compiler.pipeline.hydrate import HydratedExam, HydratedQuestion, hydrate
from solaire.exam_compiler.pipeline.prepare import PreparedExam, prepare_exam
from solaire.web.extension_registry import resolve_exe
from . import docx_markdown as _docx_markdown
from . import docx_resources as _docx_resources
from . import docx_process as _docx_process

_FENCE_RE = _docx_resources._FENCE_RE
_EMBED_RE = _docx_resources._EMBED_RE
_COMMON_MATH_MACROS_RE = _docx_resources._COMMON_MATH_MACROS_RE
_W_NS = _docx_process._W_NS
_XML_NAMESPACES = _docx_process._XML_NAMESPACES
PandocError = _docx_process.PandocError
DocxResourceContext = _docx_resources.DocxResourceContext


_tail = _docx_process._tail
format_pandoc_failure_message = _docx_process.format_pandoc_failure_message


_sanitize_name_part = _docx_resources._sanitize_name_part
_copy_media = _docx_resources._copy_media
_copy_svg_as_png = _docx_resources._copy_svg_as_png
_markdown_image = _docx_resources._markdown_image
_library_context = _docx_resources._library_context
_materialize_visuals = _docx_resources._materialize_visuals
_clean_latex_for_markdown = _docx_resources._clean_latex_for_markdown
_expand_common_math_macros = _docx_resources._expand_common_math_macros
_normalize_docx_math_macros = _docx_resources._normalize_docx_math_macros
_render_text = _docx_resources._render_text


def _escape_table_cell(text: str) -> str:
    return _docx_markdown._escape_table_cell(text)


def _append_options(
    lines: list[str],
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
) -> None:
    _docx_markdown._append_options(
        lines,
        hq,
        loaded,
        media_dir,
        metadata,
        render_text=_render_text,
    )


def _append_teacher_solution(
    lines: list[str],
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: bool,
) -> None:
    _docx_markdown._append_teacher_solution(
        lines,
        hq,
        loaded,
        media_dir,
        show_answers=show_answers,
        render_text=_render_text,
    )


def _append_question(
    lines: list[str],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    show_answers: bool,
) -> None:
    _docx_markdown._append_question(
        lines,
        label,
        hq,
        loaded,
        media_dir,
        metadata,
        show_answers=show_answers,
        render_text=_render_text,
    )


def _append_group_material(
    lines: list[str],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
) -> None:
    _docx_markdown._append_group_material(
        lines,
        label,
        hq,
        loaded,
        media_dir,
        render_text=_render_text,
    )


def _append_section_questions(
    lines: list[str],
    questions: list[HydratedQuestion],
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    show_answers: bool,
) -> None:
    _docx_markdown._append_section_questions(
        lines,
        questions,
        loaded,
        media_dir,
        metadata,
        show_answers=show_answers,
        render_text=_render_text,
    )


def _render_docx_markdown(
    hydrated: HydratedExam,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: bool,
    context: _docx_resources.DocxResourceContext | None = None,
) -> str:
    def bound_render_text(
        text: str,
        hq: HydratedQuestion,
        loaded_qs: LoadedQuestions,
        md_dir: Path,
    ) -> str:
        return _render_text(text, hq, loaded_qs, md_dir, context=context)

    return _docx_markdown.render_docx_markdown(
        hydrated,
        loaded,
        media_dir,
        show_answers=show_answers,
        render_text=bound_render_text,
        clean_text=_clean_latex_for_markdown,
    )


_w = _docx_process._w
_decode_process_output = _docx_process._decode_process_output
_ensure_child = _docx_process._ensure_child
_remove_children = _docx_process._remove_children
_set_val = _docx_process._set_val
_set_on_off = _docx_process._set_on_off
_style_by_id = _docx_process._style_by_id
_find_or_create_style = _docx_process._find_or_create_style
_set_run_properties = _docx_process._set_run_properties
_set_paragraph_properties = _docx_process._set_paragraph_properties
_patch_paragraph_style = _docx_process._patch_paragraph_style
_patch_table_style = _docx_process._patch_table_style
_patch_reference_styles_xml = _docx_process._patch_reference_styles_xml
_patch_reference_document_xml = _docx_process._patch_reference_document_xml
_patch_reference_docx = _docx_process._patch_reference_docx


def _ensure_gaokao_reference_docx(reference_docx: Path, pandoc: str) -> Path:
    return _docx_process._ensure_gaokao_reference_docx(
        reference_docx,
        pandoc,
        subprocess_run=subprocess.run,
        patch_reference_docx=_patch_reference_docx,
        error_type=PandocError,
    )


def _run_pandoc(
    md_path: Path,
    docx_path: Path,
    *,
    pandoc_path: str | None = None,
    reference_docx: Path | None = None,
) -> None:
    _docx_process._run_pandoc(
        md_path,
        docx_path,
        pandoc_path=pandoc_path,
        reference_docx=reference_docx,
        resolve_executable=resolve_exe,
        ensure_reference_docx=_ensure_gaokao_reference_docx,
        subprocess_run=subprocess.run,
        error_type=PandocError,
    )


def _copy_docx_if_exists(work_dir: Path, stem: str, dest_dir: Path) -> Path:
    src = work_dir / f"{stem}.docx"
    if not src.is_file():
        raise PandocError(f"Pandoc output missing: {src.name}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dst = dest_dir / src.name
    shutil.copy2(src, dst)
    return dst


def build_exam_docx(
    exam_yaml: Path,
    out_dir: Path | None,
    *,
    clean_workdir: bool = False,
    prepared: PreparedExam | None = None,
) -> tuple[Path, Path]:
    """Build student and teacher DOCX files with Pandoc."""
    exam_yaml = exam_yaml.resolve()
    if not exam_yaml.is_file():
        raise FileNotFoundError(exam_yaml)

    prepared = prepared or prepare_exam(exam_yaml)
    prepared.check_source(exam_yaml)
    exam, loaded, template = prepared.exam, prepared.loaded, prepared.template
    if not exam.question_libraries:
        raise ValueError("exam.yaml must include non-empty question_libraries")

    hydrated = hydrate(exam, template, loaded)
    work_dir = work_dir_for_exam(exam_yaml)
    if clean_workdir and work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    docx_work = work_dir / "docx"
    if docx_work.exists():
        shutil.rmtree(docx_work)
    docx_work.mkdir(parents=True, exist_ok=True)
    media_dir = docx_work / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    resource_context = _docx_resources.DocxResourceContext()

    student_md = docx_work / "student_paper.md"
    teacher_md = docx_work / "teacher_paper.md"
    student_md.write_text(
        _render_docx_markdown(
            hydrated,
            loaded,
            media_dir,
            show_answers=False,
            context=resource_context,
        ),
        encoding="utf-8",
    )
    teacher_md.write_text(
        _render_docx_markdown(
            hydrated,
            loaded,
            media_dir,
            show_answers=True,
            context=resource_context,
        ),
        encoding="utf-8",
    )

    _run_pandoc(student_md, docx_work / "student_paper.docx")
    _run_pandoc(teacher_md, docx_work / "teacher_paper.docx")

    dest = out_dir if out_dir is not None else exam_parent_dir(exam_yaml)
    dest = dest.resolve()
    student_docx = docx_work / "student_paper.docx"
    teacher_docx = docx_work / "teacher_paper.docx"
    if not student_docx.is_file():
        raise PandocError(f"Pandoc output missing: {student_docx.name}")
    if not teacher_docx.is_file():
        raise PandocError(f"Pandoc output missing: {teacher_docx.name}")

    student_out = _copy_docx_if_exists(docx_work, "student_paper", dest)
    teacher_out = _copy_docx_if_exists(docx_work, "teacher_paper", dest)
    return student_out, teacher_out
