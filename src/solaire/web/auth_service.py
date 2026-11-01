"""Authentication and role helpers for the platform layer."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterable

from solaire.web.platform_db import connect, init_platform_db, row_to_dict

PASSWORD_ALGORITHM = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 260_000
SESSION_DAYS = 14


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    if len(password) < 6:
        raise ValueError("password must be at least 6 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"{PASSWORD_ALGORITHM}${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt_hex, digest_hex = stored_hash.split("$", 3)
        if algorithm != PASSWORD_ALGORITHM:
            return False
        iterations = int(iterations_raw)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _public_user(row: dict[str, object]) -> dict[str, object]:
    try:
        preferences = json.loads(str(row.get("preferences_json") or "{}"))
    except json.JSONDecodeError:
        preferences = {}
    return {
        "id": row["id"],
        "school_id": row.get("school_id"),
        "role": row["role"],
        "username": row["username"],
        "display_name": row["display_name"],
        "email": row.get("email"),
        "status": row["status"],
        "must_change_password": bool(int(row.get("must_change_password") or 0)),
        "teacher_guide_step": int(row.get("teacher_guide_step") or 0),
        "avatar_data_url": row.get("avatar_data_url"),
        "preferences": preferences if isinstance(preferences, dict) else {},
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_user_profile(root: Path, user_id: str) -> dict[str, object]:
    init_platform_db(root)
    with closing(connect(root)) as con, con:
        row = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        subjects = [str(item["subject"]) for item in con.execute(
            "SELECT subject FROM teacher_subjects WHERE teacher_id = ? ORDER BY subject",
            (user_id,),
        ).fetchall()]
    data = row_to_dict(row)
    if data is None:
        raise ValueError("用户不存在")
    return {**_public_user(data), "subjects": subjects}


def update_user_profile(
    root: Path,
    *,
    user: dict[str, object],
    avatar_data_url: str | None,
    avatar_data_url_provided: bool,
    preferences: dict[str, object],
    subjects: list[str] | None,
) -> dict[str, object]:
    init_platform_db(root)
    clean_avatar = None
    if avatar_data_url_provided:
        clean_avatar = str(avatar_data_url or "").strip() or None
        if clean_avatar and (not clean_avatar.startswith("data:image/") or len(clean_avatar) > 2_000_000):
            raise ValueError("头像必须是小于约 1.5MB 的图片")
    allowed_themes = {"classic", "ocean", "forest", "warm", "night"}
    clean_preferences = {
        "theme": str(preferences.get("theme") or "classic") if str(preferences.get("theme") or "classic") in allowed_themes else "classic",
        "density": "compact" if preferences.get("density") == "compact" else "comfortable",
        "font_scale": max(0.85, min(1.2, float(preferences.get("font_scale") or 1))),
    }
    user_id = str(user.get("id") or "")
    with closing(connect(root)) as con, con:
        if avatar_data_url_provided:
            con.execute(
                "UPDATE users SET avatar_data_url = ?, preferences_json = ?, updated_at = ? WHERE id = ?",
                (clean_avatar, json.dumps(clean_preferences, ensure_ascii=False), utc_now(), user_id),
            )
        else:
            con.execute(
                "UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(clean_preferences, ensure_ascii=False), utc_now(), user_id),
            )
        if user.get("role") == "teacher" and subjects is not None:
            clean_subjects = list(dict.fromkeys(str(item).strip() for item in subjects if str(item).strip()))[:20]
            if not clean_subjects:
                raise ValueError("教师至少需要设置一个学科")
            con.execute("DELETE FROM teacher_subjects WHERE teacher_id = ?", (user_id,))
            con.executemany(
                "INSERT INTO teacher_subjects (id, teacher_id, subject) VALUES (?, ?, ?)",
                [(uuid.uuid4().hex, user_id, subject) for subject in clean_subjects],
            )
    return get_user_profile(root, user_id)


def _validate_username(username: str) -> str:
    value = username.strip()
    if len(value) < 3:
        raise ValueError("username must be at least 3 characters")
    return value


def has_admin(root: Path) -> bool:
    init_platform_db(root)
    with closing(connect(root)) as con, con:
        row = con.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    return row is not None


def bootstrap_admin(root: Path, *, username: str, password: str, display_name: str) -> dict[str, object]:
    init_platform_db(root)
    now = utc_now()
    user_id = uuid.uuid4().hex
    clean_username = _validate_username(username)
    clean_display_name = display_name.strip() or clean_username
    with closing(connect(root)) as con, con:
        existing = con.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone()
        if existing is not None:
            raise ValueError("admin already exists")
        con.execute(
            """
            INSERT INTO users (
              id, school_id, role, username, password_hash, display_name, email, status, created_at, updated_at
            )
            VALUES (?, NULL, 'admin', ?, ?, ?, NULL, 'active', ?, ?)
            """,
            (user_id, clean_username, hash_password(password), clean_display_name, now, now),
        )
        row = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    user = row_to_dict(row)
    if user is None:
        raise RuntimeError("failed to create admin user")
    return _public_user(user)


def authenticate_user(root: Path, username: str, password: str) -> dict[str, object] | None:
    init_platform_db(root)
    clean_username = username.strip()
    with closing(connect(root)) as con, con:
        row = con.execute("SELECT * FROM users WHERE username = ?", (clean_username,)).fetchone()
        if row is None:
            matches = con.execute(
                "SELECT u.* FROM users u JOIN students s ON s.user_id = u.id "
                "WHERE s.student_no = ? AND u.role = 'student' LIMIT 2", (clean_username,),
            ).fetchall()
            # Never guess a school or choose an account based on its password.
            if len(matches) == 1:
                row = matches[0]
    user = row_to_dict(row)
    if user is None or user.get("status") != "active":
        return None
    if not verify_password(password, str(user["password_hash"])):
        return None
    return _public_user(user)


def update_user_credentials(
    root: Path,
    *,
    user_id: str,
    username: str | None = None,
    current_password: str,
    new_password: str | None = None,
) -> dict[str, object]:
    init_platform_db(root)
    wants_username = username is not None and username.strip() != ""
    wants_password = bool(new_password)
    if wants_username and wants_password:
        raise ValueError("change username or password, not both")
    with closing(connect(root)) as con, con:
        row = con.execute("SELECT * FROM users WHERE id = ? AND status = 'active'", (user_id,)).fetchone()
        user = row_to_dict(row)
        if user is None:
            raise ValueError("active user not found")
        if not verify_password(current_password, str(user["password_hash"])):
            raise ValueError("current password is invalid")
        updates: list[str] = []
        params: list[object] = []
        if wants_username:
            if bool(int(user.get("must_change_password") or 0)):
                raise ValueError("password change is required before username changes")
            clean_username = _validate_username(username)
            existing = con.execute(
                "SELECT 1 FROM users WHERE username = ? AND id <> ?",
                (clean_username, user_id),
            ).fetchone()
            if existing is not None:
                raise ValueError("username already exists")
            updates.append("username = ?")
            params.append(clean_username)
        if new_password:
            if verify_password(new_password, str(user['password_hash'])):
                raise ValueError('新密码不能与当前密码相同')
            updates.append("password_hash = ?")
            params.append(hash_password(new_password))
            updates.append("must_change_password = 0")
        if not updates:
            return _public_user(user)
        updates.append("updated_at = ?")
        params.append(utc_now())
        params.append(user_id)
        con.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(params))
        updated = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    data = row_to_dict(updated)
    if data is None:
        raise RuntimeError("failed to update user")
    return _public_user(data)


def create_session(root: Path, user_id: str) -> str:
    init_platform_db(root)
    token = secrets.token_urlsafe(32)
    now_dt = datetime.now(UTC)
    expires = now_dt + timedelta(days=SESSION_DAYS)
    with closing(connect(root)) as con, con:
        exists = con.execute("SELECT 1 FROM users WHERE id = ? AND status = 'active'", (user_id,)).fetchone()
        if exists is None:
            raise ValueError("active user not found")
        con.execute(
            """
            INSERT INTO platform_sessions (token_hash, user_id, created_at, expires_at, revoked_at)
            VALUES (?, ?, ?, ?, NULL)
            """,
            (_hash_token(token), user_id, now_dt.isoformat(), expires.isoformat()),
        )
    return token


def get_session_user(root: Path, token: str | None) -> dict[str, object] | None:
    if not token:
        return None
    init_platform_db(root)
    now = utc_now()
    with closing(connect(root)) as con, con:
        row = con.execute(
            """
            SELECT users.*
            FROM platform_sessions
            JOIN users ON users.id = platform_sessions.user_id
            WHERE platform_sessions.token_hash = ?
              AND platform_sessions.revoked_at IS NULL
              AND platform_sessions.expires_at > ?
              AND users.status = 'active'
            """,
            (_hash_token(token), now),
        ).fetchone()
    user = row_to_dict(row)
    if user is None:
        return None
    return _public_user(user)


def revoke_session(root: Path, token: str | None) -> None:
    if not token:
        return
    init_platform_db(root)
    with closing(connect(root)) as con, con:
        con.execute(
            "UPDATE platform_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
            (utc_now(), _hash_token(token)),
        )


def require_role(user: dict[str, object] | None, allowed_roles: Iterable[str]) -> dict[str, object]:
    if user is None:
        raise PermissionError("authentication required")
    allowed = set(allowed_roles)
    if str(user.get("role")) not in allowed:
        raise PermissionError("insufficient role")
    return user
