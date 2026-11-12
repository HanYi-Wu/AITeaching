from __future__ import annotations

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from io import BytesIO
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
import os
import time
import zipfile

import pytest
import yaml

from solaire.exam_compiler.loaders import questions as question_loader
from solaire.exam_compiler.loaders.questions import (
    LoadedQuestions,
    iter_question_files,
    load_all_questions,
    load_questions_from_yaml_file,
)
from solaire.exam_compiler.choice_layout import infer_choice_layout
from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.exam_compiler.pipeline import diagram_expand, docx_resources, primebrush_expand
from solaire.exam_compiler.pipeline import docx_markdown, docx_process, render as tex_render
from solaire.exam_compiler.pipeline import table_expand
from solaire.exam_compiler.pipeline.docx_resources import DocxResourceContext
from solaire.exam_compiler.pipeline.hydrate import (
    HydratedExam,
    HydratedQuestion,
    HydratedSection,
    hydrate,
)
from solaire.exam_compiler.pipeline.prepare import prepare_exam
from solaire.exam_compiler.pipeline.render import write_student_teacher_tex


def _question(qualified_id: str) -> HydratedQuestion:
    return HydratedQuestion(
        qualified_id=qualified_id,
        item=QuestionItem(id=qualified_id.rsplit("/", 1)[-1], type="fill", content="题干", answer="1"),
        item_score=1.0,
    )


def test_question_file_discovery_deduplicates_symlink_aliases(tmp_path: Path) -> None:
    library = tmp_path / "library"
    alias_dir = library / "aliases"
    alias_dir.mkdir(parents=True)
    question = library / "q1.yaml"
    question.write_text("id: q1\n", encoding="utf-8")
    (library / "questions.yaml").write_text("questions: []\n", encoding="utf-8")
    try:
        (alias_dir / "q1-alias.yaml").symlink_to(question)
    except OSError as exc:
        pytest.skip(f"file symlinks are unavailable: {exc}")

    discovered = list(iter_question_files(library))
    assert len(discovered) == 1
    assert discovered[0].resolve() == question.resolve()


def test_question_file_discovery_does_not_swallow_permission_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    library = tmp_path / "library"
    library.mkdir()
    question = library / "q1.yaml"
    question.write_text("id: q1\n", encoding="utf-8")
    original_lstat = Path.lstat

    def deny_question(path: Path) -> os.stat_result:
        if path == question:
            raise PermissionError("question file is not readable")
        return original_lstat(path)

    monkeypatch.setattr(Path, "lstat", deny_question)
    with pytest.raises(PermissionError, match="not readable"):
        list(iter_question_files(library))


def test_question_file_discovery_skips_missing_path_race_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    library = tmp_path / "library"
    library.mkdir()
    question = library / "q1.yaml"
    question.write_text("id: q1\n", encoding="utf-8")
    original_lstat = Path.lstat

    def disappear(path: Path) -> os.stat_result:
        if path == question:
            raise NotADirectoryError("parent was replaced during discovery")
        return original_lstat(path)

    monkeypatch.setattr(Path, "lstat", disappear)
    assert list(iter_question_files(library)) == []


def test_question_file_discovery_deduplicates_junctioned_parent_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    library = tmp_path / "library"
    real_dir = library / "real"
    alias_dir = library / "alias"
    real_dir.mkdir(parents=True)
    alias_dir.mkdir()
    (real_dir / "q1.yaml").write_text("id: q1\n", encoding="utf-8")
    (alias_dir / "q1.yaml").write_text("id: q1\n", encoding="utf-8")

    original_resolve = Path.resolve

    def resolve_with_junction(path: Path, *, strict: bool = False) -> Path:
        if path == alias_dir:
            return original_resolve(real_dir, strict=strict)
        return original_resolve(path, strict=strict)

    monkeypatch.setattr(Path, "resolve", resolve_with_junction)

    assert len(list(iter_question_files(library))) == 1


