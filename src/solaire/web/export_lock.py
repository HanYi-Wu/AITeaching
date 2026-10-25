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


class FileLease:
    """An OS-backed lease that can be handed from a dispatcher to its worker."""

    def __init__(self, path: Path, *, timeout: float = 0):
        self.path, self.timeout, self.stream = path, timeout, None

    def __enter__(self):
        deadline = time.monotonic() + max(0, self.timeout)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.path.open("a+b")
        try:
            if stream.seek(0, os.SEEK_END) == 0:
                stream.write(b"\0")
                stream.flush()
            while True:
                try:
                    _try_lock(stream)
                    self.stream = stream
                    return self
                except OSError as exc:
                    if exc.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                        raise
                    if time.monotonic() >= deadline:
                        raise ExportBusyError("已有导出任务正在使用此工作区。") from exc
                    time.sleep(min(0.05, max(0, deadline - time.monotonic())))
        except BaseException:
            stream.close()
            raise

    def close(self):
        stream, self.stream = self.stream, None
        if stream is not None:
            try:
                _unlock(stream)
            finally:
                stream.close()

    def __exit__(self, *args):
        self.close()


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
        with FileLease(marker, timeout=max(0, deadline - time.monotonic())):
            yield
    finally:
        lock.release()
