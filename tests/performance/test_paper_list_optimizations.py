from __future__ import annotations

from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import threading
import time

import yaml

from solaire.web import paper_service
from solaire.web import platform_db
from solaire.web.papers import repository
from solaire.web.results import summary as result_summary
from solaire.web.results.summary import list_exam_results


def _seed_teacher_paper(root: Path) -> None:
    platform_db.init_platform_db(root)
    with closing(platform_db.connect(root)) as con, con:
        con.execute(
            """
            INSERT INTO users (id, role, username, password_hash, display_name, created_at, updated_at)
            VALUES ('teacher', 'teacher', 'teacher', 'hash', 'Teacher', 'now', 'now')
            """
        )
        con.execute(
            """
            INSERT INTO content_folders
              (id, owner_teacher_id, scope, parent_id, kind, name, created_at, updated_at)
            VALUES ('paper-default-teacher', 'teacher', 'paper', NULL, 'category', 'Default', 'now', 'now')
            """
        )
        con.execute(
            """
            INSERT INTO paper_records
              (id, exam_id, title, subject, owner_teacher_id, status, created_at, updated_at, folder_id)
            VALUES ('paper-1', 'exam-1/Math', 'Exam 1', 'Math', 'teacher', 'draft',
                    '2026-01-01', '2026-01-01', 'paper-default-teacher')
            """
        )


def test_stable_reconcile_does_not_update_paper_record(tmp_path, monkeypatch):
    _seed_teacher_paper(tmp_path)
    statements: list[str] = []
    original_connect = repository.connect

    def traced_connect(root):
        con = original_connect(root)
        con.set_trace_callback(statements.append)
        return con

    monkeypatch.setattr(repository, "connect", traced_connect)
    resolved = repository.reconcile_exam_papers(
        tmp_path,
        [{
            "exam_id": "exam-1/Math",
            "exam_title": "Exam 1",
            "subject": "Math",
            "owner_teacher_id": "teacher",
        }],
        {"id": "teacher", "role": "teacher"},
    )

    assert [record["id"] for record, _ in resolved] == ["paper-1"]
    assert not any("UPDATE paper_records" in statement for statement in statements)


def test_teacher_without_school_does_not_inherit_calling_school(tmp_path):
    _seed_teacher_paper(tmp_path)
    resolved = repository.reconcile_exam_papers(
        tmp_path,
        [{
            "exam_id": "exam-2/Math",
            "exam_title": "Exam 2",
            "subject": "Math",
            "owner_teacher_id": "teacher",
        }],
        {"id": "admin", "role": "admin", "school_id": "caller-school"},
    )

    assert resolved[0][0]["school_id"] is None


