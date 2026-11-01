"""Read-only views over extracted or CRC-verified bank ZIP members."""
from __future__ import annotations

from dataclasses import dataclass
import io
import os
from pathlib import Path
import re
from typing import Iterable
import zipfile

from solaire.web.bank_write_plan.zip_index import ExtractedZipIndex

_PORTABLE_COMPONENT_RE = re.compile(r"[A-Za-z0-9_.-]+\Z")
_WINDOWS_RESERVED_STEMS = {
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


class RequiresExtractedArchive(RuntimeError):
    """A reference may depend on Windows filesystem aliases absent from ZIP metadata."""


def _path_key(path: Path) -> str:
    return os.path.normcase(str(path))


@dataclass(frozen=True)
class ArchiveMember:
    path: Path
    info: zipfile.ZipInfo | None = None


class ArchiveSource:
    """Common member lookup and read operations used by the ZIP planner."""

    def __init__(
        self,
        root: Path,
        members: Iterable[ArchiveMember],
        files_by_path: dict[str, Path],
        files_by_name: dict[str, list[Path]],
        image_dirs: list[Path],
    ) -> None:
        self.root = root.resolve()
        self.members = sorted(members, key=lambda member: member.path)
        self.files_by_path = files_by_path
        self.files_by_name = files_by_name
        self.image_dirs = sorted(image_dirs)
        self.members_by_path = {_path_key(member.path): member for member in self.members}

    def is_directory(self, path: Path) -> bool:
        raise NotImplementedError

    def is_file(self, path: Path) -> bool:
        raise NotImplementedError

    def yaml_members(self) -> list[ArchiveMember]:
        yaml_root = self.root / "yaml"
        if not self.is_directory(yaml_root):
            return []
        return [
            member for member in self.members
            if member.path.is_relative_to(yaml_root) and member.path.match("*.yaml")
        ]

    def has_yaml_directory(self) -> bool:
        return self.is_directory(self.root / "yaml")

    def questions_yaml(self) -> ArchiveMember | None:
        direct = self.members_by_path.get(_path_key(self.root / "questions.yaml"))
        if direct is not None and self.is_file(direct.path):
            return direct

        candidates = [
            member for member in self.members
            if member.path.relative_to(self.root).match("questions.yaml") and self.is_file(member.path)
        ]
        if not candidates:
            return None
        if len(candidates) > 1:
            raise ValueError(
                f"ZIP 内存在多个 questions.yaml: "
                f"{[str(member.path.relative_to(self.root)) for member in candidates]}"
            )
        return candidates[0]

    def resolve_embed(self, rel: str) -> ArchiveMember | None:
        rel = rel.strip().replace("\\", "/")
        if not rel or ".." in rel or rel.startswith("/"):
            return None

        path = (self.root / rel).resolve()
        try:
            path.relative_to(self.root)
        except ValueError:
            return None
        member = self.members_by_path.get(_path_key(path))
        if member is not None and self.is_file(path):
            return member

        basename = Path(rel).name
        path = (self.root / "image" / basename).resolve()
        member = self.members_by_path.get(_path_key(path))
        if member is not None and self.is_file(path):
            try:
                path.relative_to(self.root)
                return member
            except ValueError:
                pass

        for image_dir in self.image_dirs:
            path = (image_dir / basename).resolve()
            member = self.members_by_path.get(_path_key(path))
            if member is not None and self.is_file(path):
                try:
                    path.relative_to(self.root)
                    return member
                except ValueError:
                    pass

        matches = self.files_by_name.get(basename, [])
        if len(matches) == 1:
            member = self.members_by_path.get(_path_key(matches[0]))
            if member is not None and self.is_file(matches[0]):
                return member
        return None

    def file_size(self, member: ArchiveMember) -> int:
        if member.info is not None:
            return member.info.file_size
        return member.path.stat().st_size

    def read_text(self, member: ArchiveMember) -> str:
        if member.info is None:
            return member.path.read_text(encoding="utf-8")
        assert isinstance(self, DirectArchiveSource)
        with self.archive.open(member.info) as raw:
            with io.TextIOWrapper(raw, encoding="utf-8", newline=None) as text:
                return text.read()

    def read_bytes(self, member: ArchiveMember) -> bytes:
        if member.info is None:
            return member.path.read_bytes()
        assert isinstance(self, DirectArchiveSource)
        with self.archive.open(member.info) as raw:
            return raw.read()


class ExtractedArchiveSource(ArchiveSource):
    """The unchanged extraction path used for non-portable or ambiguous ZIPs."""

    def __init__(self, root: Path) -> None:
        self.index = ExtractedZipIndex(root)
        indexed_paths = list(self.index.files_by_rel.values())
        members = [ArchiveMember(path) for path in indexed_paths]
        super().__init__(
            root,
            members,
            {_path_key(path): path for path in indexed_paths},
            self.index.files_by_name,
            self.index.image_dirs,
        )

    def is_directory(self, path: Path) -> bool:
        return path.is_dir()

    def is_file(self, path: Path) -> bool:
        return path.is_file()

    def yaml_members(self) -> list[ArchiveMember]:
        yaml_root = self.root / "yaml"
        if not yaml_root.is_dir():
            return []
        return [ArchiveMember(path) for path in sorted(yaml_root.rglob("*.yaml"))]

    def has_yaml_directory(self) -> bool:
        return (self.root / "yaml").is_dir()

    def questions_yaml(self) -> ArchiveMember | None:
        direct = self.root / "questions.yaml"
        if direct.is_file():
            return ArchiveMember(direct)
        candidates = sorted(self.root.rglob("questions.yaml"))
        files = [path for path in candidates if path.is_file()]
        if not files:
            return None
        if len(files) > 1:
            raise ValueError(
                f"ZIP 内存在多个 questions.yaml: {[str(path.relative_to(self.root)) for path in files]}"
            )
        return ArchiveMember(files[0])

    def resolve_embed(self, rel: str) -> ArchiveMember | None:
        path = self.index.resolve_embed(rel)
        return ArchiveMember(path) if path is not None else None


class DirectArchiveSource(ArchiveSource):
    """Indexed ZIP member reader for paths proven portable on Windows."""

    def __init__(
        self,
        archive: zipfile.ZipFile,
        root: Path,
        members: list[ArchiveMember],
        files_by_path: dict[str, Path],
        files_by_name: dict[str, list[Path]],
        directories_by_path: dict[str, Path],
        image_dirs: list[Path],
    ) -> None:
        super().__init__(root, members, files_by_path, files_by_name, image_dirs)
        self.archive = archive
        self.directories_by_path = directories_by_path

    @classmethod
    def try_create(cls, archive: zipfile.ZipFile, root: Path) -> DirectArchiveSource | None:
        """Return a direct source only when extraction semantics are unambiguous.

        This metadata-only pass must not open members or raise archive-content
        errors. A rejected archive is handled by the original extractor in its
        original order, preserving CRC and path-error precedence.
        """
        root = root.resolve()
        infos = archive.infolist()
        members: list[ArchiveMember] = []
        files_by_path: dict[str, Path] = {}
        files_by_name: dict[str, list[Path]] = {}
        directories_by_path: dict[str, Path] = {_path_key(root): root}
        directories_by_parts: dict[tuple[str, ...], tuple[str, ...]] = {(): ()}
        file_parts: set[tuple[str, ...]] = set()

        for info in infos:
            # Directory entries are deliberately ignored by the existing extractor.
            if info.is_dir():
                continue
            name = info.filename
            parts = cls._portable_parts(name)
            if parts is None:
                return None

            target = root.joinpath(*parts)
            try:
                resolved = target.resolve()
                resolved.relative_to(root)
            except (OSError, RuntimeError, ValueError):
                return None
            if len(str(resolved)) >= 240:
                return None

            normalized_parts = tuple(part.lower() for part in parts)
            if normalized_parts in file_parts or normalized_parts in directories_by_parts:
                return None
            if any(normalized_parts[:depth] in file_parts for depth in range(1, len(parts))):
                return None

            for depth in range(1, len(parts)):
                key = normalized_parts[:depth]
                spelling = parts[:depth]
                previous = directories_by_parts.get(key)
                if previous is not None and previous != spelling:
                    return None
                directories_by_parts[key] = spelling
                directory = root.joinpath(*spelling)
                directories_by_path[_path_key(directory)] = directory

            member = ArchiveMember(resolved, info)
            path_key = _path_key(resolved)
            if path_key in files_by_path:
                return None
            files_by_path[path_key] = resolved
            files_by_name.setdefault(resolved.name, []).append(resolved)
            members.append(member)
            file_parts.add(normalized_parts)

        yaml_root = root / "yaml"
        for directory in directories_by_path.values():
            try:
                relative = directory.relative_to(yaml_root)
            except ValueError:
                continue
            if relative.parts and directory.name.lower().endswith(".yaml"):
                # The original rglob includes matching directories and then reads
                # them as text, so keep native filesystem errors through extraction.
                return None

        image_dirs = [path for path in directories_by_path.values() if path != root and path.name == "image"]
        return cls(archive, root, members, files_by_path, files_by_name, directories_by_path, image_dirs)

    @staticmethod
    def _portable_parts(name: str) -> tuple[str, ...] | None:
        if not name or "\\" in name or name.startswith("/") or "~" in name:
            return None
        parts = tuple(name.split("/"))
        if any(not part or part in {".", ".."} for part in parts):
            return None
        for part in parts:
            if not _PORTABLE_COMPONENT_RE.fullmatch(part) or part.endswith((".", " ")):
                return None
            if part.split(".", 1)[0].upper() in _WINDOWS_RESERVED_STEMS:
                return None
        return parts

    def resolve_embed(self, rel: str) -> ArchiveMember | None:
        normalized = rel.strip().replace("\\", "/")
        if not normalized or ".." in normalized or normalized.startswith("/"):
            return super().resolve_embed(rel)
        components = normalized.split("/")
        if any(
            not part.isascii()
            or "~" in part
            or ":" in part
            or part.endswith((".", " "))
            or part.split(".", 1)[0].upper() in _WINDOWS_RESERVED_STEMS
            for part in components
        ):
            raise RequiresExtractedArchive(rel)
        return super().resolve_embed(rel)

    def validate_members(self) -> None:
        """Read every ordinary member to EOF in original order, checking CRC."""
        for info in self.archive.infolist():
            if info.is_dir():
                continue
            with self.archive.open(info) as source:
                while source.read(1024 * 1024):
                    pass

    def is_directory(self, path: Path) -> bool:
        return _path_key(path.resolve()) in self.directories_by_path

    def is_file(self, path: Path) -> bool:
        return _path_key(path.resolve()) in self.files_by_path
