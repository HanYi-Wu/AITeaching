from __future__ import annotations

from contextlib import closing
import json

import pytest

from solaire.web import paper_service
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.organization import delete_class
from solaire.web.school.transfers import transfer_student_class


@pytest.fixture
def paper_database(tmp_path):
    root = tmp_path / "platform"
    project_root = tmp_path / "project"
    project_root.mkdir()
    init_platform_db(root)
    questions = json.dumps(
        [
            {
                "question_id": "math/q1",
                "section_id": "Math",
                "score_per_item": 10,
                "type": "short_answer",
                "header": "Question 1",
                "content": "A frozen prompt",
            }
        ],
        ensure_ascii=False,
    )
    with closing(connect(root)) as con, con:
        con.executemany(
            "INSERT INTO schools (id,name,created_at,updated_at) VALUES (?,?,'now','now')",
            [("school", "School"), ("outside-school", "Outside School")],
        )
        con.executemany(
            "INSERT INTO users (id,school_id,role,username,password_hash,display_name,created_at,updated_at) "
            "VALUES (?,?,? ,?,'unused',?,'now','now')",
            [
                ("teacher", "school", "teacher", "teacher", "Teacher"),
                ("other-teacher", "school", "teacher", "other-teacher", "Other Teacher"),
                ("school-admin", "school", "school", "school-admin", "School Admin"),
            ],
        )
        con.executemany(
            "INSERT INTO classes (id,school_id,name,grade,created_at,updated_at) VALUES (?,'school',?,'G9','now','now')",
            [("class-a", "Class, A"), ("class-b", "Class B"), ("class-c", "Class C")],
        )
        con.executemany(
            "INSERT INTO students (id,school_id,student_no,display_name,created_at,updated_at) "
            "VALUES (?, 'school', ?, ?, 'now','now')",
            [("student-a", "A01", "Student A"), ("student-b", "B01", "Student B")],
        )
        con.executemany(
            "INSERT INTO class_students (class_id,student_id) VALUES (?,?)",
            [("class-a", "student-a"), ("class-b", "student-b")],
        )
        con.execute(
            "INSERT INTO paper_records (id,exam_id,title,subject,delivery_mode,owner_teacher_id,school_id,status,created_at,updated_at) "
            "VALUES ('paper','bench/Exam','Exam','Math','online','teacher','school','published','now','now')"
        )
        con.execute(
            "INSERT INTO exam_publications (id,paper_id,teacher_id,title,recipient_scope,status,created_at,updated_at) "
            "VALUES ('publication','paper','teacher','Exam','class','published','now','now')"
        )
        con.executemany(
            "INSERT INTO publication_classes (publication_id,class_id) VALUES ('publication',?)",
            [("class-a",), ("class-b",)],
        )
        for student_id, class_id, class_name, student_no, display_name in [
            ("student-a", "class-a", "Class, A", "A01", "Student A"),
            ("student-b", "class-b", "Class B", "B01", "Student B"),
        ]:
            attempt_id = f"attempt-{student_id}"
            con.execute(
                "INSERT INTO student_attempts (id,publication_id,student_id,status,started_at,submitted_at,score,max_score,time_spent_seconds,question_payload_json,answer_key_json,question_payload_version,class_membership_frozen) "
                "VALUES (?,'publication',?,'submitted','start','submit',8,10,600,?,'{}',3,1)",
                (attempt_id, student_id, questions),
            )
            con.execute(
                "INSERT INTO attempt_class_snapshots (attempt_id,class_id,class_name,class_grade,captured_at,source) "
                "VALUES (?,?,?,'G9','assignment','assignment')",
                (attempt_id, class_id, class_name),
            )
            con.execute(
                "INSERT INTO student_answers (id,attempt_id,question_id,answer_payload,is_correct,score,grading_status,responded_at) "
                "VALUES (?,?,'math/q1','{}',1,8,'graded','now')",
                (f"answer-{student_id}", attempt_id),
            )
    return root, project_root


def _analysis(root, project_root, *, user=None, class_id=None):
    return paper_service.analyze_paper(
        root,
        paper_id="paper",
        user=user or {"role": "admin"},
        project_root=project_root,
        publication_id="publication",
        class_id=class_id,
    )


def test_student_class_names_use_attempt_snapshot_and_keep_commas(paper_database):
    root, project_root = paper_database

    analysis = _analysis(root, project_root)

    students = {row["student_no"]: row for row in analysis["students"]}
    assert students["A01"]["class_names"] == ["Class, A"]
    assert students["B01"]["class_names"] == ["Class B"]
    assert [(row["class_name"], row["student_count"]) for row in analysis["classes"]] == [
        ("Class B", 1),
        ("Class, A", 1),
    ]


