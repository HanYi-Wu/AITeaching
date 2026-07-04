"""Tests for platform database and authentication services."""

from __future__ import annotations

from pathlib import Path

from solaire.web.auth_service import (
    authenticate_user,
    bootstrap_admin,
    create_session,
    get_session_user,
    has_admin,
    require_role,
)
from solaire.web.platform_db import connect, init_platform_db


def test_bootstrap_admin_creates_first_admin_and_blocks_second(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    assert has_admin(tmp_path) is False

    admin = bootstrap_admin(tmp_path, username="admin", password="secret123", display_name="Admin")

    assert admin["role"] == "admin"
    assert admin["username"] == "admin"
    assert has_admin(tmp_path) is True
    try:
        bootstrap_admin(tmp_path, username="root", password="secret123", display_name="Root")
    except ValueError as exc:
        assert "admin already exists" in str(exc)
    else:
        raise AssertionError("second admin bootstrap should fail")


def test_authenticate_and_session_roundtrip(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    admin = bootstrap_admin(tmp_path, username="admin", password="secret123", display_name="Admin")

    assert authenticate_user(tmp_path, "admin", "wrong") is None
    authed = authenticate_user(tmp_path, "admin", "secret123")
    assert authed is not None
    assert authed["id"] == admin["id"]

    token = create_session(tmp_path, authed["id"])
    session_user = get_session_user(tmp_path, token)
    assert session_user is not None
    assert session_user["role"] == "admin"
    assert require_role(session_user, {"admin"}) == session_user


def test_schema_is_idempotent(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    init_platform_db(tmp_path)
    with connect(tmp_path) as con:
        tables = {row["name"] for row in con.execute("select name from sqlite_master where type='table'")}
    assert {"schools", "users", "platform_sessions", "classes", "students"}.issubset(tables)
