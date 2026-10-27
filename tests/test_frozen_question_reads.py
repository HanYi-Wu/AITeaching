from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
import yaml

from solaire.web import paper_service
from solaire.web.papers import analysis as paper_analysis
from solaire.web.papers import frozen_question_reads, teacher_queries
from solaire.web.papers.teacher_queries import _weak_question_definition_key
from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_paper_api import (
    _bootstrap_admin,
    _create_school_teacher_class,
    _headers,
    _teacher_token,
    _write_exam,
)


def test_teacher_submission_list_reuses_only_request_scoped_frozen_reads(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch,
) -> None:
    admin = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin)
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
                for index in range(1, 5)
            ],
        },
    )
    assert imported.status_code == 200
    _write_exam(tmp_path)
    teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        headers=teacher,
        json={"class_ids": [class_id]},
    )
    assert publication.status_code == 200
    publication_id = publication.json()["publication"]["id"]

    with connect(default_platform_root()) as con:
        attempts = con.execute(
            "SELECT question_payload_json, answer_key_json FROM student_attempts WHERE publication_id = ?",
            (publication_id,),
        ).fetchall()
    assert len(attempts) == 4
    question_json = str(attempts[0]["question_payload_json"])
    answer_json = str(attempts[0]["answer_key_json"])
    assert all(str(row["question_payload_json"]) == question_json for row in attempts)
    assert all(str(row["answer_key_json"]) == answer_json for row in attempts)

    counts = {"questions": 0, "answers": 0, "maps": 0}
    traced_sql: list[str] = []
    original_loads = json.loads
    original_score_map = frozen_question_reads.question_score_map

    def counted_loads(value, *args, **kwargs):
        if value == question_json:
            counts["questions"] += 1
        elif value == answer_json:
            counts["answers"] += 1
        return original_loads(value, *args, **kwargs)

    def counted_score_map(questions):
        counts["maps"] += 1
        return original_score_map(questions)

    monkeypatch.setattr(frozen_question_reads.json, "loads", counted_loads)
    monkeypatch.setattr(frozen_question_reads, "question_score_map", counted_score_map)

    def trace_connections(original_connect):
        def traced_connect(root):
            connection = original_connect(root)
            connection.set_trace_callback(traced_sql.append)
            return connection

        return traced_connect

    monkeypatch.setattr(teacher_queries, "connect", trace_connections(teacher_queries.connect))
    monkeypatch.setattr(paper_service, "connect", trace_connections(paper_service.connect))

    class UncachedReadContext:
        def load_payload(self, raw_questions, raw_answers):
            return counted_loads(str(raw_questions or "[]")), counted_loads(str(raw_answers or "{}"))

        def question_maps(
            self,
            raw_questions,
            raw_answers,
            questions,
            answer_keys,
            *,
            include_correct_answer=False,
        ):
            scores = counted_score_map(questions)
            by_id = {str(item.get("question_id")): item for item in questions}
            if include_correct_answer:
                by_id = {
                    question_id: {**question, "correct_answer": answer_keys.get(question_id)}
                    for question_id, question in by_id.items()
                }
            return questions, by_id, scores

    original_context_type = teacher_queries.FrozenQuestionReadContext
    monkeypatch.setattr(teacher_queries, "FrozenQuestionReadContext", UncachedReadContext)

    baseline = web_client.get(f"/api/papers/{paper['paper_id']}/submissions", headers=teacher)
    assert baseline.status_code == 200, baseline.text
    assert counts == {"questions": 4, "answers": 4, "maps": 4}
    baseline_select_count = sum(statement.lstrip().upper().startswith("SELECT") for statement in traced_sql)
    assert baseline_select_count == 4
    assert sum("FROM attempt_scan_images" in statement for statement in traced_sql) == 1

    monkeypatch.setattr(teacher_queries, "FrozenQuestionReadContext", original_context_type)
    for name in counts:
        counts[name] = 0
    traced_sql.clear()

    first = web_client.get(f"/api/papers/{paper['paper_id']}/submissions", headers=teacher)
    assert first.status_code == 200, first.text
    assert len(first.json()["submissions"]) == 4
    assert counts == {"questions": 1, "answers": 1, "maps": 1}
    optimized_select_count = sum(statement.lstrip().upper().startswith("SELECT") for statement in traced_sql)
    assert optimized_select_count == baseline_select_count

    second = web_client.get(f"/api/papers/{paper['paper_id']}/submissions", headers=teacher)
    assert second.status_code == 200, second.text
    assert counts == {"questions": 2, "answers": 2, "maps": 2}


