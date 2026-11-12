"""Markdown structure for student and teacher DOCX exports."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from solaire.common.answer_logic import display as display_answer
from solaire.exam_compiler.choice_layout import choice_option_pairs, resolve_choice_layout
from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.models import is_choice_type
from solaire.exam_compiler.pipeline.hydrate import HydratedExam, HydratedQuestion
from solaire.exam_compiler.pipeline.question_groups import iter_question_runs

RenderText = Callable[[str, HydratedQuestion, LoadedQuestions, Path], str]


def _escape_table_cell(text: str) -> str:
    text = text.replace("|", r"\|")
    return "<br />".join(line.strip() for line in text.splitlines() if line.strip())


def _rendered_option_lines(
    pairs: list[tuple[str, str]], layout: str
) -> list[str]:
    if not pairs:
        return []
    lines: list[str] = []
    if any("```{=openxml}" in value or "\n\n" in value for _key, value in pairs):
        for key, value in pairs:
            lines.append(f"**{key}.**")
            lines.append("")
            if value:
                lines.append(value)
            lines.append("")
        return lines
    if layout == "inline_one_line":
        lines.append("    ".join(f"**{k}.** {v}" for k, v in pairs))
        lines.append("")
        return lines
    if layout == "grid_two_rows" and 2 <= len(pairs) <= 4:
        lines.extend(["|  |  |", "|---|---|"])
        for i in range(0, len(pairs), 2):
            left = pairs[i]
            right = pairs[i + 1] if i + 1 < len(pairs) else ("", "")
            left_cell = _escape_table_cell(f"**{left[0]}.** {left[1]}")
            right_cell = _escape_table_cell(f"**{right[0]}.** {right[1]}") if right[0] else ""
            lines.append(f"| {left_cell} | {right_cell} |")
        lines.append("")
        return lines
    for k, v in pairs:
        lines.append(f"- **{k}.** {v}")
    lines.append("")
    return lines


def _render_options(
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    render_text: RenderText,
) -> list[str]:
    q = hq.item
    if not q.options or not is_choice_type(q.type):
        return []
    options = dict(sorted(q.options.items()))
    pairs = [(key, render_text(value, hq, loaded, media_dir)) for key, value in choice_option_pairs(options)]
    return _rendered_option_lines(pairs, resolve_choice_layout(metadata, options))


def _append_options(
    lines: list[str],
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    render_text: RenderText,
) -> None:
    lines.extend(_render_options(
        hq, loaded, media_dir, metadata, render_text=render_text
    ))


def _append_teacher_solution(
    lines: list[str],
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: bool,
    render_text: RenderText,
) -> None:
    if not show_answers:
        return
    answer = render_text(display_answer(hq.item.answer), hq, loaded, media_dir)
    analysis = render_text(hq.item.analysis or "", hq, loaded, media_dir)
    lines.extend(_teacher_solution_lines(answer, analysis))


def _teacher_solution_lines(answer: str, analysis: str) -> list[str]:
    lines: list[str] = []
    if answer:
        lines.extend([f"**【答案】** {answer}", ""])
    if analysis:
        lines.extend([f"**【解析】** {analysis}", ""])
    return lines


def _append_question(
    lines: list[str],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    show_answers: bool,
    render_text: RenderText,
) -> None:
    _append_question_outputs(
        [lines],
        (show_answers,),
        label,
        hq,
        loaded,
        media_dir,
        metadata,
        render_text=render_text,
    )


def _append_group_material(
    lines: list[str],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    render_text: RenderText,
) -> None:
    _append_group_material_outputs(
        [lines], label, hq, loaded, media_dir, render_text=render_text
    )


def _append_section_questions(
    lines: list[str],
    questions: list[HydratedQuestion],
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    show_answers: bool,
    render_text: RenderText,
) -> None:
    _append_section_question_outputs(
        [lines],
        (show_answers,),
        questions,
        loaded,
        media_dir,
        metadata,
        render_text=render_text,
    )


def render_docx_markdown(
    hydrated: HydratedExam,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: bool,
    render_text: RenderText,
    clean_text: Callable[[str], str],
) -> str:
    return _render_docx_markdown_outputs(
        hydrated,
        loaded,
        media_dir,
        show_answers=(show_answers,),
        render_text=render_text,
        clean_text=clean_text,
    )[0]


def _append_question_outputs(
    outputs: list[list[str]],
    show_answers: tuple[bool, ...],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    render_text: RenderText,
) -> None:
    """Render one question once, then append shared body/options to each requested paper."""
    q = hq.item
    body = render_text(q.content, hq, loaded, media_dir)
    shared_lines = [f"**{label}.** {body}" if body else f"**{label}.**", ""]
    shared_lines.extend(
        _render_options(hq, loaded, media_dir, metadata, render_text=render_text)
    )
    for lines in outputs:
        lines.extend(shared_lines)

    teacher_outputs = [
        lines for lines, include_answers in zip(outputs, show_answers) if include_answers
    ]
    if not teacher_outputs:
        return
    answer = render_text(display_answer(q.answer), hq, loaded, media_dir)
    analysis = render_text(q.analysis or "", hq, loaded, media_dir)
    teacher_lines = _teacher_solution_lines(answer, analysis)
    for lines in teacher_outputs:
        lines.extend(teacher_lines)


def _append_group_material_outputs(
    outputs: list[list[str]],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    render_text: RenderText,
) -> None:
    material = render_text(hq.item.group_material or "", hq, loaded, media_dir)
    if not material:
        return
    shared_lines = [f"**{label}. 【材料】**", "", material, ""]
    for lines in outputs:
        lines.extend(shared_lines)


def _append_section_question_outputs(
    outputs: list[list[str]],
    show_answers: tuple[bool, ...],
    questions: list[HydratedQuestion],
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    render_text: RenderText,
) -> None:
    global_n = 0
    for question_run in iter_question_runs(questions):
        first = question_run.questions[0]
        if not question_run.grouped:
            global_n += 1
            _append_question_outputs(
                outputs,
                show_answers,
                str(global_n),
                first,
                loaded,
                media_dir,
                metadata,
                render_text=render_text,
            )
            continue

        if first.item.unified is False:
            global_n += 1
            major = global_n
            _append_group_material_outputs(
                outputs, str(major), first, loaded, media_dir, render_text=render_text
            )
            for index, row in enumerate(question_run.questions, start=1):
                _append_question_outputs(
                    outputs,
                    show_answers,
                    f"{major}.{index}",
                    row,
                    loaded,
                    media_dir,
                    metadata,
                    render_text=render_text,
                )
            continue

        for index, row in enumerate(question_run.questions):
            global_n += 1
            if index == 0:
                _append_group_material_outputs(
                    outputs,
                    str(global_n),
                    row,
                    loaded,
                    media_dir,
                    render_text=render_text,
                )
            _append_question_outputs(
                outputs,
                show_answers,
                str(global_n),
                row,
                loaded,
                media_dir,
                metadata,
                render_text=render_text,
            )


def _markdown_preamble(
    hydrated: HydratedExam, clean_text: Callable[[str], str]
) -> tuple[dict[str, Any], list[str]]:
    meta = hydrated.metadata
    title = str(meta.get("title") or hydrated.exam_id).strip() or hydrated.exam_id
    lines = [f"# {title}", ""]
    school = str(meta.get("school") or "").strip()
    subject = str(meta.get("subject") or "").strip()
    if school:
        lines.extend([school, ""])
    if subject:
        lines.extend([f"**科目：** {subject}", ""])
    if bool(meta.get("show_name_column")):
        lines.extend(["姓名：________    班级：________    学号：________", ""])
    notices = clean_text(str(meta.get("preamble_notices") or "").strip())
    if notices:
        lines.extend([notices, ""])
    return meta, lines


def _render_docx_markdown_outputs(
    hydrated: HydratedExam,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: tuple[bool, ...],
    render_text: RenderText,
    clean_text: Callable[[str], str],
) -> tuple[str, ...]:
    """Render one or more papers over one shared numbering and group traversal."""
    meta, preamble = _markdown_preamble(hydrated, clean_text)
    papers = [list(preamble) for _include_answers in show_answers]
    for section in hydrated.sections:
        section_header = [f"## {section.section_id}", ""]
        if section.describe:
            section_header.extend([clean_text(section.describe), ""])
        for lines in papers:
            lines.extend(section_header)
        _append_section_question_outputs(
            papers,
            show_answers,
            section.questions,
            loaded,
            media_dir,
            meta,
            render_text=render_text,
        )
    return tuple("\n".join(lines).rstrip() + "\n" for lines in papers)


def render_docx_markdown_pair(
    hydrated: HydratedExam,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    render_text: RenderText,
    clean_text: Callable[[str], str],
) -> tuple[str, str]:
    """Render student and teacher papers over one shared question traversal."""
    student, teacher = _render_docx_markdown_outputs(
        hydrated,
        loaded,
        media_dir,
        show_answers=(False, True),
        render_text=render_text,
        clean_text=clean_text,
    )
    return student, teacher
