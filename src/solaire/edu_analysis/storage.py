"""Filesystem boundary for education analysis jobs and artifacts.

The public module-level helpers keep their historical signatures.  A
``AnalysisStorage`` instance lets a multi-step job reuse the resolved project
boundary and prepared directories instead of resolving and creating the same
paths for every file operation.
"""

from __future__ import annotations

import heapq
import io
import json
import os
import tempfile
from datetime import datetime, timezone
from operator import index as integer_index
from pathlib import Path
from typing import Any, Iterable

from solaire.common.security import PathEscapesProjectRoot, assert_within_project

from ._request_index import RequestIndex


_JSON_WRITE_BUFFER_CHARS = 32 * 1024
_JSON_LIST_CHUNK_ITEMS = 4096
_JSON_CHUNK_STRING_CHARS = 128


class _UseStandardJsonDump(Exception):
    """Signal that a value needs the standard encoder's complete type handling."""


def _write_compact_json_in_chunks(stream, payload: dict[str, Any]) -> None:
    """Use the C encoder for bounded scalar-list chunks and JSON strings."""
    encode = json.JSONEncoder(ensure_ascii=False, separators=(",", ":")).encode
    pending = io.StringIO()
    pending_chars = 0
    active_containers: set[int] = set()

    def flush() -> None:
        nonlocal pending_chars
        if pending_chars:
            stream.write(pending.getvalue())
            pending.seek(0)
            pending.truncate(0)
            pending_chars = 0

    def emit(piece: str) -> None:
        nonlocal pending_chars
        if not piece:
            return
        if pending_chars + len(piece) > _JSON_WRITE_BUFFER_CHARS:
            flush()
        if len(piece) >= _JSON_WRITE_BUFFER_CHARS:
            stream.write(piece)
            return
        pending.write(piece)
        pending_chars += len(piece)

    def encode_key(key: Any) -> str:
        if key is None:
            text_key = "null"
        elif key is True:
            text_key = "true"
        elif key is False:
            text_key = "false"
        elif type(key) is str:
            text_key = key
        elif type(key) in (int, float):
            text_key = encode(key)
        else:
            raise _UseStandardJsonDump
        return encode(text_key)

    def is_scalar(value: Any) -> bool:
        return value is None or type(value) in (str, int, float, bool)

    def fits_chunk(value: Any) -> bool:
        value_type = type(value)
        if value_type is str:
            return len(value) <= _JSON_CHUNK_STRING_CHARS
        if value_type is int:
            return value.bit_length() <= 64
        return value_type is float or value_type is bool or value is None

    def is_flat_record(record: dict[Any, Any]) -> bool:
        remaining = _JSON_LIST_CHUNK_ITEMS - len(record)
        if remaining < 0:
            return False
        for key, value in record.items():
            if not fits_chunk(key):
                return False
            if fits_chunk(value):
                continue
            if type(value) not in (list, tuple):
                return False
            remaining -= len(value)
            if remaining < 0 or not all(fits_chunk(item) for item in value):
                return False
        return True

    def encode_value(value: Any) -> None:
        value_type = type(value)
        if value_type in (dict, list, tuple):
            marker = id(value)
            if marker in active_containers:
                raise ValueError("Circular reference detected")
            if value_type is dict and is_flat_record(value):
                emit(encode(value))
                return
            active_containers.add(marker)
            try:
                if value_type is dict:
                    emit("{")
                    first = True
                    for key, item in value.items():
                        if not first:
                            emit(",")
                        emit(encode_key(key))
                        emit(":")
                        encode_value(item)
                        first = False
                    emit("}")
                    return

                emit("[")
                if all(fits_chunk(item) for item in value):
                    for start in range(0, len(value), _JSON_LIST_CHUNK_ITEMS):
                        if start:
                            emit(",")
                        encoded = encode(value[start : start + _JSON_LIST_CHUNK_ITEMS])
                        emit(encoded[1:-1])
                else:
                    first = True
                    for item in value:
                        if not first:
                            emit(",")
                        encode_value(item)
                        first = False
                emit("]")
                return
            finally:
                active_containers.remove(marker)

        if is_scalar(value):
            emit(encode(value))
            return
        raise _UseStandardJsonDump

    encode_value(payload)
    flush()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def _write_json(
    path: Path,
    payload: dict[str, Any],
    *,
    indent: int | None = 2,
    separators: tuple[str, str] | None = None,
) -> None:
    """Replace one JSON document atomically after a complete serialization."""
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            if indent is None and separators == (",", ":") and type(payload) is dict:
                try:
                    _write_compact_json_in_chunks(stream, payload)
                except (_UseStandardJsonDump, RecursionError):
                    # Preserve exact behavior for JSONEncoder-supported custom
                    # container/scalar subclasses, deep nesting, and type errors.
                    stream.seek(0)
                    stream.truncate()
                    json.dump(
                        payload,
                        stream,
                        ensure_ascii=False,
                        indent=indent,
                        separators=separators,
                    )
            else:
                json.dump(
                    payload,
                    stream,
                    ensure_ascii=False,
                    indent=indent,
                    separators=separators,
                )
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _component(value: str, label: str) -> str:
    """Accept a single portable filename component, never a path expression."""
    value = str(value)
    if (
        not value
        or value in {".", ".."}
        or any(char in value for char in ("/", "\\", ":", "\x00"))
    ):
        raise ValueError(f"Invalid {label}: expected one filename component")
    return value


