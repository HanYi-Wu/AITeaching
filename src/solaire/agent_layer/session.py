"""Session persistence under .solaire/agent/sessions/."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from solaire.agent_layer.models import SessionState


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
    root = sessions_dir(project_root).resolve()
    path = (root / f"{_validated_session_id(session_id)}.json").resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Agent session path must stay inside sessions directory") from exc
    return path


def load_session(project_root: Path, session_id: str) -> SessionState | None:
    p = session_path(project_root, session_id)
    if not p.is_file():
        return None
    raw = json.loads(p.read_text(encoding="utf-8"))
    return SessionState.model_validate(raw)


def save_session(project_root: Path, session: SessionState) -> None:
    p = session_path(project_root, session.session_id)
    p.write_text(session.model_dump_json(indent=2), encoding="utf-8")


def create_session(project_root: Path, *, owner_user_id: str | None = None) -> SessionState:
    sid = new_session_id()
    s = SessionState(session_id=sid, owner_user_id=owner_user_id)
    save_session(project_root, s)
    return s


def list_sessions(project_root: Path, *, limit: int = 50, owner_user_id: str | None = None) -> list[dict]:
    out: list[dict] = []
    d = sessions_dir(project_root)
    for p in sorted(d.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)[:limit]:
        try:
            s = SessionState.model_validate(json.loads(p.read_text(encoding="utf-8")))
            if owner_user_id is not None and s.owner_user_id != owner_user_id:
                continue
            title = ""
            for m in s.messages:
                if m.role == "user" and (m.content or "").strip():
                    title = (m.content or "").strip().replace("\n", " ")[:50]
                    break
            out.append(
                {
                    "session_id": s.session_id,
                    "updated_at": s.updated_at,
                    "message_count": len(s.messages),
                    "title": title or "新对话",
                }
            )
        except Exception:
            continue
    return out


def delete_session(project_root: Path, session_id: str) -> bool:
    p = session_path(project_root, session_id)
    if p.is_file():
        p.unlink()
        return True
    return False