def test_question_loader_rejects_unsafe_yaml(tmp_path: Path) -> None:
    question_file = tmp_path / "unsafe.yaml"
    question_file.write_text(
        "!!python/object/apply:os.system ['echo unsafe']\n",
        encoding="utf-8",
    )

    with pytest.raises(yaml.YAMLError):
        load_questions_from_yaml_file(question_file, "math/set")


def test_question_parse_cache_sees_same_size_edit_and_returns_private_models(tmp_path: Path) -> None:
    question_file = tmp_path / "q1.yaml"
    first_source = (
        "id: q1\ntype: single_choice\ncontent: prompt\noptions:\n  A: one\n  B: two\n"
        "answer: A\nmetadata:\n  labels: [original]\n"
    )
    second_source = first_source.replace("answer: A\n", "answer: B\n")
    assert len(first_source.encode("utf-8")) == len(second_source.encode("utf-8"))
    question_file.write_text(first_source, encoding="utf-8")

    first = load_questions_from_yaml_file(question_file, "math/set")[0]
    assert isinstance(first, QuestionItem)
    original_stat = question_file.stat()
    first.content = "caller mutation"
    first.metadata["labels"].append("caller mutation")

    cached = load_questions_from_yaml_file(question_file, "math/set")[0]
    assert isinstance(cached, QuestionItem)
    assert cached.content == "prompt"
    assert cached.metadata == {"labels": ["original"]}

    question_file.write_text(second_source, encoding="utf-8")
    question_file.touch()
    import os

    os.utime(question_file, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
    edited = load_questions_from_yaml_file(question_file, "math/set")[0]
    assert isinstance(edited, QuestionItem)
    assert edited.answer == "B"


def test_question_parse_cache_admits_only_after_second_miss(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    question_file = tmp_path / "q1.yaml"
    question_file.write_text("id: cached\ntype: fill\ncontent: stem\nanswer: A\n", encoding="utf-8")
    cache = question_loader._QuestionParseCache()
    monkeypatch.setattr(question_loader, "_QUESTION_PARSE_CACHE", cache)
    original_load = question_loader._load_yaml_text
    calls = 0

    def counted_load(path: Path, text: str) -> object:
        nonlocal calls
        calls += 1
        return original_load(path, text)

    monkeypatch.setattr(question_loader, "_load_yaml_text", counted_load)
    load_questions_from_yaml_file(question_file, "math/set")
    assert calls == 1
    assert not cache._items

    load_questions_from_yaml_file(question_file, "math/set")
    assert calls == 2
    assert len(cache._items) == 1

    load_questions_from_yaml_file(question_file, "math/set")
    assert calls == 2


def test_selected_question_loading_copies_only_requested_cached_records(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    library = tmp_path / "library"
    library.mkdir()
    question_file = library / "batch.yaml"
    source = yaml.safe_dump(
        [
            {
                "id": f"q{index}",
                "type": "fill",
                "content": f"prompt {index}",
                "answer": "A",
                "metadata": {"labels": [f"label-{index}"]},
            }
            for index in range(3)
        ],
        allow_unicode=True,
        sort_keys=False,
    )
    question_file.write_text(source, encoding="utf-8")
    exam_yaml = tmp_path / "exam.yaml"
    refs = [("selected-cache", str(library))]
    cache = question_loader._QuestionParseCache()
    monkeypatch.setattr(question_loader, "_QUESTION_PARSE_CACHE", cache)

    first = load_all_questions(exam_yaml, refs)
    second = load_all_questions(exam_yaml, refs)
    assert len(first.by_qualified) == len(second.by_qualified) == 3
    assert len(cache._items) == 1

    original_deepcopy = question_loader.deepcopy
    copied_record_counts: list[int] = []

    def counted_deepcopy(value):
        if isinstance(value, list) and value and all(isinstance(row, QuestionItem) for row in value):
            copied_record_counts.append(len(value))
        return original_deepcopy(value)

    monkeypatch.setattr(question_loader, "deepcopy", counted_deepcopy)
    selected_ids = {"selected-cache/q1"}
    selected = load_all_questions(exam_yaml, refs, selected_qualified_ids=selected_ids)
    assert list(selected.by_qualified) == ["selected-cache/q1"]
    assert selected.library_roots == second.library_roots
    assert copied_record_counts == [1]

    selected.by_qualified["selected-cache/q1"].metadata["labels"].append("caller change")
    again = load_all_questions(exam_yaml, refs, selected_qualified_ids=selected_ids)
    assert again.by_qualified["selected-cache/q1"].metadata == {"labels": ["label-1"]}

    original_stat = question_file.stat()
    edited = source.replace("content: prompt 1", "content: edited 1")
    assert len(edited.encode("utf-8")) == len(source.encode("utf-8"))
    question_file.write_text(edited, encoding="utf-8")
    os.utime(question_file, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
    changed = load_all_questions(exam_yaml, refs, selected_qualified_ids=selected_ids)
    assert changed.by_qualified["selected-cache/q1"].content == "edited 1"
    assert len(changed.by_qualified) == 1


def test_selected_question_loading_still_checks_unselected_duplicates(tmp_path: Path) -> None:
    library = tmp_path / "library"
    library.mkdir()
    (library / "01.yaml").write_text(
        "- id: selected\n  type: fill\n  content: stem\n  answer: A\n"
        "- id: hidden\n  type: fill\n  content: stem\n  answer: A\n",
        encoding="utf-8",
    )
    (library / "02.yaml").write_text(
        "id: hidden\ntype: fill\ncontent: second\nanswer: B\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Duplicate question id 'hidden'"):
        load_all_questions(
            tmp_path / "exam.yaml",
            [("selected-duplicate", str(library))],
            selected_qualified_ids={"selected-duplicate/selected"},
        )


def test_selected_question_loading_still_parses_unselected_records(tmp_path: Path) -> None:
    library = tmp_path / "library"
    library.mkdir()
    (library / "batch.yaml").write_text(
        "- id: selected\n  type: fill\n  content: stem\n  answer: A\n"
        "- id: malformed\n  type: unsupported\n  content: ignored\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Invalid questions file.*unknown or missing type"):
        load_all_questions(
            tmp_path / "exam.yaml",
            [("selected-invalid", str(library))],
            selected_qualified_ids={"selected-invalid/selected"},
        )


def test_selected_preview_uses_normalized_ids_but_default_prepare_keeps_full_library(
    tmp_path: Path,
) -> None:
    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    (library / "batch.yaml").write_text(
        yaml.safe_dump(
            [
                {"id": f"q{index}", "type": "fill", "content": f"stem {index}", "answer": "A"}
                for index in range(1, 6)
            ],
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    template_path = tmp_path / "template.yaml"
    template_path.write_text(
        "template_id: preview-selection\n"
        "layout: single_column\n"
        "latex_base: paper.tex.j2\n"
        "sections:\n"
        "  - section_id: A\n"
        "    type: fill\n"
        "    required_count: 1\n"
        "    score_per_item: 1\n"
        "  - section_id: T\n"
        "    type: text\n"
        "    required_count: 0\n"
        "    score_per_item: 0\n",
        encoding="utf-8",
    )
    (tmp_path / "paper.tex.j2").write_text(
        "[% for section in sections %]\n"
        "\\section*{[[ section.section_id ]]}\n"
        "[% for question in section.questions %]\n"
        "[[ question.qualified_id ]]: [[ question.content ]]\n"
        "[% endfor %]\n"
        "[% endfor %]\n",
        encoding="utf-8",
    )
    exam_path = tmp_path / "exam.yaml"
    exam_path.write_text(
        yaml.safe_dump(
            {
                "exam_id": "preview-selection",
                "template_ref": "preview-selection",
                "template_path": str(template_path),
                "question_libraries": [{"path": str(library), "namespace": "preview-bank"}],
                "selected_items": [
                    {"section_id": "A", "question_ids": ["preview-bank/q1", "preview-bank/q2"]},
                    {"section_id": "T", "question_ids": ["preview-bank/q4"]},
                    {"section_id": "obsolete", "question_ids": ["preview-bank/q3"]},
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    full = prepare_exam(exam_path, preview_relaxed=True)
    selected = prepare_exam(
        exam_path,
        preview_relaxed=True,
        selected_questions_only=True,
    )

    assert set(full.loaded.by_qualified) == {f"preview-bank/q{index}" for index in range(1, 6)}
    assert set(selected.loaded.by_qualified) == {f"preview-bank/q{index}" for index in range(1, 5)}
    normalized_ids = {
        qid for section in selected.exam.selected_items for qid in section.question_ids
    }
    assert normalized_ids <= {"preview-bank/q1", "preview-bank/q2", "preview-bank/q3", "preview-bank/q4"}
    assert selected.exam.model_dump(mode="json") == full.exam.model_dump(mode="json")
    assert selected.preview_warnings == full.preview_warnings
    assert selected.loaded.library_roots == full.loaded.library_roots
    full_hydrated = hydrate(full.exam, full.template, full.loaded)
    selected_hydrated = hydrate(selected.exam, selected.template, selected.loaded)
    full_tex = write_student_teacher_tex(
        full_hydrated, template_path.parent, full.template.latex_base, tmp_path / "full-work", full.loaded
    )
    selected_tex = write_student_teacher_tex(
        selected_hydrated,
        template_path.parent,
        selected.template.latex_base,
        tmp_path / "selected-work",
        selected.loaded,
    )
    assert [path.read_bytes() for path in full_tex] == [path.read_bytes() for path in selected_tex]

    valid_exam_path = tmp_path / "valid_exam.yaml"
    valid_exam_path.write_text(
        yaml.safe_dump(
            {
                "exam_id": "normal-selection",
                "template_ref": "preview-selection",
                "template_path": str(template_path),
                "question_libraries": [{"path": str(library), "namespace": "preview-bank"}],
                "selected_items": [
                    {"section_id": "A", "question_ids": ["preview-bank/q1"]},
                    {"section_id": "T", "question_ids": []},
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    normal_full = prepare_exam(valid_exam_path)
    normal_selected = prepare_exam(valid_exam_path, selected_questions_only=True)
    assert set(normal_full.loaded.by_qualified) == {f"preview-bank/q{index}" for index in range(1, 6)}
    assert set(normal_selected.loaded.by_qualified) == {"preview-bank/q1"}


def test_selected_preview_defers_template_failure_until_after_library_errors(tmp_path: Path) -> None:
    library = tmp_path / "library"
    library.mkdir()
    (library / "01.yaml").write_text(
        "id: duplicate\ntype: fill\ncontent: first\nanswer: A\n",
        encoding="utf-8",
    )
    (library / "02.yaml").write_text(
        "id: duplicate\ntype: fill\ncontent: second\nanswer: B\n",
        encoding="utf-8",
    )
    exam_path = tmp_path / "exam.yaml"
    exam_path.write_text(
        yaml.safe_dump(
            {
                "exam_id": "error-order",
                "template_ref": "missing-template",
                "template_path": str(tmp_path / "missing.yaml"),
                "question_libraries": [{"path": str(library), "namespace": "error-order-bank"}],
                "selected_items": [],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError) as full_error:
        prepare_exam(exam_path, preview_relaxed=True)
    with pytest.raises(ValueError) as selected_error:
        prepare_exam(exam_path, preview_relaxed=True, selected_questions_only=True)

    assert str(selected_error.value) == str(full_error.value)
    assert "Duplicate question id 'duplicate'" in str(selected_error.value)


def test_question_parse_cache_does_not_keep_failed_parse(tmp_path: Path) -> None:
    question_file = tmp_path / "q1.yaml"
    question_file.write_text("id: q1\ntype: missing\n", encoding="utf-8")
    with pytest.raises(ValueError, match="unknown or missing type"):
        load_questions_from_yaml_file(question_file, "math/set")

    question_file.write_text("id: q1\ntype: fill\ncontent: prompt\nanswer: A\n", encoding="utf-8")
    loaded = load_questions_from_yaml_file(question_file, "math/set")
    assert len(loaded) == 1
    assert isinstance(loaded[0], QuestionItem)
    assert loaded[0].content == "prompt"


@pytest.mark.parametrize(
    "source",
    [
        {
            "id": "mixed",
            "type": "group",
            "material": "passage",
            "unified": False,
            "items": [
                {"type": "single_choice", "content": "choice", "options": {"A": "x"}, "answer": "A", "metadata": {"tag": [1]}},
                {"type": "fill", "content": "fill", "answer": "B"},
            ],
        },
        {
            "id": "unified",
            "type": "group",
            "material": "passage",
            "unified": "fill",
            "items": [{"content": "fill", "answer": "B"}, {"content": "fill2", "answer": "C"}],
        },
    ],
)
def test_group_flatten_is_lazy_compatible_and_isolates_each_expansion(source: dict) -> None:
    group = QuestionGroupRecord.model_validate(source)
    flattened = group.flatten()
    streamed = list(group.iter_flattened())

    assert [row.model_dump(mode="json") for row in flattened] == [
        row.model_dump(mode="json") for row in streamed
    ]
    assert all(left is not right for left, right in zip(flattened, streamed))
    assert len({id(row.metadata) for row in flattened}) == len(flattened)
    if flattened and flattened[0].options is not None:
        assert len({id(row.options) for row in flattened if row.options is not None}) == sum(
            row.options is not None for row in flattened
        )
    flattened[0].metadata.setdefault("caller", []).append("change")
    assert "caller" not in group.items[0].metadata
    assert "caller" not in list(group.iter_flattened())[0].metadata
    if "tag" in group.items[0].metadata:
        assert flattened[0].metadata["tag"] is not group.items[0].metadata["tag"]


def test_group_metadata_copy_preserves_yaml_aliases_cycles_and_scalar_values() -> None:
    shared = {"tags": ["shared"]}
    recursive: list[object] = []
    recursive.append(recursive)
    metadata = {
        "left": shared,
        "right": shared,
        "recursive": recursive,
        "created": date(2026, 11, 10),
    }
    group = QuestionGroupRecord.model_validate(
        {
            "id": "metadata",
            "type": "group",
            "material": "passage",
            "unified": False,
            "items": [{"type": "fill", "content": "stem", "answer": "A", "metadata": metadata}],
        }
    )

    first = group.flatten()[0].metadata
    second = group.flatten()[0].metadata
    assert first["left"] is first["right"]
    assert first["left"] is not group.items[0].metadata["left"]
    assert first["recursive"][0] is first["recursive"]
    assert first["recursive"] is not second["recursive"]
    assert first["created"] == date(2026, 11, 10)


def test_question_loader_preserves_yaml_metadata_aliases_and_cycles(tmp_path: Path) -> None:
    question_file = tmp_path / "group.yaml"
    question_file.write_text(
        "id: yaml_metadata\n"
        "type: group\n"
        "material: passage\n"
        "unified: false\n"
        "items:\n"
        "  - type: fill\n"
        "    content: stem\n"
        "    answer: A\n"
        "    metadata:\n"
        "      shared: &shared\n"
        "        tags: [yaml]\n"
        "      left: *shared\n"
        "      right: *shared\n"
        "      recursive: &cycle [*cycle]\n",
        encoding="utf-8",
    )

    group = load_questions_from_yaml_file(question_file, "math/set")[0]
    assert isinstance(group, QuestionGroupRecord)
    source = group.items[0].metadata
    assert source["left"] is source["right"]

    flattened = group.flatten()[0].metadata
    assert flattened["left"] is flattened["right"]
    assert flattened["left"] is not source["left"]
    assert flattened["recursive"][0] is flattened["recursive"]


def test_choice_layout_cache_uses_current_mutable_option_values() -> None:
    options = {"A": "x", "B": "y"}
    assert infer_choice_layout(options) == "inline_one_line"

    options["A"] = "x" * 50
    options["B"] = "y" * 50
    assert infer_choice_layout(options) == "stack"


def test_table_plan_is_reused_across_outputs_and_parse_rows_are_private(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = "version: 1\nrows:\n  - [left, right]\n  - [top, bottom]\n"
    table_expand._cached_table_plan.cache_clear()
    original_expand = table_expand.expand_table
    original_parse = table_expand._parse_table_rows
    calls = 0
    parse_calls = 0

    def counted_expand(rows):
        nonlocal calls
        calls += 1
        return original_expand(rows)

    def counted_parse(source: str):
        nonlocal parse_calls
        parse_calls += 1
        return original_parse(source)

    monkeypatch.setattr(table_expand, "expand_table", counted_expand)
    monkeypatch.setattr(table_expand, "_parse_table_rows", counted_parse)
    latex = table_expand.table_to_latex(source)
    openxml = table_expand.table_to_openxml(source)
    parsed = table_expand.parse_table(source)
    assert calls == 3
    assert parse_calls == 1
    assert "left" in latex
    assert "<w:t xml:space=\"preserve\">left</w:t>" in openxml

    parsed[0][0] = table_expand.TableCell(text="caller mutation")
    assert table_expand.parse_table(source)[0][0].text == "left"
    table_expand._cached_table_plan.cache_clear()


def test_group_flatten_revalidates_rows_mutated_after_parse() -> None:
    group = QuestionGroupRecord.model_validate(
        {
            "id": "mutable",
            "type": "group",
            "material": "passage",
            "unified": False,
            "items": [{"type": "fill", "content": "before", "answer": "A"}],
        }
    )
    group.items[0].content = 7

    with pytest.raises(Exception, match="content"):
        group.flatten()


def test_docx_render_cache_reuses_same_plain_text_across_question_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    context = DocxResourceContext()
    loaded = LoadedQuestions()
    media_dir = tmp_path / "media"
    original = docx_resources.expand_tables_for_docx_markdown
    calls = 0

    def counted(text: str) -> str:
        nonlocal calls
        calls += 1
        return original(text)

    monkeypatch.setattr(docx_resources, "expand_tables_for_docx_markdown", counted)
    text = r"\textbf{共享题面}，$\e^x$。"
    first = docx_resources._render_text(text, _question("math/set/q1"), loaded, media_dir, context=context)
    second = docx_resources._render_text(text, _question("math/set/q2"), loaded, media_dir, context=context)

    assert first == second == r"**共享题面**，$\mathrm{e}^x$。"
    assert calls == 1


def test_docx_render_cache_rechecks_embedded_resource_existence(tmp_path: Path) -> None:
    project_root = tmp_path
    library = project_root / "resource" / "math" / "set"
    image = library / "image" / "figure.png"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"image")
    loaded = LoadedQuestions(library_roots={"math/set": library})
    context = DocxResourceContext()
    media_dir = tmp_path / "exam" / "docx" / "media"
    text = "题面 :::EMBED_IMG:math/set/image/figure.png::: 结束"

    rendered = docx_resources._render_text(
        text, _question("math/set/q1"), loaded, media_dir, context=context
    )
    assert "![](media/" in rendered

    image.unlink()
    rendered_after_removal = docx_resources._render_text(
        text, _question("math/set/q1"), loaded, media_dir, context=context
    )
    assert ":::EMBED_IMG:math/set/image/figure.png:::" in rendered_after_removal
    assert "![](media/" not in rendered_after_removal


def test_tex_expansion_resolves_each_library_root_once_per_export(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    questions = [_question("math/set/q1"), _question("math/set/q2")]
    hydrated = HydratedExam(
        exam_id="bench",
        metadata={},
        sections=[
            HydratedSection(
                section_id="Fill",
                type="fill",
                score_per_item=1.0,
                questions=questions,
            )
        ],
    )
    loaded = LoadedQuestions(library_roots={"math/set": library})
    original = diagram_expand.project_root_from_library_root
    calls = 0

    def counted(root: Path) -> Path:
        nonlocal calls
        calls += 1
        return original(root)

    monkeypatch.setattr(diagram_expand, "project_root_from_library_root", counted)
    primebrush_expand.expand_hydrated_for_latex(hydrated, loaded)

    assert calls == 1
    assert [question.item.content for question in questions] == ["题干", "题干"]


def test_docx_student_teacher_pair_matches_legacy_output_and_projects_once(tmp_path: Path) -> None:
    ordinary = QuestionItem(
        id="ordinary",
        type="single_choice",
        content=r"\textbf{普通题干}",
        options={"B": "选项乙", "A": "选项甲"},
        answer="A",
        analysis="普通解析",
    )
    mixed_first = QuestionItem(
        id="mixed__01",
        type="fill",
        content="材料题第一问",
        answer="填空一",
        analysis="第一问解析",
        group_material="共用材料",
        unified=False,
        group_root_id="mixed",
    )
    mixed_second = QuestionItem(
        id="mixed__02",
        type="fill",
        content="材料题第二问",
        answer="填空二",
        group_material="共用材料",
        unified=False,
        group_root_id="mixed",
    )
    unified_first = QuestionItem(
        id="unified__01",
        type="fill",
        content="统一组第一问",
        answer="统一答案一",
        group_material="统一材料",
        unified="fill",
        group_root_id="unified",
    )
    unified_second = QuestionItem(
        id="unified__02",
        type="fill",
        content="统一组第二问",
        answer="统一答案二",
        group_material="统一材料",
        unified="fill",
        group_root_id="unified",
    )
    hydrated = HydratedExam(
        exam_id="projection",
        metadata={"title": "共享投影", "subject": "数学", "show_name_column": True},
        sections=[
            HydratedSection(
                section_id="选择与填空",
                type="mixed",
                score_per_item=1.0,
                describe="说明文字",
                questions=[
                    HydratedQuestion("math/set/ordinary", ordinary, 1.0),
                    HydratedQuestion("math/set/mixed", mixed_first, 1.0),
                    HydratedQuestion("math/set/mixed", mixed_second, 1.0),
                    HydratedQuestion("math/set/unified", unified_first, 1.0),
                    HydratedQuestion("math/set/unified", unified_second, 1.0),
                ],
            )
        ],
    )
    loaded = LoadedQuestions()
    rendered: Counter[tuple[str, str]] = Counter()

    def render_text(text: str, question: HydratedQuestion, _loaded: LoadedQuestions, _media: Path) -> str:
        rendered[(question.qualified_id, text)] += 1
        return text

    student, teacher = docx_markdown.render_docx_markdown_pair(
        hydrated,
        loaded,
        tmp_path / "media",
        render_text=render_text,
        clean_text=docx_resources._clean_latex_for_markdown,
    )
    assert rendered[("math/set/ordinary", r"\textbf{普通题干}")] == 1
    assert rendered[("math/set/mixed", "材料题第一问")] == 1
    assert rendered[("math/set/mixed", "共用材料")] == 1
    assert rendered[("math/set/unified", "统一材料")] == 1
    assert rendered[("math/set/ordinary", "普通解析")] == 1

    legacy_student = docx_markdown.render_docx_markdown(
        hydrated,
        loaded,
        tmp_path / "media",
        show_answers=False,
        render_text=lambda text, *_args: text,
        clean_text=docx_resources._clean_latex_for_markdown,
    )
    legacy_teacher = docx_markdown.render_docx_markdown(
        hydrated,
        loaded,
        tmp_path / "media",
        show_answers=True,
        render_text=lambda text, *_args: text,
        clean_text=docx_resources._clean_latex_for_markdown,
    )
    assert student == legacy_student
    assert teacher == legacy_teacher
    assert "普通解析" not in student
    assert "普通解析" in teacher
    assert "**1.**" in student and "**2.1.**" in student and "**4.**" in student


def test_tex_template_bytecode_cache_checks_source_and_loader_priority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hydrated = HydratedExam(exam_id="cache", metadata={"title": "可变标题"}, sections=[])
    project = tmp_path / "project"
    bundled = tmp_path / "bundled"
    project.mkdir()
    bundled.mkdir()
    primary = project / "paper.tex.j2"
    primary.write_text("[[ metadata.title ]]", encoding="utf-8")

    compile_calls = 0
    original_compile = tex_render.Environment.compile

    def counted_compile(self, *args, **kwargs):
        nonlocal compile_calls
        compile_calls += 1
        return original_compile(self, *args, **kwargs)

    monkeypatch.setattr(tex_render.Environment, "compile", counted_compile)
    monkeypatch.setattr(tex_render, "latex_jinja_loader_dirs", lambda *_args: [project, bundled])
    first = tex_render._prepare_tex_render(hydrated, project, "paper.tex.j2")
    second = tex_render._prepare_tex_render(hydrated, project, "paper.tex.j2")
    assert tex_render._render_prepared_tex(first, show_answers=False) == "可变标题"
    assert tex_render._render_prepared_tex(second, show_answers=True) == "可变标题"
    assert compile_calls == 1

    before = primary.stat()
    primary.write_text("新内容:[[ metadata.title ]]", encoding="utf-8")
    os.utime(primary, ns=(before.st_atime_ns, before.st_mtime_ns))
    changed = tex_render._prepare_tex_render(hydrated, project, "paper.tex.j2")
    assert tex_render._render_prepared_tex(changed, show_answers=False) == "新内容:可变标题"
    assert compile_calls == 2

    lower = bundled / "paper.tex.j2"
    lower.write_text("同一内容:[[ metadata.title ]]", encoding="utf-8")
    primary.write_text("同一内容:[[ metadata.title ]]", encoding="utf-8")
    preferred = tex_render._prepare_tex_render(hydrated, project, "paper.tex.j2")
    assert tex_render._render_prepared_tex(preferred, show_answers=False) == "同一内容:可变标题"
    assert compile_calls == 3
    primary.unlink()
    fallback = tex_render._prepare_tex_render(hydrated, project, "paper.tex.j2")
    assert tex_render._render_prepared_tex(fallback, show_answers=False) == "同一内容:可变标题"
    assert compile_calls == 4


def _reference_docx_fixture() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "word/styles.xml",
            '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        )
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
        )
    return buffer.getvalue()


def test_shared_reference_docx_is_initialized_once_for_concurrent_exports(tmp_path: Path) -> None:
    reference = tmp_path / "docx" / "gaokao_reference.docx"
    source = _reference_docx_fixture()
    calls = 0
    calls_lock = Lock()

    def fake_pandoc(_args, **_kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
        time.sleep(0.03)
        return SimpleNamespace(returncode=0, stdout=source, stderr=b"")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(
                lambda _index: docx_process._ensure_gaokao_reference_docx(
                    reference, "pandoc", subprocess_run=fake_pandoc
                ),
                range(8),
            )
        )

    assert calls == 1
    assert all(path == reference for path in results)
    assert zipfile.is_zipfile(reference)
    with zipfile.ZipFile(reference) as archive:
        assert archive.testzip() is None
        assert "word/styles.xml" in archive.namelist()
        assert "word/document.xml" in archive.namelist()


def test_failed_pandoc_output_keeps_previous_docx(tmp_path: Path) -> None:
    markdown = tmp_path / "paper.md"
    markdown.write_text("paper", encoding="utf-8")
    output = tmp_path / "paper.docx"
    output.write_bytes(b"previous-final")
    reference = tmp_path / "reference.docx"

    def failed_pandoc(command, **kwargs):
        output_name = command[command.index("-o") + 1]
        (Path(kwargs["cwd"]) / output_name).write_bytes(b"partial-output")
        return SimpleNamespace(returncode=7, stdout="conversion failed", stderr="bad input")

    with pytest.raises(docx_process.PandocError):
        docx_process._run_pandoc(
            markdown,
            output,
            pandoc_path="pandoc",
            reference_docx=reference,
            subprocess_run=failed_pandoc,
        )

    assert output.read_bytes() == b"previous-final"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["paper.docx", "paper.md"]