def test_frozen_question_context_returns_isolated_values_and_keeps_versions_separate() -> None:
    context = frozen_question_reads.FrozenQuestionReadContext()
    older_questions = [{"question_id": "math/q1", "content": "old wording", "score_per_item": 2}]
    newer_questions = [{"question_id": "math/q1", "content": "new wording", "score_per_item": 4}]
    older_raw = json.dumps(older_questions)
    newer_raw = json.dumps(newer_questions)
    answer_raw = json.dumps({"math/q1": "A"})

    questions, answers = context.load_payload(older_raw, answer_raw)
    questions[0]["content"] = "caller mutation"
    maps = context.question_maps(older_raw, answer_raw, older_questions, answers, include_correct_answer=True)
    maps[1]["math/q1"]["content"] = "mapping mutation"
    old_again, _ = context.load_payload(older_raw, answer_raw)
    assert old_again[0]["content"] == "old wording"

    new_questions, new_answers = context.load_payload(newer_raw, answer_raw)
    _, new_by_id, new_scores = context.question_maps(
        newer_raw,
        answer_raw,
        new_questions,
        new_answers,
        include_correct_answer=True,
    )
    assert new_by_id["math/q1"]["content"] == "new wording"
    assert new_scores == {"math/q1": 4.0}


def test_teacher_student_profile_decodes_one_snapshot_for_all_answer_rows(
    web_client: TestClient,
    tmp_path: Path,
    monkeypatch,
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
    assert imported.status_code == 200
    student_id = imported.json()["students"][0]["id"]
    _write_exam(tmp_path)
    teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        headers=teacher,
        json={"class_ids": [class_id]},
    ).json()["publication"]
    with connect(default_platform_root()) as con:
        attempt = con.execute(
            "SELECT id, question_payload_json FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (publication["id"], student_id),
        ).fetchone()
        attempt_id = str(attempt["id"])
        question_json = str(attempt["question_payload_json"])
        con.execute(
            "UPDATE student_attempts SET status='submitted', score=6, max_score=10, time_spent_seconds=300, grading_completed_at='2026-09-18' WHERE id=?",
            (attempt_id,),
        )
        con.executemany(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES (?, ?, ?, ?, ?, ?, 'reviewed', '2026-09-18')",
            [
                ("answer-one", attempt_id, "math/q1", '{"answer":"work"}', 0, 1.5),
                ("answer-two", attempt_id, "math/q2", '{"answer":"work"}', 1, 4.5),
            ],
        )

    calls = 0
    original_loads = json.loads

    def counted_loads(value, *args, **kwargs):
        nonlocal calls
        if value == question_json:
            calls += 1
        return original_loads(value, *args, **kwargs)

    monkeypatch.setattr(frozen_question_reads.json, "loads", counted_loads)

    class UncachedProfileContext:
        def question_count(self, raw_questions):
            value = counted_loads(str(raw_questions or "[]"))
            return len(value) if isinstance(value, list) else 0

        def first_question(self, raw_questions, question_id):
            value = counted_loads(str(raw_questions or "[]"))
            if not isinstance(value, list):
                return None
            return next(
                (
                    item
                    for item in value
                    if isinstance(item, dict) and str(item.get("question_id") or "") == question_id
                ),
                None,
            )

        @staticmethod
        def first_answer_key(_raw_answers, _question_id):
            return False, None

    original_context_type = teacher_queries.FrozenQuestionReadContext
    monkeypatch.setattr(teacher_queries, "FrozenQuestionReadContext", UncachedProfileContext)
    baseline = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile",
        headers=teacher,
    )
    assert baseline.status_code == 200, baseline.text
    assert calls == 3

    monkeypatch.setattr(teacher_queries, "FrozenQuestionReadContext", original_context_type)
    calls = 0
    response = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile",
        headers=teacher,
    )
    assert response.status_code == 200, response.text
    profile = response.json()["profile"]
    assert profile["summary"]["average_score_percent"] == 60
    assert profile["weak_questions"][0]["question_id"] == "math/q1"
    assert profile["weak_questions"][0]["average_score_percent"] == 30
    assert calls == 1


