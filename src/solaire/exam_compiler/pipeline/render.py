"""Jinja2 → .tex; latex_escape on metadata, |safe on question LaTeX."""

from __future__ import annotations

import hashlib
import sys
from collections import OrderedDict
from copy import deepcopy
from threading import RLock
from types import CodeType
from pathlib import Path
from typing import Any

from jinja2 import (
    ChoiceLoader,
    Environment,
    FileSystemLoader,
    Template,
    select_autoescape,
)

from solaire.exam_compiler.choice_layout import (
    choice_option_pairs,
    resolve_choice_layout,
)
from solaire.exam_compiler.latex_jinja_paths import latex_jinja_loader_dirs
from solaire.exam_compiler.latex_util import (
    build_graphicspath_command,
    latex_escape_text,
    latex_safe_label,
)
from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.models import is_choice_type
from solaire.exam_compiler.pipeline.hydrate import HydratedExam, HydratedQuestion
from solaire.exam_compiler.pipeline.primebrush_expand import expand_hydrated_for_latex
from solaire.exam_compiler.pipeline.question_groups import iter_question_runs

_TEMPLATE_CODE_CACHE_MAX_ENTRIES = 64
_TEMPLATE_CODE_CACHE_MAX_BYTES = 8 * 1024 * 1024
_TEMPLATE_CODE_CACHE: OrderedDict[tuple[tuple[str, ...], str, str, str], tuple[CodeType, int]] = OrderedDict()
_TEMPLATE_CODE_CACHE_BYTES = 0
_TEMPLATE_CODE_CACHE_LOCK = RLock()
_TEMPLATE_SECTION_FIELDS = frozenset(
    {"section_id", "type", "actual_type", "score_per_item", "questions", "describe"}
)
_TEMPLATE_QUESTION_FIELDS = frozenset(
    {
        "qualified_id",
        "content",
        "options",
        "choice_layout",
        "choice_option_items",
        "answer",
        "analysis",
        "type",
        "is_choice",
        "group_id",
        "group_material",
        "show_group_material",
        "group_member_index",
        "display_number",
        "item_score",
    }
)


def _jinja_env(loader_dirs: list[Path]) -> Environment:
    loaders = [FileSystemLoader(str(d.resolve())) for d in loader_dirs if d.is_dir()]
    env = Environment(
        loader=ChoiceLoader(loaders),
        autoescape=select_autoescape(
            enabled_extensions=()
        ),  # no HTML autoescape on .tex
        block_start_string="[%",
        block_end_string="%]",
        variable_start_string="[[",
        variable_end_string="]]",
        comment_start_string="[#",
        comment_end_string="#]",
    )

    def latex_escape_filter(s: object) -> str:
        return latex_escape_text("" if s is None else str(s))

    env.filters["latex_escape"] = latex_escape_filter
    env.filters["safe_label"] = lambda s: latex_safe_label(str(s))
    return env


def _compiled_template(env: Environment, template_name: str) -> Template:
    """Load the active template source each time, reusing only matching bytecode."""
    if env.loader is None:
        raise FileNotFoundError(f"No Jinja loader configured for {template_name!r}")
    source, filename, _uptodate = env.loader.get_source(env, template_name)
    if filename is None:
        filename = template_name
    resolved_filename = str(Path(filename).resolve())
    loader_dirs = tuple(
        str(Path(root).resolve())
        for loader in getattr(env.loader, "loaders", (env.loader,))
        for root in getattr(loader, "searchpath", ())
    )
    checksum = hashlib.sha256(source.encode("utf-8")).hexdigest()
    key = (loader_dirs, template_name, resolved_filename, checksum)

    global _TEMPLATE_CODE_CACHE_BYTES
    with _TEMPLATE_CODE_CACHE_LOCK:
        entry = _TEMPLATE_CODE_CACHE.get(key)
        if entry is not None:
            code, _size = entry
            _TEMPLATE_CODE_CACHE.move_to_end(key)
        else:
            code = env.compile(source, name=template_name, filename=filename)
            size = _code_object_size(code)
            if size <= _TEMPLATE_CODE_CACHE_MAX_BYTES:
                _TEMPLATE_CODE_CACHE[key] = (code, size)
                _TEMPLATE_CODE_CACHE_BYTES += size
                while (
                    len(_TEMPLATE_CODE_CACHE) > _TEMPLATE_CODE_CACHE_MAX_ENTRIES
                    or _TEMPLATE_CODE_CACHE_BYTES > _TEMPLATE_CODE_CACHE_MAX_BYTES
                ):
                    _old_key, (_old_code, old_size) = _TEMPLATE_CODE_CACHE.popitem(last=False)
                    _TEMPLATE_CODE_CACHE_BYTES -= old_size
    return Template.from_code(env, code, env.globals, None)


