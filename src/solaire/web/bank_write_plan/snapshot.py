"""Library snapshot under bank write lock."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from solaire.exam_compiler.loaders.questions import iter_question_files
from solaire.web.bank_storage import (
    BankDocument,
    _diagnostic_message,
    _diagnostic_path,
    read_bank_document,
)
from solaire.web.security import assert_within_project


@dataclass
class FileSnapshot:
    path: Path
    mtime_ns: int
    size: int
    document: BankDocument | None = None
    error: Exception | None = None
    diagnostic: dict[str, str] | None = None


@dataclass
class LibrarySnapshot:
    """Authoritative snapshot of a question library taken under lock."""

    project_root: Path
    library: Path
    documents: list[BankDocument]
    diagnostics: list[dict[str, str]]
    files_by_path: dict[Path, FileSnapshot]

    def require_identity_complete(self, qid: str) -> None:
        if self.diagnostics:
            paths = ", ".join(item["storage_path"] for item in self.diagnostics)
            raise ValueError(f"存在无法读取的题目文件，无法确认新题号 {qid} 是否已存在: {paths}")

    def verify_concurrency_valid(self) -> None:
        """Verify that the captured question-file set and metadata are still current."""
        current_paths = {path.resolve() for path in iter_question_files(self.library)}
        captured_paths = set(self.files_by_path)
        if current_paths != captured_paths:
            added = sorted(current_paths - captured_paths)
            deleted = sorted(captured_paths - current_paths)
            if added:
                raise ValueError(f"并发写入冲突：题库在计划构建期间新增文件: {added[0].name}")
            if deleted:
                raise ValueError(f"并发写入冲突：题库在计划构建期间删除文件: {deleted[0].name}")

        for resolved in sorted(current_paths):
            snap = self.files_by_path[resolved]
            try:
                st = resolved.stat()
            except OSError as error:
                raise ValueError(f"并发写入冲突：文件在计划构建期间被外部删除: {resolved.name}") from error
            if st.st_mtime_ns != snap.mtime_ns or st.st_size != snap.size:
                raise ValueError(f"并发写入冲突：文件在计划构建期间被外部修改: {resolved.name}")


def capture_library_snapshot(project_root: Path, library: Path) -> LibrarySnapshot:
    """Capture library state in a single traversal under lock."""
    documents: list[BankDocument] = []
    diagnostics: list[dict[str, str]] = []
    files_by_path: dict[Path, FileSnapshot] = {}

    for path in iter_question_files(library):
        assert_within_project(project_root, path)
        resolved = path.resolve()
        try:
            st = resolved.stat()
            mtime_ns = st.st_mtime_ns
            size = st.st_size
        except OSError:
            mtime_ns = 0
            size = 0

        try:
            document = read_bank_document(path)
            snap = FileSnapshot(path=resolved, mtime_ns=mtime_ns, size=size, document=document)
            files_by_path[resolved] = snap
        except (OSError, UnicodeError, yaml.YAMLError, ValueError) as error:
            diag = {
                "storage_path": _diagnostic_path(project_root, path),
                "code": "invalid_question_file",
                "message": _diagnostic_message(path, error),
            }
            diagnostics.append(diag)
            snap = FileSnapshot(
                path=resolved,
                mtime_ns=mtime_ns,
                size=size,
                document=None,
                error=error,
                diagnostic=diag,
            )
            files_by_path[resolved] = snap
            continue

        documents.append(document)

    return LibrarySnapshot(
        project_root=project_root,
        library=library,
        documents=documents,
        diagnostics=diagnostics,
        files_by_path=files_by_path,
    )
