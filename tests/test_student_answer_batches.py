"""Answer save/submit interleavings and all-or-nothing batch boundaries."""

import json

import pytest

from solaire.web import student_service
from solaire.web.papers import answer_batches
from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_student_api import _publish_exam_for_student, _write_online_exam


@pytest.fixture
def opened_attempt(web_client, tmp_path):
    exam_id = _write_online_exam(tmp_path)
    headers, publication_id, _ = _publish_exam_for_student(web_client, tmp_path, exam_id=exam_id)
    started = web_client.post(f"/api/student/publications/{publication_id}/start", headers=headers)
    assert started.status_code == 200
    return headers, started.json()["attempt"]["id"]


def _answer_rows(attempt_id):
    with connect(default_platform_root()) as con:
        return [dict(row) for row in con.execute(
            "SELECT * FROM student_answers WHERE attempt_id = ? ORDER BY question_id", (attempt_id,)
        )]


def test_save_read_before_submit_cannot_erase_submitted_answers_or_scores(
    web_client, tmp_path, monkeypatch, opened_attempt,
):
    headers, attempt_id = opened_attempt
    root = default_platform_root()
    with connect(root) as con:
        user = dict(con.execute("SELECT * FROM users WHERE role = 'student'").fetchone())
    prepare = answer_batches._prepare_answer_mutations
    submitted = False

    def submit_before_save_takes_writer_lock(*args, **kwargs):
        nonlocal submitted
        if not submitted:
            submitted = True
            student_service.submit_student_attempt(
                root, tmp_path, attempt_id=attempt_id, user=user,
                answers=[{"question_id": "math/q1", "answer": "A"},
                         {"question_id": "math/q2", "answer": "B"}],
            )
        return prepare(*args, **kwargs)

    monkeypatch.setattr(answer_batches, "_prepare_answer_mutations", submit_before_save_takes_writer_lock)
    stale = web_client.post(
        f"/api/student/attempts/{attempt_id}/answers", headers=headers,
        json={"answers": [{"question_id": "math/q1", "answer": "B"}]},
    )
    assert stale.status_code == 400
    assert stale.json()["detail"] == "Attempt already submitted"
    rows = _answer_rows(attempt_id)
    assert [json.loads(row["answer_payload"])["answer"] for row in rows] == ["A", "B"]
    assert [row["score"] for row in rows] == [5, 5]
    with connect(root) as con:
        attempt = con.execute("SELECT * FROM student_attempts WHERE id = ?", (attempt_id,)).fetchone()
        assert attempt["status"] == "submitted"
        assert attempt["score"] == 10
        assert attempt["grading_completed_at"]


def test_failed_answer_batch_rolls_back_every_mutation(web_client, monkeypatch, opened_attempt):
    headers, attempt_id = opened_attempt
    url = f"/api/student/attempts/{attempt_id}/answers"
    assert web_client.post(url, headers=headers, json={"answers": [
        {"question_id": "math/q1", "answer": "A"}
    ]}).status_code == 200
    before = _answer_rows(attempt_id)
    write = answer_batches._write_answer_mutations

    def fail_after_writes(*args, **kwargs):
        write(*args, **kwargs)
        raise ValueError("injected batch failure")

    monkeypatch.setattr(answer_batches, "_write_answer_mutations", fail_after_writes)
    failed = web_client.post(url, headers=headers, json={"answers": [
        {"question_id": "math/q1", "answer": ""}, {"question_id": "math/q2", "answer": "B"}
    ]})
    assert failed.status_code == 400
    assert _answer_rows(attempt_id) == before


@pytest.mark.parametrize("invalid", [
    [{"question_id": "math/q1", "answer": "A"}, {"question_id": " math/q1 ", "answer": "B"}],
    [{"question_id": "foreign/q1", "answer": "A"}],
    [{"question_id": "math/q1", "images": [{"data_url": "data:image/png;base64,AA=="}] * 11}],
])
def test_invalid_batch_keeps_saved_answers_unchanged(web_client, opened_attempt, invalid):
    headers, attempt_id = opened_attempt
    url = f"/api/student/attempts/{attempt_id}/answers"
    assert web_client.post(url, headers=headers, json={"answers": [
        {"question_id": "math/q1", "answer": "A"}
    ]}).status_code == 200
    before = _answer_rows(attempt_id)
    assert web_client.post(url, headers=headers, json={"answers": invalid}).status_code == 400
    assert _answer_rows(attempt_id) == before
    cleared = web_client.post(url, headers=headers, json={"answers": [
        {"question_id": "math/q1", "answer": "", "images": []}
    ]})
    assert cleared.status_code == 200
    assert cleared.json()["answer_count"] == 0
    assert _answer_rows(attempt_id) == []
