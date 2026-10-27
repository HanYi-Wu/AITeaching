from __future__ import annotations

import fnmatch
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
from types import SimpleNamespace

import pytest

from scripts import build_linux_offline
from scripts.build_linux_offline import (
    RUNTIME_EXCLUDE_PATTERNS,
    _archive_unpacked_file_bytes,
    pack_runtime,
)
from scripts.build_stamp import create_stamp, write_stamp


class _File:
    def __init__(self, source: Path, target: str, is_conda: bool = True, file_mode=None):
        self.source = str(source)
        self.target = target
        self.is_conda = is_conda
        self.file_mode = file_mode


class _Environment:
    def __init__(self, files: list[_File]):
        self.files = sorted(files, key=lambda entry: entry.target)

    @classmethod
    def from_prefix(cls, prefix: str):
        root = Path(prefix)
        return cls(
            [
                _File(path, path.relative_to(root).as_posix())
                for path in root.rglob("*")
                if path.is_file()
            ]
        )

    def exclude(self, pattern: str):
        return _Environment(
            [
                entry for entry in self.files
                if not fnmatch.fnmatchcase(entry.target, pattern)
            ]
        )

    def pack(self, *, output: str, format: str):
        assert format == "tar.gz"
        with tarfile.open(output, "w:gz") as archive:
            for entry in self.files:
                archive.add(entry.source, arcname=entry.target)


class _CondaPack:
    File = _File
    CondaEnv = _Environment


def _runtime_fixture(root: Path) -> tuple[Path, dict[str, bytes]]:
    runtime = root / "runtime"
    files = {
        "lib/python3.12/site-packages/solaire/__init__.py": b"runtime copy",
        "lib/python3.12/site-packages/solaire/web/assets/uploader.exe": b"duplicate asset",
        "lib/python3.12/site-packages/solaire_education-1.6.7.dist-info/entry_points.txt": (
            b"[console_scripts]\nsolaire-exam = solaire.exam_compiler.cli:main\n"
        ),
        "lib/libtesseract.a": b"static library",
        "lib/libtesseract.so.5": b"shared library",
        "bin/solaire-exam": b"entrypoint",
        "bin/solaire-web": b"entrypoint",
        "bin/solaire-desktop": b"entrypoint",
        "bin/primebrush": b"entrypoint",
        "bin/conda-unpack": b"relocation helper",
        "bin/python": b"python runtime",
    }
    for relative, data in files.items():
        path = runtime / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return runtime, files


def test_runtime_filters_are_limited_to_duplicate_package_and_linker_archive():
    package_pattern, static_pattern = RUNTIME_EXCLUDE_PATTERNS

    assert fnmatch.fnmatchcase(
        "lib/python3.12/site-packages/solaire/web/assets/uploader.exe",
        package_pattern,
    )
    assert fnmatch.fnmatchcase("lib/libtesseract.a", static_pattern)
    assert not fnmatch.fnmatchcase(
        "lib/python3.12/site-packages/solaire_education-1.6.7.dist-info/entry_points.txt",
        package_pattern,
    )
    assert not fnmatch.fnmatchcase("lib/libtesseract.so.5", static_pattern)
    assert not fnmatch.fnmatchcase("lib/libother.a", static_pattern)