def test_profile_splits_only_changed_question_definitions_after_republication(
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
    assert imported.status_code == 200
    student_id = imported.json()["students"][0]["id"]
    _write_exam(tmp_path)
    teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    paper_id = paper["paper_id"]
    first_publication = web_client.post(
        f"/api/papers/{paper_id}/publish",
        headers=teacher,
        json={"class_ids": [class_id]},
    ).json()["publication"]

    root = default_platform_root()
    with connect(root) as con:
        old_attempt = con.execute(
            "SELECT id, question_payload_json FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (first_publication["id"], student_id),
        ).fetchone()
        old_attempt_id = str(old_attempt["id"])
        old_question_snapshot = str(old_attempt["question_payload_json"])
        con.execute(
            "UPDATE student_attempts SET status='submitted', score=5, max_score=10, started_at='2026-01-01', submitted_at='2026-01-01', grading_completed_at='2026-01-01' WHERE id=?",
            (old_attempt_id,),
        )
        con.executemany(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES (?, ?, ?, '{\"answer\":\"work\"}', 0, ?, 'reviewed', '2026-01-01')",
            [
                ("old-q1-answer", old_attempt_id, "math/q1", 2.5),
                ("old-q2-answer", old_attempt_id, "math/q2", 2.5),
            ],
        )

    revoked = web_client.delete(
        f"/api/papers/{paper_id}/publications/{first_publication['id']}",
        headers=teacher,
    )
    assert revoked.status_code == 200

    question_path = tmp_path / "resource" / "math" / "q1.yaml"
    question = yaml.safe_load(question_path.read_text(encoding="utf-8"))
    question["content"] = "Revised wording for 1+1"
    question_path.write_text(yaml.safe_dump(question, allow_unicode=True, sort_keys=False), encoding="utf-8")
    exam_path = tmp_path / "exams" / "midterm" / "Math" / "exam.yaml"
    exam = yaml.safe_load(exam_path.read_text(encoding="utf-8"))
    exam["selected_items"] = [
        {"section_id": "Revised", "question_ids": ["math/q1"], "score_per_item": 10.0},
        {"section_id": "Choice", "question_ids": ["math/q2"], "score_per_item": 5.0},
    ]
    exam_path.write_text(yaml.safe_dump(exam, allow_unicode=True, sort_keys=False), encoding="utf-8")

    second_publication_response = web_client.post(
        f"/api/papers/{paper_id}/publish",
        headers=teacher,
        json={"class_ids": [class_id]},
    )
    assert second_publication_response.status_code == 200, second_publication_response.text
    second_publication = second_publication_response.json()["publication"]
    with connect(root) as con:
        new_attempt = con.execute(
            "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
            (second_publication["id"], student_id),
        ).fetchone()
        new_attempt_id = str(new_attempt["id"])
        con.execute(
            "UPDATE student_attempts SET status='submitted', score=2.5, max_score=15, started_at='2026-02-01', submitted_at='2026-02-01', grading_completed_at='2026-02-01' WHERE id=?",
            (new_attempt_id,),
        )
        con.executemany(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at) VALUES (?, ?, ?, '{\"answer\":\"work\"}', 0, ?, 'reviewed', '2026-02-01')",
            [
                ("new-q1-answer", new_attempt_id, "math/q1", 0.0),
                ("new-q2-answer", new_attempt_id, "math/q2", 2.5),
            ],
        )
        preserved = con.execute(
            "SELECT sa.question_payload_json, ans.question_id, ans.score FROM student_attempts sa JOIN student_answers ans ON ans.attempt_id = sa.id WHERE sa.id = ? ORDER BY ans.question_id",
            (old_attempt_id,),
        ).fetchall()
    assert all(str(row["question_payload_json"]) == old_question_snapshot for row in preserved)
    assert [(row["question_id"], row["score"]) for row in preserved] == [
        ("math/q1", 2.5),
        ("math/q2", 2.5),
    ]

    profile_response = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile",
        headers=teacher,
    )
    assert profile_response.status_code == 200, profile_response.text
    weak_questions = profile_response.json()["profile"]["weak_questions"]
    q1_versions = sorted(
        (item for item in weak_questions if item["question_id"] == "math/q1"),
        key=lambda item: item["question_version"],
    )
    assert len(q1_versions) == 2
    assert [(item["content"], item["average_score_percent"]) for item in q1_versions] == [
        ("1+1=?", 50.0),
        ("Revised wording for 1+1", 0.0),
    ]
    assert [item["question_version_label"] for item in q1_versions] == ["历史版本 1", "历史版本 2"]
    assert all(item["question_version_count"] == 2 for item in q1_versions)

    q2_rows = [item for item in weak_questions if item["question_id"] == "math/q2"]
    assert len(q2_rows) == 1
    assert q2_rows[0]["attempt_count"] == 2
    assert q2_rows[0]["question_version_count"] == 1
    assert q2_rows[0]["question_version_label"] is None

    with connect(root) as con:
        con.execute(
            "UPDATE student_attempts SET question_payload_json=NULL, answer_key_json=NULL WHERE id=?",
            (new_attempt_id,),
        )
    legacy_profile = web_client.get(
        f"/api/teacher/classes/{class_id}/students/{student_id}/profile",
        headers=teacher,
    ).json()["profile"]
    legacy_q1 = next(item for item in legacy_profile["weak_questions"] if item["question_id"] == "math/q1" and item["question_version"] is None)
    assert legacy_q1["question_version_label"] == "历史题目内容不可用"


