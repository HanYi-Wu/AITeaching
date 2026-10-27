from __future__ import annotations

import io
from pathlib import Path
import zipfile

import pytest
import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import QuestionItem
from solaire.exam_compiler.pipeline import diagram_expand
from solaire.web import bank_storage, state
from solaire.web.bank_exchange import import_bank_exchange_zip
from solaire.web.bank_service import (
    create_question_selection_export,
    get_question_detail,
    import_merged_yaml,
    list_bank_entries,
    save_bank_record,
)
from solaire.web.bank_storage import BankVersionConflict


def question(qid: str, content: str = "question") -> dict[str, str]:
    return {"id": qid, "type": "fill", "content": content, "answer": "1"}


def write_question(path: Path, qid: str, content: str = "question") -> None:
    path.write_text(yaml.safe_dump(question(qid, content), allow_unicode=True), encoding="utf-8")


def test_selection_export_scans_once_and_does_not_expand_graphs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    total, selected = 8, 4
    for index in range(total):
        write_question(
            library / f"q{index}.yaml",
            f"q{index}",
            f"question {index}\n```mermaid\ngraph LR; A{index}-->B{index}\n```",
        )

    parsed: list[Path] = []
    rendered: list[Path] = []
    original_read = bank_storage.read_bank_document

    def count_parse(path: Path):
        parsed.append(path)
        return original_read(path)

    def count_render(_body: str, path: Path) -> None:
        rendered.append(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("<svg/>", encoding="utf-8")

    monkeypatch.setattr(bank_storage, "read_bank_document", count_parse)
    monkeypatch.setattr(diagram_expand, "render_mermaid_to_svg_file", count_render)

    exported = create_question_selection_export(tmp_path, [f"math/set/q{i}" for i in range(selected)])

    assert exported["question_count"] == selected
    assert len(parsed) == total
    assert rendered == []
    assert not (library / "image").exists()
    assert "```mermaid" in (tmp_path / ".solaire" / "exports" / exported["filename"]).read_text(encoding="utf-8")


def test_corrupt_unrelated_yaml_is_diagnosed_without_blocking_healthy_read_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from solaire.web.app import app

    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    good = library / "q1.yaml"
    damaged = library / "damaged.yaml"
    write_question(good, "q1", "before")
    damaged.write_text("id: [broken\n", encoding="utf-8")
    damaged_original = damaged.read_bytes()

    detail = get_question_detail(tmp_path, "math/set/q1")
    save_bank_record(
        tmp_path,
        "math/set/q1",
        QuestionItem.model_validate(question("q1", "after")),
        expected_version=detail["version"],
    )
    with pytest.raises(BankVersionConflict):
        save_bank_record(
            tmp_path,
            "math/set/q1",
            QuestionItem.model_validate(question("q1", "stale")),
            expected_version=detail["version"],
        )
    with pytest.raises(ValueError, match="无法确认新题号"):
        save_bank_record(
            tmp_path,
            "math/set/new-id",
            QuestionItem.model_validate(question("new-id", "new")),
            create_only=True,
        )
    assert not (library / "new-id.yaml").exists()

    monkeypatch.setattr(state, "get_root", lambda: tmp_path.resolve())
    response = TestClient(app).get("/api/bank/items")
    assert response.status_code == 200
    body = response.json()
    assert [item["qualified_id"] for item in body["items"]] == ["math/set/q1"]
    assert len(body["diagnostics"]) == 1
    assert body["diagnostics"][0]["storage_path"] == "math/set/damaged.yaml"
    assert "damaged.yaml" not in body["diagnostics"][0]["message"]
    question_response = TestClient(app).get("/api/questions")
    assert question_response.status_code == 200
    question_body = question_response.json()
    assert [item["qualified_id"] for item in question_body["questions"]] == ["math/set/q1"]
    assert question_body["diagnostics"][0]["storage_path"] == "math/set/damaged.yaml"
    assert damaged.read_bytes() == damaged_original
    assert get_question_detail(tmp_path, "math/set/q1")["question"]["content"] == "after"
    assert list_bank_entries(tmp_path)[0]["qualified_id"] == "math/set/q1"


def test_damaged_target_and_known_duplicate_ids_are_never_overwritten(tmp_path: Path) -> None:
    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    damaged = library / "target.yaml"
    damaged.write_text("not: [valid\n", encoding="utf-8")
    damaged_original = damaged.read_bytes()
    with pytest.raises(FileExistsError):
        save_bank_record(tmp_path, "math/set/target", QuestionItem.model_validate(question("target")))
    assert damaged.read_bytes() == damaged_original

    first, second = library / "first.yaml", library / "second.yaml"
    write_question(first, "duplicate", "one")
    write_question(second, "duplicate", "two")
    first_original, second_original = first.read_bytes(), second.read_bytes()
    with pytest.raises(ValueError, match="重复题目编号"):
        save_bank_record(
            tmp_path,
            "math/set/duplicate",
            QuestionItem.model_validate(question("duplicate", "must not overwrite")),
        )
    assert first.read_bytes() == first_original
    assert second.read_bytes() == second_original


def test_import_updates_stable_id_with_unrelated_bad_yaml_and_preserves_neighbors(tmp_path: Path) -> None:
    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    legacy_records = [
        {**question("q1", "before"), "extension": {"keep": True}},
        {**question("q2", "neighbor"), "neighbor_extension": "keep"},
    ]
    legacy = library / "legacy.yaml"
    legacy.write_text(yaml.safe_dump(legacy_records, allow_unicode=True), encoding="utf-8")
    damaged = library / "unrelated.yaml"
    damaged.write_text("bad: [yaml\n", encoding="utf-8")
    damaged_original = damaged.read_bytes()

    result = import_merged_yaml(
        tmp_path,
        yaml.safe_dump({"questions": [question("q1", "updated")]}, allow_unicode=True),
        "math",
        "set",
    )

    saved = yaml.safe_load(legacy.read_text(encoding="utf-8"))
    assert result["written"] == 1
    assert saved[0]["content"] == "updated"
    assert saved[0]["extension"] == {"keep": True}
    assert saved[1] == legacy_records[1]
    assert damaged.read_bytes() == damaged_original


def test_import_does_not_replace_damaged_canonical_target(tmp_path: Path) -> None:
    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    target = library / "new-id.yaml"
    target.write_text("broken: [yaml\n", encoding="utf-8")
    original = target.read_bytes()

    with pytest.raises(ValueError, match="目标文件已存在"):
        import_merged_yaml(
            tmp_path,
            yaml.safe_dump({"questions": [question("new-id")]}, allow_unicode=True),
            "math",
            "set",
        )

    assert target.read_bytes() == original


def test_exchange_import_does_not_replace_damaged_target(tmp_path: Path) -> None:
    library = tmp_path / "resource" / "math" / "set"
    library.mkdir(parents=True)
    target = library / "q1.yaml"
    target.write_text("damaged: [yaml\n", encoding="utf-8")
    original = target.read_bytes()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("yaml/q1.yaml", yaml.safe_dump(question("q1", "replacement"), allow_unicode=True))

    with pytest.raises(ValueError, match="损坏的题目文件"):
        import_bank_exchange_zip(tmp_path, archive.getvalue(), "math", "set")

    assert target.read_bytes() == original