def test_catalog_cache_invalidates_yaml_and_live_score_batch_changes(tmp_path):
    exam_dir = tmp_path / "exams" / "exam-1" / "Math"
    exam_dir.mkdir(parents=True)
    exam_path = exam_dir / "exam.yaml"
    payload = {
        "exam_id": "exam-1/Math",
        "template_ref": "builtin/math",
        "metadata": {"title": "Before", "subject": "Math"},
        "selected_items": [{"section_id": "s1", "question_ids": ["q1"], "score_per_item": 1}],
    }
    exam_path.write_text(yaml.safe_dump(payload, allow_unicode=True), encoding="utf-8")
    first = list_exam_results(tmp_path)
    assert first[0]["exam_title"] == "Before"
    assert first[0]["question_count"] == 1

    payload["metadata"]["title"] = "After"
    payload["selected_items"][0]["question_ids"].append("q2")
    exam_path.write_text(yaml.safe_dump(payload, allow_unicode=True), encoding="utf-8")
    second = list_exam_results(tmp_path)
    assert second[0]["exam_title"] == "After"
    assert second[0]["question_count"] == 2

    first_batch = exam_dir / "scores" / "batch-1"
    first_batch.mkdir(parents=True)
    (first_batch / "analysis.json").write_text(json.dumps({"student_count": 1}), encoding="utf-8")
    live_one = list_exam_results(tmp_path)
    assert live_one[0]["score_batch_count"] == 1
    assert live_one[0]["latest_batch_id"] == "batch-1"

    second_batch = exam_dir / "scores" / "batch-2"
    second_batch.mkdir(parents=True)
    (second_batch / "analysis.json").write_text(json.dumps({"student_count": 2}), encoding="utf-8")
    future = time.time() + 2
    import os
    os.utime(second_batch, (future, future))
    live_two = list_exam_results(tmp_path)
    assert live_two[0]["score_batch_count"] == 2
    assert live_two[0]["latest_batch_id"] == "batch-2"

    new_exam_dir = tmp_path / "exams" / "exam-2" / "Math"
    new_exam_dir.mkdir(parents=True)
    (new_exam_dir / "exam.yaml").write_text(yaml.safe_dump({
        "exam_id": "exam-2/Math",
        "template_ref": "builtin/math",
        "metadata": {"title": "New", "subject": "Math"},
        "selected_items": [],
    }, allow_unicode=True), encoding="utf-8")
    assert len(list_exam_results(tmp_path)) == 2
    shutil.rmtree(new_exam_dir.parent)
    assert len(list_exam_results(tmp_path)) == 1


def test_catalog_cold_parses_for_different_paths_do_not_share_global_lock(tmp_path, monkeypatch):
    paths = []
    for index in range(2):
        exam_dir = tmp_path / "exams" / f"exam-{index}" / "Math"
        exam_dir.mkdir(parents=True)
        exam_path = exam_dir / "exam.yaml"
        exam_path.write_text(yaml.safe_dump({
            "exam_id": f"exam-{index}/Math",
            "template_ref": "builtin/math",
            "metadata": {"title": f"Exam {index}", "subject": "Math"},
            "selected_items": [{"section_id": "s1", "question_ids": ["q1"], "score_per_item": 1}],
        }, allow_unicode=True), encoding="utf-8")
        paths.append(exam_path)

    entered = threading.Barrier(2)
    original_safe_load = result_summary.yaml.safe_load

    def synchronized_safe_load(text):
        entered.wait(timeout=2)
        return original_safe_load(text)

    monkeypatch.setattr(result_summary.yaml, "safe_load", synchronized_safe_load)
    with ThreadPoolExecutor(max_workers=2) as pool:
        catalogs = list(pool.map(result_summary._load_exam_catalog, paths))
    assert [catalog.question_count for catalog in catalogs] == [1, 1]


def test_first_concurrent_list_creates_one_record_without_errors(tmp_path):
    _seed_teacher_paper(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con, con:
        con.execute("DELETE FROM paper_records WHERE id='paper-1'")

    # The exam is supplied directly to avoid coupling this race regression to
    # the filesystem catalog benchmark.
    candidate = {
        "exam_id": "exam-1/Math",
        "exam_title": "Exam 1",
        "subject": "Math",
        "owner_teacher_id": "teacher",
    }

    def one_call(_):
        return repository.reconcile_exam_papers(
            tmp_path,
            [candidate],
            {"id": "teacher", "role": "teacher"},
        )[0][0]["id"]

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(one_call, range(10)))
    assert len(set(results)) == 1
    with closing(platform_db.connect(tmp_path)) as con:
        assert con.execute("SELECT COUNT(*) FROM paper_records WHERE exam_id='exam-1/Math'").fetchone()[0] == 1


