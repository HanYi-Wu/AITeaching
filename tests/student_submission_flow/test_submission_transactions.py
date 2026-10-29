"""Regression tests for student answer saves and final submission."""

from __future__ import annotations

import json

import pytest

from solaire.web import student_service
from solaire.web.papers import answer_batches
from solaire.web.papers.student_sessions import _saved_answer_payloads
from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_student_api import _publish_exam_for_student, _write_online_exam


@pytest.fixture
def opened_student_attempt(web_client, tmp_path):
    exam_id = _write_online_exam(tmp_path)
    headers, publication_id, _ = _publish_exam_for_student(web_client, tmp_path, exam_id=exam_id)
    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=headers)
    assert started.status_code == 200
    data = started.json()
    return headers, data["attempt"]["id"], publication_id, tmp_path


def _db_user(role="student"):
    with connect(default_platform_root()) as con:
        return dict(con.execute("SELECT * FROM users WHERE role = ?", (role,)).fetchone())


def _answer_rows(attempt_id: str):
    with connect(default_platform_root()) as con:
        return [
            dict(row)
            for row in con.execute(
                "SELECT * FROM student_answers WHERE attempt_id = ? ORDER BY question_id",
                (attempt_id,),
            )
        ]


def test_duplicate_submit_idempotent_and_preserves_score(web_client, opened_student_attempt):
    headers, attempt_id, _, _ = opened_student_attempt
    url = f"/api/student/attempts/{attempt_id}/submit"

    # First submit with correct answers
    first = web_client.post(
        url,
        headers=headers,
        json={"answers": [{"question_id": "math/q1", "answer": "A"}, {"question_id": "math/q2", "answer": "B"}]},
    )
    assert first.status_code == 200
    resp1 = first.json()
    assert resp1["attempt"]["submitted_answers_accepted"] is True
    assert resp1["attempt"]["status"] == "submitted"
    assert resp1["attempt"]["score"] == 10
    original_answers = _answer_rows(attempt_id)

    # Second submit with different answers must be rejected with accepted=False
    second = web_client.post(
        url,
        headers=headers,
        json={"answers": [{"question_id": "math/q1", "answer": "C"}, {"question_id": "math/q2", "answer": "D"}]},
    )
    assert second.status_code == 200
    resp2 = second.json()
    assert resp2["attempt"]["submitted_answers_accepted"] is False
    assert resp2["attempt"]["score"] == 10

    # Saved answers in database must remain exactly the first submission's answers
    after_answers = _answer_rows(attempt_id)
    assert after_answers == original_answers
    assert [json.loads(r["answer_payload"])["answer"] for r in after_answers] == ["A", "B"]


def test_concurrent_save_rejected_after_submit(web_client, opened_student_attempt, monkeypatch):
    headers, attempt_id, _, tmp_path = opened_student_attempt
    root = default_platform_root()
    user = _db_user("student")
    orig_prepare = answer_batches._prepare_answer_mutations
    submitted = False

    def submit_while_preparing(*args, **kwargs):
        nonlocal submitted
        if not submitted:
            submitted = True
            student_service.submit_student_attempt(
                root,
                tmp_path,
                attempt_id=attempt_id,
                user=user,
                answers=[{"question_id": "math/q1", "answer": "A"}, {"question_id": "math/q2", "answer": "B"}],
            )
        return orig_prepare(*args, **kwargs)

    monkeypatch.setattr(answer_batches, "_prepare_answer_mutations", submit_while_preparing)

    stale_save = web_client.post(
        f"/api/student/attempts/{attempt_id}/answers",
        headers=headers,
        json={"answers": [{"question_id": "math/q1", "answer": "WRONG"}]},
    )
    assert stale_save.status_code == 400
    assert stale_save.json()["detail"] == "Attempt already submitted"

    rows = _answer_rows(attempt_id)
    assert [json.loads(r["answer_payload"])["answer"] for r in rows] == ["A", "B"]
    assert [r["score"] for r in rows] == [5, 5]


