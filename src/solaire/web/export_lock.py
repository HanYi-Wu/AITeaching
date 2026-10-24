"""Cross-thread/process exclusion for a project's shared compiler workspace."""

from __future__ import annotations

import errno
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from solaire.web.security import assert_within_project

_registry_guard = threading.Lock()
_project_locks: dict[str, threading.Lock] = {}


class ExportBusyError(TimeoutError):
    """The workspace could not be acquired within the caller's wait budget."""


def _try_lock(stream) -> None:
    stream.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock(stream) -> None:
    stream.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


@contextmanager
def project_export_lock(root: Path, *, timeout: float = 120):
    """Serialize shared build/restore operations; independent projects can run together.

    OS advisory locks are released on process exit. The marker is intentionally
    retained, so a crashed exporter cannot leave behind a permanently busy flag.
    """
    root = root.resolve()
    key = os.path.normcase(str(root))
    deadline = time.monotonic() + max(0, timeout)
    with _registry_guard:
        lock = _project_locks.setdefault(key, threading.Lock())
    if not lock.acquire(timeout=max(0, timeout)):
        raise ExportBusyError("已有导出正在使用此项目，请稍后重试。")
    try:
        marker = root / ".solaire" / ".export.lock"
        assert_within_project(root, marker)
        marker.parent.mkdir(parents=True, exist_ok=True)
        with marker.open("a+b") as stream:
            if stream.seek(0, os.SEEK_END) == 0:
                stream.write(b"\0")
                stream.flush()
            while True:
                try:
                    _try_lock(stream)
                    break
                except OSError as exc:
                    if exc.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                        raise
                    if time.monotonic() >= deadline:
                        raise ExportBusyError("已有导出正在使用此项目，请稍后重试。") from exc
                    time.sleep(min(0.05, max(0, deadline - time.monotonic())))
            try:
                yield
            finally:
                _unlock(stream)
    finally:
        lock.release()
