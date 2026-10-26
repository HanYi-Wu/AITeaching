"""Process-local liveness only; execution and persistence remain with source services."""
from pathlib import Path
from threading import RLock

_lock = RLock()
_live: set[tuple[str, str]] = set()


def mark_live(root: Path, task_id: str) -> None:
    with _lock:
        _live.add((str(root.resolve()), task_id))


def mark_finished(root: Path, task_id: str) -> None:
    with _lock:
        _live.discard((str(root.resolve()), task_id))


def is_live(root: Path, task_id: str) -> bool:
    with _lock:
        return (str(root.resolve()), task_id) in _live
