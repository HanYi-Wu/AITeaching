from contextlib import closing
from pathlib import Path
import sqlite3

import pytest

from solaire.web import legacy_exam_repair, platform_db
from solaire.web.papers import analysis, repository


def _capture_connections(monkeypatch, module):
    connections = []
    original = module.connect

    def capture(root):
        connection = original(root)
        connections.append(connection)
        return connection

    monkeypatch.setattr(module, "connect", capture)
    return connections


def _assert_closed(connections):
    assert connections
    for connection in connections:
        try:
            with pytest.raises(sqlite3.ProgrammingError, match="closed"):
                connection.execute("SELECT 1")
        finally:
            connection.close()


def _class_report(root, *, clause="1=1", **options):
    return analysis.build_class_report(
        root, paper_id="missing-paper", user={"role": "admin"}, publication_id=None, class_id=None,
        attempt_clause_fn=lambda *args, **kwargs: (clause, []),
        attempt_status_group_fn=lambda row: "not_started",
        score_percent_fn=lambda score, maximum: None,
        **options,
    )


def test_paper_record_is_committed_and_connection_is_released(tmp_path, monkeypatch):
    platform_db.init_platform_db(tmp_path)
    connections = _capture_connections(monkeypatch, repository)
    paper = repository.get_or_create_exam_paper(
        tmp_path, {"exam_id": "algebra", "exam_title": "Algebra"}, {"role": "admin"},
    )
    assert paper["title"] == "Algebra"
    _assert_closed(connections)
    with closing(platform_db.connect(tmp_path)) as connection:
        assert connection.execute("SELECT title FROM paper_records").fetchone()[0] == "Algebra"
    platform_db.platform_db_path(tmp_path).unlink()


def test_class_report_closes_its_owned_connection(tmp_path, monkeypatch):
    platform_db.init_platform_db(tmp_path)
    connections = _capture_connections(monkeypatch, analysis)
    assert _class_report(tmp_path) == []
    _assert_closed(connections)


def test_class_report_keeps_borrowed_transaction_open(tmp_path, monkeypatch):
    platform_db.init_platform_db(tmp_path)
    connections = _capture_connections(monkeypatch, analysis)
    with closing(platform_db.connect(tmp_path)) as connection:
        connection.execute("INSERT INTO schools (id, name, created_at, updated_at) VALUES ('pending', 'Pending', 'now', 'now')")
        assert _class_report(tmp_path, connection=connection) == []
        assert connection.in_transaction
        assert connection.execute("SELECT name FROM schools WHERE id='pending'").fetchone()[0] == "Pending"
        connection.rollback()
        assert connection.execute("SELECT COUNT(*) FROM schools").fetchone()[0] == 0
    assert not connections


def test_class_report_releases_connection_when_query_fails(tmp_path, monkeypatch):
    platform_db.init_platform_db(tmp_path)
    connections = _capture_connections(monkeypatch, analysis)
    with pytest.raises(sqlite3.OperationalError):
        _class_report(tmp_path, clause="invalid(")
    _assert_closed(connections)


def test_legacy_repair_releases_backup_database(tmp_path, monkeypatch):
    platform_db.init_platform_db(tmp_path)
    connections = _capture_connections(monkeypatch, sqlite3)
    report = legacy_exam_repair.repair(tmp_path, tmp_path, apply=True)
    assert report["unresolved"] == []
    _assert_closed(connections)
    Path(report["backup"]).unlink()
