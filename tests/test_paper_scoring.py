"""Legal-score compatibility and rejection before invalid scores reach storage."""

import pytest

from solaire.web.paper_service import _score_percent as paper_percent
from solaire.web.papers.scoring import (
    clamp_suggested_score, question_score_map, rounded_total,
    score_objective_answer, validate_manual_score,
)
from solaire.web.papers.student_sessions import _score_percent as student_percent
from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_student_api import _teacher_headers
from tests import test_student_answer_batches as answer_batch_fixtures

opened_attempt = answer_batch_fixtures.opened_attempt


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -float("inf"), -1, 6])
def test_manual_scores_must_be_finite_and_within_question_maximum(invalid):
    with pytest.raises(ValueError):
        validate_manual_score(invalid, 5)


def test_legacy_zero_maximum_fallback_is_preserved_and_nonfinite_values_rejected():
    assert validate_manual_score(0, 0) == 0
    assert validate_manual_score(1, 0) == 1
    with pytest.raises(ValueError):
        validate_manual_score(0, float("inf"))
    assert clamp_suggested_score(float("nan"), 5) is None
    assert clamp_suggested_score(float("inf"), 5) is None
    assert clamp_suggested_score(2, float("inf")) is None
    assert clamp_suggested_score(2, 0) == 2
    assert clamp_suggested_score(-1, 5) == 0
    assert clamp_suggested_score(6, 5) == 5
    assert clamp_suggested_score(1.234, 5) == 1.23


def test_total_overflow_and_invalid_question_maxima_are_rejected():
    assert rounded_total([0.1, 0.2, 0.345]) == round(sum([0.1, 0.2, 0.345]), 2)
    with pytest.raises(ValueError):
        rounded_total([1e308, 1e308])
    for maximum in (float("nan"), float("inf"), -1):
        with pytest.raises(ValueError):
            question_score_map([{"question_id": "q1", "score_per_item": maximum}])


@pytest.mark.parametrize("raw,expected,qtype,zero_unanswered,result", [
    ("ca", "AC", "multiple_choice", False, (1, 5.0)),
    ("b", "A", "single_choice", False, (0, 0.0)),
    ("  Example   Answer ", "example answer", "short_answer", False, (1, 5.0)),
    ("", "A", "single_choice", False, (None, None)),
    (None, "A", "single_choice", True, (0, 0.0)),
])
def test_objective_scoring_keeps_normalization_and_unanswered_policy(raw, expected, qtype, zero_unanswered, result):
    assert score_objective_answer(raw, expected, qtype, 5, zero_unanswered=zero_unanswered) == result


def test_legacy_percentage_fallback_is_retained_for_finite_values():
    for percentage in (paper_percent, student_percent):
        assert percentage(2, 4) == 50
        assert percentage(3, 0) == 3
        assert percentage(3, None) == 3
        assert percentage(None, 5) is None
        assert percentage(float("nan"), 5) is None
        assert percentage(1, float("inf")) is None


def test_invalid_teacher_score_cannot_mutate_released_attempt(web_client, opened_attempt):
    headers, attempt_id = opened_attempt
    submitted = web_client.post(f"/api/student/attempts/{attempt_id}/submit", headers=headers,
                               json={"answers": [{"question_id": "math/q1", "answer": "A"},
                                                 {"question_id": "math/q2", "answer": "B"}]})
    assert submitted.status_code == 200
    root = default_platform_root()
    with connect(root) as con:
        before = dict(con.execute("SELECT * FROM student_attempts WHERE id = ?", (attempt_id,)).fetchone())
        paper_id = con.execute("SELECT paper_id FROM exam_publications WHERE id = ?", (before["publication_id"],)).fetchone()[0]
        answers_before = [dict(row) for row in con.execute("SELECT * FROM student_answers WHERE attempt_id = ? ORDER BY question_id", (attempt_id,))]
    teacher_headers = {**_teacher_headers(web_client), "Content-Type": "application/json"}
    url = f"/api/papers/{paper_id}/attempts/{attempt_id}/answers/math/q1/grade"
    for value in ("1e999", "6"):
        rejected = web_client.patch(url, headers=teacher_headers, content='{"score": ' + value + '}')
        assert rejected.status_code == 400
        with connect(root) as con:
            assert dict(con.execute("SELECT * FROM student_attempts WHERE id = ?", (attempt_id,)).fetchone()) == before
            assert [dict(row) for row in con.execute("SELECT * FROM student_answers WHERE attempt_id = ? ORDER BY question_id", (attempt_id,))] == answers_before
    accepted = web_client.patch(url, headers=teacher_headers, json={"score": 1.2345})
    assert accepted.status_code == 200
    assert accepted.json()["answer"]["score"] == 1.2345
