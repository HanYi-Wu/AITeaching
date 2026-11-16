"""Session persistence under .solaire/agent/sessions/."""

from __future__ import annotations

import json
import heapq
import re
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from solaire.agent_layer.models import SessionState
from solaire.common.atomic_files import write_text_atomic


@dataclass(frozen=True, slots=True)
class _SessionListCacheEntry:
    signature: tuple[int, int, int, int, int]
    owner_user_id: str | None
    summary: dict[str, object] | None


_SESSION_LIST_CACHE_MAX_ROOTS = 8
_SESSION_LIST_CACHE_MAX_ENTRIES = 2048
_SESSION_LIST_CACHE_LOCK = threading.RLock()
_SESSION_LIST_CACHE: OrderedDict[Path, dict[str, _SessionListCacheEntry]] = OrderedDict()


def sessions_dir(project_root: Path) -> Path:
    d = project_root / ".solaire" / "agent" / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def new_session_id() -> str:
    return uuid.uuid4().hex


def _validated_session_id(session_id: str) -> str:
    value = str(session_id).strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value) is None:
        raise ValueError("Invalid agent session id")
    return value


def session_path(project_root: Path, session_id: str) -> Path:
    return _session_path_with_root(project_root, session_id)[1]


def _session_path_with_root(project_root: Path, session_id: str) -> tuple[Path, Path]:
    root = sessions_dir(project_root).resolve()
    path = (root / f"{_validated_session_id(session_id)}.json").resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Agent session path must stay inside sessions directory") from exc
    return root, path


def _read_session(path: Path) -> SessionState:
    raw = path.read_bytes()
    # Large message strings parse faster with the standard decoder, while the
    # direct model decoder avoids an intermediate object tree for short records.
    if len(raw) > 65_536:
        return SessionState.model_validate(json.loads(raw.decode("utf-8")))
    try:
        return SessionState.model_validate_json(raw)
    except ValidationError:
        return SessionState.model_validate(json.loads(raw.decode("utf-8")))


def load_session(project_root: Path, session_id: str) -> SessionState | None:
    p = session_path(project_root, session_id)
    if not p.is_file():
        return None
    return _read_session(p)


def save_session(project_root: Path, session: SessionState) -> None:
    root, p = _session_path_with_root(project_root, session.session_id)
    write_text_atomic(p, session.model_dump_json())
    _invalidate_session_list_cache(root, p.name)


def create_session(project_root: Path, *, owner_user_id: str | None = None) -> SessionState:
    sid = new_session_id()
    s = SessionState(session_id=sid, owner_user_id=owner_user_id)
    save_session(project_root, s)
    return s


def _session_file_signature(path: Path) -> tuple[int, int, int, int, int]:
    stat = path.stat()
    return (
        int(stat.st_dev),
        int(stat.st_ino),
        int(stat.st_size),
        int(stat.st_mtime_ns),
        int(stat.st_ctime_ns),
    )


def _session_list_cache_root(project_root: Path) -> Path:
    return (project_root / ".solaire" / "agent" / "sessions").resolve()


def _invalidate_session_list_cache(root: Path, filename: str) -> None:
    with _SESSION_LIST_CACHE_LOCK:
        entries = _SESSION_LIST_CACHE.get(root)
        if entries is not None:
            entries.pop(filename, None)


def _get_session_list_cache_entry(
    root: Path,
    filename: str,
    signature: tuple[int, int, int, int, int],
) -> _SessionListCacheEntry | None:
    with _SESSION_LIST_CACHE_LOCK:
        entries = _SESSION_LIST_CACHE.get(root)
        if entries is None:
            return None
        _SESSION_LIST_CACHE.move_to_end(root)
        entry = entries.get(filename)
        if entry is not None and entry.signature == signature:
            return entry
        return None


def _prune_session_list_cache(root: Path, filenames: set[str]) -> None:
    with _SESSION_LIST_CACHE_LOCK:
        entries = _SESSION_LIST_CACHE.get(root)
        if entries is None:
            entries = {}
            _SESSION_LIST_CACHE[root] = entries
        else:
            _SESSION_LIST_CACHE.move_to_end(root)
        for filename in tuple(entries):
            if filename not in filenames:
                del entries[filename]
        while len(_SESSION_LIST_CACHE) > _SESSION_LIST_CACHE_MAX_ROOTS:
            _SESSION_LIST_CACHE.popitem(last=False)