def test_question_definition_fingerprint_covers_group_material_but_ignores_analysis() -> None:
    base = {
        "question_id": "math/group/q1",
        "header": "阅读题",
        "type": "group",
        "content": "共享材料甲",
        "score_per_item": 5,
        "analysis": "解析甲",
    }
    base_key = _weak_question_definition_key(base, answer_key_known=False, answer_key=None)
    assert base_key is not None
    assert _weak_question_definition_key(
        {**base, "analysis": "解析乙"}, answer_key_known=False, answer_key=None
    ) == base_key
    assert _weak_question_definition_key(
        {**base, "content": "共享材料乙"}, answer_key_known=False, answer_key=None
    ) != base_key


def test_submission_reads_fill_missing_questions_without_publishing_student_results(
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
    assert imported.status_code == 200
    student = imported.json()["students"][0]
    _write_exam(tmp_path)
    teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        headers=teacher,
        json={"class_ids": [class_id], "show_results_immediately": True},
    ).json()["publication"]
    with connect(default_platform_root()) as con:
        attempt_id = str(
            con.execute(
                "SELECT id FROM student_attempts WHERE publication_id = ? AND student_id = ?",
                (publication["id"], student["id"]),
            ).fetchone()["id"]
        )
        con.execute(
            "UPDATE student_attempts SET status='submitted', started_at='2026-01-01', submitted_at='2026-01-01' WHERE id=?",
            (attempt_id,),
        )
        con.execute(
            "INSERT INTO student_answers (id, attempt_id, question_id, answer_payload, grading_status, responded_at) VALUES ('only-q1-answer', ?, 'math/q1', '{\"answer\":\"work\"}', 'pending', '2026-01-01')",
            (attempt_id,),
        )

    submissions = web_client.get(f"/api/papers/{paper['paper_id']}/submissions", headers=teacher)
    assert submissions.status_code == 200
    submission = submissions.json()["submissions"][0]
    assert [answer["question_id"] for answer in submission["answers"]] == ["math/q1", "math/q2"]
    missing = submission["answers"][1]
    assert missing["answer"] is None
    assert missing["score"] is None
    assert missing["content"] == "2+2=?"

    student_login = web_client.post(
        "/api/auth/login",
        json={"username": student["account_username"], "password": student["initial_password"]},
    )
    student_headers = _headers(student_login.json()["token"])
    result = web_client.get("/api/student/results", headers=student_headers).json()["results"][0]
    assert result["score"] is None
    assert result["answers"] == []

    analysis = web_client.get(
        f"/api/papers/{paper['paper_id']}/analysis?publication_id={publication['id']}",
        headers=teacher,
    ).json()["analysis"]
    assert analysis["summary"]["average_score"] is None