def _code_object_size(code: CodeType) -> int:
    """Estimate retained bytecode size, including nested template blocks."""
    size = 0
    pending = [code]
    while pending:
        current = pending.pop()
        size += sys.getsizeof(current) + len(current.co_code)
        for value in current.co_consts:
            if isinstance(value, CodeType):
                pending.append(value)
            else:
                size += sys.getsizeof(value)
    return size


def _template_question_data(
    hq: HydratedQuestion,
    meta: dict,
    *,
    display_number: str,
    content: str | None = None,
    group_material: str | None = None,
    group_member_index: int | None = None,
) -> dict[str, Any]:
    q = hq.item
    options = dict(sorted(q.options.items())) if q.options else None
    return {
        "qualified_id": hq.qualified_id,
        "content": q.content if content is None else content,
        "options": options,
        "choice_layout": resolve_choice_layout(meta, options) if options else "stack",
        "choice_option_items": choice_option_pairs(options) if options else [],
        "answer": q.answer,
        "analysis": q.analysis,
        "type": q.type,
        "is_choice": is_choice_type(q.type),
        "group_id": q.group_root_id,
        "group_material": group_material,
        "show_group_material": False,
        "group_member_index": group_member_index,
        "display_number": display_number,
        "item_score": hq.item_score,
    }


def _build_section_questions(
    questions: list[HydratedQuestion],
    meta: dict,
) -> list[dict]:
    """Assign numbering and template fields over the shared group-run traversal."""
    qs_out: list[dict] = []
    global_n = 0
    for question_run in iter_question_runs(questions):
        first = question_run.questions[0]
        q = first.item
        if not question_run.grouped:
            global_n += 1
            qs_out.append(
                _template_question_data(first, meta, display_number=str(global_n))
            )
            continue

        material = q.group_material or ""
        if q.unified is False:
            global_n += 1
            major = global_n
            for index, row in enumerate(question_run.questions):
                sub_number = index + 1
                display_number = f"{major}.{sub_number}"
                body = row.item.content
                if index == 0:
                    body = (
                        f"\\noindent\\textbf{{{major}}}.\\par\\smallskip\n"
                        f"{material}\n"
                        f"\\par\\smallskip\n"
                        f"\\textbf{{{display_number}}}\\quad "
                    ) + body
                else:
                    body = f"\\textbf{{{display_number}}}\\quad " + body
                qs_out.append(
                    _template_question_data(
                        row,
                        meta,
                        display_number=display_number,
                        content=body,
                        group_material=material if index == 0 else None,
                        group_member_index=sub_number,
                    )
                )
            continue

        # Concrete unified groups display the material once and number each row globally.
        assert isinstance(q.unified, str)
        for index, row in enumerate(question_run.questions):
            global_n += 1
            display_number = str(global_n)
            body = row.item.content
            if index == 0 and material:
                body = (
                    f"\\par\\vspace{{0.3em}}\\noindent\\begingroup\\small\\textbf{{【材料】}}\\endgroup\\par\n"
                    f"\\noindent {material}\n\\par\\vspace{{0.35em}}\n"
                ) + body
            qs_out.append(
                _template_question_data(
                    row,
                    meta,
                    display_number=display_number,
                    content=body,
                    group_material=material if index == 0 else None,
                    group_member_index=index + 1,
                )
            )
    return qs_out


def render_tex(
    hydrated: HydratedExam,
    template_yaml_dir: Path,
    latex_base: str,
    *,
    show_answers: bool,
) -> str:
    prepared = _prepare_tex_render(hydrated, template_yaml_dir, latex_base)
    return _render_prepared_tex(prepared, show_answers=show_answers)


def _prepare_tex_render(
    hydrated: HydratedExam,
    template_yaml_dir: Path,
    latex_base: str,
) -> tuple[Template, dict[str, Any], str, str, list[dict[str, Any]]]:
    """Prepare template and template-facing data once for one or more renders."""
    dirs = latex_jinja_loader_dirs(template_yaml_dir, latex_base)
    env = _jinja_env(dirs)
    tpl = _compiled_template(env, latex_base)

    meta = hydrated.metadata
    graphic_paths: list[Path] = []
    seen_gp: set[Path] = set()
    for root in hydrated.graphicspath_roots:
        r = root.resolve()
        for p in ((r / "image").resolve(), r):
            if p not in seen_gp:
                seen_gp.add(p)
                graphic_paths.append(p)
    graphicspath_cmd = build_graphicspath_command(graphic_paths)

    sections_data: list[dict[str, Any]] = []
    for sec in hydrated.sections:
        qs = _build_section_questions(sec.questions, meta)
        render_type = "text" if sec.type != "text" and not qs else sec.type
        sections_data.append(
            {
                "section_id": sec.section_id,
                "type": render_type,
                "actual_type": sec.type,
                "score_per_item": sec.score_per_item,
                "questions": qs,
                "describe": sec.describe,
            }
        )

    return tpl, meta, hydrated.exam_id, graphicspath_cmd, sections_data


