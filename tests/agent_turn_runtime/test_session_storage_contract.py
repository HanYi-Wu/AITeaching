from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from solaire.agent_layer.models import ChatMessage, SessionState
from solaire.agent_layer.session import list_sessions, load_session, save_session, session_path


def test_session_round_trip_keeps_confirmations_and_unicode(tmp_path):
    session = SessionState(session_id="valid-session", owner_user_id="teacher-a")
    session.messages = [ChatMessage(role="user", content="题目\n中文与 😀"),
                        ChatMessage(role="assistant", tool_calls=[{"id": "t", "function": {"name": "read"}}])]
    session.draft_tool_results = [{"tool_call_id": "t", "content": "未确认结果"}]
    save_session(tmp_path, session)
    assert load_session(tmp_path, session.session_id) == session
    assert list_sessions(tmp_path, owner_user_id="teacher-a") == [{
        "session_id": session.session_id, "updated_at": session.updated_at,
        "message_count": 2, "title": "题目 中文与 😀",
    }]
    assert list_sessions(tmp_path, owner_user_id="teacher-b") == []


def test_small_legacy_session_with_escaped_surrogate_uses_compatible_decoder(tmp_path):
    path = session_path(tmp_path, "legacy-session")
    path.write_text(
        json.dumps({"session_id": "legacy-session", "messages": [{"role": "user", "content": "\ud800"}]}),
        encoding="utf-8",
    )
    session = load_session(tmp_path, "legacy-session")
    assert session is not None
    assert session.messages[0].content == "\ud800"


@pytest.mark.parametrize("invalid", [
    {"session_id": "broken", "messages": [{"role": "unknown", "content": "text"}]},
    {"session_id": "broken", "messages": [{"role": "user", "content": {"private": "data"}}]},
    {"session_id": "broken", "pending_confirmations": {"x": {"tool_name": "write"}}},
])
def test_invalid_session_is_not_projected_as_a_valid_history_item(tmp_path, invalid):
    session_path(tmp_path, "broken").write_text(json.dumps(invalid), encoding="utf-8")
    assert list_sessions(tmp_path) == []
    with pytest.raises(ValidationError):
        load_session(tmp_path, "broken")


@pytest.mark.parametrize("session_id", ["../outside", "a/b", "a\\b", "..", "", "x" * 65])
def test_session_ids_keep_the_path_boundary(tmp_path, session_id):
    with pytest.raises(ValueError, match="Invalid agent session id"):
        session_path(tmp_path, session_id)
