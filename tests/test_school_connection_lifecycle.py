from __future__ import annotations

import gc
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from solaire.web.auth_service import authenticate_user, bootstrap_admin
from solaire.web.platform_db import connect, init_platform_db, platform_db_path
from solaire.web.school.importer import import_teachers
from solaire.web.school.organization import create_school, list_schools


class _TrackingConnection(sqlite3.Connection):
    was_closed = False

    def close(self) -> None:
        self.was_closed = True
        super().close()


def _track_connections(monkeypatch: pytest.MonkeyPatch) -> list[_TrackingConnection]:
    real_connect = sqlite3.connect
    opened: list[_TrackingConnection] = []

    def tracked_connect(*args, **kwargs):
        kwargs["factory"] = _TrackingConnection
        connection = real_connect(*args, **kwargs)
        opened.append(connection)
        return connection

    monkeypatch.setattr(sqlite3, "connect", tracked_connect)
    return opened


def _close_unreleased(opened: list[_TrackingConnection]) -> None:
    for connection in opened:
        if not connection.was_closed:
            connection.close()


@pytest.mark.parametrize("operation", ["login", "school_list"])
def test_normal_auth_and_school_reads_close_owned_connections(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    root = tmp_path / operation
    init_platform_db(root)
    if operation == "login":
        bootstrap_admin(root, username="admin", password="secret123", display_name="Admin")
        expected = "admin"
    else:
        create_school(root, name="Lifecycle School")
        expected = "Lifecycle School"
    # Discard any connections from setup so the tracker covers only the request.
    gc.collect()

    opened = _track_connections(monkeypatch)
    try:
        if operation == "login":
            result = authenticate_user(root, "admin", "secret123")
            assert result is not None
            assert result["username"] == expected
        else:
            result = list_schools(root)
            assert [row["name"] for row in result] == [expected]

        assert opened, "the operation should open a platform database connection"
        assert all(connection.was_closed for connection in opened)
    finally:
        _close_unreleased(opened)


def test_failed_owned_teacher_import_rolls_back_and_closes_connection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "owned-import"
    init_platform_db(root)
    school = create_school(root, name="Import Lifecycle School")
    gc.collect()
    real_connect = sqlite3.connect

    opened = _track_connections(monkeypatch)
    try:
        with pytest.raises(ValueError, match="username must be at least 3 characters"):
            import_teachers(
                root,
                school_id=school["id"],
                teachers=[
                    {"username": "teacher_valid", "display_name": "Valid Teacher"},
                    {"username": "x", "display_name": "Invalid Teacher"},
                ],
            )

        # Read after the importer exits, using a separately and explicitly closed connection.
        with closing(real_connect(platform_db_path(root))) as check:
            assert check.execute(
                "SELECT COUNT(*) FROM users WHERE school_id = ? AND role = 'teacher'",
                (school["id"],),
            ).fetchone()[0] == 0

        assert opened, "the import should open a platform database connection"
        assert all(connection.was_closed for connection in opened)
    finally:
        _close_unreleased(opened)


def test_borrowed_import_connection_stays_open_and_caller_controls_rollback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "borrowed-import"
    init_platform_db(root)
    school = create_school(root, name="Borrowed Lifecycle School")
    gc.collect()
    opened = _track_connections(monkeypatch)

    connection = connect(root)
    try:
        with pytest.raises(ValueError, match="username must be at least 3 characters"):
            import_teachers(
                root,
                school_id=school["id"],
                teachers=[
                    {"username": "teacher_valid", "display_name": "Valid Teacher"},
                    {"username": "x", "display_name": "Invalid Teacher"},
                ],
                _connection=connection,
            )

        # The import helper borrows the connection: its first insert is still visible
        # in the caller's transaction, and the connection remains usable.
        assert connection.execute(
            "SELECT COUNT(*) FROM users WHERE school_id = ? AND role = 'teacher'",
            (school["id"],),
        ).fetchone()[0] == 1
        assert not connection.was_closed
        connection.rollback()
        assert connection.execute(
            "SELECT COUNT(*) FROM users WHERE school_id = ? AND role = 'teacher'",
            (school["id"],),
        ).fetchone()[0] == 0
        assert not connection.was_closed
        assert opened == [connection]
    finally:
        if not connection.was_closed:
            connection.close()
