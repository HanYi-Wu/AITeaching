"""Atomic application and rollback for write plans."""
from __future__ import annotations

from pathlib import Path

from solaire.common.atomic_files import write_bytes_atomic, write_text_atomic
from solaire.web.security import assert_within_project
from solaire.web.bank_write_plan.plan import WritePlan


def apply_write_plan(project_root: Path, plan: WritePlan) -> None:
    """Apply planned mutations atomically with strict reverse-order rollback."""
    originals: dict[Path, bytes | None] = {}

    all_targets = set(plan.yaml_writes.keys()) | set(plan.extra_writes.keys())
    for path in all_targets:
        assert_within_project(project_root, path)
        if path.exists() and not path.is_file():
            raise ValueError(f"导入目标不是普通文件: {path.name}")
        originals[path] = path.read_bytes() if path.is_file() else None

    applied: list[Path] = []
    try:
        # Apply YAML writes
        for path, text in plan.yaml_writes.items():
            write_text_atomic(path, text)
            applied.append(path)

        # Apply Extra bytes writes
        for path, data in plan.extra_writes.items():
            write_bytes_atomic(path, data)
            applied.append(path)

    except OSError as error:
        failed_restores: list[str] = []
        for path in reversed(applied):
            try:
                previous = originals[path]
                if previous is None:
                    path.unlink(missing_ok=True)
                else:
                    write_bytes_atomic(path, previous)
            except OSError:
                failed_restores.append(path.relative_to(project_root).as_posix())

        if failed_restores:
            raise ValueError(
                "导入写入失败，以下文件未能恢复，请检查后重试: " + "、".join(failed_restores)
            ) from error
        raise ValueError("导入写入失败，已恢复本批已应用文件，原内容保持完整") from error
