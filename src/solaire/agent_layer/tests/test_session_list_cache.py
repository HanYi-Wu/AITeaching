from __future__ import annotations

import os
from pathlib import Path

from solaire.agent_layer import session as session_store
from solaire.agent_layer.models import ChatMessage, SessionState
from solaire.common.atomic_files import write_text_atomic


def _session(session_id: str, owner: str | None, title: str) -> SessionState:
    return SessionState(
        session_id=session_id,
        owner_user_id=owner,
        messages=[ChatMessage(role="user", content=title)],
    )


def test_list_sessions_reuses_validated_summaries_and_returns_detached_values(
    monkeypatch, tmp_path: Path,
) -> None:
    for sid, owner, title in (
        ("alpha", "teacher-a", "Alpha title"),
        ("beta", "teacher-b", "Beta title"),
        ("gamma", "teacher-a", "Gamma title"),
    ):
        session_store.save_session(tmp_path, _session(sid, owner, title))

    original_read = session_store._read_session
    reads: list[str] = []

    def counted_read(path: Path) -> SessionState:
        reads.append(path.name)
        return original_read(path)

    monkeypatch.setattr(session_store, "_read_session", counted_read)
    first = session_store.list_sessions(tmp_path)
    assert len(reads) == 3

    first[0]["title"] = "caller mutation"
    second = session_store.list_sessions(tmp_path)
    assert len(reads) == 3
    assert second[0]["title"] != "caller mutation"
    assert len(session_store.list_sessions(tmp_path, owner_user_id="teacher-a")) == 2
    assert len(reads) == 3


def test_list_sessions_invalidates_after_atomic_save_and_external_replace(
    tmp_path: Path,
) -> None:
    original = _session("save-me", "teacher-a", "Original")
    session_store.save_session(tmp_path, original)
    assert session_store.list_sessions(tmp_path)[0]["title"] == "Original"

    original.messages[0].content = "Updated by save"
    session_store.save_session(tmp_path, original)
    assert session_store.list_sessions(tmp_path)[0]["title"] == "Updated by save"

    external = _session("save-me", "teacher-b", "External replacement")
    path = session_store.session_path(tmp_path, external.session_id)
    write_text_atomic(path, external.model_dump_json())
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert session_store.list_sessions(tmp_path)[0]["title"] == "External replacement"
    assert session_store.list_sessions(tmp_path, owner_user_id="teacher-a") == []


def test_list_sessions_caches_corrupt_files_until_their_signature_changes(
    monkeypatch, tmp_path: Path,
) -> None:
    broken = session_store.session_path(tmp_path, "broken")
    write_text_atomic(broken, "{")
    original_read = session_store._read_session
    reads = 0

    def counted_read(path: Path) -> SessionState:
        nonlocal reads
        reads += 1
        return original_read(path)

    monkeypatch.setattr(session_store, "_read_session", counted_read)
    assert session_store.list_sessions(tmp_path) == []
    assert session_store.list_sessions(tmp_path) == []
    assert reads == 1

    valid = _session("broken", "teacher-a", "Repaired")
    write_text_atomic(broken, valid.model_dump_json())
    stat = broken.stat()
    os.utime(broken, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert session_store.list_sessions(tmp_path)[0]["title"] == "Repaired"
    assert reads == 2


def test_list_sessions_keeps_file_limit_before_owner_filtering(tmp_path: Path) -> None:
    old = _session("old", "teacher-a", "Old owned session")
    new = _session("new", "teacher-b", "Newest other session")
    session_store.save_session(tmp_path, old)
    session_store.save_session(tmp_path, new)
    old_path = session_store.session_path(tmp_path, old.session_id)
    new_path = session_store.session_path(tmp_path, new.session_id)
    os.utime(old_path, ns=(1_000_000_000, 1_000_000_000))
    os.utime(new_path, ns=(2_000_000_000, 2_000_000_000))

    assert session_store.list_sessions(tmp_path, limit=1, owner_user_id="teacher-a") == []
    assert session_store.list_sessions(tmp_path, limit=2, owner_user_id="teacher-a")[0]["session_id"] == "old"


def test_delete_session_invalidates_cached_summary(tmp_path: Path) -> None:
    session_store.save_session(tmp_path, _session("remove-me", "teacher-a", "To remove"))
    assert len(session_store.list_sessions(tmp_path)) == 1
    assert session_store.delete_session(tmp_path, "remove-me") is True
    assert session_store.list_sessions(tmp_path) == []
