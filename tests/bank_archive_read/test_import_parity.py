from __future__ import annotations

import io
import hashlib
from pathlib import Path
import zipfile

import pytest
import yaml

from solaire.web.bank_exchange import import_bank_exchange_zip
from solaire.web.bank_write_plan.archive_source import DirectArchiveSource
from solaire.web.bank_write_plan import planner


def _package(entries: list[tuple[str, bytes | str]]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in entries:
            archive.writestr(name, value)
    return output.getvalue()


def _question(qid: str, content: str = "body") -> dict:
    return {
        "id": qid,
        "type": "fill",
        "content": content,
        "answer": "answer",
        "analysis": "",
        "metadata": {"source": "archive"},
    }


def _seed_existing_question(root: Path) -> bytes:
    target = root / "resource" / "math" / "set"
    target.mkdir(parents=True)
    content = yaml.safe_dump(_question("q2", "before"), allow_unicode=True).encode("utf-8")
    (target / "q2.yaml").write_bytes(content)
    return content


def _tree(root: Path) -> dict[str, bytes]:
    target = root / "resource" / "math" / "set"
    if not target.exists():
        return {}
    return {path.relative_to(target).as_posix(): path.read_bytes() for path in sorted(target.rglob("*")) if path.is_file()}


def _force_extraction(monkeypatch):
    monkeypatch.setattr(
        DirectArchiveSource,
        "try_create",
        classmethod(lambda cls, archive, root: None),
    )


def test_modern_import_direct_and_extracted_paths_match_public_result_and_bytes(tmp_path: Path, monkeypatch):
    image = b"sample image bytes"
    large = b"x" * (5 * 1024 * 1024 + 1)
    question1 = _question(
        "q1",
        " :::EMBED_IMG:image/pic.png::: "
        " :::EMBED_IMG:image/missing.png::: "
        " :::EMBED_IMG:image/large.png::: "
        " :::EMBED_IMG:image/vector.svg::: ",
    )
    question2 = _question("q2", "after")
    data = _package(
        [
            ("manifest.json", '{"version": 1}'),
            ("yaml/", b""),
            ("yaml/q1.yaml", yaml.safe_dump(question1, allow_unicode=True, sort_keys=False)),
            ("yaml/q2.yaml", yaml.safe_dump(question2, allow_unicode=True, sort_keys=False)),
            # Modern yaml/ wins over the legacy document, which is still CRC checked.
            ("questions.yaml", "this is not a merged import"),
            ("image/pic.png", image),
            ("image/large.png", large),
            ("image/vector.svg", b"<svg/>"),
            ("audio/.keep", b""),
            ("empty/", b""),
        ]
    )

    direct_root = tmp_path / "direct-import"
    fallback_root = tmp_path / "fallback-import"
    direct_original = _seed_existing_question(direct_root)
    fallback_original = _seed_existing_question(fallback_root)
    assert direct_original == fallback_original

    def fail_extract(*_args):
        pytest.fail("modern yaml tree should reach the direct archive reader")

    with monkeypatch.context() as patch:
        patch.setattr(planner, "_safe_extract_zip", fail_extract)
        direct_result = import_bank_exchange_zip(direct_root, data, "math", "set")
    with monkeypatch.context() as patch:
        _force_extraction(patch)
        fallback_result = import_bank_exchange_zip(fallback_root, data, "math", "set")

    assert direct_result == fallback_result
    assert direct_result["written"] == 2
    assert direct_result["warnings"] == [
        "未找到图片文件，保留占位符: image/missing.png",
        "跳过大文件: image/large.png",
        "跳过不支持的格式: image/vector.svg",
    ]
    assert _tree(direct_root) == _tree(fallback_root)
    assert _tree(direct_root)["q2.yaml"] != direct_original
    image_name = f"image/{hashlib.sha256(image).hexdigest()[:16]}.png"
    assert _tree(direct_root)[image_name] == image


def test_legacy_nested_questions_yaml_import_matches_extraction(tmp_path: Path, monkeypatch):
    question = _question("legacy", " :::EMBED_IMG:image/legacy.png::: ")
    data = _package(
        [
            ("archive/questions.yaml", yaml.safe_dump({"questions": [question]}, allow_unicode=True)),
            ("image/legacy.png", b"legacy image"),
        ]
    )
    direct_root = tmp_path / "legacy-direct"
    fallback_root = tmp_path / "legacy-fallback"

    direct_result = import_bank_exchange_zip(direct_root, data, "math", "set")
    with monkeypatch.context() as patch:
        _force_extraction(patch)
        fallback_result = import_bank_exchange_zip(fallback_root, data, "math", "set")

    assert direct_result == fallback_result
    assert _tree(direct_root) == _tree(fallback_root)
    assert direct_result["written"] == 1


def test_legacy_package_uses_single_extraction_path_without_archive_rescan(tmp_path: Path, monkeypatch):
    question = _question("legacy", " :::EMBED_IMG:image/legacy.png::: ")
    data = _package(
        [
            ("archive/questions.yaml", yaml.safe_dump({"questions": [question]}, allow_unicode=True)),
            ("image/legacy.png", b"legacy image"),
        ]
    )
    extract_calls = 0
    original_extract = planner._safe_extract_zip

    def tracked_extract(archive, destination):
        nonlocal extract_calls
        extract_calls += 1
        return original_extract(archive, destination)

    def fail_if_rescanned(_source):
        pytest.fail("legacy import should not validate members in a separate archive pass")

    def fail_if_indexed(_cls, _archive, _root):
        pytest.fail("legacy import should bypass the direct archive metadata index")

    monkeypatch.setattr(planner, "_safe_extract_zip", tracked_extract)
    monkeypatch.setattr(DirectArchiveSource, "validate_members", fail_if_rescanned)
    monkeypatch.setattr(DirectArchiveSource, "try_create", classmethod(fail_if_indexed))

    result = import_bank_exchange_zip(tmp_path / "legacy", data, "math", "set")

    assert result["written"] == 1
    assert extract_calls == 1
    assert _tree(tmp_path / "legacy")["legacy.yaml"]


def test_short_name_reference_uses_extracted_filesystem_lookup(tmp_path: Path, monkeypatch):
    question = _question("short-name", " :::EMBED_IMG:REALLY~1.PNG::: ")
    data = _package(
        [
            ("yaml/q.yaml", yaml.safe_dump(question, allow_unicode=True)),
            ("really-long-picture-name.png", b"image"),
        ]
    )
    direct_root = tmp_path / "short-direct"
    fallback_root = tmp_path / "short-fallback"

    direct_result = import_bank_exchange_zip(direct_root, data, "math", "set")
    with monkeypatch.context() as patch:
        _force_extraction(patch)
        fallback_result = import_bank_exchange_zip(fallback_root, data, "math", "set")

    assert direct_result == fallback_result
    assert _tree(direct_root) == _tree(fallback_root)


@pytest.mark.parametrize(
    "case",
    [
        "duplicate_ids",
        "duplicate_legacy_questions",
        "duplicate_archive_targets",
        "casefold_targets",
        "file_directory_conflict",
        "yaml_directory_named_yaml",
        "invalid_utf8",
    ],
)
def test_failed_import_matches_extraction_and_leaves_no_files(tmp_path: Path, monkeypatch, case: str):
    if case == "duplicate_ids":
        record = _question("same")
        data = _package(
            [
                ("yaml/a.yaml", yaml.safe_dump(record, allow_unicode=True)),
                ("yaml/b.yaml", yaml.safe_dump(record, allow_unicode=True)),
            ]
        )
    elif case == "duplicate_legacy_questions":
        data = _package(
            [
                ("a/questions.yaml", yaml.safe_dump({"questions": [_question("first")]}, allow_unicode=True)),
                ("b/questions.yaml", yaml.safe_dump({"questions": [_question("second")]}, allow_unicode=True)),
            ]
        )
    elif case == "duplicate_archive_targets":
        with pytest.warns(UserWarning, match="Duplicate name"):
            data = _package(
                [
                    ("yaml/a.yaml", yaml.safe_dump(_question("first"), allow_unicode=True)),
                    ("yaml/a.yaml", yaml.safe_dump(_question("second"), allow_unicode=True)),
                ]
            )
    elif case == "casefold_targets":
        data = _package(
            [
                ("yaml/a.yaml", yaml.safe_dump(_question("first"), allow_unicode=True)),
                ("YAML/A.yaml", yaml.safe_dump(_question("second"), allow_unicode=True)),
            ]
        )
    elif case == "file_directory_conflict":
        data = _package(
            [
                ("node", b"file first"),
                ("node/child.txt", b"directory conflict"),
            ]
        )
    elif case == "yaml_directory_named_yaml":
        data = _package([("yaml/folder.yaml/child.txt", b"directory, not yaml text")])
    else:
        data = _package([("questions.yaml", b"\xff")])

    outcomes = []
    for suffix, force in (("direct", False), ("fallback", True)):
        root = tmp_path / f"{case}-{suffix}"
        try:
            if force:
                with monkeypatch.context() as patch:
                    _force_extraction(patch)
                    import_bank_exchange_zip(root, data, "math", "set")
            else:
                import_bank_exchange_zip(root, data, "math", "set")
        except Exception as error:  # Compare the public failure contract across both sources.
            outcomes.append((type(error), str(error)))
        else:
            pytest.fail("invalid archive unexpectedly imported")
        assert _tree(root) == {}

    assert outcomes[0][0] is outcomes[1][0]
    if case not in {"invalid_utf8", "file_directory_conflict", "yaml_directory_named_yaml"}:
        assert outcomes[0][1] == outcomes[1][1]
