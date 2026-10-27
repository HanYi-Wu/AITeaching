"""Tests for submission batch reads: teacher submissions scan metadata,
student results answers batch reading, and teacher student profile snapshot deduplication.
"""

from __future__ import annotations

import base64
from collections.abc import Sequence
import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import yaml

from solaire.web import paper_service, student_service
from solaire.web.paper_service import (
    _answer_public_payload,
    _attempt_scan_payloads,
    _attempt_scan_payloads_for_attempts,
    _attempt_status_group,
    _question_maps_for_attempt,
    get_paper,
)
from solaire.web.papers import teacher_queries
from solaire.web.papers.teacher_queries import (
    list_paper_submissions_query,
    teacher_student_profile_query,
)
from solaire.web.platform_db import connect, default_platform_root
from solaire.web.student_service import (
    _load_student_answers_for_attempts,
    list_student_results,
)
from tests.test_platform_paper_api import (
    _bootstrap_admin,
    _create_school_teacher_class,
    _headers,
    _teacher_token,
    _write_exam,
)


def _setup_multi_student_fixture(web_client: TestClient, tmp_path: Path, student_count: int = 4):
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(
        web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    )
    imported = web_client.post(
        "/api/school/students/import",
        headers=school,
        json={
            "class_id": class_id,
            "students": [
                {"student_no": f"S{index:03d}", "display_name": f"Student {index}"}
                for index in range(1, student_count + 1)
            ],
        },
    )
    assert imported.status_code == 200
    students = imported.json()["students"]
    _write_exam(tmp_path)
    teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        headers=teacher,
        json={"class_ids": [class_id], "show_results_immediately": True},
    ).json()["publication"]

    return {
        "admin": admin,
        "teacher_id": teacher_id,
        "class_id": class_id,
        "teacher_headers": teacher,
        "students": students,
        "paper": paper,
        "publication": publication,
    }


# ==============================================================================
# Teacher submissions scan metadata batch reading
# ==============================================================================