def test_timeout_submit_time_spent_clamped(opened_student_attempt):
    headers, attempt_id, _, tmp_path = opened_student_attempt
    root = default_platform_root()
    user = _db_user("student")

    # Set started_at to 3 hours ago, and time_limit_minutes to 60
    with connect(root) as con:
        con.execute(
            """
            UPDATE student_attempts
            SET started_at = datetime('now', '-180 minutes')
            WHERE id = ?
            """,
            (attempt_id,),
        )
        con.execute(
            """
            UPDATE exam_publications
            SET time_limit_minutes = 60
            WHERE id = (SELECT publication_id FROM student_attempts WHERE id = ?)
            """,
            (attempt_id,),
        )

    result = student_service.submit_student_attempt(
        root,
        tmp_path,
        attempt_id=attempt_id,
        user=user,
        answers=[{"question_id": "math/q1", "answer": "A"}],
    )
    assert result["submitted_answers_accepted"] is True
    # time_spent_seconds must be clamped to 60 * 60 = 3600
    assert result["time_spent_seconds"] == 3600


def test_blank_answers_auto_release_scored_zero(web_client, opened_student_attempt):
    headers, attempt_id, _, _ = opened_student_attempt
    url = f"/api/student/attempts/{attempt_id}/submit"

    # Submit completely blank paper
    res = web_client.post(url, headers=headers, json={"answers": []})
    assert res.status_code == 200
    data = res.json()
    assert data["attempt"]["submitted_answers_accepted"] is True
    assert data["attempt"]["score"] == 0
    assert data["attempt"]["max_score"] == 10
    assert data["attempt"]["show_results"] is True

    rows = _answer_rows(attempt_id)
    assert len(rows) == 2
    for row in rows:
        assert row["score"] == 0
        assert row["grading_status"] == "auto_scored"


def test_incremental_delta_save_merges_with_existing(web_client, opened_student_attempt):
    headers, attempt_id, _, _ = opened_student_attempt
    url = f"/api/student/attempts/{attempt_id}/answers"

    # Save q1 only
    r1 = web_client.post(url, headers=headers, json={"answers": [{"question_id": "math/q1", "answer": "A"}]})
    assert r1.status_code == 200
    assert r1.json()["answer_count"] == 1

    # Save q2 only
    r2 = web_client.post(url, headers=headers, json={"answers": [{"question_id": "math/q2", "answer": "B"}]})
    assert r2.status_code == 200
    assert r2.json()["answer_count"] == 1

    # Check database: both q1 and q2 exist
    saved = _saved_answer_payloads(default_platform_root(), attempt_id)
    assert len(saved) == 2
    assert {s["question_id"]: s["answer"] for s in saved} == {"math/q1": "A", "math/q2": "B"}

    # Clear q1 by saving empty answer
    r3 = web_client.post(url, headers=headers, json={"answers": [{"question_id": "math/q1", "answer": ""}]})
    assert r3.status_code == 200
    saved_after = _saved_answer_payloads(default_platform_root(), attempt_id)
    assert len(saved_after) == 1
    assert saved_after[0]["question_id"] == "math/q2"


def test_batch_size_counts_escaped_unicode_and_nested_fields(monkeypatch):
    answers = [{"question_id": "q", "answer": "x", "extra": {"nested": [("中" + chr(10) + chr(92) + chr(34))] * 20}}]
    exact = len(json.dumps(answers, ensure_ascii=False).encode("utf-8"))
    monkeypatch.setattr(answer_batches, "MAX_ANSWER_BATCH_BYTES", exact)
    answer_batches._validate_answer_batch(answers, {"q"})
    monkeypatch.setattr(answer_batches, "MAX_ANSWER_BATCH_BYTES", exact - 1)
    with pytest.raises(ValueError, match="payload is too large"):
        answer_batches._validate_answer_batch(answers, {"q"})


@pytest.mark.parametrize("operation", ["save", "submit"])
def test_student_deactivated_before_write_is_rechecked(web_client, opened_student_attempt, monkeypatch, operation):
    headers, attempt_id, _, _ = opened_student_attempt
    root = default_platform_root()
    module = answer_batches if operation == "save" else student_service
    original = module._prepare_answer_mutations
    def deactivate(*args, **kwargs):
        rows = original(*args, **kwargs)
        with connect(root) as con:
            con.execute("UPDATE students SET status = 'inactive' WHERE user_id = ?", (_db_user("student")["id"],))
        return rows
    monkeypatch.setattr(module, "_prepare_answer_mutations", deactivate)
    endpoint = "answers" if operation == "save" else "submit"
    result = web_client.post(
        f"/api/student/attempts/{attempt_id}/{endpoint}", headers=headers,
        json={"answers": [{"question_id": "math/q1", "answer": "A"}]},
    )
    assert result.status_code == 403
    assert _answer_rows(attempt_id) == []