def _ordered_json_paths(directory: Path, limit: int | None = None) -> list[Path]:
    """Return JSON paths in mtime-descending scandir order.

    A positive limit uses a bounded heap, keeping top-N discovery at
    O(files * log(limit)) while preserving the prior enumeration order for
    equal mtimes.  Negative slicing retains the old ``sorted(...)[ :limit]``
    behavior for callers that pass a negative limit.
    """
    limit_value = None if limit is None else integer_index(limit)
    if limit_value == 0:
        return []

    heap: list[tuple[float, int, Path]] = []
    all_entries: list[tuple[float, int, Path]] | None = [] if limit_value is None or limit_value < 0 else None
    try:
        with os.scandir(directory) as entries:
            for position, entry in enumerate(entries):
                if not entry.name.endswith(".json"):
                    continue
                try:
                    modified = entry.stat().st_mtime
                except OSError:
                    # A file removed during enumeration would fail the old
                    # stat call too; skipping it gives a coherent current view.
                    continue
                item = (modified, -position, Path(entry.path))
                if all_entries is not None:
                    all_entries.append(item)
                elif len(heap) < limit_value:
                    heapq.heappush(heap, item)
                elif item[:2] > heap[0][:2]:
                    heapq.heapreplace(heap, item)
    except FileNotFoundError:
        return []

    if all_entries is not None:
        all_entries.sort(key=lambda item: item[0], reverse=True)
        paths = [item[2] for item in all_entries]
        return paths if limit_value is None else paths[:limit_value]
    heap.sort(key=lambda item: item[:2], reverse=True)
    return [item[2] for item in heap]


