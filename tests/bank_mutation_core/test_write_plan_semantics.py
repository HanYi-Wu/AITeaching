"""Comprehensive regression tests for bank mutation and write plan semantics."""
from __future__ import annotations

import io
from pathlib import Path
import zipfile

import pytest
import yaml

from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.web.bank_exchange import import_bank_exchange_zip
from solaire.web.bank_service import (
    delete_question,
    get_question_detail,
    import_merged_yaml,
    save_bank_record,
)
from solaire.web.bank_storage import (
    BankVersionConflict,
    read_bank_document,
    read_bank_library,
)


def _sample_q(qid: str = "q1", content: str = "content", answer: str = "A") -> dict:
    return {
        "id": qid,
        "type": "choice",
        "content": content,
        "options": {"A": "a", "B": "b", "C": "c", "D": "d"},
        "answer": answer,
        "analysis": "",
        "metadata": {"subject": "math"},
    }


def _sample_group(gid: str = "g1", material: str = "material") -> dict:
    return {
        "id": gid,
        "type": "group",
        "unified": "choice",
        "material": material,
        "items": [
            {
                "content": "sub 1",
                "options": {"A": "1", "B": "2", "C": "3", "D": "4"},
                "answer": "A",
                "analysis": "",
                "metadata": {},
            }
        ],
    }


def test_duplicate_id_in_incoming_batch_rejected(tmp_path: Path):
    """Importing a package with duplicate IDs within the same payload must be rejected."""
    q1 = _sample_q("duplicate_id")
    q2 = _sample_q("duplicate_id", content="second")
    payload = yaml.safe_dump({"questions": [q1, q2]})
    with pytest.raises(ValueError, match="重复"):
        import_merged_yaml(tmp_path, payload, "math", "test")
    assert not list((tmp_path / "resource" / "math" / "test").rglob("*.yaml"))


def test_duplicate_id_with_existing_different_file_rejected(tmp_path: Path):
    """If an existing file already contains the ID and another file attempts to add it, reject."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    (target / "existing.yaml").write_text(yaml.safe_dump(_sample_q("q_exist")), encoding="utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("yaml/new_file.yaml", yaml.safe_dump(_sample_q("q_exist")))

    with pytest.raises(ValueError, match="重复"):
        import_bank_exchange_zip(tmp_path, buf.getvalue(), "math", "test")
    # Original file is unmodified
    orig = yaml.safe_load((target / "existing.yaml").read_text(encoding="utf-8"))
    assert orig["id"] == "q_exist"


def test_unknown_extension_fields_preserved_across_save_and_import(tmp_path: Path):
    """Custom vendor and extension fields must be preserved on both items and groups."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    q_data = {
        **_sample_q("ext_q1"),
        "x_custom_vendor": {"score": 98, "tags": ["algebra"]},
        "x_extra_notes": "keep this note",
    }
    (target / "ext_q1.yaml").write_text(yaml.safe_dump(q_data), encoding="utf-8")

    # Update through save_bank_record
    updated_item = QuestionItem.model_validate(_sample_q("ext_q1", content="new content"))
    save_bank_record(tmp_path, "math/test/ext_q1", updated_item)

    saved = yaml.safe_load((target / "ext_q1.yaml").read_text(encoding="utf-8"))
    assert saved["content"] == "new content"
    assert saved["x_custom_vendor"] == {"score": 98, "tags": ["algebra"]}
    assert saved["x_extra_notes"] == "keep this note"


def test_refuse_overwrite_of_damaged_yaml(tmp_path: Path):
    """Mutating or importing over an existing damaged YAML file must raise an error."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    bad_file = target / "bad.yaml"
    bad_file.write_text("invalid: yaml: : syntax [[[", encoding="utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("yaml/bad.yaml", yaml.safe_dump(_sample_q("bad")))

    with pytest.raises(ValueError, match="拒绝覆盖损坏的题目文件"):
        import_bank_exchange_zip(tmp_path, buf.getvalue(), "math", "test")

    # The corrupted file remains untouched
    assert bad_file.read_text(encoding="utf-8") == "invalid: yaml: : syntax [[["


def test_damaged_unrelated_file_blocks_new_id_creation(tmp_path: Path):
    """If there are unreadable files in the bank, creating a new ID is blocked to avoid collision."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    (target / "corrupt.yaml").write_text("bad: : yaml", encoding="utf-8")

    new_item = QuestionItem.model_validate(_sample_q("brand_new_id"))
    with pytest.raises(ValueError, match="存在无法读取的题目文件，无法确认新题号"):
        save_bank_record(tmp_path, "math/test/brand_new_id", new_item)


