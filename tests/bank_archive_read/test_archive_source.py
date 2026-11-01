from __future__ import annotations

import io
from contextlib import contextmanager
from pathlib import Path
import struct
import zipfile

import pytest

from solaire.web.bank_write_plan.archive_source import (
    DirectArchiveSource,
    ExtractedArchiveSource,
    RequiresExtractedArchive,
)
from solaire.web.bank_write_plan.planner import _safe_extract_zip


def _zip(entries: list[tuple[str, bytes]], *, compression: int = zipfile.ZIP_DEFLATED) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=compression) as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return output.getvalue()


@contextmanager
def _source_pair(data: bytes, tmp_path: Path):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        direct_root = tmp_path / "direct"
        direct_root.mkdir()
        direct = DirectArchiveSource.try_create(archive, direct_root)
        assert direct is not None

        extracted_root = tmp_path / "extracted"
        extracted_root.mkdir()
        _safe_extract_zip(archive, extracted_root)
        extracted = ExtractedArchiveSource(extracted_root)
        yield direct, extracted


def _corrupt_stored_member(data: bytes, name: str) -> bytes:
    damaged = bytearray(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        info = archive.getinfo(name)
        assert info.compress_type == zipfile.ZIP_STORED
        header = info.header_offset
        name_length, extra_length = struct.unpack_from("<HH", data, header + 26)
        payload_start = header + 30 + name_length + extra_length
        assert info.file_size > 0
        damaged[payload_start] ^= 0x20
    return bytes(damaged)


@pytest.mark.parametrize(
    "names",
    [
        ["CON.txt"],
        ["folder/NUL.data"],
        ["trailing."],
        ["trailing "],
        ["with~1.txt"],
        [r"folder\child.txt"],
        ["C:/outside.txt"],
        ["//server/share.txt"],
        ["safe/../outside.txt"],
        ["yaml/folder.yaml/child.txt"],
        ["yaml/folder.YAML/child.txt"],
        ["yaml/a.yaml", "YAML/b.yaml"],
        ["same/name.txt", "same/name.txt"],
        ["node", "node/child.txt"],
        ["node/child.txt", "node"],
    ],
)
def test_ambiguous_or_windows_special_paths_fall_back_before_reading(names, tmp_path: Path):
    if len(names) != len(set(names)):
        with pytest.warns(UserWarning, match="Duplicate name"):
            data = _zip([(name, b"payload") for name in names])
    else:
        data = _zip([(name, b"payload") for name in names])
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        root = tmp_path / "extract"
        root.mkdir()
        open_calls = 0
        original_open = archive.open

        def counted_open(*args, **kwargs):
            nonlocal open_calls
            open_calls += 1
            return original_open(*args, **kwargs)

        archive.open = counted_open  # type: ignore[method-assign]
        if any("\\" in name for name in names):
            archive.infolist()[0].filename = names[0]
        assert DirectArchiveSource.try_create(archive, root) is None
        assert open_calls == 0


def test_directory_entries_are_ignored_like_the_extractor(tmp_path: Path):
    data = _zip([("yaml/", b""), ("questions.yaml", b"questions: []")])
    with _source_pair(data, tmp_path) as (direct, extracted):
        assert not direct.has_yaml_directory()
        assert not extracted.has_yaml_directory()
        assert direct.questions_yaml() is not None
        assert extracted.questions_yaml() is not None


def test_direct_text_read_matches_utf8_universal_newlines(tmp_path: Path):
    raw = "line one\rline two\r\nline three\n".encode("utf-8")
    with _source_pair(_zip([("questions.yaml", raw)]), tmp_path) as (direct, extracted):
        assert direct.read_text(direct.questions_yaml()) == "line one\nline two\nline three\n"
        assert direct.read_text(direct.questions_yaml()) == extracted.read_text(extracted.questions_yaml())


def test_text_decode_errors_match_extracted_source(tmp_path: Path):
    with _source_pair(_zip([("questions.yaml", b"\xff")]), tmp_path) as (direct, extracted):
        with pytest.raises(UnicodeDecodeError) as direct_error:
            direct.read_text(direct.questions_yaml())
        with pytest.raises(UnicodeDecodeError) as extracted_error:
            extracted.read_text(extracted.questions_yaml())
        assert direct_error.value.encoding == extracted_error.value.encoding == "utf-8"


def test_embed_resolution_keeps_existing_precedence_and_ambiguity(tmp_path: Path):
    entries = [
        ("folder/ref.png", b"exact"),
        ("image/ref.png", b"root-image"),
        ("nested/image/nested.png", b"nested-image"),
        ("other/nested.png", b"nested-ambiguous"),
        ("unique/only.png", b"unique"),
        ("a/ambiguous.png", b"ambiguous-a"),
        ("b/ambiguous.png", b"ambiguous-b"),
    ]
    with _source_pair(_zip(entries), tmp_path) as (direct, extracted):
        refs = [
            "folder/ref.png",       # exact path
            "missing/ref.png",      # root image/<basename>
            "elsewhere/nested.png", # sorted nested image directory before unique lookup
            "missing/only.png",     # unique basename
            "missing/ambiguous.png",
            r"..\folder\ref.png",
        ]
        direct_paths = [direct.resolve_embed(ref) for ref in refs]
        extracted_paths = [extracted.resolve_embed(ref) for ref in refs]
        assert [m.path.relative_to(direct.root).as_posix() if m else None for m in direct_paths] == [
            m.path.relative_to(extracted.root).as_posix() if m else None for m in extracted_paths
        ]
        assert [m.path.relative_to(direct.root).as_posix() if m else None for m in direct_paths] == [
            "folder/ref.png",
            "image/ref.png",
            "nested/image/nested.png",
            "unique/only.png",
            None,
            None,
        ]


@pytest.mark.parametrize("reference", ["PIC~1.PNG", "image/a.png:stream", "image/a.", "image/ñ.png"])
def test_unmodeled_windows_reference_requests_extracted_lookup(reference: str, tmp_path: Path):
    with zipfile.ZipFile(io.BytesIO(_zip([("yaml/q.yaml", b"content: test")]))) as archive:
        root = tmp_path / "direct"
        root.mkdir()
        source = DirectArchiveSource.try_create(archive, root)
        assert source is not None
        with pytest.raises(RequiresExtractedArchive):
            source.resolve_embed(reference)


def test_full_crc_validation_includes_unreferenced_members(tmp_path: Path):
    valid = _zip(
        [("questions.yaml", b"questions: []"), ("unreferenced.bin", b"still checked")],
        compression=zipfile.ZIP_STORED,
    )
    damaged = _corrupt_stored_member(valid, "unreferenced.bin")
    with zipfile.ZipFile(io.BytesIO(damaged)) as archive:
        root = tmp_path / "direct"
        root.mkdir()
        source = DirectArchiveSource.try_create(archive, root)
        assert source is not None
        with pytest.raises(zipfile.BadZipFile, match="Bad CRC"):
            source.validate_members()


def test_bad_crc_precedes_unsafe_later_path_errors(tmp_path: Path):
    from solaire.web.bank_exchange import import_bank_exchange_zip

    valid = _zip(
        [("a.bin", b"crc first"), ("CON.txt", b"later path error")],
        compression=zipfile.ZIP_STORED,
    )
    damaged = _corrupt_stored_member(valid, "a.bin")
    with zipfile.ZipFile(io.BytesIO(damaged)) as archive:
        root = tmp_path / "direct"
        root.mkdir()
        # Metadata preflight falls back without reading or raising on the later path.
        assert DirectArchiveSource.try_create(archive, root) is None
    with pytest.raises(zipfile.BadZipFile, match="Bad CRC"):
        import_bank_exchange_zip(tmp_path, damaged, "math", "set")
    assert not list((tmp_path / "resource" / "math" / "set").rglob("*"))


def test_later_unreferenced_bad_crc_precedes_yaml_decode_error(tmp_path: Path):
    from solaire.web.bank_exchange import import_bank_exchange_zip

    valid = _zip(
        [("questions.yaml", b"\xff"), ("unreferenced.bin", b"bad after yaml")],
        compression=zipfile.ZIP_STORED,
    )
    damaged = _corrupt_stored_member(valid, "unreferenced.bin")
    with pytest.raises(zipfile.BadZipFile, match="Bad CRC"):
        import_bank_exchange_zip(tmp_path, damaged, "math", "set")
    assert not list((tmp_path / "resource" / "math" / "set").rglob("*"))
