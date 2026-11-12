"""Transactional request-to-job bindings with bounded legacy JSON caching.

The original ``request_index.json`` remains in place and is read on demand.
New bindings live in a small SQLite table so a request never has to rewrite a
project-wide JSON object.  Legacy snapshots are loaded from exact file bytes,
cached by file identity, and evicted through a small process-wide LRU.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from collections import OrderedDict
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_BUSY_TIMEOUT_SECONDS = 15
_MAX_LEGACY_SNAPSHOTS = 2
_SCHEMA_LOCK = threading.Lock()
_SCHEMA_FILES: dict[str, tuple[int, int]] = {}
_LEGACY_CACHE_LOCK = threading.RLock()


@dataclass(frozen=True, slots=True)
class _LegacySnapshot:
    signature: tuple[int, int, int, int, int] | None
    content: bytes
    bindings: dict[str, Any]


_LEGACY_CACHE: OrderedDict[str, _LegacySnapshot] = OrderedDict()


def _file_signature(path: Path) -> tuple[int, int, int, int, int] | None:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    return (
        int(getattr(stat, "st_dev", 0)),
        int(getattr(stat, "st_ino", 0)),
        int(stat.st_size),
        int(stat.st_mtime_ns),
        int(stat.st_ctime_ns),
    )


def _read_legacy_bytes(path: Path) -> tuple[tuple[int, int, int, int, int] | None, bytes]:
    """Read a stable byte image, retrying if an older writer replaces it."""
    for _ in range(5):
        before = _file_signature(path)
        if before is None:
            if _file_signature(path) is None:
                return None, b""
            continue
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            continue
        after = _file_signature(path)
        if before != after:
            continue
        return after, raw
    raise OSError("Legacy request index changed while it was being read")


def _legacy_bindings(path: Path) -> dict[str, Any]:
    """Return a bounded snapshot cached by exact file content."""
    key = os.path.normcase(str(path))
    signature, raw = _read_legacy_bytes(path)
    with _LEGACY_CACHE_LOCK:
        snapshot = _LEGACY_CACHE.get(key)
        if snapshot is not None and snapshot.content == raw:
            _LEGACY_CACHE.move_to_end(key)
            return snapshot.bindings

        try:
            parsed: Any = json.loads(raw.decode("utf-8"))
        except Exception:
            parsed = None
        bindings = parsed if isinstance(parsed, dict) else {}
        snapshot = _LegacySnapshot(signature, raw, bindings)
        _LEGACY_CACHE[key] = snapshot
        _LEGACY_CACHE.move_to_end(key)
        while len(_LEGACY_CACHE) > _MAX_LEGACY_SNAPSHOTS:
            _LEGACY_CACHE.popitem(last=False)
        return snapshot.bindings


class RequestIndex:
    """Small SQLite index for new request bindings, plus a legacy read view."""

    __slots__ = ("database_path", "legacy_path")

    def __init__(self, database_path: Path, legacy_path: Path) -> None:
        self.database_path = database_path
        self.legacy_path = legacy_path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=_BUSY_TIMEOUT_SECONDS)
        connection.execute(f"PRAGMA busy_timeout = {_BUSY_TIMEOUT_SECONDS * 1000}")
        connection.execute("PRAGMA synchronous = FULL")
        key = os.path.normcase(str(self.database_path))
        try:
            stat = self.database_path.stat()
            file_identity = (int(stat.st_dev), int(stat.st_ino))
        except FileNotFoundError:
            file_identity = (0, 0)
        with _SCHEMA_LOCK:
            if _SCHEMA_FILES.get(key) != file_identity:
                # The default rollback journal keeps writes transactional with
                # fewer sidecar files, which matters on Windows project disks.
                connection.execute(
                    "CREATE TABLE IF NOT EXISTS request_bindings ("
                    "request_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, source TEXT NOT NULL) WITHOUT ROWID"
                )
                stat = self.database_path.stat()
                _SCHEMA_FILES[key] = (int(stat.st_dev), int(stat.st_ino))
        return connection

    def lookup(self, request_id: str) -> str | None:
        request_id = str(request_id)
        row = None
        if self.database_path.is_file():
            with closing(self._connect()) as connection:
                row = connection.execute(
                    "SELECT job_id FROM request_bindings WHERE request_id = ?",
                    (request_id,),
                ).fetchone()
        if row is not None:
            return str(row[0])
        try:
            legacy_value = _legacy_bindings(self.legacy_path).get(request_id)
        except OSError:
            return None
        return legacy_value if isinstance(legacy_value, str) else None

    def bind(self, request_id: str, job_id: str) -> None:
        """Unconditionally bind a key, preserving the former upsert behavior."""
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "INSERT INTO request_bindings(request_id, job_id, source) VALUES (?, ?, 'native') "
                "ON CONFLICT(request_id) DO UPDATE SET job_id=excluded.job_id, source='native'",
                (str(request_id), str(job_id)),
            )

    def claim(self, request_id: str, job_id: str) -> str:
        """Atomically claim an idempotency key; return its winning job ID."""
        request_id = str(request_id)
        existing = self.lookup(request_id)
        if existing is not None:
            return existing
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "INSERT INTO request_bindings(request_id, job_id, source) VALUES (?, ?, 'native') "
                "ON CONFLICT(request_id) DO NOTHING",
                (request_id, str(job_id)),
            )
            row = connection.execute(
                "SELECT job_id FROM request_bindings WHERE request_id = ?",
                (request_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("Request index claim completed without a binding")
        return str(row[0])