def test_first_concurrent_query_creates_one_record_without_errors(tmp_path):
    _seed_teacher_paper(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con, con:
        con.execute("DELETE FROM paper_records WHERE id='paper-1'")
    exam_dir = tmp_path / "exams" / "exam-1" / "Math"
    exam_dir.mkdir(parents=True)
    (exam_dir / "exam.yaml").write_text(
        yaml.safe_dump({
            "exam_id": "exam-1/Math",
            "template_ref": "builtin/math",
            "metadata": {"title": "Exam 1", "subject": "Math", "owner_teacher_id": "teacher"},
            "selected_items": [{"section_id": "s1", "question_ids": ["q1"], "score_per_item": 1}],
        }, allow_unicode=True),
        encoding="utf-8",
    )

    def one_call(_):
        return paper_service.query_papers(
            tmp_path,
            tmp_path,
            {"id": "teacher", "role": "teacher"},
            page=1,
            page_size=10,
        )["papers"][0]["paper_id"]

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(one_call, range(10)))
    assert len(set(results)) == 1
    with closing(platform_db.connect(tmp_path)) as con:
        assert con.execute("SELECT COUNT(*) FROM paper_records WHERE exam_id='exam-1/Math'").fetchone()[0] == 1


def test_query_papers_only_aggregates_the_selected_page(tmp_path, monkeypatch):
    records = [
        {
            "id": f"paper-{index}",
            "exam_id": f"exam-{index}/Math",
            "title": f"Exam {index}",
            "subject": "Math",
            "delivery_mode": "offline",
            "status": "draft",
            "owner_teacher_id": "teacher",
            "school_id": None,
            "folder_id": None,
            "updated_at": f"2026-01-0{index + 1}",
        }
        for index in range(3)
    ]
    exams = [
        {
            "exam_id": record["exam_id"],
            "question_count": 1,
            "section_count": 1,
            "score_batch_count": 0,
            "has_score": False,
            "has_pdf": False,
            "has_docx": False,
            "latest_batch_id": None,
            "exam_dir": record["exam_id"],
            "mtime": record["updated_at"],
        }
        for record in records
    ]
    monkeypatch.setattr(
        paper_service,
        "_paper_candidates",
        lambda _project_root, _platform_root, _user: (list(zip(records, exams)), []),
    )
    calls: list[list[str]] = []

    def fake_stats(_root, paper_ids, _user, _access_clause):
        calls.append(list(paper_ids))
        default = {
            "has_publication_history": False,
            "publication_count": 0,
            "published_class_count": 0,
            "total_student_count": 0,
            "submitted_student_count": 0,
            "in_progress_student_count": 0,
            "graded_student_count": 0,
            "published_student_count": 0,
        }
        return {paper_id: dict(default) for paper_id in paper_ids}

    monkeypatch.setattr(paper_service, "batch_publication_stats", fake_stats)
    result = paper_service.query_papers(
        tmp_path,
        tmp_path,
        {"id": "teacher", "role": "teacher"},
        page=2,
        page_size=1,
    )

    assert result["total"] == 3
    assert [paper["paper_id"] for paper in result["papers"]] == ["paper-1"]
    assert calls == [["paper-1"]]


def test_platform_schema_contains_publication_read_indexes(tmp_path):
    platform_db.init_platform_db(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con:
        names = {
            row["name"]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='index'")
        }
    assert {
        "idx_exam_publications_paper_status",
        "idx_exam_publications_teacher_paper_status",
        "idx_student_attempts_publication_state",
    } <= names


def test_schema_16_database_migrates_read_indexes(tmp_path):
    platform_db.init_platform_db(tmp_path)
    with closing(platform_db.connect(tmp_path)) as con, con:
        con.execute("DROP INDEX idx_exam_publications_paper_status")
        con.execute("DROP INDEX idx_exam_publications_teacher_paper_status")
        con.execute("DROP INDEX idx_student_attempts_publication_state")
        con.execute("PRAGMA user_version = 16")

    platform_db.init_platform_db(tmp_path)

    with closing(platform_db.connect(tmp_path)) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == platform_db.SCHEMA_VERSION
        names = {
            row["name"]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='index'")
        }
    assert {
        "idx_exam_publications_paper_status",
        "idx_exam_publications_teacher_paper_status",
        "idx_student_attempts_publication_state",
    } <= names