def _put_session_list_cache_entry(
    root: Path,
    filename: str,
    entry: _SessionListCacheEntry,
) -> None:
    with _SESSION_LIST_CACHE_LOCK:
        entries = _SESSION_LIST_CACHE.get(root)
        if entries is None:
            entries = {}
            _SESSION_LIST_CACHE[root] = entries
        entries[filename] = entry
        _SESSION_LIST_CACHE.move_to_end(root)
        while len(entries) > _SESSION_LIST_CACHE_MAX_ENTRIES:
            entries.pop(next(iter(entries)))
        while len(_SESSION_LIST_CACHE) > _SESSION_LIST_CACHE_MAX_ROOTS:
            _SESSION_LIST_CACHE.popitem(last=False)


def _summarize_session(session: SessionState) -> dict[str, object]:
    title = ""
    for message in session.messages:
        if message.role == "user" and (message.content or "").strip():
            title = (message.content or "").strip().replace("\n", " ")[:50]
            break
    return {
        "session_id": session.session_id,
        "updated_at": session.updated_at,
        "message_count": len(session.messages),
        "title": title or "新对话",
    }


def _read_session_list_cache_entry(
    path: Path,
    signature: tuple[int, int, int, int, int],
) -> _SessionListCacheEntry | None:
    """Read and validate one history, retrying once if atomic replacement raced us."""
    for _attempt in range(2):
        try:
            session = _read_session(path)
            owner_user_id = session.owner_user_id
            summary = _summarize_session(session)
        except Exception:
            owner_user_id = None
            summary = None

        try:
            after_signature = _session_file_signature(path)
        except OSError:
            return None
        if after_signature == signature:
            return _SessionListCacheEntry(signature, owner_user_id, summary)
        signature = after_signature
    # Avoid caching metadata read across repeated concurrent replacements.
    return None


def list_sessions(project_root: Path, *, limit: int = 50, owner_user_id: str | None = None) -> list[dict]:
    out: list[dict] = []
    d = sessions_dir(project_root)
    records: list[tuple[Path, tuple[int, int, int, int, int], float]] = []
    for path in d.glob("*.json"):
        try:
            stat = path.stat()
            signature = (
                int(stat.st_dev),
                int(stat.st_ino),
                int(stat.st_size),
                int(stat.st_mtime_ns),
                int(stat.st_ctime_ns),
            )
            records.append((path, signature, stat.st_mtime))
        except OSError:
            continue

    if limit < 0:
        candidates = sorted(records, key=lambda item: item[2], reverse=True)[:limit]
    else:
        # Preserve the old mtime-descending order while selecting only the
        # prefix requested by the caller instead of sorting every session.
        candidates = heapq.nlargest(limit, records, key=lambda item: item[2])

    root = _session_list_cache_root(project_root)
    cache_filenames = {path.name for path, _, _ in candidates[:_SESSION_LIST_CACHE_MAX_ENTRIES]}
    _prune_session_list_cache(root, cache_filenames)

    cacheable_count = min(len(candidates), _SESSION_LIST_CACHE_MAX_ENTRIES)
    for index, (path, indexed_signature, _mtime) in enumerate(candidates):
        # The directory scan already captured a validated file signature; use
        # it for warm hits and avoid a second stat for every visible session.
        entry = _get_session_list_cache_entry(root, path.name, indexed_signature)
        if entry is None:
            entry = _read_session_list_cache_entry(path, indexed_signature)
            if entry is None:
                continue
            if index < cacheable_count:
                _put_session_list_cache_entry(root, path.name, entry)

        if owner_user_id is not None and entry.owner_user_id != owner_user_id:
            continue
        if entry.summary is not None:
            # Return detached dictionaries so callers cannot mutate the cache.
            out.append(dict(entry.summary))
    return out


def delete_session(project_root: Path, session_id: str) -> bool:
    root, p = _session_path_with_root(project_root, session_id)
    if p.is_file():
        p.unlink()
        _invalidate_session_list_cache(root, p.name)
        return True
    return False