def test_teacher_scan_submission_list_fallback_vs_batch_scan_images(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    fixture = _setup_multi_student_fixture(web_client, tmp_path, student_count=4)
    root = default_platform_root()

    with connect(root) as con:
        attempt_rows = con.execute(
            "SELECT id, student_id FROM student_attempts WHERE publication_id = ? ORDER BY id",
            (fixture["publication"]["id"],),
        ).fetchall()
    attempt_ids = [str(r["id"]) for r in attempt_rows]
    assert len(attempt_ids) == 4

    # Insert scan images for the first two attempts (multi-page scan)
    fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    with connect(root) as con:
        con.execute(
            """
            INSERT INTO attempt_scan_images (attempt_id, page_index, file_name, mime_type, file_size, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?, '2026-10-27T10:00:00Z')
            """,
            (attempt_ids[0], 0, "page0.png", "image/png", len(fake_png), fake_png),
        )
        con.execute(
            """
            INSERT INTO attempt_scan_images (attempt_id, page_index, file_name, mime_type, file_size, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?, '2026-10-27T10:00:00Z')
            """,
            (attempt_ids[0], 1, "page1.png", "image/png", len(fake_png), fake_png),
        )
        con.execute(
            """
            INSERT INTO attempt_scan_images (attempt_id, page_index, file_name, mime_type, file_size, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?, '2026-10-27T10:00:00Z')
            """,
            (attempt_ids[1], 0, "only_page.png", "image/png", len(fake_png), fake_png),
        )

    user = {"id": fixture["teacher_id"], "role": "teacher"}
    paper_record = get_paper(root, fixture["paper"]["paper_id"])

    # 1. Fallback mode: attempt_scan_payloads_for_attempts is None
    fallback_submissions = list_paper_submissions_query(
        root,
        tmp_path,
        paper_id=fixture["paper"]["paper_id"],
        paper=paper_record,
        user=user,
        question_maps_for_attempt=_question_maps_for_attempt,
        answer_public_payload=_answer_public_payload,
        attempt_scan_payloads=_attempt_scan_payloads,
        attempt_status_group=_attempt_status_group,
        attempt_scan_payloads_for_attempts=None,
    )

    # Batch metadata reader
    batch_submissions = list_paper_submissions_query(
        root,
        tmp_path,
        paper_id=fixture["paper"]["paper_id"],
        paper=paper_record,
        user=user,
        question_maps_for_attempt=_question_maps_for_attempt,
        answer_public_payload=_answer_public_payload,
        attempt_scan_payloads=_attempt_scan_payloads,
        attempt_status_group=_attempt_status_group,
        attempt_scan_payloads_for_attempts=_attempt_scan_payloads_for_attempts,
    )

    # Exact equality of returned structures
    assert len(fallback_submissions) == len(batch_submissions) == 4
    for fb, bt in zip(fallback_submissions, batch_submissions, strict=True):
        assert fb["attempt_id"] == bt["attempt_id"]
        assert fb["submission_mode"] == bt["submission_mode"]
        assert fb["scan_images"] == bt["scan_images"]
        assert fb["answers"] == bt["answers"]

    # Verify attempt 0 has 2 pages in page_index order, submission_mode='offline_scan'
    sub0 = next(s for s in batch_submissions if s["attempt_id"] == attempt_ids[0])
    assert sub0["submission_mode"] == "offline_scan"
    assert len(sub0["scan_images"]) == 2
    assert sub0["scan_images"][0]["page_index"] == 0
    assert sub0["scan_images"][0]["name"] == "page0.png"
    assert sub0["scan_images"][1]["page_index"] == 1
    assert sub0["scan_images"][1]["name"] == "page1.png"

    # Verify attempt 1 has 1 page
    sub1 = next(s for s in batch_submissions if s["attempt_id"] == attempt_ids[1])
    assert sub1["submission_mode"] == "offline_scan"
    assert len(sub1["scan_images"]) == 1

    # Verify attempts 2 and 3 have empty scan_images [] and 'online' submission_mode
    for aid in (attempt_ids[2], attempt_ids[3]):
        sub = next(s for s in batch_submissions if s["attempt_id"] == aid)
        assert sub["submission_mode"] == "online"
        assert sub["scan_images"] == []


def test_teacher_scan_sql_trace_proves_batch_hook_reduces_metadata_queries(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    fixture = _setup_multi_student_fixture(web_client, tmp_path, student_count=4)
    root = default_platform_root()
    user = {"id": fixture["teacher_id"], "role": "teacher"}
    paper_record = get_paper(root, fixture["paper"]["paper_id"])

    # Count scan metadata SELECTs for the single-attempt and batch readers.
    scan_selects: list[str] = []

    def trace_scan_select(statement: str) -> None:
        if "FROM attempt_scan_images" in statement:
            scan_selects.append(statement)

    original_paper_connect = paper_service.connect

    def traced_paper_connect(db_root):
        conn = original_paper_connect(db_root)
        conn.set_trace_callback(trace_scan_select)
        return conn

    original_test_connect = connect

    def traced_test_connect(db_root):
        conn = original_test_connect(db_root)
        conn.set_trace_callback(trace_scan_select)
        return conn

    monkeypatch.setattr(paper_service, "connect", traced_paper_connect)
    monkeypatch.setitem(globals(), "connect", traced_test_connect)

    fallback_scan_queries: list[str] = []
    def fallback_scan_collector(r, aid, *, include_content=False):
        fallback_scan_queries.append(aid)
        return _attempt_scan_payloads(r, aid, include_content=include_content)

    list_paper_submissions_query(
        root,
        tmp_path,
        paper_id=fixture["paper"]["paper_id"],
        paper=paper_record,
        user=user,
        question_maps_for_attempt=_question_maps_for_attempt,
        answer_public_payload=_answer_public_payload,
        attempt_scan_payloads=fallback_scan_collector,
        attempt_status_group=_attempt_status_group,
        attempt_scan_payloads_for_attempts=None,
    )
    # Legacy producer fallback performs one scan SELECT for each attempt.
    assert len(fallback_scan_queries) == 4
    assert len(scan_selects) == 4

    batch_scan_queries: list[str] = []
    def batch_scan_collector(r, aids, *, include_content=False):
        batch_scan_queries.append(list(aids))
        return _attempt_scan_payloads_for_attempts(r, aids, include_content=include_content)

    list_paper_submissions_query(
        root,
        tmp_path,
        paper_id=fixture["paper"]["paper_id"],
        paper=paper_record,
        user=user,
        question_maps_for_attempt=_question_maps_for_attempt,
        answer_public_payload=_answer_public_payload,
        attempt_scan_payloads=fallback_scan_collector,
        attempt_status_group=_attempt_status_group,
        attempt_scan_payloads_for_attempts=batch_scan_collector,
    )
    # The test-only batch producer performs one SELECT for all four attempts.
    assert len(batch_scan_queries) == 1
    assert len(batch_scan_queries[0]) == 4
    assert len(scan_selects) == 5

    failing_calls: list[str] = []

    def failing_batch_collector(r, aids, *, include_content=False):
        failing_calls.append("called")
        raise TypeError("batch reader failed")

    try:
        list_paper_submissions_query(
            root,
            tmp_path,
            paper_id=fixture["paper"]["paper_id"],
            paper=paper_record,
            user=user,
            question_maps_for_attempt=_question_maps_for_attempt,
            answer_public_payload=_answer_public_payload,
            attempt_scan_payloads=fallback_scan_collector,
            attempt_status_group=_attempt_status_group,
            attempt_scan_payloads_for_attempts=failing_batch_collector,
        )
    except TypeError as exc:
        assert str(exc) == "batch reader failed"
    else:
        raise AssertionError("the batch reader's TypeError must propagate")
    assert len(failing_calls) == 1


def test_teacher_scan_chunked_batch_reader_handles_variable_limit(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    fixture = _setup_multi_student_fixture(web_client, tmp_path, student_count=4)
    root = default_platform_root()
    with connect(root) as con:
        rows = con.execute("SELECT id FROM student_attempts WHERE publication_id = ?", (fixture["publication"]["id"],)).fetchall()
    attempt_ids = [str(r["id"]) for r in rows]

    fake_png = b"test-png"
    with connect(root) as con:
        for aid in attempt_ids[:2]:
            con.execute(
                "INSERT INTO attempt_scan_images (attempt_id, page_index, file_name, mime_type, file_size, content, created_at) VALUES (?, ?, ?, ?, ?, ?, '2026-10-27T10:00:00Z')",
                (aid, 0, f"{aid}.png", "image/png", len(fake_png), fake_png),
            )
    result = _attempt_scan_payloads_for_attempts(root, attempt_ids, chunk_size=2)
    assert len(result) == 4
    assert all(aid in result for aid in attempt_ids)
    assert len(result[attempt_ids[0]]) == 1
    assert len(result[attempt_ids[1]]) == 1
    assert result[attempt_ids[2]] == []
    assert result[attempt_ids[3]] == []


# ==============================================================================
# Student results answers batch reading
# ==============================================================================

def test_student_results_student_results_batch_answers_and_connection_count(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(
        web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    )
    imported = web_client.post(
        "/api/school/students/import",
        headers=school,
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
    )
    student = imported.json()["students"][0]
    student_user = {"id": student["user_id"], "role": "student"}
    teacher = _headers(_teacher_token(web_client))

    # Write 4 distinct exams and publish each to the class
    publications = []
    for idx in range(1, 5):
        _write_exam(tmp_path, label=f"exam_{idx}", subject=f"Subject_{idx}")
    papers = web_client.get("/api/papers", headers=teacher).json()["papers"]
    assert len(papers) == 4
    for paper in papers:
        pub = web_client.post(
            f"/api/papers/{paper['paper_id']}/publish",
            headers=teacher,
            json={"class_ids": [class_id], "show_results_immediately": True},
        ).json()["publication"]
        publications.append(pub)

    student_login = web_client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    student_headers = _headers(str(student_login.json()["token"]))

    # Start and submit all 4 attempts
    for pub in publications:
        started = web_client.post(f"/api/student/publications/{pub['id']}/start", headers=student_headers)
        assert started.status_code == 200
        aid = str(started.json()["attempt"]["id"])
        submitted = web_client.post(
            f"/api/student/attempts/{aid}/submit",
            headers=student_headers,
            json={"time_spent_seconds": 120, "answers": [{"question_id": "math/q1", "answer": "2"}]},
        )
        assert submitted.status_code == 200

    root = default_platform_root()
    with connect(root) as con:
        con.execute("UPDATE student_attempts SET grading_completed_at = '2026-10-27T12:00:00Z'")

    # Trace connections and SQL statements in list_student_results
    connections: list[str] = []
    statements: list[str] = []
    original_connect = student_service.connect

    def traced_connect(db_root):
        conn = original_connect(db_root)
        connections.append(str(db_root))
        conn.set_trace_callback(statements.append)
        return conn

    monkeypatch.setattr(student_service, "connect", traced_connect)

    results = list_student_results(root, tmp_path, student_user)
    assert len(results) == 4

    # Connection count in list_student_results is exactly 1 (not 1 + 4 = 5)
    assert len(connections) == 1

    # Answers SELECT query is batched into exactly 1 query
    ans_selects = sum("FROM STUDENT_ANSWERS" in stmt.upper() for stmt in statements)
    assert ans_selects == 1

    # Verify answers shape and order
    for res in results:
        assert res["analysis"]["answered_count"] >= 1
        q_order = [ans["question_id"] for ans in res["answers"]]
        assert q_order[0] == "math/q1"


def test_student_results_student_results_masking_when_show_results_false(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(
        web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    )
    imported = web_client.post(
        "/api/school/students/import",
        headers=school,
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
    )
    student = imported.json()["students"][0]
    _write_exam(tmp_path)
    teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]

    # Publish with show_results_immediately = False
    pub = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        headers=teacher,
        json={"class_ids": [class_id], "show_results_immediately": False},
    ).json()["publication"]

    student_login = web_client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    student_headers = _headers(str(student_login.json()["token"]))
    started = web_client.post(f"/api/student/publications/{pub['id']}/start", headers=student_headers)
    attempt_id = str(started.json()["attempt"]["id"])
    web_client.post(
        f"/api/student/attempts/{attempt_id}/submit",
        headers=student_headers,
        json={"time_spent_seconds": 60, "answers": [{"question_id": "math/q1", "answer": "2"}]},
    )

    root = default_platform_root()
    student_user = {"id": student["user_id"], "role": "student"}
    results = list_student_results(root, tmp_path, student_user)
    assert len(results) == 1
    res = results[0]

    # Masking rules: answers list must be empty, scores/analysis masked, but answered_count preserved
    assert res["show_results"] is False
    assert res["answers"] == []
    assert res["score"] is None
    assert res["analysis"]["correct_count"] is None
    assert res["analysis"]["wrong_count"] is None
    assert res["analysis"]["answered_count"] == 1
    assert res["analysis"]["average_time_per_question_seconds"] is None


def test_student_results_load_student_answers_chunking():
    root = default_platform_root()
    with connect(root) as con:
        # Empty attempt list returns empty dict with 0 queries
        assert _load_student_answers_for_attempts(con, []) == {}

        # Chunking test with small chunk_size
        aids = ["att-1", "att-2", "att-3", "att-4", "att-5"]
        res = _load_student_answers_for_attempts(con, aids, chunk_size=2)
        assert len(res) == 5
        assert all(aid in res for aid in aids)


# ==============================================================================
# Teacher student profile snapshot read once per attempt
# ==============================================================================

def test_teacher_profile_teacher_student_profile_snapshot_deduplication(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    fixture = _setup_multi_student_fixture(web_client, tmp_path, student_count=1)
    root = default_platform_root()
    student = fixture["students"][0]
    teacher = {"id": fixture["teacher_id"], "role": "teacher"}

    with connect(root) as con:
        attempt = con.execute(
            "SELECT id, question_payload_json, answer_key_json FROM student_attempts WHERE student_id = ?",
            (student["id"],),
        ).fetchone()
        attempt_id = str(attempt["id"])
        con.execute(
            "UPDATE student_attempts SET status='submitted', score=5, max_score=10, time_spent_seconds=240, grading_completed_at='2026-10-27T11:00:00Z' WHERE id=?",
            (attempt_id,),
        )
        con.executemany(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES (?, ?, ?, ?, ?, ?, 'reviewed', '2026-10-27T11:00:00Z')",
            [
                ("ans-1", attempt_id, "math/q1", '{"answer":"wrong"}', 0, 0.0),
                ("ans-2", attempt_id, "math/q2", '{"answer":"4"}', 1, 5.0),
            ],
        )

    # Trace executed SQL in teacher_student_profile_query
    executed_statements: list[str] = []
    original_connect = teacher_queries.connect

    def traced_connect(db_root):
        conn = original_connect(db_root)
        conn.set_trace_callback(executed_statements.append)
        return conn

    monkeypatch.setattr(teacher_queries, "connect", traced_connect)

    profile = teacher_student_profile_query(
        root,
        class_id=fixture["class_id"],
        user=teacher,
        student_id=student["id"],
        resolve_student=paper_service.resolve_teacher_class_student,
        attempt_status_group=_attempt_status_group,
        score_percent=paper_service._score_percent,
    )

    attempt_query = next(s for s in executed_statements if "FROM student_attempts sa" in s and "JOIN paper_records" in s and "FROM student_answers ans" not in s)
    weak_query = next(s for s in executed_statements if "FROM student_answers ans" in s)

    # Verify attempt_rows selects answer_key_json AND question_payload_json
    assert "sa.question_payload_json" in attempt_query
    assert "sa.answer_key_json" in attempt_query

    # Verify weak_rows NO LONGER selects question_payload_json OR answer_key_json
    assert "sa.question_payload_json" not in weak_query
    assert "sa.answer_key_json" not in weak_query
    assert "sa.id AS attempt_id" in weak_query

    # Verify weak_questions aggregation
    assert len(profile["weak_questions"]) == 1
    weak_q = profile["weak_questions"][0]
    assert weak_q["question_id"] == "math/q1"
    assert weak_q["wrong_count"] == 1
    assert weak_q["attempt_count"] == 1
    assert weak_q["average_score_percent"] == 0.0

    # Verify recent_exams doesn't leak answer_key_json
    assert "answer_key_json" not in profile["recent_exams"][0]
    assert profile["recent_exams"][0]["score"] == 5
    assert profile["recent_exams"][0]["score_percent"] == 50.0


def test_teacher_profile_profile_version_splitting_and_fallback_labels(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(
        web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    )
    imported = web_client.post(
        "/api/school/students/import",
        headers=school,
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
    )
    student = imported.json()["students"][0]
    student_id = student["id"]
    teacher = _headers(_teacher_token(web_client))
    teacher_user = {"id": teacher_id, "role": "teacher"}

    _write_exam(tmp_path)
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    paper_id = paper["paper_id"]

    # First publication
    pub1 = web_client.post(
        f"/api/papers/{paper_id}/publish",
        headers=teacher,
        json={"class_ids": [class_id]},
    ).json()["publication"]

    root = default_platform_root()
    with connect(root) as con:
        att1 = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (pub1["id"], student_id),
        ).fetchone()
        att1_id = str(att1["id"])
        con.execute(
            "UPDATE student_attempts SET status='submitted', score=0, max_score=5, started_at='2026-01-01', submitted_at='2026-01-01', grading_completed_at='2026-01-01' WHERE id=?",
            (att1_id,),
        )
        con.execute(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES ('ans-v1', ?, 'math/q1', '{}', 0, 0, 'reviewed', '2026-01-01')",
            (att1_id,),
        )

    # Revoke first publication so we can republish with modified question content
    revoked = web_client.delete(f"/api/papers/{paper_id}/publications/{pub1['id']}", headers=teacher)
    assert revoked.status_code == 200

    # Modify question content
    q_path = tmp_path / "resource" / "math" / "q1.yaml"
    q_data = yaml.safe_load(q_path.read_text(encoding="utf-8"))
    q_data["content"] = "1+1=? (revised definition)"
    q_path.write_text(yaml.safe_dump(q_data, allow_unicode=True, sort_keys=False), encoding="utf-8")

    # Second publication
    pub2 = web_client.post(
        f"/api/papers/{paper_id}/publish",
        headers=teacher,
        json={"class_ids": [class_id]},
    ).json()["publication"]

    with connect(root) as con:
        att2 = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (pub2["id"], student_id),
        ).fetchone()
        att2_id = str(att2["id"])
        con.execute(
            "UPDATE student_attempts SET status='submitted', score=0, max_score=5, started_at='2026-01-02', submitted_at='2026-01-02', grading_completed_at='2026-01-02' WHERE id=?",
            (att2_id,),
        )
        con.execute(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES ('ans-v2', ?, 'math/q1', '{}', 0, 0, 'reviewed', '2026-01-02')",
            (att2_id,),
        )

    # Revoke second publication and publish third with corrupted question snapshot
    revoked2 = web_client.delete(f"/api/papers/{paper_id}/publications/{pub2['id']}", headers=teacher)
    assert revoked2.status_code == 200

    pub3 = web_client.post(
        f"/api/papers/{paper_id}/publish",
        headers=teacher,
        json={"class_ids": [class_id]},
    ).json()["publication"]

    with connect(root) as con:
        att3 = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (pub3["id"], student_id),
        ).fetchone()
        att3_id = str(att3["id"])
        con.execute(
            "UPDATE student_attempts SET status='submitted', score=0, max_score=5, started_at='2026-01-03', submitted_at='2026-01-03', grading_completed_at='2026-01-03', question_payload_json='corrupted-not-json' WHERE id=?",
            (att3_id,),
        )
        con.execute(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES ('ans-v3', ?, 'math/q1', '{}', 0, 0, 'reviewed', '2026-01-03')",
            (att3_id,),
        )

    profile = teacher_student_profile_query(
        root,
        class_id=class_id,
        user=teacher_user,
        student_id=student_id,
        resolve_student=paper_service.resolve_teacher_class_student,
        attempt_status_group=_attempt_status_group,
        score_percent=paper_service._score_percent,
    )

    weak = profile["weak_questions"]
    # 3 distinct weak question groups for math/q1:
    # 1. corrupted snapshot -> question_version_label = '历史题目内容不可用'
    # 2. version 1 -> question_version_label = '历史版本 1'
    # 3. version 2 -> question_version_label = '历史版本 2'
    assert len(weak) == 3

    labels = {item.get("question_version_label") for item in weak}
    assert "历史题目内容不可用" in labels
    assert "历史版本 1" in labels
    assert "历史版本 2" in labels

    missing_group = next(item for item in weak if item.get("question_version_label") == "历史题目内容不可用")
    assert missing_group["question_version_count"] is None
    assert missing_group["question_version"] is None


# ==============================================================================
# End-to-End User Perspective Tests: Teacher & Student Workflows
# ==============================================================================

def test_user_perspective_teacher_submission_workflow(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    """User Journey: Teacher creates online and offline exam papers,

    students submit online and offline, teacher views/searches/filters the submissions list,
    and inspects scan images.
    """
    from tests.test_platform_paper_api import _tiny_image_bytes

    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(
        web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    )
    imported = web_client.post(
        "/api/school/students/import",
        headers=school,
        json={
            "class_id": class_id,
            "students": [
                {"student_no": f"S{index:03d}", "display_name": f"Student {index}"}
                for index in range(1, 4)
            ],
        },
    )
    students = imported.json()["students"]
    teacher_token = _teacher_token(web_client)
    teacher_headers = _headers(teacher_token)

    # 1. Teacher authors two papers: one online, one offline
    _write_exam(tmp_path, label="exam_online", subject="Math")
    _write_exam(tmp_path, label="exam_offline", subject="Physics")

    papers = web_client.get("/api/papers", headers=teacher_headers).json()["papers"]
    online_paper = next(p for p in papers if p["exam_id"] == "exam_online/Math")
    offline_paper = next(p for p in papers if p["exam_id"] == "exam_offline/Physics")

    # Publish online paper
    pub_online = web_client.post(
        f"/api/papers/{online_paper['paper_id']}/publish",
        headers=teacher_headers,
        json={"class_ids": [class_id], "show_results_immediately": True},
    ).json()["publication"]

    # 2. Student 1 logs in and submits online exam
    s1_login = web_client.post(
        "/api/auth/login",
        json={"username": students[0]["account_username"], "password": students[0]["initial_password"]},
    )
    s1_headers = _headers(str(s1_login.json()["token"]))
    s1_start = web_client.post(f"/api/student/publications/{pub_online['id']}/start", headers=s1_headers)
    s1_attempt_id = str(s1_start.json()["attempt"]["id"])
    s1_submit = web_client.post(
        f"/api/student/attempts/{s1_attempt_id}/submit",
        headers=s1_headers,
        json={
            "time_spent_seconds": 180,
            "answers": [
                {"question_id": "math/q1", "answer": "2"},
                {"question_id": "math/q2", "answer": "4"},
            ],
        },
    )
    assert s1_submit.status_code == 200

    # 3. Student 2 has an offline scan submission uploaded by teacher on the offline paper
    uploaded = web_client.post(
        f"/api/papers/{offline_paper['paper_id']}/offline-submissions",
        data={"class_id": class_id, "student_id": students[1]["id"]},
        files=[
            ("files", ("sheet1.jpg", _tiny_image_bytes("JPEG"), "image/jpeg")),
            ("files", ("sheet2.png", _tiny_image_bytes("PNG"), "image/png")),
        ],
        headers=teacher_headers,
    )
    assert uploaded.status_code == 200
    s2_attempt_id = uploaded.json()["attempt"]["attempt_id"]

    # 4. Teacher views submissions list for online paper
    online_subs_res = web_client.get(f"/api/papers/{online_paper['paper_id']}/submissions", headers=teacher_headers)
    assert online_subs_res.status_code == 200
    online_subs = online_subs_res.json()["submissions"]
    assert len(online_subs) == 3

    sub1 = next(s for s in online_subs if s["student_no"] == "S001")
    assert sub1["submission_mode"] == "online"
    assert sub1["scan_images"] == []
    assert len(sub1["answers"]) == 2

    # 5. Teacher views submissions list for offline paper
    offline_subs_res = web_client.get(f"/api/papers/{offline_paper['paper_id']}/submissions", headers=teacher_headers)
    assert offline_subs_res.status_code == 200
    offline_subs = offline_subs_res.json()["submissions"]
    assert len(offline_subs) == 1

    sub2 = offline_subs[0]
    assert sub2["submission_mode"] == "offline_scan"
    assert len(sub2["scan_images"]) == 2
    assert sub2["scan_images"][0]["page_index"] == 0
    assert sub2["scan_images"][0]["name"] == "sheet1.jpg"
    assert sub2["scan_images"][1]["page_index"] == 1
    assert sub2["scan_images"][1]["name"] == "sheet2.png"

    # Teacher downloads scan image page 0
    scan_img = web_client.get(
        f"/api/papers/{offline_paper['paper_id']}/attempts/{s2_attempt_id}/scan-images/0",
        headers=teacher_headers,
    )
    assert scan_img.status_code == 200
    assert scan_img.headers["content-type"].startswith("image/")

    # 6. Teacher filters submissions by student
    student_1_subs = [s for s in online_subs if s["student_name"] == "Student 1" or s["student_no"] == "S001"]
    assert len(student_1_subs) == 1
    assert student_1_subs[0]["student_no"] == "S001"
    assert student_1_subs[0]["submission_mode"] == "online"
    assert student_1_subs[0]["status"] == "submitted"

    # 7. Teacher grades student answers and completes grading
    grade_q1 = web_client.patch(
        f"/api/papers/{online_paper['paper_id']}/attempts/{s1_attempt_id}/answers/math/q1/grade",
        headers=teacher_headers,
        json={"score": 5.0, "is_correct": True, "feedback": "Well done"},
    )
    assert grade_q1.status_code == 200

    grade_q2 = web_client.patch(
        f"/api/papers/{online_paper['paper_id']}/attempts/{s1_attempt_id}/answers/math/q2/grade",
        headers=teacher_headers,
        json={"score": 5.0, "is_correct": True, "feedback": "Accurate"},
    )
    assert grade_q2.status_code == 200

    completed = web_client.post(
        f"/api/papers/{online_paper['paper_id']}/attempts/{s1_attempt_id}/complete-grading",
        headers=teacher_headers,
    )
    assert completed.status_code == 200
    assert completed.json()["attempt"]["grading_completed_at"] is not None


def test_user_perspective_student_results_lifecycle(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    """User Journey: Student completes exam, checks masked results before release,

    views full analysis and answers after teacher release, and browses multiple exam results.
    """
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(
        web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    )
    imported = web_client.post(
        "/api/school/students/import",
        headers=school,
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
    )
    student = imported.json()["students"][0]
    teacher = _headers(_teacher_token(web_client))

    # Create 2 exams: Exam 1 with delayed results release, Exam 2 with immediate release
    _write_exam(tmp_path, label="exam_delayed", subject="Math")
    _write_exam(tmp_path, label="exam_immediate", subject="Physics")

    papers = web_client.get("/api/papers", headers=teacher).json()["papers"]
    delayed_paper = next(p for p in papers if p["exam_id"] == "exam_delayed/Math")
    immediate_paper = next(p for p in papers if p["exam_id"] == "exam_immediate/Physics")

    pub_delayed = web_client.post(
        f"/api/papers/{delayed_paper['paper_id']}/publish",
        headers=teacher,
        json={"class_ids": [class_id], "show_results_immediately": False},
    ).json()["publication"]

    pub_immediate = web_client.post(
        f"/api/papers/{immediate_paper['paper_id']}/publish",
        headers=teacher,
        json={"class_ids": [class_id], "show_results_immediately": True},
    ).json()["publication"]

    # Student logs in
    student_login = web_client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    student_headers = _headers(str(student_login.json()["token"]))

    # 1. Student takes delayed exam
    start1 = web_client.post(f"/api/student/publications/{pub_delayed['id']}/start", headers=student_headers)
    att1_id = start1.json()["attempt"]["id"]
    sub1 = web_client.post(
        f"/api/student/attempts/{att1_id}/submit",
        headers=student_headers,
        json={
            "time_spent_seconds": 150,
            "answers": [
                {"question_id": "math/q1", "answer": "2"},
                {"question_id": "math/q2", "answer": "4"},
            ],
        },
    )
    assert sub1.status_code == 200

    # 2. Student checks results immediately: must be masked!
    results_before_release = web_client.get("/api/student/results", headers=student_headers)
    assert results_before_release.status_code == 200
    res1_before = results_before_release.json()["results"][0]
    assert res1_before["show_results"] is False
    assert res1_before["answers"] == []
    assert res1_before["score"] is None
    assert res1_before["analysis"]["correct_count"] is None
    assert res1_before["analysis"]["answered_count"] == 2  # Student knows their submission was saved!

    # 3. Teacher grades student answers and completes grading to release results
    grade1 = web_client.patch(
        f"/api/papers/{delayed_paper['paper_id']}/attempts/{att1_id}/answers/math/q1/grade",
        headers=teacher,
        json={"score": 5.0, "is_correct": True, "feedback": "Full marks"},
    )
    assert grade1.status_code == 200

    grade2 = web_client.patch(
        f"/api/papers/{delayed_paper['paper_id']}/attempts/{att1_id}/answers/math/q2/grade",
        headers=teacher,
        json={"score": 4.0, "is_correct": True, "feedback": "Good effort"},
    )
    assert grade2.status_code == 200

    complete_res = web_client.post(
        f"/api/papers/{delayed_paper['paper_id']}/attempts/{att1_id}/complete-grading",
        headers=teacher,
    )
    assert complete_res.status_code == 200

    # 4. Student checks results again: now revealed!
    results_after_release = web_client.get("/api/student/results", headers=student_headers)
    assert results_after_release.status_code == 200
    res1_after = results_after_release.json()["results"][0]
    assert res1_after["show_results"] is True
    assert res1_after["score"] is not None
    assert len(res1_after["answers"]) == 2
    # Verify rich fields in answer
    ans_q1 = next(a for a in res1_after["answers"] if a["question_id"] == "math/q1")
    assert ans_q1["content"] == "1+1=?"
    assert ans_q1["is_correct"] is True
    assert ans_q1["correct_answer"] == "2"

    # 5. Student takes second exam
    start2 = web_client.post(f"/api/student/publications/{pub_immediate['id']}/start", headers=student_headers)
    att2_id = start2.json()["attempt"]["id"]
    web_client.post(
        f"/api/student/attempts/{att2_id}/submit",
        headers=student_headers,
        json={
            "time_spent_seconds": 90,
            "answers": [
                {"question_id": "math/q1", "answer": "2"},
                {"question_id": "math/q2", "answer": "4"},
            ],
        },
    )
    # Teacher grades and completes grading
    web_client.patch(
        f"/api/papers/{immediate_paper['paper_id']}/attempts/{att2_id}/answers/math/q1/grade",
        headers=teacher,
        json={"score": 5.0, "is_correct": True},
    )
    web_client.patch(
        f"/api/papers/{immediate_paper['paper_id']}/attempts/{att2_id}/answers/math/q2/grade",
        headers=teacher,
        json={"score": 5.0, "is_correct": True},
    )
    complete2 = web_client.post(
        f"/api/papers/{immediate_paper['paper_id']}/attempts/{att2_id}/complete-grading",
        headers=teacher,
    )
    assert complete2.status_code == 200

    # Student results list now shows both exams sorted by submission time
    multi_results = web_client.get("/api/student/results", headers=student_headers)
    assert multi_results.status_code == 200
    assert len(multi_results.json()["results"]) == 2


def test_user_perspective_teacher_student_profile_diagnostics(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    """User Journey: Teacher inspects student academic diagnostic profile,

    verifying radar chart, weak questions grouping, version split, and date filters.
    """
    admin = _bootstrap_admin(web_client)
    _, teacher_id, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(
        web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"]
    )
    imported = web_client.post(
        "/api/school/students/import",
        headers=school,
        json={"class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student One"}]},
    )
    student = imported.json()["students"][0]
    student_id = student["id"]
    teacher_headers = _headers(_teacher_token(web_client))

    _write_exam(tmp_path, label="exam_diag", subject="Math")
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    paper_id = paper["paper_id"]

    pub = web_client.post(
        f"/api/papers/{paper_id}/publish",
        headers=teacher_headers,
        json={"class_ids": [class_id], "show_results_immediately": True},
    ).json()["publication"]

    # Student completes exam with 1 correct and 1 wrong answer
    root = default_platform_root()
    with connect(root) as con:
        att = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (pub["id"], student_id),
        ).fetchone()
        att_id = str(att["id"])
        con.execute(
            """
            UPDATE student_attempts
            SET status='submitted', score=5, max_score=10, time_spent_seconds=200,
                started_at='2026-10-20T10:00:00Z', submitted_at='2026-10-20T10:10:00Z', grading_completed_at='2026-10-20T10:10:00Z'
            WHERE id=?
            """,
            (att_id,),
        )
        con.execute(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES ('diag-ans-1', ?, 'math/q1', '{\"answer\":\"2\"}', 1, 5.0, 'reviewed', '2026-10-20T10:05:00Z')",
            (att_id,),
        )
        con.execute(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES ('diag-ans-2', ?, 'math/q2', '{\"answer\":\"wrong\"}', 0, 0.0, 'reviewed', '2026-10-20T10:06:00Z')",
            (att_id,),
        )

    # 1. Teacher views academic profile
    profile_res = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile",
        headers=teacher_headers,
    )
    assert profile_res.status_code == 200
    profile = profile_res.json()["profile"]

    # Check student info
    assert profile["student"]["student_no"] == "S001"

    # Check summary metrics
    summary = profile["summary"]
    assert summary["exam_count"] == 1
    assert summary["submitted_exam_count"] == 1
    assert summary["graded_exam_count"] == 1
    assert summary["average_score_percent"] == 50.0

    # Check radar chart dimensions (must have all 5 dimensions)
    radar = profile["radar"]
    radar_ids = {r["id"] for r in radar}
    assert radar_ids == {"completion", "score", "time_efficiency", "behavior", "module_mastery"}
    for r in radar:
        assert isinstance(r["value"], (int, float))
        assert 0 <= r["value"] <= 100

    # Check weak questions: only the wrong question appears!
    weak_qs = profile["weak_questions"]
    assert len(weak_qs) == 1
    assert weak_qs[0]["question_id"] == "math/q2"
    assert weak_qs[0]["wrong_count"] == 1
    assert weak_qs[0]["attempt_count"] == 1
    assert weak_qs[0]["average_score_percent"] == 0.0

    # Check recent exams
    recent = profile["recent_exams"]
    assert len(recent) == 1
    assert recent[0]["paper_id"] == paper_id
    assert recent[0]["score_percent"] == 50.0
    assert recent[0]["submission_mode"] == "online"

    # 2. Date filtering
    # Valid filter covering the exam date
    in_range = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile?date_from=2026-10-01&date_to=2026-10-31",
        headers=teacher_headers,
    )
    assert in_range.status_code == 200
    assert in_range.json()["profile"]["summary"]["exam_count"] == 1

    # Date filter outside the exam date
    out_of_range = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile?date_from=2026-11-01&date_to=2026-11-30",
        headers=teacher_headers,
    )
    assert out_of_range.status_code == 200
    assert out_of_range.json()["profile"]["summary"]["exam_count"] == 0

    # Invalid date range: date_from > date_to
    inverted_range = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile?date_from=2026-12-31&date_to=2026-01-01",
        headers=teacher_headers,
    )
    assert inverted_range.status_code == 400
    assert "开始日期不能晚于结束日期" in inverted_range.json()["detail"]