def test_student_class_names_survive_transfer_and_source_class_deletion(paper_database):
    root, project_root = paper_database
    transfer_student_class(
        root,
        school_id="school",
        student_id="student-a",
        target_class_id="class-c",
        expected_class_ids=["class-a"],
        actor_id="school-admin",
    )
    delete_class(root, school_id="school", class_id="class-a")

    analysis = _analysis(root, project_root)

    students = {row["student_no"]: row for row in analysis["students"]}
    assert students["A01"]["class_names"] == ["Class, A"]
    assert students["B01"]["class_names"] == ["Class B"]
    historical_class = next(row for row in analysis["classes"] if row["class_id"] == "class-a")
    assert historical_class["class_name"] == "Class, A"
    assert historical_class["student_count"] == 1


def test_empty_frozen_and_legacy_multiple_memberships_are_reported_as_saved(paper_database):
    root, project_root = paper_database
    with closing(connect(root)) as con, con:
        con.execute(
            "INSERT INTO students (id,school_id,student_no,display_name,created_at,updated_at) "
            "VALUES ('student-unknown','school','U01','Student Unknown','now','now')"
        )
        con.execute(
            "INSERT INTO student_attempts (id,publication_id,student_id,status,score,max_score,question_payload_json,answer_key_json,question_payload_version,class_membership_frozen) "
            "VALUES ('attempt-unknown','publication','student-unknown','submitted',8,10,'[]','{}',3,1)"
        )
        con.execute(
            "INSERT INTO students (id,school_id,student_no,display_name,created_at,updated_at) "
            "VALUES ('student-legacy','school','L01','Student Legacy','now','now')"
        )
        con.execute(
            "INSERT INTO student_attempts (id,publication_id,student_id,status,score,max_score,question_payload_json,answer_key_json,question_payload_version,class_membership_frozen) "
            "VALUES ('attempt-legacy','publication','student-legacy','submitted',8,10,'[]','{}',3,1)"
        )
        con.executemany(
            "INSERT INTO attempt_class_snapshots (attempt_id,class_id,class_name,class_grade,captured_at,source) "
            "VALUES ('attempt-legacy',?,?, 'G9','legacy','migration')",
            [("legacy-a", "Old A"), ("legacy-b", "Old B")],
        )

    analysis = _analysis(root, project_root)
    students = {row["student_no"]: row for row in analysis["students"]}

    assert students["U01"]["class_names"] == []
    assert students["L01"]["class_names"] == ["Old A", "Old B"]


def test_class_names_change_keeps_teacher_and_school_access_checks(paper_database):
    root, project_root = paper_database

    with pytest.raises(PermissionError, match="Teacher can only analyze own papers"):
        _analysis(root, project_root, user={"role": "teacher", "id": "other-teacher"})
    with pytest.raises(PermissionError, match="School can only analyze own papers"):
        _analysis(root, project_root, user={"role": "school", "school_id": "outside-school"})


def test_class_filtered_analysis_keeps_only_matching_attempt_proctor_events(paper_database):
    root, project_root = paper_database
    with closing(connect(root)) as con, con:
        con.executemany(
            "INSERT INTO proctor_events "
            "(id,attempt_id,student_id,publication_id,event_type,occurred_at,duration_ms,payload_json) "
            "VALUES (?,?,?,'publication','visibility_hidden',?,100,'{}')",
            [
                ("event-a-1", "attempt-student-a", "student-a", "2026-10-01T10:00:00Z"),
                ("event-a-2", "attempt-student-a", "student-a", "2026-10-01T10:01:00Z"),
                ("event-b-1", "attempt-student-b", "student-b", "2026-10-01T10:02:00Z"),
            ],
        )

    all_classes = _analysis(root, project_root)
    class_a = _analysis(root, project_root, class_id="class-a")
    class_b = _analysis(root, project_root, class_id="class-b")
    school_class_a = _analysis(
        root,
        project_root,
        user={"role": "school", "school_id": "school"},
        class_id="class-a",
    )

    assert all_classes["proctoring"]["screen_switch_count"] == 3
    assert {student["student_no"]: student["screen_switch_count"] for student in all_classes["students"]} == {
        "A01": 2,
        "B01": 1,
    }
    assert class_a["proctoring"]["screen_switch_count"] == 2
    assert [student["student_no"] for student in class_a["students"]] == ["A01"]
    assert class_a["students"][0]["screen_switch_count"] == 2
    assert class_b["proctoring"]["screen_switch_count"] == 1
    assert [student["student_no"] for student in class_b["students"]] == ["B01"]
    assert class_b["students"][0]["screen_switch_count"] == 1
    assert school_class_a["proctoring"]["screen_switch_count"] == 2

    with pytest.raises(PermissionError, match="Teacher can only analyze own papers"):
        _analysis(root, project_root, user={"role": "teacher", "id": "other-teacher"}, class_id="class-a")
    with pytest.raises(PermissionError, match="School can only analyze own papers"):
        _analysis(root, project_root, user={"role": "school", "school_id": "outside-school"}, class_id="class-a")


