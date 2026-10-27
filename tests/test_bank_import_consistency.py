import io
from pathlib import Path
import zipfile

import pytest
import yaml

from solaire.web.bank_exchange import import_bank_exchange_zip
from solaire.web.bank_service import import_merged_yaml


def question(qid="q1"):
    return {"id": qid, "type": "fill", "content": "question", "answer": "1"}


def package(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


@pytest.mark.parametrize("kind", ["zip", "merged"])
def test_invalid_tail_is_rejected_before_applying_any_questions(tmp_path: Path, kind):
    good, bad = question(), {"id": "invalid", "type": "fill", "content": "missing answer"}
    with pytest.raises(ValueError):
        if kind == "zip":
            import_bank_exchange_zip(tmp_path, package({
                "yaml/a.yaml": yaml.safe_dump(good), "yaml/z.yaml": yaml.safe_dump(bad),
            }), "math", "set")
        else:
            import_merged_yaml(tmp_path, yaml.safe_dump({"questions": [good, bad]}), "math", "set")
    assert not list((tmp_path / "resource/math/set").rglob("*.yaml"))


def test_duplicate_id_in_different_files_does_not_corrupt_library(tmp_path: Path):
    data = package({"yaml/a.yaml": yaml.safe_dump(question()), "yaml/b.yaml": yaml.safe_dump(question())})
    with pytest.raises(ValueError, match="重复|duplicate"):
        import_bank_exchange_zip(tmp_path, data, "math", "set")
    assert not list((tmp_path / "resource/math/set").rglob("*.yaml"))


def test_second_file_write_failure_restores_existing_data(tmp_path: Path, monkeypatch):
    target = tmp_path / "resource/math/set"
    target.mkdir(parents=True)
    original = yaml.safe_dump(question("original")).encode("utf-8")
    (target / "a.yaml").write_bytes(original)
    from solaire.common import atomic_files
    replace = atomic_files.os.replace
    failed = False

    def fail_second(source, destination):
        nonlocal failed
        if Path(destination) == (target / "z.yaml").resolve() and not failed:
            failed = True
            raise OSError("injected disk error")
        return replace(source, destination)

    monkeypatch.setattr(atomic_files.os, "replace", fail_second)
    data = package({"yaml/a.yaml": yaml.safe_dump(question("new")), "yaml/z.yaml": yaml.safe_dump(question("last"))})
    with pytest.raises(ValueError, match="恢复"):
        import_bank_exchange_zip(tmp_path, data, "math", "set")
    assert (target / "a.yaml").read_bytes() == original
    assert not (target / "z.yaml").exists()


def test_failed_restore_lists_the_file_that_kept_imported_content(tmp_path: Path, monkeypatch):
    target = tmp_path / "resource/math/set"
    target.mkdir(parents=True)
    original = yaml.safe_dump(question("original")).encode("utf-8")
    (target / "a.yaml").write_bytes(original)
    from solaire.common import atomic_files

    replace = atomic_files.os.replace
    failed_second_write = False

    def fail_write_and_restore(source, destination):
        nonlocal failed_second_write
        resolved = Path(destination).resolve()
        if resolved == (target / "z.yaml").resolve() and not failed_second_write:
            failed_second_write = True
            raise OSError("injected second-file error")
        if resolved == (target / "a.yaml").resolve() and failed_second_write:
            raise OSError("injected restore error")
        return replace(source, destination)

    monkeypatch.setattr(atomic_files.os, "replace", fail_write_and_restore)
    data = package({"yaml/a.yaml": yaml.safe_dump(question("new")), "yaml/z.yaml": yaml.safe_dump(question("last"))})

    with pytest.raises(ValueError, match="未能恢复.*resource/math/set/a.yaml"):
        import_bank_exchange_zip(tmp_path, data, "math", "set")


def test_merged_import_updates_existing_stable_id_in_legacy_multi_record_file(tmp_path: Path):
    target = tmp_path / "resource/math/set"
    target.mkdir(parents=True)
    original = [
        {**question("q1"), "custom": {"review": "pending"}, "metadata": {"source": "old"}},
        {**question("q2"), "custom_neighbor": "preserve"},
    ]
    (target / "legacy.yaml").write_text(yaml.safe_dump(original), encoding="utf-8")
    incoming = {
        "questions": [
            {**question("q1"), "content": "updated", "metadata": {"source": "archive"}},
        ]
    }

    result = import_merged_yaml(tmp_path, yaml.safe_dump(incoming), "math", "set")

    saved = yaml.safe_load((target / "legacy.yaml").read_text(encoding="utf-8"))
    assert result["written"] == 1
    assert saved[0]["content"] == "updated"
    assert saved[0]["custom"] == original[0]["custom"]
    assert saved[0]["metadata"]["source"] == "archive"
    assert saved[1] == original[1]
    assert not (target / "q1.yaml").exists()