def test_runtime_pack_keeps_cli_and_adds_relative_source_redirect(tmp_path: Path):
    runtime, original_files = _runtime_fixture(tmp_path)
    output = tmp_path / "runtime.tar.gz"
    staging = tmp_path / "staging"
    staging.mkdir()
    cli_names = ("solaire-exam", "solaire-web", "solaire-desktop", "primebrush")

    excluded = pack_runtime(
        runtime,
        output,
        staging,
        _CondaPack,
        console_scripts=cli_names,
    )

    excluded_paths = {item["path"] for item in excluded}
    assert "lib/python3.12/site-packages/solaire/__init__.py" in excluded_paths
    assert "lib/python3.12/site-packages/solaire/web/assets/uploader.exe" in excluded_paths
    assert "lib/libtesseract.a" in excluded_paths
    assert all(item["bytes"] > 0 for item in excluded)

    with tarfile.open(output, "r:gz") as archive:
        targets = {member.name for member in archive.getmembers()}
        assert "lib/python3.12/site-packages/solaire/__init__.py" not in targets
        assert "lib/python3.12/site-packages/solaire/web/assets/uploader.exe" not in targets
        assert "lib/libtesseract.a" not in targets
        assert "lib/python3.12/site-packages/solaire_education-1.6.7.dist-info/entry_points.txt" in targets
        assert "lib/libtesseract.so.5" in targets
        assert "bin/conda-unpack" in targets
        assert {f"bin/{name}" for name in cli_names}.issubset(targets)
        pth = archive.extractfile("lib/python3.12/site-packages/solaire-source.pth")
        assert pth is not None
        assert pth.read() == b"../../../../src\n"

    # Packing only filters a CondaEnv view; it does not modify the input runtime.
    for relative, expected in original_files.items():
        assert (runtime / relative).read_bytes() == expected
    assert not (runtime / "lib/python3.12/site-packages/solaire-source.pth").exists()