def test_repeated_valid_frozen_question_snapshots_reuse_score_map(paper_database, monkeypatch):
    root, project_root = paper_database
    original = paper_service._question_maps_for_attempt
    calls = 0

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(paper_service, "_question_maps_for_attempt", counted)

    analysis = _analysis(root, project_root)

    assert calls == 1
    students = {row["student_no"]: row for row in analysis["students"]}
    assert students["A01"]["max_score"] == 10
    assert students["B01"]["max_score"] == 10


@pytest.mark.parametrize("mutation", ["version", "answer_key", "different_maximum"])
def test_frozen_snapshot_cache_key_keeps_per_attempt_inputs_separate(paper_database, monkeypatch, mutation):
    root, project_root = paper_database
    if mutation == "version":
        with closing(connect(root)) as con, con:
            con.execute("UPDATE student_attempts SET question_payload_version=2 WHERE id='attempt-student-b'")
    elif mutation == "answer_key":
        with closing(connect(root)) as con, con:
            con.execute(
                "UPDATE student_attempts SET answer_key_json=? WHERE id='attempt-student-b'",
                ('{"math/q1":"different"}',),
            )
    else:
        with closing(connect(root)) as con, con:
            row = con.execute(
                "SELECT question_payload_json FROM student_attempts WHERE id='attempt-student-b'"
            ).fetchone()
            questions = json.loads(row["question_payload_json"])
            questions[0]["score_per_item"] = 7
            con.execute(
                "UPDATE student_attempts SET question_payload_json=?, score=5, max_score=7 WHERE id='attempt-student-b'",
                (json.dumps(questions, ensure_ascii=False),),
            )
            con.execute("UPDATE student_answers SET score=5 WHERE id='answer-student-b'")

    original = paper_service._question_maps_for_attempt
    calls = 0

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(paper_service, "_question_maps_for_attempt", counted)
    analysis = _analysis(root, project_root)

    assert calls == 2
    students = {row["student_no"]: row for row in analysis["students"]}
    assert students["A01"]["max_score"] == 10
    assert students["B01"]["max_score"] == (7 if mutation == "different_maximum" else 10)


@pytest.mark.parametrize("snapshot_kind", ["placeholder", "missing"])
def test_placeholder_and_missing_snapshots_still_run_fallback_for_each_attempt(
    paper_database, monkeypatch, snapshot_kind
):
    from tests.test_platform_paper_api import _write_exam

    root, project_root = paper_database
    _write_exam(project_root, label="bench", subject="Exam")
    placeholder = json.dumps(
        [
            {
                "question_id": "math/q1",
                "section_id": "Choice",
                "score_per_item": 5,
                "type": "unknown",
                "content": "math/q1",
            }
        ],
        ensure_ascii=False,
    )
    with closing(connect(root)) as con, con:
        if snapshot_kind == "placeholder":
            con.execute(
                "UPDATE student_attempts SET question_payload_json=?, max_score=5 WHERE publication_id='publication'",
                (placeholder,),
            )
            con.execute("UPDATE student_answers SET score=4 WHERE attempt_id LIKE 'attempt-student-%'")
            con.execute("UPDATE student_attempts SET score=4 WHERE publication_id='publication'")
        else:
            con.execute(
                "UPDATE student_attempts SET question_payload_json=NULL, answer_key_json=NULL WHERE publication_id='publication'"
            )

    original = paper_service._question_maps_for_attempt
    calls = 0

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(paper_service, "_question_maps_for_attempt", counted)
    analysis = _analysis(root, project_root)

    assert calls == 2
    assert {row["max_score"] for row in analysis["students"]} == {
        5 if snapshot_kind == "placeholder" else 10
    }