def _render_prepared_tex(
    prepared: tuple[Template, dict[str, Any], str, str, list[dict[str, Any]]],
    *,
    show_answers: bool,
) -> str:
    tpl, meta, exam_id, graphicspath_cmd, sections_data = prepared
    return tpl.render(
        metadata=meta,
        exam_id=exam_id,
        graphicspath_command=graphicspath_cmd,
        # Custom templates can mutate dictionaries/lists with pop()/update().
        # Keep a fresh, deeply independent tree for the student and teacher paper.
        sections=_sections_for_template(sections_data),
        show_answers=show_answers,
        latex_escape=latex_escape_text,
    )


def _plain_dict_with_fields(value: object, fields: frozenset[str]) -> bool:
    if type(value) is not dict or len(value) != len(fields):
        return False
    return all(type(key) is str and key in fields for key in value)


def _plain_string_or_none(value: object) -> bool:
    return value is None or type(value) is str


def _plain_number_or_none(value: object) -> bool:
    return value is None or type(value) in (int, float)


def _copy_builtin_template_sections(sections: object) -> list[dict[str, Any]] | None:
    """Clone the exact template data shape without copying immutable scalar leaves."""
    if type(sections) is not list:
        return None

    copied_sections: list[dict[str, Any]] = []
    for section in sections:
        if not _plain_dict_with_fields(section, _TEMPLATE_SECTION_FIELDS):
            return None
        if any(type(section[key]) is not str for key in ("section_id", "type", "actual_type")):
            return None
        if not _plain_number_or_none(section["score_per_item"]):
            return None
        if not _plain_string_or_none(section["describe"]):
            return None
        questions = section["questions"]
        if type(questions) is not list:
            return None

        copied_questions: list[dict[str, Any]] = []
        for question in questions:
            if not _plain_dict_with_fields(question, _TEMPLATE_QUESTION_FIELDS):
                return None
            if any(
                type(question[key]) is not str
                for key in (
                    "qualified_id",
                    "content",
                    "choice_layout",
                    "answer",
                    "analysis",
                    "type",
                    "display_number",
                )
            ):
                return None
            if type(question["is_choice"]) is not bool or type(question["show_group_material"]) is not bool:
                return None
            if not _plain_string_or_none(question["group_id"]):
                return None
            if not _plain_string_or_none(question["group_material"]):
                return None
            member_index = question["group_member_index"]
            if member_index is not None and type(member_index) is not int:
                return None
            if not _plain_number_or_none(question["item_score"]):
                return None

            options = question["options"]
            if options is not None and (
                type(options) is not dict
                or any(type(key) is not str or type(value) is not str for key, value in options.items())
            ):
                return None
            option_items = question["choice_option_items"]
            if type(option_items) is not list or any(
                type(pair) is not tuple
                or len(pair) != 2
                or type(pair[0]) is not str
                or type(pair[1]) is not str
                for pair in option_items
            ):
                return None

            copied_questions.append(
                dict(
                    question,
                    options=options.copy() if options is not None else None,
                    choice_option_items=option_items.copy(),
                )
            )
        copied_sections.append(dict(section, questions=copied_questions))
    return copied_sections


def _sections_for_template(sections: object) -> object:
    copied = _copy_builtin_template_sections(sections)
    return deepcopy(sections) if copied is None else copied


def write_student_teacher_tex(
    hydrated: HydratedExam,
    template_yaml_dir: Path,
    latex_base: str,
    work_dir: Path,
    loaded: LoadedQuestions,
) -> tuple[Path, Path]:
    work_dir.mkdir(parents=True, exist_ok=True)
    expand_hydrated_for_latex(hydrated, loaded)
    prepared = _prepare_tex_render(hydrated, template_yaml_dir, latex_base)
    student_tex = work_dir / "student_paper.tex"
    teacher_tex = work_dir / "teacher_paper.tex"
    student_tex.write_text(
        _render_prepared_tex(prepared, show_answers=False),
        encoding="utf-8",
    )
    teacher_tex.write_text(
        _render_prepared_tex(prepared, show_answers=True),
        encoding="utf-8",
    )
    return student_tex, teacher_tex
