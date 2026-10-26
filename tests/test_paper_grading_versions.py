"""Optional preconditions reject stale writes while legacy requests keep working."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from solaire.web.paper_service import grade_paper_answer
from solaire.web.papers.grading_versions import GradingVersionConflict
from solaire.web.platform_db import connect, default_platform_root
from tests.test_paper_grading_transactions import _submitted_attempt
from tests.test_platform_paper_api import _headers, _teacher_token


@pytest.fixture
def grading_context(web_client, tmp_path):
    context = _submitted_attempt(web_client, tmp_path)
    context["headers"] = _headers(_teacher_token(web_client))
    return context


def _versions(client, context):
    result = client.get(f"/api/papers/{context['paper_id']}/submissions", headers=context["headers"])
    assert result.status_code == 200
    attempt = next(row for row in result.json()["submissions"] if row["attempt_id"] == context["attempt_id"])
    return {answer["question_id"]: answer["grading_version"] for answer in attempt["answers"]}


def _url(context, question_id="math/q1"):
    return f"/api/papers/{context['paper_id']}/attempts/{context['attempt_id']}/answers/{question_id}/grade"


def test_optional_version_rejects_stale_answer_without_changing_legacy_contract(web_client, grading_context):
    context = grading_context
    initial = _versions(web_client, context)["math/q1"]
    current = web_client.patch(_url(context), headers={**context["headers"], "If-Match": f'"{initial}"'},
                               json={"score": 3, "feedback": "first review"})
    assert current.status_code == 200
    version = current.json()["answer"]["grading_version"]
    assert version != initial
    stale = web_client.patch(_url(context), headers={**context["headers"], "If-Match": initial}, json={"score": 1})
    assert stale.status_code == 409
    assert stale.headers["etag"] == f'"{version}"'
    with connect(default_platform_root()) as con:
        answer = con.execute("SELECT score, feedback FROM student_answers WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],)).fetchone()
        assert (answer["score"], answer["feedback"]) == (3, "first review")
        assert con.execute("SELECT revision FROM paper_answer_grading_versions WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],)).fetchone()[0] == 1
    legacy = web_client.patch(_url(context), headers=context["headers"], json={"score": 4})
    assert legacy.status_code == 200


def test_legacy_writes_are_detected_by_content_even_without_revision_updates(web_client, grading_context):
    context = grading_context
    saved = web_client.patch(_url(context), headers=context["headers"], json={"score": 3, "feedback": "old"})
    version = saved.json()["answer"]["grading_version"]
    with connect(default_platform_root()) as con:
        con.execute("UPDATE student_answers SET feedback='changed by older program' WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],))
    stale = web_client.patch(_url(context), headers={**context["headers"], "If-Match": version}, json={"score": 2})
    assert stale.status_code == 409
    fresh = _versions(web_client, context)["math/q1"]
    assert fresh != version
    assert web_client.patch(_url(context), headers={**context["headers"], "If-Match": fresh}, json={"score": 2}).status_code == 200


def test_different_question_versions_do_not_conflict(web_client, grading_context):
    context = grading_context
    versions = _versions(web_client, context)
    for question_id, score in (("math/q1", 3), ("math/q2", 4)):
        response = web_client.patch(_url(context, question_id), headers={**context["headers"], "If-Match": versions[question_id]}, json={"score": score})
        assert response.status_code == 200
    with connect(default_platform_root()) as con:
        assert con.execute("SELECT score FROM student_attempts WHERE id=?", (context["attempt_id"],)).fetchone()[0] == 7


def test_suggestion_and_full_status_changes_invalidate_old_versions(web_client, grading_context):
    context = grading_context
    assert web_client.patch(_url(context), headers=context["headers"], json={"score": 3}).status_code == 200
    for field, value in (("ai_suggested_score", 2.5), ("ai_feedback", "new suggestion"),
                         ("ai_ocr_text", "new recognized text"), ("grading_status", "needs_review")):
        before = _versions(web_client, context)["math/q1"]
        with connect(default_platform_root()) as con:
            con.execute(f"UPDATE student_answers SET {field}=? WHERE attempt_id=? AND question_id='math/q1'", (value, context["attempt_id"]))
        stale = web_client.patch(_url(context), headers={**context["headers"], "If-Match": before}, json={"score": 1})
        assert stale.status_code == 409
        assert _versions(web_client, context)["math/q1"] != before
        with connect(default_platform_root()) as con:
            assert con.execute("SELECT revision FROM paper_answer_grading_versions WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],)).fetchone()[0] == 1


def test_concurrent_conditional_writes_accept_only_one_current_version(web_client, tmp_path, grading_context):
    context = grading_context
    version = _versions(web_client, context)["math/q1"]
    barrier = Barrier(2)

    def grade(score):
        barrier.wait(timeout=10)
        try:
            return grade_paper_answer(default_platform_root(), tmp_path, paper_id=context["paper_id"],
                                      attempt_id=context["attempt_id"], question_id="math/q1",
                                      user={"id": context["teacher_id"], "role": "teacher"}, score=score, expected_version=version)
        except GradingVersionConflict as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(grade, [2, 4]))
    assert sum(isinstance(item, dict) for item in outcomes) == 1
    assert sum(isinstance(item, GradingVersionConflict) for item in outcomes) == 1
    with connect(default_platform_root()) as con:
        assert con.execute("SELECT revision FROM paper_answer_grading_versions WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],)).fetchone()[0] == 1


def test_revision_write_failure_rolls_back_answer_total_and_completion(web_client, grading_context):
    context = grading_context
    assert web_client.patch(_url(context), headers=context["headers"], json={"score": 3}).status_code == 200
    with connect(default_platform_root()) as con:
        before_answer = dict(con.execute("SELECT * FROM student_answers WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],)).fetchone())
        before_attempt = dict(con.execute("SELECT * FROM student_attempts WHERE id=?", (context["attempt_id"],)).fetchone())
        con.execute("CREATE TRIGGER reject_version_update BEFORE UPDATE ON paper_answer_grading_versions BEGIN SELECT RAISE(ABORT, 'version write failed'); END")
    failed = web_client.patch(_url(context), headers=context["headers"], json={"score": 1})
    assert failed.status_code == 400
    with connect(default_platform_root()) as con:
        assert dict(con.execute("SELECT * FROM student_answers WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],)).fetchone()) == before_answer
        assert dict(con.execute("SELECT * FROM student_attempts WHERE id=?", (context["attempt_id"],)).fetchone()) == before_attempt
        assert con.execute("SELECT revision FROM paper_answer_grading_versions WHERE attempt_id=? AND question_id='math/q1'", (context["attempt_id"],)).fetchone()[0] == 1