def test_student_rows_are_scoped_to_selected_publication(paper_database):
    root, project_root = paper_database
    with closing(connect(root)) as con, con:
        con.execute(
            "INSERT INTO students (id,school_id,student_no,display_name,created_at,updated_at) "
            "VALUES ('student-c','school','C01','Student C','now','now')"
        )
        con.execute("INSERT INTO class_students (class_id,student_id) VALUES ('class-c','student-c')")
        con.execute(
            "INSERT INTO exam_publications (id,paper_id,teacher_id,title,recipient_scope,status,created_at,updated_at) "
            "VALUES ('publication-2','paper','teacher','Exam 2','class','published','later','later')"
        )
        con.execute("INSERT INTO publication_classes (publication_id,class_id) VALUES ('publication-2','class-c')")
        con.execute(
            "INSERT INTO student_attempts (id,publication_id,student_id,status,started_at,submitted_at,score,max_score,time_spent_seconds,question_payload_json,answer_key_json,question_payload_version,class_membership_frozen) "
            "SELECT 'attempt-publication-2','publication-2','student-c',status,started_at,submitted_at,8,10,600,question_payload_json,'{}',3,1 "
            "FROM student_attempts WHERE id='attempt-student-b'"
        )
        con.execute(
            "INSERT INTO attempt_class_snapshots (attempt_id,class_id,class_name,class_grade,captured_at,source) "
            "VALUES ('attempt-publication-2','class-c','Class C at publication 2','G9','later','assignment')"
        )
        con.execute(
            "INSERT INTO student_answers (id,attempt_id,question_id,answer_payload,is_correct,score,grading_status,responded_at) "
            "VALUES ('answer-publication-2','attempt-publication-2','math/q1','{}',1,8,'graded','later')"
        )

    first = _analysis(root, project_root)
    second = paper_service.analyze_paper(
        root,
        paper_id="paper",
        user={"role": "admin"},
        project_root=project_root,
        publication_id="publication-2",
    )

    assert {row["student_no"] for row in first["students"]} == {"A01", "B01"}
    assert len(second["students"]) == 1
    assert second["students"][0]["student_no"] == "C01"
    assert second["students"][0]["class_names"] == ["Class C at publication 2"]


def test_answer_summary_from_existing_answer_rows_keeps_unscored_rule(paper_database):
    root, project_root = paper_database
    with closing(connect(root)) as con, con:
        con.execute("UPDATE student_answers SET score=NULL WHERE id='answer-student-b'")

    analysis = _analysis(root, project_root)
    students = {row["student_no"]: row for row in analysis["students"]}

    assert students["A01"]["score_percent"] == 80
    assert students["A01"]["question_scores"] == {"math/q1": 8.0}
    assert students["B01"]["score_percent"] is None
    assert students["B01"]["question_scores"] == {}


@pytest.mark.parametrize(
    ("second_payload", "expected_answered_count"),
    [
        ('{"answer":"B"}', 2),
        ("{}", 1),
        ("[]", 1),
        ("not-json", 1),
        ("", 1),
    ],
)
def test_analysis_decodes_answer_payload_once_for_both_reports(
    paper_database, monkeypatch, second_payload, expected_answered_count
):
    root, project_root = paper_database
    with closing(connect(root)) as con, con:
        con.execute(
            "UPDATE student_answers SET answer_payload=? WHERE id='answer-student-a'",
            ('{"answer":"A"}',),
        )
        con.execute(
            "UPDATE student_answers SET answer_payload=? WHERE id='answer-student-b'",
            (second_payload,),
        )

    original_json_payload = paper_service._json_payload
    decoded_payloads = []

    def counted_json_payload(value):
        decoded_payloads.append(value)
        return original_json_payload(value)

    monkeypatch.setattr(paper_service, "_json_payload", counted_json_payload)
    analysis = _analysis(root, project_root)

    assert sorted(decoded_payloads) == sorted(['{"answer":"A"}', second_payload])
    expected = expected_answered_count
    assert analysis["modules"][0]["answered_count"] == expected
    assert analysis["questions"][0]["answered_count"] == expected


def test_analysis_without_project_does_not_parse_snapshot_version_or_read_project(
    paper_database, monkeypatch
):
    root, _project_root = paper_database
    with closing(connect(root)) as con, con:
        con.execute(
            "UPDATE student_attempts SET question_payload_version='invalid-version' "
            "WHERE publication_id='publication'"
        )

    def unexpected_project_read(*args, **kwargs):
        pytest.fail("project question snapshots must not be read when project_root is None")

    monkeypatch.setattr(paper_service, "_analysis_question_maps", unexpected_project_read)
    monkeypatch.setattr(paper_service, "_question_maps_for_attempt", unexpected_project_read)

    analysis = paper_service.analyze_paper(
        root,
        paper_id="paper",
        user={"role": "admin"},
        project_root=None,
        publication_id="publication",
    )

    assert analysis["summary"]["total_students"] == 2
    assert analysis["questions"] == []
    assert analysis["modules"] == []
