from __future__ import annotations

import json

from fastapi.testclient import TestClient

from solaire.web.adaptive import publishing
from solaire.web.learning_progress import sources
from solaire.web.learning_progress.source_reads import load_online_source_read_context
from solaire.web.platform_db import connect, default_platform_root, init_platform_db
from tests.test_adaptive_practice_api import _setup


def test_personalized_publication_baseline_read_counts_and_frozen_results(
    web_client: TestClient,
    tmp_path,
    monkeypatch,
) -> None:
    context = _setup(web_client, tmp_path)
    root = default_platform_root()
    publication_id = str(context["source_publication"]["id"])
    students = context["students"]
    teacher_headers = context["teacher_headers"]

    node_id = "math/frozen-reuse-node"
    assert web_client.post(
        "/api/graph/nodes",
        headers=teacher_headers,
        json={"id": node_id, "canonical_name": "Frozen reuse node", "subject": "Math", "aliases": []},
    ).status_code == 200
    assert web_client.post(
        "/api/graph/bindings",
        headers=teacher_headers,
        json={"question_qualified_id": "math/q1", "node_id": node_id},
    ).status_code == 200

    with connect(root) as con:
        attempts = con.execute(
            "SELECT id, student_id, question_payload_json FROM student_attempts WHERE publication_id = ? ORDER BY student_id",
            (publication_id,),
        ).fetchall()
        assert len(attempts) == len(students) == 2
        for attempt in attempts:
            questions = json.loads(str(attempt["question_payload_json"] or "[]"))
            for question in questions:
                if str(question.get("question_id")) == "math/q1":
                    question["knowledge_node_ids"] = [node_id]
                    question["knowledge_node_names"] = {node_id: "Frozen reuse node"}
            con.execute(
                "UPDATE student_attempts SET question_payload_json = ? WHERE id = ?",
                (json.dumps(questions, ensure_ascii=False), str(attempt["id"])),
            )
        con.execute(
            "UPDATE student_answers SET is_correct = 0, score = 0 "
            "WHERE question_id = ? AND attempt_id IN "
            "(SELECT id FROM student_attempts WHERE publication_id = ?)",
            ("math/q1", publication_id),
        )
        con.execute(
            "UPDATE student_attempts SET grading_completed_at = '2026-10-27T12:00:00Z' WHERE publication_id = ?",
            (publication_id,),
        )

    graph_loads = 0
    original_load_graph = sources.load_graph

    def counted_load_graph(*args, **kwargs):
        nonlocal graph_loads
        graph_loads += 1
        return original_load_graph(*args, **kwargs)

    statements: list[str] = []
    original_connect = publishing.connect

    def traced_connect(db_root):
        con = original_connect(db_root)
        con.set_trace_callback(statements.append)
        return con

    monkeypatch.setattr(sources, "load_graph", counted_load_graph)
    monkeypatch.setattr(publishing, "connect", traced_connect)

    response = web_client.post(
        "/api/teacher/practice-publications/wrong-questions",
        headers=teacher_headers,
        json={
            "class_id": context["class"]["id"],
            "source_publication_id": publication_id,
            "title": "Frozen read reuse",
            "show_results_immediately": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["assigned_student_count"] == 2

    source_attempt_reads = [
        sql for sql in statements
        if "FROM STUDENT_ATTEMPTS SA" in sql.upper() and "JOIN EXAM_PUBLICATIONS EP" in sql.upper()
    ]
    source_answer_reads = [
        sql for sql in statements
        if "FROM STUDENT_ANSWERS" in sql.upper() and "ATTEMPT_ID IN" in sql.upper()
    ]

    # One read-only graph snapshot serves both assignments and baseline creation.
    # Selection and transactional baseline phases each perform one bounded attempt
    # read plus one answer read, independent of the two students.
    assert graph_loads == 1
    assert len(source_attempt_reads) == 2
    assert len(source_answer_reads) == 2
    assert sum("ANSWER_KEY_JSON" in sql.upper() for sql in source_attempt_reads) == 1
    assert sum(", SCORE" in sql.upper() for sql in source_answer_reads) == 1

    practice_publication_id = str(response.json()["publication"]["id"])
    with connect(root) as con:
        baseline_rows = con.execute(
            "SELECT student_id, source_attempt_id, source_question_id, knowledge_node_id, raw_score, raw_max_score, source_snapshot_hash "
            "FROM practice_frozen_baselines WHERE practice_publication_id = ? ORDER BY student_id, source_question_id",
            (practice_publication_id,),
        ).fetchall()
        frozen_questions = con.execute(
            "SELECT question_payload_json FROM student_attempts WHERE publication_id = ? ORDER BY student_id",
            (practice_publication_id,),
        ).fetchall()

    assert len(baseline_rows) == 2
    assert {str(row["knowledge_node_id"]) for row in baseline_rows} == {node_id}
    assert {float(row["raw_score"]) for row in baseline_rows} == {0.0}
    assert {float(row["raw_max_score"]) for row in baseline_rows} == {5.0}
    assert all(
        str(row["source_snapshot_hash"])
        == sources.compute_online_source_snapshot_hash(root, publication_id, str(row["student_id"]))
        for row in baseline_rows
    )
    assert len(frozen_questions) == 2
    assert all(node_id in str(row["question_payload_json"]) for row in frozen_questions)


def test_source_read_context_chunks_pairs_below_sqlite_variable_limit(tmp_path) -> None:
    init_platform_db(tmp_path)
    statements: list[str] = []
    with connect(tmp_path) as con:
        con.set_trace_callback(statements.append)
        context = load_online_source_read_context(
            con,
            source_publication_ids=["missing-source"],
            student_ids=[f"student-{index}" for index in range(901)],
        )

    attempt_reads = [sql for sql in statements if "FROM STUDENT_ATTEMPTS SA" in sql.upper()]
    assert len(attempt_reads) == 3
    assert context.attempts_by_pair == {}
    assert context.answers_by_attempt == {}
