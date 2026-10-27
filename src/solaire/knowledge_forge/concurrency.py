"""One reentrant project lock for graph read/modify/write operations."""

from __future__ import annotations

import contextlib
import os
import threading
import time
from functools import wraps
from pathlib import Path

from solaire.common.security import assert_within_project

_THREAD_LOCKS: dict[str, threading.RLock] = {}
_THREAD_GUARD = threading.Lock()
_LOCAL = threading.local()


@contextlib.contextmanager
def graph_lock(project_root: Path, slug: str | None = None, *, timeout: float = 15.0):
    # References and IDs span subjects. A single lock also avoids lock-order inversions.
    root = project_root.resolve()
    key = os.path.normcase(str(root))
    with _THREAD_GUARD:
        lock = _THREAD_LOCKS.setdefault(key, threading.RLock())
    if not lock.acquire(timeout=timeout):
        raise TimeoutError("图谱正被其他操作使用，请稍后重试。")
    held = getattr(_LOCAL, "held", None)
    if held is None:
        held = _LOCAL.held = set()
    handle = None
    acquired = False
    reentrant = key in held
    try:
        if not reentrant:
            path = root / "resource" / "graph" / ".write.lock"
            assert_within_project(root, path)
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = path.open("a+b")
            deadline = time.monotonic() + timeout
            while True:
                try:
                    if os.name == "nt":
                        import msvcrt
                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                    held.add(key)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("图谱文件锁等待超时，未执行写入。") from None
                    time.sleep(0.02)
        yield
    finally:
        try:
            if acquired:
                held.discard(key)
                if os.name == "nt":
                    import msvcrt
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            if handle is not None:
                handle.close()
            lock.release()


def graph_mutation(fn):
    @wraps(fn)
    def locked(project_root, *args, **kwargs):
        with graph_lock(project_root):
            return fn(project_root, *args, **kwargs)
    return locked