def test_relative_pth_imports_from_release_src(tmp_path: Path):
    release = tmp_path / "release"
    source_package = release / "src" / "solaire"
    site_packages = release / "runtime" / "lib" / "python3.12" / "site-packages"
    source_package.mkdir(parents=True)
    site_packages.mkdir(parents=True)
    (source_package / "__init__.py").write_text(
        "SOURCE_MARKER = 'release-source'\n",
        encoding="utf-8",
    )
    (site_packages / "solaire-source.pth").write_text(
        "../../../../src\n",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            "-c",
            "import site,sys; site.addsitedir(sys.argv[1]); "
            "import solaire; print(solaire.SOURCE_MARKER, solaire.__file__)",
            str(site_packages),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert "release-source" in result.stdout
    assert str(source_package) in result.stdout


def test_unpacked_size_uses_only_regular_files_in_the_actual_archive(tmp_path: Path):
    archive_path = tmp_path / "runtime.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        for name, body in (("lib/runtime.so", b"shared-data"), ("bin/python", b"runtime")):
            member = tarfile.TarInfo(name)
            member.size = len(body)
            archive.addfile(member, io.BytesIO(body))
        link = tarfile.TarInfo("lib/python")
        link.type = tarfile.SYMTYPE
        link.linkname = "python3.12"
        archive.addfile(link)

    assert _archive_unpacked_file_bytes(archive_path) == len(b"shared-data") + len(b"runtime")


def test_linux_bundle_manifest_counts_the_filtered_archives(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    repo = tmp_path / "project"
    runtime, _ = _runtime_fixture(tmp_path)
    (repo / "scripts" / "offline").mkdir(parents=True)
    (repo / "docs").mkdir()
    (repo / "src" / "solaire" / "web" / "assets" / "tools").mkdir(parents=True)
    (repo / "web" / "src").mkdir(parents=True)
    (repo / "web" / "dist" / "assets").mkdir(parents=True)

    (repo / "pyproject.toml").write_text(
        """[project]
name = "solaire-education"
version = "1.6.7"

[project.scripts]
solaire-exam = "solaire.exam_compiler.cli:main"
solaire-web = "solaire.web.__main__:main"
solaire-desktop = "solaire.desktop_entry:main"
primebrush = "solaire.primebrush.cli:main"
""",
        encoding="utf-8",
    )
    (repo / "README.md").write_text("readme\n", encoding="utf-8")
    (repo / "LICENSE").write_text("license\n", encoding="utf-8")
    (repo / "src" / "solaire" / "__init__.py").write_text("", encoding="utf-8")
    (repo / "src" / "solaire" / "web" / "assets" / "tools" / "uploader.exe").write_bytes(
        b"duplicate app asset"
    )
    (repo / "scripts" / "offline" / "install.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (repo / "scripts" / "offline" / "installer.py").write_text("pass\n", encoding="utf-8")
    (repo / "docs" / "linux-offline-install.md").write_text("install\n", encoding="utf-8")
    (repo / "web" / ".gitignore").write_text("/dist/\n", encoding="utf-8")
    (repo / "web" / "package.json").write_text('{"name":"frontend"}\n', encoding="utf-8")
    (repo / "web" / "src" / "app.js").write_text("export default 1;\n", encoding="utf-8")
    (repo / "web" / "dist" / "index.html").write_text(
        '<script src="/assets/app.js"></script>\n',
        encoding="utf-8",
    )
    (repo / "web" / "dist" / "assets" / "app.js").write_text(
        "console.log(1);\n",
        encoding="utf-8",
    )

    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(
        [
            "git", "-C", str(repo),
            "-c", "user.name=Test",
            "-c", "user.email=test@example.invalid",
            "commit", "-qm", "fixture",
        ],
        check=True,
    )
    stamp = create_stamp(repo / "web", repo)
    write_stamp(stamp, repo / "web" / "dist" / "build-stamp.json")

    def fake_run(args, *, check, stdout):
        assert check is True
        assert args[1:] == ["-m", "pip", "freeze"]
        stdout.write("solaire-education==1.6.7\n")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(build_linux_offline.platform, "system", lambda: "Linux")
    monkeypatch.setattr(build_linux_offline.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(
        build_linux_offline,
        "subprocess",
        SimpleNamespace(
            check_output=subprocess.check_output,
            run=fake_run,
        ),
    )
    monkeypatch.setitem(sys.modules, "conda_pack", _CondaPack)
    output = tmp_path / "dist"
    build_linux_offline.build(runtime, output, root=repo)

    bundle = next(output.glob("*.tar.gz"))
    with tarfile.open(bundle, "r:gz") as outer:
        members = {member.name: member for member in outer.getmembers()}
        base = bundle.stem.removesuffix(".tar")
        manifest = json.load(outer.extractfile(members[f"{base}/manifest.json"]))
        app_bytes = outer.extractfile(members[f"{base}/app.tar.gz"]).read()
        runtime_bytes = outer.extractfile(members[f"{base}/runtime.tar.gz"]).read()

    app_archive = tmp_path / "app.tar.gz"
    runtime_archive = tmp_path / "packed-runtime.tar.gz"
    app_archive.write_bytes(app_bytes)
    runtime_archive.write_bytes(runtime_bytes)
    assert manifest["unpacked_bytes"] == (
        _archive_unpacked_file_bytes(app_archive)
        + _archive_unpacked_file_bytes(runtime_archive)
    )
    with tarfile.open(app_archive, "r:gz") as app:
        assert "src/solaire/web/assets/tools/uploader.exe" in app.getnames()
    with tarfile.open(runtime_archive, "r:gz") as packed_runtime:
        names = set(packed_runtime.getnames())
        assert "lib/python3.12/site-packages/solaire/__init__.py" not in names
        assert "lib/libtesseract.a" not in names
        assert "lib/libtesseract.so.5" in names
        assert "lib/python3.12/site-packages/solaire-source.pth" in names


def test_runtime_pack_rejects_missing_entrypoint(tmp_path: Path):
    runtime, _ = _runtime_fixture(tmp_path)
    (runtime / "bin" / "solaire-web").unlink()
    output = tmp_path / "runtime.tar.gz"
    staging = tmp_path / "staging"
    staging.mkdir()

    with pytest.raises(ValueError, match="console scripts would be missing"):
        pack_runtime(
            runtime,
            output,
            staging,
            _CondaPack,
            console_scripts=("solaire-web",),
        )