def test_analysis_reports_preserve_six_argument_question_map_callbacks(tmp_path: Path) -> None:
    from solaire.web.platform_db import init_platform_db

    init_platform_db(tmp_path)
    question = {"question_id": "q1", "header": "1", "section_id": "Choice", "score_per_item": 1}
    callback_args: list[tuple[object, ...]] = []

    def six_argument_question_maps(root, project_root, paper, user, publication_id, class_id):
        callback_args.append((root, project_root, paper, user, publication_id, class_id))
        return [question], {"q1": question}, {"q1": 1.0}

    common = {
        "root": tmp_path,
        "project_root": tmp_path,
        "paper": {"id": "paper"},
        "user": {"role": "teacher"},
        "question_maps_fn": six_argument_question_maps,
        "attempt_clause_fn": lambda *_args, **_kwargs: ("1=1", []),
        "json_payload_fn": lambda _value: {},
        "risk_level_fn": lambda _value: "no_data",
        "read_context": None,
    }
    modules = paper_analysis.build_module_report(
        **common,
        paper_id="paper",
        students=[],
        average_score=None,
    )
    questions = paper_analysis.build_question_report(**common, paper_id="paper")
    assert modules[0]["question_ids"] == ["q1"]
    assert questions[0]["question_id"] == "q1"
    assert [len(args) for args in callback_args] == [6, 6]


def test_analysis_reports_share_answers_when_grading_changes_during_the_request(web_client, tmp_path, monkeypatch):
    admin = _bootstrap_admin(web_client)
    _, _, class_id = _create_school_teacher_class(web_client, admin)
    school = _headers(web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"}).json()["token"])
    student = web_client.post("/api/school/students/import", headers=school, json={
        "class_id": class_id, "students": [{"student_no": "S001", "display_name": "Student"}],
    }).json()["students"][0]
    _write_exam(tmp_path)
    teacher = _headers(_teacher_token(web_client))
    paper = web_client.get("/api/papers", headers=teacher).json()["papers"][0]
    publication = web_client.post(f"/api/papers/{paper['paper_id']}/publish", headers=teacher, json={"class_ids": [class_id]}).json()["publication"]
    root = default_platform_root()
    with connect(root) as con:
        attempt_id = con.execute("SELECT id FROM student_attempts WHERE publication_id=? AND student_id=?", (publication["id"], student["id"])).fetchone()[0]
        con.execute("UPDATE student_attempts SET score=3, max_score=10 WHERE id=?", (attempt_id,))
        con.execute("INSERT INTO student_answers(id, attempt_id, question_id, answer_payload, score, is_correct, responded_at) VALUES ('answer', ?, 'math/q1', '{\"text\":\"A\"}', 3, 0, '2026-01-01')", (attempt_id,))

    statements = []
    for module in (paper_service, paper_analysis):
        original_connect = module.connect
        def traced(path, original=original_connect):
            con = original(path)
            con.set_trace_callback(statements.append)
            return con
        monkeypatch.setattr(module, "connect", traced)
    original_module_report = paper_service._build_module_report
    def grade_after_modules(*args, **kwargs):
        result = original_module_report(*args, **kwargs)
        with connect(root) as con:
            con.execute("UPDATE student_answers SET score=4 WHERE id='answer'")
            con.execute("UPDATE student_attempts SET score=4 WHERE id=?", (attempt_id,))
        return result
    monkeypatch.setattr(paper_service, "_build_module_report", grade_after_modules)
    response = web_client.get(f"/api/papers/{paper['paper_id']}/analysis?publication_id={publication['id']}", headers=teacher)
    assert response.status_code == 200, response.text
    analysis = response.json()["analysis"]
    question = next(item for item in analysis["questions"] if item["question_id"] == "math/q1")
    assert question["average_score_percent"] == analysis["modules"][0]["average_score_percent"] == 60
    assert analysis["classes"][0]["average_score"] == 30
    answer_reads = [sql for sql in statements if "FROM student_answers ans" in sql]
    assert len(answer_reads) == 1
    assert not any("SELECT sa.question_payload_json FROM student_attempts" in sql for sql in statements)
