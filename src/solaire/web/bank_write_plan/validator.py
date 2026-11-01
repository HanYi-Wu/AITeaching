"""Single-pass validation for write plans."""
from __future__ import annotations

from pathlib import Path

import yaml

from solaire.web.bank_storage import (
    _diagnostic_path,
    parse_bank_document,
    read_bank_document,
)
from solaire.web.security import assert_within_project
from solaire.web.bank_write_plan.plan import WritePlan
from solaire.web.bank_write_plan.snapshot import LibrarySnapshot


def validate_write_plan(snapshot: LibrarySnapshot, plan: WritePlan) -> None:
    """Validate resulting library state before mutating disk.

    Combines snapshot state with planned writes in one pass, eliminating
    redundant file re-enumeration and duplicate YAML parsing.
    """
    project_root = plan.project_root
    target_library = plan.target_library
    lib_resolved = target_library.resolve()

    planned = {path.resolve(): text for path, text in plan.yaml_writes.items()}
    forbidden_questions_yaml = (target_library / "questions.yaml").resolve()
    paths = set(snapshot.files_by_path) | set(planned)
    seen: dict[str, Path] = {}

    # Match the legacy validator's sorted path walk while reusing parsed documents
    # from the locked snapshot instead of reading them from disk a second time.
    for path in sorted(paths):
        assert_within_project(project_root, path)
        path.relative_to(lib_resolved)
        if path == forbidden_questions_yaml:
            raise ValueError("题库根目录的 questions.yaml 仅用于旧版合并导入，请使用其他题目文件名")

        snap = snapshot.files_by_path.get(path)
        if path in planned:
            if path.exists() and snap is not None:
                if snap.document is None and snap.error is not None:
                    raise ValueError(
                        f"拒绝覆盖损坏的题目文件: {_diagnostic_path(project_root, path)} ({type(snap.error).__name__})"
                    ) from snap.error
            elif path.is_file():
                try:
                    read_bank_document(path)
                except (OSError, UnicodeError, yaml.YAMLError, ValueError) as error:
                    raise ValueError(
                        f"拒绝覆盖损坏的题目文件: {_diagnostic_path(project_root, path)} ({type(error).__name__})"
                    ) from error

            document = parse_bank_document(path, planned[path])
            if not path.exists():
                for record in document.records:
                    snapshot.require_identity_complete(record.id)
        else:
            if snap is None or snap.document is None:
                # Existing unreadable files remain in place and keep their
                # diagnostics; they are not treated as valid ID records here.
                continue
            document = snap.document

        for record in document.records:
            if record.id in seen:
                raise ValueError(
                    f"题集中存在重复题目编号: {record.id} ({seen[record.id].name}, {path.name})"
                )
            seen[record.id] = path

    for path in plan.extra_writes:
        assert_within_project(project_root, path)
        if path.resolve() in planned:
            raise ValueError(f"导入资源路径冲突: {path.name}")

    # Concurrency check follows validation so the first reported data error stays
    # stable and ordered by path, as in the original batch import flow.
    snapshot.verify_concurrency_valid()
