"""Deduplicating class assignments must not revoke unrelated publications."""

import sqlite3

from solaire.web.platform_db import _dedupe_active_publication_classes


def test_deduplication_only_revokes_publications_that_lost_all_duplicate_links():
    with sqlite3.connect(":memory:") as con:
        con.row_factory = sqlite3.Row
        con.executescript("""
            CREATE TABLE exam_publications (
                id TEXT PRIMARY KEY, paper_id TEXT, status TEXT, recipient_scope TEXT,
                created_at TEXT, updated_at TEXT
            );
            CREATE TABLE publication_classes (publication_id TEXT, class_id TEXT);
        """)
        for identifier, paper, scope, date in [
            ("old", "paper", "class", "2026-01-01"),
            ("latest", "paper", "class", "2026-01-02"),
            ("same-paper-student", "paper", "student", "2026-01-03"),
            ("other-student", "other", "student", "2026-01-03"),
            ("unassigned", "other", "class", "2026-01-03"),
        ]:
            con.execute(
                "INSERT INTO exam_publications VALUES (?, ?, 'active', ?, ?, NULL)",
                (identifier, paper, scope, date),
            )
        con.executemany(
            "INSERT INTO publication_classes VALUES (?, ?)",
            [("old", "class"), ("latest", "class")],
        )

        _dedupe_active_publication_classes(con)

        assert dict(con.execute("SELECT id, status FROM exam_publications")) == {
            "old": "revoked",
            "latest": "active",
            "same-paper-student": "active",
            "other-student": "active",
            "unassigned": "active",
        }
        _dedupe_active_publication_classes(con)
        assert (
            dict(con.execute("SELECT id, status FROM exam_publications"))["unassigned"]
            == "active"
        )
