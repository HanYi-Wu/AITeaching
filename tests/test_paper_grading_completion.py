from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import sqlite3
from threading import Barrier, Event

import pytest
from fastapi.testclient import TestClient

from solaire.web import paper_service
from solaire.web.paper_service import complete_paper_attempt_grading
from solaire.web.platform_db import connect, default_platform_root
from tests.test_paper_grading_transactions import _grade, _submitted_attempt
from tests.test_platform_paper_api import _headers


def _complete(
    project_root: Path,
    context: dict[str, str],
    *,
    user_id: str | None = None,
    role: str = "teacher",
) -> dict:
    return complete_paper_attempt_grading(
        default_platform_root(),
        project_root,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        user={"id": user_id or context["teacher_id"], "role": role},
    )


def _grade_both_questions(context: dict[str, str], project_root: Path) -> None:
    _grade(
        project_root,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q1",
        score=3,
    )
    _grade(
        project_root,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q2",
        score=4,
    )


def test_repeated_completion_preserves_first_confirmation_until_a_new_grade(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    _grade_both_questions(context, tmp_path)

    first = _complete(tmp_path, context, user_id=context["admin_id"], role="admin")
    assert first["score"] == 7
    assert first["max_score"] == 10
    assert first["grading_completed_by"] == context["admin_id"]

    repeated = _complete(tmp_path, context)
    assert repeated["grading_completed_at"] == first["grading_completed_at"]
    assert repeated["grading_completed_by"] == context["admin_id"]
    assert repeated["score"] == first["score"]
    assert repeated["max_score"] == first["max_score"]

    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q1",
        score=2,
    )
    root = default_platform_root()
    with connect(root) as con:
        cleared = con.execute(
            "SELECT grading_completed_at, grading_completed_by, score FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    assert cleared["grading_completed_at"] is None
    assert cleared["grading_completed_by"] is None
    assert cleared["score"] == 6

    confirmed_again = _complete(tmp_path, context)
    assert confirmed_again["grading_completed_at"] != first["grading_completed_at"]
    assert confirmed_again["grading_completed_by"] == context["teacher_id"]
    assert confirmed_again["score"] == 6
    assert confirmed_again["max_score"] == 10


def test_completion_rejects_missing_or_nonfinite_scores_without_publishing(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    with pytest.raises(ValueError, match="仍有 2 道题未完成批改"):
        _complete(tmp_path, context)

    _grade_both_questions(context, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        con.execute(
            "UPDATE student_answers SET score = 1 WHERE attempt_id = ?",
            (context["attempt_id"],),
        )
        con.execute(
            "UPDATE student_answers SET score = ? WHERE attempt_id = ? AND question_id = 'math/q1'",
            (float("inf"), context["attempt_id"]),
        )

    with pytest.raises(ValueError, match="score must be finite"):
        _complete(tmp_path, context)

    with connect(root) as con:
        attempt = con.execute(
            "SELECT grading_completed_at, grading_completed_by FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    assert attempt["grading_completed_at"] is None
    assert attempt["grading_completed_by"] is None


def test_completion_preserves_legacy_zero_maximum_scores(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        row = con.execute(
            "SELECT question_payload_json FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
        questions = json.loads(row["question_payload_json"])
        for question in questions:
            question["score_per_item"] = 0
        con.execute(
            "UPDATE student_attempts SET question_payload_json = ?, max_score = 0 WHERE id = ?",
            (json.dumps(questions, ensure_ascii=False), context["attempt_id"]),
        )

    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q1",
        score=1,
    )
    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q2",
        score=2,
    )

    completed = _complete(tmp_path, context)
    assert completed["score"] == 3
    assert completed["max_score"] == 0


def test_completion_failure_rolls_back_legacy_snapshot_repair_and_release(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    _grade_both_questions(context, tmp_path)
    root = default_platform_root()
    with connect(root) as con:
        row = con.execute(
            "SELECT question_payload_json FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
        questions = json.loads(row["question_payload_json"])
        for question in questions:
            question["score_per_item"] = 1
        con.execute(
            "UPDATE student_attempts SET question_payload_json = ?, question_payload_version = 1, max_score = 2 WHERE id = ?",
            (json.dumps(questions, ensure_ascii=False), context["attempt_id"]),
        )
        con.execute(
            """
            CREATE TRIGGER inject_completion_failure
            BEFORE UPDATE OF score ON student_attempts
            WHEN NEW.grading_completed_at IS NOT NULL
            BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="injected completion failure"):
        _complete(tmp_path, context)

    with connect(root) as con:
        attempt = con.execute(
            "SELECT question_payload_json, question_payload_version, score, max_score, grading_completed_at, grading_completed_by FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
    questions_after = json.loads(attempt["question_payload_json"])
    assert attempt["question_payload_version"] == 1
    assert [question["score_per_item"] for question in questions_after] == [1, 1]
    assert attempt["score"] == 7
    assert attempt["max_score"] == 2
    assert attempt["grading_completed_at"] is None
    assert attempt["grading_completed_by"] is None


@pytest.mark.parametrize("permission_change", ["paper_owner", "publication_owner", "attempt_status"])
def test_completion_rechecks_current_permissions_and_submission_state(
    web_client: TestClient,
    tmp_path: Path,
    permission_change: str,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    school_login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    outsider = web_client.post(
        "/api/school/teachers",
        headers=school_headers,
        json={"username": "teacher_other", "password": "secret123", "display_name": "Other", "subjects": ["Math"]},
    )
    assert outsider.status_code == 200
    outsider_id = str(outsider.json()["teacher"]["id"])
    root = default_platform_root()
    with connect(root) as con:
        if permission_change == "paper_owner":
            con.execute(
                "UPDATE paper_records SET owner_teacher_id = ? WHERE id = ?",
                (outsider_id, context["paper_id"]),
            )
            error_type, error = PermissionError, "No permission for this paper"
        elif permission_change == "publication_owner":
            con.execute(
                "UPDATE exam_publications SET teacher_id = ? WHERE paper_id = ?",
                (outsider_id, context["paper_id"]),
            )
            error_type, error = ValueError, "attempt not found for this paper"
        else:
            con.execute(
                "UPDATE student_attempts SET status = 'in_progress', submitted_at = NULL WHERE id = ?",
                (context["attempt_id"],),
            )
            error_type, error = ValueError, "只能发布已提交答卷的批改结果"

    with pytest.raises(error_type, match=error):
        _complete(tmp_path, context)

    with connect(root) as con:
        assert con.execute(
            "SELECT grading_completed_at FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()[0] is None


def test_completion_rechecks_paper_access_after_waiting_for_writer_lock(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    school_login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = _headers(str(school_login.json()["token"]))
    outsider = web_client.post(
        "/api/school/teachers",
        headers=school_headers,
        json={"username": "teacher_other", "password": "secret123", "display_name": "Other", "subjects": ["Math"]},
    )
    assert outsider.status_code == 200
    outsider_id = str(outsider.json()["teacher"]["id"])

    root = default_platform_root()
    lock = connect(root)
    lock.execute("BEGIN IMMEDIATE")
    begin_requested = Event()
    original_connect = paper_service.connect

    class SignalingConnection:
        def __init__(self, raw_connection):
            self.raw_connection = raw_connection

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return self.raw_connection.__exit__(exc_type, exc, traceback)

        def execute(self, sql, parameters=()):
            if str(sql).strip().upper() == "BEGIN IMMEDIATE":
                begin_requested.set()
            return self.raw_connection.execute(sql, parameters)

    monkeypatch.setattr(paper_service, "init_platform_db", lambda _root: None)
    monkeypatch.setattr(
        paper_service,
        "connect",
        lambda connection_root: SignalingConnection(original_connect(connection_root)),
    )

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(_complete, tmp_path, context)
            assert begin_requested.wait(timeout=5)
            lock.execute(
                "UPDATE paper_records SET owner_teacher_id = ? WHERE id = ?",
                (outsider_id, context["paper_id"]),
            )
            lock.commit()
            with pytest.raises(PermissionError, match="No permission for this paper"):
                pending.result(timeout=10)
    finally:
        lock.rollback()
        lock.close()


def test_concurrent_grade_and_completion_leave_one_consistent_final_state(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    context = _submitted_attempt(web_client, tmp_path)
    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q1",
        score=1,
    )
    _grade(
        tmp_path,
        paper_id=context["paper_id"],
        attempt_id=context["attempt_id"],
        teacher_id=context["teacher_id"],
        question_id="math/q2",
        score=2,
    )

    barrier = Barrier(2)

    def grade_one() -> dict:
        barrier.wait(timeout=10)
        return _grade(
            tmp_path,
            paper_id=context["paper_id"],
            attempt_id=context["attempt_id"],
            teacher_id=context["teacher_id"],
            question_id="math/q1",
            score=3,
        )

    def complete() -> dict:
        barrier.wait(timeout=10)
        return _complete(tmp_path, context, user_id=context["admin_id"], role="admin")

    with ThreadPoolExecutor(max_workers=2) as executor:
        graded, completed = list(executor.map(lambda action: action(), (grade_one, complete)))
    assert graded["score"] == 3
    assert completed["score"] in {3, 5}

    root = default_platform_root()
    with connect(root) as con:
        attempt = con.execute(
            "SELECT score, max_score, grading_completed_at, grading_completed_by FROM student_attempts WHERE id = ?",
            (context["attempt_id"],),
        ).fetchone()
        answers = con.execute(
            "SELECT question_id, score FROM student_answers WHERE attempt_id = ? ORDER BY question_id",
            (context["attempt_id"],),
        ).fetchall()
    assert [(row["question_id"], row["score"]) for row in answers] == [("math/q1", 3), ("math/q2", 2)]
    assert attempt["score"] == sum(row["score"] for row in answers) == 5
    assert attempt["max_score"] == 10
    if attempt["grading_completed_at"] is None:
        assert attempt["grading_completed_by"] is None
    else:
        assert attempt["grading_completed_by"] == context["admin_id"]