def test_root_questions_yaml_in_library_rejected(tmp_path: Path):
    """Directly targeting root questions.yaml in modern import is rejected."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("yaml/questions.yaml", yaml.safe_dump(_sample_q("q1")))

    with pytest.raises(ValueError, match="questions.yaml 仅用于旧版合并导入"):
        import_bank_exchange_zip(tmp_path, buf.getvalue(), "math", "test")


def test_non_regular_file_destination_rejected(tmp_path: Path):
    """If target destination exists and is a directory, reject import."""
    target = tmp_path / "resource" / "math" / "test" / "q_dir.yaml"
    target.mkdir(parents=True)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("yaml/q_dir.yaml", yaml.safe_dump(_sample_q("q_dir")))

    with pytest.raises(ValueError, match="不是普通文件"):
        import_bank_exchange_zip(tmp_path, buf.getvalue(), "math", "test")


def test_if_match_conflict_detection(tmp_path: Path):
    """Conditional mutation with stale version must raise BankVersionConflict."""
    save_bank_record(tmp_path, "math/test/q1", QuestionItem.model_validate(_sample_q("q1")))
    detail = get_question_detail(tmp_path, "math/test/q1")
    old_ver = detail["version"]

    # First update succeeds
    save_bank_record(
        tmp_path,
        "math/test/q1",
        QuestionItem.model_validate(_sample_q("q1", content="first edit")),
        expected_version=old_ver,
    )

    # Second update with old version raises BankVersionConflict
    with pytest.raises(BankVersionConflict) as exc_info:
        save_bank_record(
            tmp_path,
            "math/test/q1",
            QuestionItem.model_validate(_sample_q("q1", content="stale edit")),
            expected_version=old_ver,
        )
    assert exc_info.value.current_version is not None
    assert exc_info.value.current_version != old_ver


def test_partial_write_failure_rollback(tmp_path: Path, monkeypatch):
    """When a write fails halfway, previously applied files are restored to original bytes."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    orig_a = yaml.safe_dump(_sample_q("qa", content="original qa")).encode("utf-8")
    (target / "qa.yaml").write_bytes(orig_a)

    from solaire.common import atomic_files
    real_replace = atomic_files.os.replace
    failed = False

    def injected_replace(src, dst):
        nonlocal failed
        if Path(dst).name == "qb.yaml" and not failed:
            failed = True
            raise OSError("simulated disk error on qb")
        return real_replace(src, dst)

    monkeypatch.setattr(atomic_files.os, "replace", injected_replace)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("yaml/qa.yaml", yaml.safe_dump(_sample_q("qa", content="new qa")))
        zf.writestr("yaml/qb.yaml", yaml.safe_dump(_sample_q("qb", content="new qb")))

    with pytest.raises(ValueError, match="已恢复本批已应用文件"):
        import_bank_exchange_zip(tmp_path, buf.getvalue(), "math", "test")

    # qa is restored to its original bytes
    assert (target / "qa.yaml").read_bytes() == orig_a
    # qb was not left behind
    assert not (target / "qb.yaml").exists()


def test_delete_single_record_in_multi_file_rejected(tmp_path: Path):
    """delete_question must refuse deleting a file containing multiple records."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    records = [_sample_q("q1"), _sample_q("q2")]
    (target / "bundle.yaml").write_text(yaml.safe_dump(records), encoding="utf-8")

    with pytest.raises(ValueError, match="文件含多条记录时请手动编辑 YAML"):
        delete_question(tmp_path, "math/test/q1")
    assert (target / "bundle.yaml").is_file()


def test_single_update_allows_unrelated_duplicate_ids(tmp_path: Path):
    """An unrelated duplicate ID must not block editing another unique record."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    (target / "duplicate-a.yaml").write_text(yaml.safe_dump(_sample_q("duplicate")), encoding="utf-8")
    (target / "duplicate-b.yaml").write_text(yaml.safe_dump(_sample_q("duplicate", content="second")), encoding="utf-8")
    (target / "unique.yaml").write_text(yaml.safe_dump(_sample_q("unique")), encoding="utf-8")

    updated = QuestionItem.model_validate(_sample_q("unique", content="updated unique"))
    save_bank_record(tmp_path, "math/test/unique", updated)

    assert yaml.safe_load((target / "unique.yaml").read_text(encoding="utf-8"))["content"] == "updated unique"
    assert yaml.safe_load((target / "duplicate-a.yaml").read_text(encoding="utf-8"))["id"] == "duplicate"
    assert yaml.safe_load((target / "duplicate-b.yaml").read_text(encoding="utf-8"))["content"] == "second"


