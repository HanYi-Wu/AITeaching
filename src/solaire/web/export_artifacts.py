"""Stage a complete export before replacing any previously delivered files."""

from contextlib import contextmanager
import logging
import os
from pathlib import Path
import shutil
import tempfile
from collections.abc import Iterator, Mapping


class ExportRecoveryRequired(RuntimeError):
    """Replacement and restoration failed; retain the staged recovery copies."""


@contextmanager
def export_staging(destination: Path) -> Iterator[Path]:
    destination = destination.resolve()
    stage = Path(tempfile.mkdtemp(prefix=".export-", dir=destination)).resolve()
    preserve = False
    try:
        yield stage
    except ExportRecoveryRequired:
        preserve = True
        raise
    finally:
        if not preserve:
            # Only remove the directory created by this operation, inside its destination.
            if stage.parent != destination or not stage.name.startswith(".export-"):
                raise ValueError("Invalid export staging directory")
            shutil.rmtree(stage, ignore_errors=True)


def publish_export_files(
    destination: Path, stage: Path, files: Mapping[str, Path]
) -> None:
    """Publish the pair and metadata together, restoring replaced files on failure."""
    backups = stage / "previous"
    backups.mkdir()
    previous: dict[Path, Path] = {}
    for name, source in files.items():
        if Path(name).name != name or not source.resolve().is_relative_to(
            stage.resolve()
        ):
            raise ValueError("Invalid staged export file")
        if not source.is_file() or source.stat().st_size == 0:
            raise ValueError("导出未生成完整文件，原有文件已保留")
        target = destination / name
        if target.is_file():
            backup = backups / name
            shutil.copy2(target, backup)
            previous[target] = backup

    replaced: list[Path] = []
    try:
        for name, source in files.items():
            target = destination / name
            os.replace(source, target)
            replaced.append(target)
    except BaseException as failure:
        restore_errors = []
        for target in reversed(replaced):
            try:
                if target in previous:
                    os.replace(previous[target], target)
                else:
                    target.unlink(missing_ok=True)
            except OSError as exc:
                restore_errors.append(exc)
        if restore_errors:
            logging.getLogger(__name__).error(
                "Export restoration failed; recovery files retained in %s",
                stage,
                exc_info=True,
            )
            raise ExportRecoveryRequired(
                "导出文件更新失败，已保留旧文件恢复副本，请联系管理员。"
            ) from failure
        raise
