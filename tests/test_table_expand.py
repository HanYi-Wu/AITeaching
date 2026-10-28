from __future__ import annotations

import yaml

import pytest

from solaire.exam_compiler.pipeline import table_expand
from solaire.exam_compiler.pipeline.table_expand import (
    expand_tables_for_docx_markdown,
    expand_tables_for_latex,
    parse_table,
    table_to_latex,
    table_to_openxml,
    separate_markdown_tables,
)


TABLE = """version: 1
rows:
  - - text: 项目
      header: true
      rowSpan: 2
    - text: 数值
      header: true
      colSpan: 2
  - - text: $x$
    - text: 说明
"""


def test_word_pipe_tables_keep_a_block_boundary_after_prose_and_question_labels():
    table = "| A | B |\n|---|:---:|\n| 1 | 2 |"
    assert separate_markdown_tables("Question\n" + table) == "Question\n\n" + table
    assert separate_markdown_tables(table) == "\n\n" + table
    example = "```markdown\n" + table + "\n```"
    assert separate_markdown_tables(example) == example


EMPTY_TABLE = """version: 1
rows:
  - - text: ''
    - text: ''
    - text: ''
  - - text: ''
    - text: ''
    - text: ''
  - - text: ''
    - text: ''
    - text: ''
"""


def test_table_to_latex_supports_colspan_and_rowspan() -> None:
    out = table_to_latex(TABLE)

    assert "\\begin{tabular}" in out
    assert "\\providecommand{\\multirow}[3]{#3}" in out
    assert "\\multicolumn{2}" in out
    assert "\\multirow{2}" in out
    assert "$x$" in out


def test_empty_table_to_latex_does_not_require_array_package() -> None:
    out = table_to_latex(EMPTY_TABLE)

    assert "\\begin{tabular}" in out
    assert "\\arraybackslash" not in out
    assert ">{" not in out
    assert "\\multirow" not in out
    assert " &  & " in out


def test_expand_tables_for_latex_replaces_fenced_block() -> None:
    out = expand_tables_for_latex(f"before\n```solaire-table\n{TABLE}```\nafter")

    assert "```solaire-table" not in out
    assert "\\begin{tabular}" in out
    assert "before" in out
    assert "after" in out


def test_table_to_openxml_supports_word_merges() -> None:
    out = table_to_openxml(TABLE)

    assert "<w:tbl" in out
    assert '<w:gridSpan w:val="2"/>' in out
    assert '<w:vMerge w:val="restart"/>' in out
    assert "<w:vMerge/>" in out
    assert "<m:oMath>" in out


def test_expand_tables_for_docx_markdown_emits_raw_openxml() -> None:
    out = expand_tables_for_docx_markdown(f"before\n```solaire-table\n{TABLE}```\nafter")

    assert "```{=openxml}" in out
    assert "<w:tbl" in out
    assert "```solaire-table" not in out


@pytest.mark.parametrize(
    ("converter", "fence"),
    [
        (expand_tables_for_latex, f"```solaire-table\n{TABLE}```"),
        (expand_tables_for_docx_markdown, f"```solaire-table\n{TABLE}```"),
    ],
)
def test_table_converters_expand_validated_grid_once(monkeypatch, converter, fence) -> None:
    calls = 0
    original = table_expand.expand_table

    def counted(rows):
        nonlocal calls
        calls += 1
        return original(rows)

    monkeypatch.setattr(table_expand, "expand_table", counted)

    converter(fence)

    assert calls == 1


def test_table_yaml_safe_loader_preserves_alias_boolean_and_special_numbers() -> None:
    source = """version: 1
shared_row: &cells
  - true
  - false
  - .inf
  - .nan
rows:
  - *cells
"""

    rows = parse_table(source)

    assert [cell.text for cell in rows[0]] == ["True", "False", "inf", "nan"]


def test_table_yaml_safe_loader_keeps_date_and_cell_error_behavior() -> None:
    source = """version: 1
rows:
  - - 2026-10-01
"""

    with pytest.raises(ValueError, match="table cell must be an object"):
        parse_table(source)


@pytest.mark.parametrize("source", ["version: 1\nrows: [", "version: 1\nrows:\n  - - !!python/object/apply:os.system ['echo unsafe']\n"])
def test_table_yaml_safe_loader_rejects_malformed_and_unsafe_tags(source: str) -> None:
    with pytest.raises(yaml.YAMLError) as expected_error:
        yaml.safe_load(source)

    with pytest.raises(type(expected_error.value)) as actual_error:
        parse_table(source)
    assert str(actual_error.value) == str(expected_error.value)


def test_table_parser_still_rejects_invalid_spans() -> None:
    source = """version: 1
rows:
  - - text: merged
      rowSpan: 2
"""

    with pytest.raises(ValueError, match="rowSpan exceeds table height"):
        parse_table(source)