def test_explicit_storage_path_delete_can_resolve_duplicate_ids(tmp_path: Path, monkeypatch):
    """A targeted delete remains available to clean up one entry in a duplicate-ID bank."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    first = target / "duplicate-a.yaml"
    second = target / "duplicate-b.yaml"
    first.write_text(yaml.safe_dump(_sample_q("duplicate")), encoding="utf-8")
    second.write_text(yaml.safe_dump(_sample_q("duplicate", content="keep")), encoding="utf-8")

    from solaire.web import bank_storage

    original_iter = bank_storage.iter_question_files
    calls = 0

    def counted_iter(library: Path):
        nonlocal calls
        calls += 1
        yield from original_iter(library)

    monkeypatch.setattr(bank_storage, "iter_question_files", counted_iter)
    delete_question(tmp_path, "math/test/duplicate", storage_path="math/test/duplicate-a.yaml")

    assert not first.exists()
    assert yaml.safe_load(second.read_text(encoding="utf-8"))["content"] == "keep"
    assert calls == 0


def test_single_update_scans_the_library_once(tmp_path: Path, monkeypatch):
    """Single-record saves use the existing index path without a second snapshot pass."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    (target / "unique.yaml").write_text(yaml.safe_dump(_sample_q("unique")), encoding="utf-8")

    from solaire.web import bank_storage

    original_iter = bank_storage.iter_question_files
    calls = 0

    def counted_iter(library: Path):
        nonlocal calls
        calls += 1
        yield from original_iter(library)

    monkeypatch.setattr(bank_storage, "iter_question_files", counted_iter)
    save_bank_record(
        tmp_path,
        "math/test/unique",
        QuestionItem.model_validate(_sample_q("unique", content="updated")),
    )

    assert calls == 1


def test_zip_import_reports_duplicate_paths_in_sorted_order(tmp_path: Path):
    """Duplicate diagnostics retain the established sorted-path order."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)
    (target / "z-duplicate.yaml").write_text(yaml.safe_dump(_sample_q("duplicate")), encoding="utf-8")
    (target / "a-duplicate.yaml").write_text(yaml.safe_dump(_sample_q("duplicate", content="second")), encoding="utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("yaml/new.yaml", yaml.safe_dump(_sample_q("new")))

    with pytest.raises(
        ValueError,
        match=r"题集中存在重复题目编号: duplicate \(a-duplicate\.yaml, z-duplicate\.yaml\)",
    ):
        import_bank_exchange_zip(tmp_path, buf.getvalue(), "math", "test")


def test_batch_import_rejects_external_file_added_after_snapshot(tmp_path: Path, monkeypatch):
    """A library change outside the write lock is detected before batch writes apply."""
    target = tmp_path / "resource" / "math" / "test"
    target.mkdir(parents=True)

    from solaire.web import bank_write_plan as write_plan_package

    original_plan = write_plan_package.plan_merged_import

    def add_file_after_plan(snapshot, yaml_text, extra_files=None):
        plan = original_plan(snapshot, yaml_text, extra_files=extra_files)
        (target / "external.yaml").write_text(yaml.safe_dump(_sample_q("external")), encoding="utf-8")
        return plan

    monkeypatch.setattr(write_plan_package, "plan_merged_import", add_file_after_plan)
    payload = yaml.safe_dump({"questions": [_sample_q("incoming")]})

    with pytest.raises(ValueError, match="并发写入冲突：题库在计划构建期间新增文件"):
        import_merged_yaml(tmp_path, payload, "math", "test")

    assert (target / "external.yaml").is_file()
    assert not (target / "incoming.yaml").exists()
