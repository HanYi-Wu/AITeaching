"""A teacher's analysis history must not include another teacher's papers."""

from __future__ import annotations

import importlib
import sqlite3

from solaire.common.actor_context import actor


def test_teacher_analysis_list_is_owner_scoped(monkeypatch, tmp_path):
    app_module = importlib.import_module("solaire.web.routers.exams")
    platform_db = importlib.import_module("solaire.web.platform_db")
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE paper_records (exam_id TEXT, owner_teacher_id TEXT)")
    db.executemany(
        "INSERT INTO paper_records VALUES (?, ?)",
        [("mine/math", "teacher-a"), ("other/math", "teacher-b")],
    )
    monkeypatch.setattr(app_module, "_require_root", lambda: tmp_path)
    monkeypatch.setattr(app_module, "list_exam_results", lambda root: [
        {"exam_id": "mine/math", "owner_teacher_id": None},
        {"exam_id": "other/math", "owner_teacher_id": None},
        {"exam_id": "unowned/math", "owner_teacher_id": None},
    ])
    monkeypatch.setattr(platform_db, "connect", lambda root: db)
    monkeypatch.setattr(platform_db, "default_platform_root", lambda: tmp_path)
    token = actor.set({"role": "teacher", "id": "teacher-a"})
    try:
        assert [row["exam_id"] for row in app_module.exams_analysis_list()["exams"]] == ["mine/math"]
    finally:
        actor.reset(token)
        db.close()
