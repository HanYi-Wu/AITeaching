"""Concurrency protection and locking primitives for KnowledgeForge graphs."""

from __future__ import annotations

import contextlib
import os
import threading
import time
from collections.abc import Iterator
from pathlib import Path

_THREAD_LOCKS: dict[str, threading.RLock] = {}
_THREAD_GUARD = threading.Lock()
_LOCAL = threading.local()


def _get_thread_lock(key: str) -> threading.RLock:
    with _THREAD_GUARD:
        if key not in _THREAD_LOCKS:
            _THREAD_LOCKS[key] = threading.RLock()
        return _THREAD_LOCKS[key]


@contextlib.contextmanager
def graph_lock(
    project_root: Path,
    slug: str | None = None,
    *,
    timeout: float = 15.0,
) -> Iterator[None]:
    """Acquire both an in-process thread lock and an OS file lock for graph mutations."""
    rk = str(project_root.resolve())
    target_key = f"{rk}:{slug or '_meta'}"
    thread_lock = _get_thread_lock(target_key)
    thread_lock.acquire()

    held = getattr(_LOCAL, "held", None)
    if held is None:
        held = _LOCAL.held = set()

    reentrant = target_key in held
    handle = None

    if not reentrant:
        held.add(target_key)
        lock_dir = (project_root / "resource" / "graph").resolve()
        lock_dir.mkdir(parents=True, exist_ok=True)
        safe_target = (slug or "_meta").replace("/", "_").replace("\\", "_")
        lock_file = lock_dir / f".{safe_target}.lock"
        start = time.monotonic()
        try:
            handle = open(lock_file, "a+", encoding="utf-8")
            locked = False
            while time.monotonic() - start < timeout:
                try:
                    if os.name == "nt":
                        import msvcrt

                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    locked = True
                    break
                except (OSError, IOError):
                    time.sleep(0.02)
        except Exception:
            # If opening lock file fails, thread_lock still protects concurrency
            handle = None

    try:
        yield
    finally:
        if not reentrant:
            held.discard(target_key)
            if handle is not None:
                try:
                    if os.name == "nt":
                        import msvcrt

                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass
                try:
                    handle.close()
                except Exception:
                    pass
        thread_lock.release()
