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

RenderText = Callable[[str, HydratedQuestion, LoadedQuestions, Path], str]


def _escape_table_cell(text: str) -> str:
    text = text.replace("|", r"\|")
    return "<br />".join(line.strip() for line in text.splitlines() if line.strip())


def _append_options(
    lines: list[str],
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    render_text: RenderText,
) -> None:
    q = hq.item
    if not q.options or not is_choice_type(q.type):
        return
    options = dict(sorted(q.options.items()))
    pairs = [(k, render_text(v, hq, loaded, media_dir)) for k, v in choice_option_pairs(options)]
    if any(chr(96) * 3 + "{=openxml}" in v or "\n\n" in v for _k, v in pairs):
        for k, v in pairs:
            lines.append(f"**{k}.**")
            lines.append("")
            if v:
                lines.append(v)
            lines.append("")
        return
    layout = resolve_choice_layout(metadata, options)
    if layout == "inline_one_line":
        lines.append("    ".join(f"**{k}.** {v}" for k, v in pairs))
        lines.append("")
        return
    if layout == "grid_two_rows" and 2 <= len(pairs) <= 4:
        lines.extend(["|  |  |", "|---|---|"])
        for i in range(0, len(pairs), 2):
            left = pairs[i]
            right = pairs[i + 1] if i + 1 < len(pairs) else ("", "")
            left_cell = _escape_table_cell(f"**{left[0]}.** {left[1]}")
            right_cell = _escape_table_cell(f"**{right[0]}.** {right[1]}") if right[0] else ""
            lines.append(f"| {left_cell} | {right_cell} |")
        lines.append("")
        return
    for k, v in pairs:
        lines.append(f"- **{k}.** {v}")
    lines.append("")


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
    if answer:
        lines.append(f"**【答案】** {answer}")
        lines.append("")
    if analysis:
        lines.append(f"**【解析】** {analysis}")
        lines.append("")


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
    body = render_text(hq.item.content, hq, loaded, media_dir)
    if body:
        lines.append(f"**{label}.** {body}")
    else:
        lines.append(f"**{label}.**")
    lines.append("")
    _append_options(lines, hq, loaded, media_dir, metadata, render_text=render_text)
    _append_teacher_solution(
        lines,
        hq,
        loaded,
        media_dir,
        show_answers=show_answers,
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
    material = render_text(hq.item.group_material or "", hq, loaded, media_dir)
    if not material:
        return
    lines.append(f"**{label}. 【材料】**")
    lines.append("")
    lines.append(material)
    lines.append("")


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
    global_n = 0
    i = 0
    n = len(questions)
    while i < n:
        hq = questions[i]
        q = hq.item
        if q.group_root_id is None:
            global_n += 1
            _append_question(
                lines,
                str(global_n),
                hq,
                loaded,
                media_dir,
                metadata,
                show_answers=show_answers,
                render_text=render_text,
            )
            i += 1
            continue

        j = i + 1
        while j < n and questions[j].qualified_id == hq.qualified_id:
            j += 1
        run = questions[i:j]
        if q.unified is False:
            global_n += 1
            major = global_n
            _append_group_material(lines, str(major), hq, loaded, media_dir, render_text=render_text)
            for idx, row in enumerate(run, start=1):
                _append_question(
                    lines,
                    f"{major}.{idx}",
                    row,
                    loaded,
                    media_dir,
                    metadata,
                    show_answers=show_answers,
                    render_text=render_text,
                )
            i = j
            continue

        for idx, row in enumerate(run):
            global_n += 1
            if idx == 0:
                _append_group_material(
                    lines,
                    str(global_n),
                    row,
                    loaded,
                    media_dir,
                    render_text=render_text,
                )
            _append_question(
                lines,
                str(global_n),
                row,
                loaded,
                media_dir,
                metadata,
                show_answers=show_answers,
                render_text=render_text,
            )
        i = j


def render_docx_markdown(
    hydrated: HydratedExam,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: bool,
    render_text: RenderText,
    clean_text: Callable[[str], str],
) -> str:
    meta = hydrated.metadata
    title = str(meta.get("title") or hydrated.exam_id).strip() or hydrated.exam_id
    lines: list[str] = [f"# {title}", ""]
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

    for sec in hydrated.sections:
        lines.extend([f"## {sec.section_id}", ""])
        if sec.describe:
            lines.extend([clean_text(sec.describe), ""])
        _append_section_questions(
            lines,
            sec.questions,
            loaded,
            media_dir,
            meta,
            show_answers=show_answers,
            render_text=render_text,
        )
    return "\n".join(lines).rstrip() + "\n"