def _read_many(paths: Iterable[Path]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in paths:
        try:
            records.append(_read_json(path))
        except Exception:
            continue
    return records


class AnalysisStorage:
    """Resolve and guard one project's analysis storage for a task/request."""

    __slots__ = ("project_root", "root", "_directories", "_request_index")

    def __init__(self, project_root: Path) -> None:
        supplied_root = Path(project_root)
        self.project_root = assert_within_project(supplied_root, supplied_root)
        candidate = self.project_root / "result" / "edu_analysis"
        self.root = assert_within_project(self.project_root, candidate)
        self.root.mkdir(parents=True, exist_ok=True)
        self.root = self._assert_path(self.root)
        self._directories: dict[str, Path] = {}
        self._request_index: RequestIndex | None = None

    def _assert_path(self, path: Path) -> Path:
        resolved = path.resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise PathEscapesProjectRoot(
                f"Path {resolved!r} escapes analysis storage {self.root!r}"
            ) from exc
        return resolved

    def _directory(self, name: str) -> Path:
        directory = self._directories.get(name)
        if directory is None:
            directory = self._assert_path(self.root / name)
            directory.mkdir(parents=True, exist_ok=True)
            directory = self._assert_path(directory)
            self._directories[name] = directory
        return directory

    def _file(self, directory: str, filename: str) -> Path:
        return self._assert_path(self._directory(directory) / filename)

    def _index(self) -> RequestIndex:
        if self._request_index is None:
            self._request_index = RequestIndex(
                self._assert_path(self.root / "request_index.sqlite3"),
                self._assert_path(self.root / "request_index.json"),
            )
        return self._request_index

    def get_job_for_request(self, request_id: str) -> str | None:
        return self._index().lookup(request_id)

    def bind_request_to_job(self, request_id: str, job_id: str) -> None:
        self._index().bind(request_id, job_id)

    def claim_request_for_job(self, request_id: str, job_id: str) -> str:
        return self._index().claim(request_id, job_id)

    def append_audit_record(self, record: dict[str, Any]) -> None:
        path = self._assert_path(self.root / "audit.log.jsonl")
        payload = {**record, "created_at": _now()}
        with path.open("a", encoding="utf-8", newline="") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def save_script(self, script: dict[str, Any]) -> dict[str, Any]:
        script["updated_at"] = _now()
        if "created_at" not in script:
            script["created_at"] = script["updated_at"]
        script_id = _component(script["script_id"], "script ID")
        path = self._file("scripts", f"{script_id}.json")
        _write_json(path, script)
        return script

    def load_script(self, script_id: str) -> dict[str, Any]:
        script_id = _component(script_id, "script ID")
        path = self._file("scripts", f"{script_id}.json")
        if not path.is_file():
            raise FileNotFoundError(f"Script not found: {script_id}")
        return _read_json(path)

    def list_scripts(self) -> list[dict[str, Any]]:
        return _read_many(_ordered_json_paths(self._directory("scripts")))

    def delete_script(self, script_id: str) -> None:
        script_id = _component(script_id, "script ID")
        path = self._file("scripts", f"{script_id}.json")
        if not path.is_file():
            raise FileNotFoundError(f"Script not found: {script_id}")
        path.unlink()

    def save_output(self, job_id: str, output: dict[str, Any]) -> str:
        job_id = _component(job_id, "job ID")
        path = self._file("outputs", f"{job_id}.json")
        _write_json(path, output, indent=None, separators=(",", ":"))
        return f"outputs/{job_id}.json"

    def load_output(self, output_ref: str) -> dict[str, Any]:
        reference = Path(output_ref)
        if reference.is_absolute() or len(reference.parts) != 2 or reference.parts[0] != "outputs":
            raise ValueError("Invalid output reference")
        filename = _component(reference.parts[1], "output reference")
        if not filename.endswith(".json"):
            raise ValueError("Invalid output reference")
        path = self._assert_path(self.root / reference)
        if not path.is_file():
            raise FileNotFoundError(f"Output not found: {output_ref}")
        return _read_json(path)

    def save_job(self, job: dict[str, Any]) -> dict[str, Any]:
        job["updated_at"] = _now()
        if "created_at" not in job:
            job["created_at"] = job["updated_at"]
        job_id = _component(job["job_id"], "job ID")
        path = self._file("jobs", f"{job_id}.json")
        _write_json(path, job)
        return job

    def load_job(self, job_id: str) -> dict[str, Any]:
        job_id = _component(job_id, "job ID")
        path = self._file("jobs", f"{job_id}.json")
        if not path.is_file():
            raise FileNotFoundError(f"Job not found: {job_id}")
        return _read_json(path)

    def delete_job(self, job_id: str) -> None:
        job_id = _component(job_id, "job ID")
        path = self._file("jobs", f"{job_id}.json")
        if path.is_file():
            path.unlink()

    def list_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        return _read_many(_ordered_json_paths(self._directory("jobs"), limit))


# Compatibility path helpers.  Workflows that touch several artifacts should
# keep one AnalysisStorage instance and use its methods directly.
def edu_analysis_root(project_root: Path) -> Path:
    return AnalysisStorage(project_root).root


def scripts_dir(project_root: Path) -> Path:
    return AnalysisStorage(project_root)._directory("scripts")


def jobs_dir(project_root: Path) -> Path:
    return AnalysisStorage(project_root)._directory("jobs")


def outputs_dir(project_root: Path) -> Path:
    return AnalysisStorage(project_root)._directory("outputs")


def _requests_index_path(project_root: Path) -> Path:
    return AnalysisStorage(project_root)._assert_path(edu_analysis_root(project_root) / "request_index.json")


def _audit_log_path(project_root: Path) -> Path:
    return AnalysisStorage(project_root)._assert_path(edu_analysis_root(project_root) / "audit.log.jsonl")


def get_job_for_request(project_root: Path, request_id: str) -> str | None:
    return AnalysisStorage(project_root).get_job_for_request(request_id)


def bind_request_to_job(project_root: Path, request_id: str, job_id: str) -> None:
    AnalysisStorage(project_root).bind_request_to_job(request_id, job_id)


def claim_request_for_job(project_root: Path, request_id: str, job_id: str) -> str:
    return AnalysisStorage(project_root).claim_request_for_job(request_id, job_id)


def append_audit_record(project_root: Path, record: dict[str, Any]) -> None:
    AnalysisStorage(project_root).append_audit_record(record)


def save_script(project_root: Path, script: dict[str, Any]) -> dict[str, Any]:
    return AnalysisStorage(project_root).save_script(script)


def load_script(project_root: Path, script_id: str) -> dict[str, Any]:
    return AnalysisStorage(project_root).load_script(script_id)


def list_scripts(project_root: Path) -> list[dict[str, Any]]:
    return AnalysisStorage(project_root).list_scripts()


def delete_script(project_root: Path, script_id: str) -> None:
    AnalysisStorage(project_root).delete_script(script_id)


def save_output(project_root: Path, job_id: str, output: dict[str, Any]) -> str:
    return AnalysisStorage(project_root).save_output(job_id, output)


def load_output(project_root: Path, output_ref: str) -> dict[str, Any]:
    return AnalysisStorage(project_root).load_output(output_ref)


def save_job(project_root: Path, job: dict[str, Any]) -> dict[str, Any]:
    return AnalysisStorage(project_root).save_job(job)


def load_job(project_root: Path, job_id: str) -> dict[str, Any]:
    return AnalysisStorage(project_root).load_job(job_id)


def list_jobs(project_root: Path, limit: int = 50) -> list[dict[str, Any]]:
    return AnalysisStorage(project_root).list_jobs(limit=limit)
