from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml
from fastapi import HTTPException

from solaire.exam_compiler.facade import strip_primebrush_fences_for_preview
from solaire.web.bank_service import (
    _preview,
    bank_catalog,
    get_question_detail,
    list_question_rows_for_web,
)
from solaire.web.bank_reads import preview_text


def _write_question(path: Path, qid: str, content: str = "题目内容") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(
            {"id": qid, "type": "fill", "content": content, "answer": "", "analysis": ""},
            allow_unicode=True,
        ),
        encoding="utf-8",
    )


def test_preview_fast_path_matches_legacy_preview() -> None:
    cases = [
        "",
        "   多行\n普通\t文本  ",
        "```solaire-table\n|A|B|\n```",
        "```mermaid\ngraph LR; A-->B\n```",
        ":::EMBED_IMG:数学/代数/image.png:::",
        "plain " * 2_500,
    ]
    for text in cases:
        legacy = strip_primebrush_fences_for_preview(text, max_len=10_000).replace("\n", " ")
        for size in (1, 40, 200, 12_000):
            expected = legacy if len(legacy) <= size else legacy[: size - 3] + "..."
            assert preview_text(text, size) == expected
            assert _preview(text, size) == expected


def test_catalog_and_picker_do_not_expose_hydrate_only_fields(tmp_path: Path) -> None:
    project = tmp_path / "project"
    library = project / "resource" / "数学" / "代数"
    library.mkdir(parents=True)
    record = {
        "id": "q1",
        "type": "fill",
        "content": "题目",
        "answer": "答案",
        "analysis": "解析",
        "group_material": "hydrate material",
        "unified": "choice",
        "group_root_id": "old-root",
        "group_member_index": 2,
    }
    (library / "q1.yaml").write_text(yaml.safe_dump(record, allow_unicode=True), encoding="utf-8")

    catalog, diagnostics = bank_catalog(project)
    rows, row_diagnostics = list_question_rows_for_web(project)
    assert diagnostics == []
    assert row_diagnostics == []
    assert catalog[0]["content_preview"] == "题目"
    assert rows[0]["content"] == "题目"
    assert rows[0]["answer"] == "答案"
    assert rows[0]["group_material"] is None


def test_detail_lookup_keeps_duplicate_id_error_for_same_and_different_files(tmp_path: Path) -> None:
    project = tmp_path / "project"
    library = project / "resource" / "数学" / "代数"
    _write_question(library / "q1.yaml", "q1", "规范文件")
    _write_question(library / "other.yaml", "q1", "同名ID在另一文件")

    with pytest.raises(ValueError, match="重复题目编号"):
        get_question_detail(project, "数学/代数/q1")

    (library / "other.yaml").unlink()
    document = [
        {"id": "q1", "type": "fill", "content": "第一条", "answer": ""},
        {"id": "q1", "type": "fill", "content": "第二条", "answer": ""},
    ]
    (library / "q1.yaml").write_text(yaml.safe_dump(document, allow_unicode=True), encoding="utf-8")
    with pytest.raises(ValueError, match="重复题目编号"):
        get_question_detail(project, "数学/代数/q1")


def test_detail_lookup_falls_back_when_canonical_filename_has_another_id(tmp_path: Path) -> None:
    project = tmp_path / "project"
    library = project / "resource" / "数学" / "代数"
    _write_question(library / "q1.yaml", "different", "同名文件中的其他题目")
    _write_question(library / "legacy_pack.yaml", "q1", "非规范文件名中的目标题目")

    detail = get_question_detail(project, "数学/代数/q1")
    assert detail["storage_path"] == "数学/代数/legacy_pack.yaml"
    assert detail["question"]["content"] == "非规范文件名中的目标题目"


def test_detail_lookup_rejects_symlink_outside_project(tmp_path: Path) -> None:
    project = tmp_path / "project"
    library = project / "resource" / "数学" / "代数"
    library.mkdir(parents=True)
    external = tmp_path / "outside.yaml"
    _write_question(external, "q1", "项目外内容")
    link = library / "q1.yaml"
    try:
        os.symlink(external, link)
    except (OSError, NotImplementedError) as error:
        pytest.skip(f"symlink creation is unavailable in this environment: {error}")

    with pytest.raises(HTTPException) as error:
        get_question_detail(project, "数学/代数/q1")
    assert error.value.status_code == 400
