from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, default_platform_root, init_platform_db
from solaire.web.school.accounts import create_school_user
from solaire.web.school.importer import import_students
from solaire.web.school.organization import create_class, create_school
from solaire.web.school.transfers import (
    StudentClassTransferConflict,
    StudentClassTransferDataError,
    StudentClassTransferNotFound,
    get_student_class_transfer_preview,
    transfer_student_class,
)


def _setup_school(root: Path, *, student_no: str, class_name: str | None = "Class A"):
    init_platform_db(root)
    school = create_school(root, name="Transfer School")
    school_id = str(school["id"])
    actor = create_school_user(
        root,
        school_id=school_id,
        username="transfer_school_admin",
        password="secret123",
        display_name="School Admin",
    )
    classes = {
        name: create_class(root, school_id=school_id, name=name, grade=f"Grade {name[-1]}")
        for name in ("Class A", "Class B", "Class C")
    }
    student = import_students(
        root,
        school_id=school_id,
        students=[{"student_no": student_no, "display_name": "Transfer Student", "class_name": class_name}],
    )["students"][0]
    return school_id, actor, classes, student


def _add_attempt(
    root: Path,
    *,
    school_id: str,
    student_id: str,
    teacher_id: str,
    suffix: str,
    class_ids: tuple[str, ...] = (),
    frozen: bool = False,
    answer: bool = False,
) -> str:
    now = utc_now()
    paper_id = f"paper_{suffix}"
    publication_id = f"publication_{suffix}"
    attempt_id = f"attempt_{suffix}"
    with closing(connect(root)) as con, con:
        con.execute(
            """INSERT INTO paper_records
               (id, exam_id, title, subject, owner_teacher_id, school_id, status, created_at, updated_at)
               VALUES (?, ?, ?, 'Math', ?, ?, 'published', ?, ?)""",
            (paper_id, f"exam_{suffix}", f"Paper {suffix}", teacher_id, school_id, now, now),
        )
        con.execute(
            """INSERT INTO exam_publications (id, paper_id, teacher_id, title, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'published', ?, ?)""",
            (publication_id, paper_id, teacher_id, f"Publication {suffix}", now, now),
        )
        con.executemany(
            "INSERT INTO publication_classes (publication_id, class_id) VALUES (?, ?)",
            [(publication_id, class_id) for class_id in class_ids],
        )
        con.execute(
            """INSERT INTO student_attempts
               (id, publication_id, student_id, status, score, max_score, class_membership_frozen)
               VALUES (?, ?, ?, 'submitted', 3.0, 5.0, ?)""",
            (attempt_id, publication_id, student_id, int(frozen)),
        )
        if answer:
            con.execute(
                """INSERT INTO student_answers
                   (id, attempt_id, question_id, answer_payload, is_correct, score, grading_status, responded_at)
                   VALUES (?, ?, 'q1', '{"answer":"A"}', 1, 3.0, 'graded', ?)""",
                (f"answer_{suffix}", attempt_id, now),
            )
        if frozen and class_ids:
            klass = con.execute("SELECT name, grade FROM classes WHERE id = ?", (class_ids[0],)).fetchone()
            con.execute(
                """INSERT INTO attempt_class_snapshots
                   (attempt_id, class_id, class_name, class_grade, captured_at, source)
                   VALUES (?, ?, ?, ?, ?, 'assignment')""",
                (attempt_id, class_ids[0], klass["name"], klass["grade"], now),
            )
    return attempt_id


def _current_memberships(root: Path, student_id: str) -> list[tuple[str, str]]:
    with closing(connect(root)) as con:
        rows = con.execute(
            """SELECT c.id, c.name FROM class_students cs JOIN classes c ON c.id = cs.class_id
               WHERE cs.student_id = ? ORDER BY c.name, c.id""",
            (student_id,),
        ).fetchall()
    return [(str(row["id"]), str(row["name"])) for row in rows]


def _add_legacy_multiple_memberships(root: Path, student_id: str, class_ids: list[str]) -> None:
    with closing(connect(root)) as con, con:
        trigger = con.execute(
            """SELECT name, sql FROM sqlite_master
               WHERE type='trigger' AND tbl_name='class_students' AND upper(sql) LIKE '%BEFORE INSERT%'"""
        ).fetchone()
        assert trigger is not None
        quoted_name = '"' + str(trigger["name"]).replace('"', '""') + '"'
        con.execute(f"DROP TRIGGER {quoted_name}")
        con.executemany(
            "INSERT INTO class_students (class_id, student_id) VALUES (?, ?)",
            [(class_id, student_id) for class_id in class_ids],
        )
        con.execute(str(trigger["sql"]))


def test_preview_and_transfer_preserve_legacy_attempts_and_account_status(tmp_path: Path) -> None:
    school_id, actor, classes, student = _setup_school(tmp_path, student_no="T001")
    visible_attempt = _add_attempt(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        teacher_id=actor["id"],
        suffix="visible",
        class_ids=(classes["Class A"]["id"],),
        answer=True,
    )
    unknown_attempt = _add_attempt(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        teacher_id=actor["id"],
        suffix="unknown",
    )
    frozen_attempt = _add_attempt(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        teacher_id=actor["id"],
        suffix="frozen",
        class_ids=(classes["Class A"]["id"],),
        frozen=True,
    )
    with closing(connect(tmp_path)) as con, con:
        con.execute("UPDATE students SET status='disabled' WHERE id=?", (student["id"],))
        con.execute("UPDATE users SET status='disabled' WHERE id=?", (student["user_id"],))
    with closing(connect(tmp_path)) as con:
        credentials_before = con.execute(
            """SELECT s.user_id, s.initial_password, u.password_hash
               FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?""",
            (student["id"],),
        ).fetchone()

    preview = get_student_class_transfer_preview(tmp_path, school_id=school_id, student_id=student["id"])
    assert set(preview) == {
        "student", "current_classes", "available_classes", "attempt_count", "legacy_attempt_count",
    }
    assert preview["student"] == {
        "id": student["id"], "student_no": "T001", "display_name": "Transfer Student",
    }
    assert preview["current_classes"] == [
        {"id": classes["Class A"]["id"], "name": "Class A", "grade": "Grade A"},
    ]
    assert {row["id"] for row in preview["available_classes"]} == {
        classes["Class A"]["id"], classes["Class B"]["id"], classes["Class C"]["id"],
    }
    assert preview["attempt_count"] == 3
    assert preview["legacy_attempt_count"] == 2

    result = transfer_student_class(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        target_class_id=classes["Class B"]["id"],
        expected_class_ids=[classes["Class A"]["id"]],
        actor_id=actor["id"],
    )
    assert set(result) == {
        "student_id", "current_class", "previous_classes", "retained_attempt_count",
        "captured_legacy_attempt_count", "changed", "transfer_id",
    }
    assert result["current_class"] == {
        "id": classes["Class B"]["id"], "name": "Class B", "grade": "Grade B",
    }
    assert result["previous_classes"] == preview["current_classes"]
    assert result["retained_attempt_count"] == 3
    assert result["captured_legacy_attempt_count"] == 2
    assert result["changed"] is True
    assert result["transfer_id"]
    assert _current_memberships(tmp_path, student["id"]) == [(classes["Class B"]["id"], "Class B")]

    with closing(connect(tmp_path)) as con:
        flags = {
            str(row["id"]): int(row["class_membership_frozen"])
            for row in con.execute(
                "SELECT id, class_membership_frozen FROM student_attempts WHERE student_id = ?",
                (student["id"],),
            ).fetchall()
        }
        snapshots = con.execute(
            "SELECT attempt_id, class_id, class_name, source FROM attempt_class_snapshots ORDER BY attempt_id"
        ).fetchall()
        answer = con.execute(
            "SELECT score, answer_payload FROM student_answers WHERE attempt_id = ?",
            (visible_attempt,),
        ).fetchone()
        account = con.execute(
            """SELECT s.status AS student_status, s.user_id, s.initial_password,
                      u.status AS account_status, u.password_hash
               FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?""",
            (student["id"],),
        ).fetchone()
        audit = con.execute(
            "SELECT * FROM student_class_transfers WHERE id = ?",
            (result["transfer_id"],),
        ).fetchone()
        historical = con.execute(
            "SELECT class_id, class_name FROM attempt_class_memberships WHERE attempt_id = ?",
            (visible_attempt,),
        ).fetchall()
    assert flags == {visible_attempt: 1, unknown_attempt: 1, frozen_attempt: 1}
    assert [(row["attempt_id"], row["class_id"], row["source"]) for row in snapshots] == [
        (frozen_attempt, classes["Class A"]["id"], "assignment"),
        (visible_attempt, classes["Class A"]["id"], "transfer_capture"),
    ]
    assert answer["score"] == 3.0
    assert json.loads(answer["answer_payload"]) == {"answer": "A"}
    assert account["student_status"] == account["account_status"] == "disabled"
    assert account["user_id"] == credentials_before["user_id"] == student["user_id"]
    assert account["initial_password"] == credentials_before["initial_password"] == student["initial_password"]
    assert account["password_hash"] == credentials_before["password_hash"]
    assert json.loads(audit["from_classes_json"]) == preview["current_classes"]
    assert audit["to_class_name"] == "Class B"
    assert int(audit["retained_attempt_count"]) == 3
    assert int(audit["captured_legacy_attempt_count"]) == 2
    assert [(row["class_id"], row["class_name"]) for row in historical] == [
        (classes["Class A"]["id"], "Class A"),
    ]

    idempotent = transfer_student_class(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        target_class_id=classes["Class B"]["id"],
        expected_class_ids=[classes["Class B"]["id"]],
        actor_id=actor["id"],
    )
    assert idempotent == {
        "student_id": student["id"],
        "current_class": result["current_class"],
        "previous_classes": [],
        "retained_attempt_count": 3,
        "captured_legacy_attempt_count": 0,
        "changed": False,
    }
    with closing(connect(tmp_path)) as con:
        assert con.execute("SELECT COUNT(*) FROM student_class_transfers").fetchone()[0] == 1


def test_empty_membership_can_be_assigned_and_unknown_history_is_frozen(tmp_path: Path) -> None:
    school_id, actor, classes, student = _setup_school(tmp_path, student_no="T002", class_name=None)
    attempt_id = _add_attempt(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        teacher_id=actor["id"],
        suffix="unlinked",
    )

    preview = get_student_class_transfer_preview(tmp_path, school_id=school_id, student_id=student["id"])
    assert preview["current_classes"] == []
    assert preview["legacy_attempt_count"] == 1

    result = transfer_student_class(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        target_class_id=classes["Class C"]["id"],
        expected_class_ids=[],
        actor_id=actor["id"],
    )
    assert result["previous_classes"] == []
    assert result["current_class"]["id"] == classes["Class C"]["id"]
    assert result["retained_attempt_count"] == 1
    assert result["captured_legacy_attempt_count"] == 1
    assert _current_memberships(tmp_path, student["id"]) == [(classes["Class C"]["id"], "Class C")]
    with closing(connect(tmp_path)) as con:
        attempt = con.execute(
            "SELECT class_membership_frozen FROM student_attempts WHERE id = ?",
            (attempt_id,),
        ).fetchone()
        snapshot_count = con.execute(
            "SELECT COUNT(*) FROM attempt_class_snapshots WHERE attempt_id = ?",
            (attempt_id,),
        ).fetchone()[0]
    assert int(attempt["class_membership_frozen"]) == 1
    assert snapshot_count == 0


def test_ambiguous_legacy_membership_can_be_explicitly_resolved_with_history(tmp_path: Path) -> None:
    school_id, actor, classes, student = _setup_school(tmp_path, student_no="T003", class_name=None)
    _add_legacy_multiple_memberships(
        tmp_path,
        student["id"],
        [classes["Class A"]["id"], classes["Class B"]["id"]],
    )
    attempt_id = _add_attempt(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        teacher_id=actor["id"],
        suffix="ambiguous",
        class_ids=(classes["Class A"]["id"], classes["Class B"]["id"]),
    )
    expected = [classes["Class A"]["id"], classes["Class B"]["id"]]

    result = transfer_student_class(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        target_class_id=classes["Class C"]["id"],
        expected_class_ids=expected,
        actor_id=actor["id"],
    )
    assert [item["id"] for item in result["previous_classes"]] == expected
    assert result["current_class"]["id"] == classes["Class C"]["id"]
    assert result["captured_legacy_attempt_count"] == 1
    assert _current_memberships(tmp_path, student["id"]) == [(classes["Class C"]["id"], "Class C")]
    with closing(connect(tmp_path)) as con:
        history = con.execute(
            "SELECT class_id, class_name FROM attempt_class_memberships WHERE attempt_id = ? ORDER BY class_name",
            (attempt_id,),
        ).fetchall()
        sources = con.execute(
            "SELECT class_id, source FROM attempt_class_snapshots WHERE attempt_id = ? ORDER BY class_id",
            (attempt_id,),
        ).fetchall()
    assert [(row["class_id"], row["class_name"]) for row in history] == [
        (classes["Class A"]["id"], "Class A"),
        (classes["Class B"]["id"], "Class B"),
    ]
    assert {str(row["class_id"]): str(row["source"]) for row in sources} == {
        classes["Class A"]["id"]: "transfer_capture",
        classes["Class B"]["id"]: "transfer_capture",
    }


def test_conflicts_scope_errors_and_audit_failure_do_not_partially_transfer(tmp_path: Path) -> None:
    school_id, actor, classes, student = _setup_school(tmp_path, student_no="T004")
    attempt_id = _add_attempt(
        tmp_path,
        school_id=school_id,
        student_id=student["id"],
        teacher_id=actor["id"],
        suffix="rollback",
        class_ids=(classes["Class A"]["id"],),
    )
    with pytest.raises(StudentClassTransferConflict):
        transfer_student_class(
            tmp_path,
            school_id=school_id,
            student_id=student["id"],
            target_class_id=classes["Class B"]["id"],
            expected_class_ids=[],
            actor_id=actor["id"],
        )
    assert _current_memberships(tmp_path, student["id"]) == [(classes["Class A"]["id"], "Class A")]

    with pytest.raises(StudentClassTransferNotFound):
        transfer_student_class(
            tmp_path,
            school_id=school_id,
            student_id=student["id"],
            target_class_id="foreign_or_unknown_class",
            expected_class_ids=[classes["Class A"]["id"]],
            actor_id=actor["id"],
        )

    foreign_school = create_school(tmp_path, name="Other Target School")
    foreign_actor = create_school_user(
        tmp_path,
        school_id=foreign_school["id"],
        username="other_transfer_admin",
        password="secret123",
        display_name="Other School Admin",
    )
    foreign_class = create_class(tmp_path, school_id=foreign_school["id"], name="Private Foreign Class")
    with pytest.raises(StudentClassTransferNotFound) as foreign_target_error:
        transfer_student_class(
            tmp_path,
            school_id=school_id,
            student_id=student["id"],
            target_class_id=foreign_class["id"],
            expected_class_ids=[classes["Class A"]["id"]],
            actor_id=actor["id"],
        )
    assert "Private Foreign Class" not in str(foreign_target_error.value)
    with pytest.raises(StudentClassTransferNotFound) as error:
        transfer_student_class(
            tmp_path,
            school_id=foreign_school["id"],
            student_id=student["id"],
            target_class_id=foreign_class["id"],
            expected_class_ids=[],
            actor_id=foreign_actor["id"],
        )
    assert "Private Foreign Class" not in str(error.value)
    with pytest.raises(StudentClassTransferNotFound) as foreign_student_error:
        get_student_class_transfer_preview(tmp_path, school_id=foreign_school["id"], student_id=student["id"])
    assert "Transfer Student" not in str(foreign_student_error.value)

    with closing(connect(tmp_path)) as con, con:
        con.execute(
            """CREATE TRIGGER fail_transfer_audit BEFORE INSERT ON student_class_transfers
               BEGIN SELECT RAISE(ABORT, 'test audit failure'); END"""
        )
    with pytest.raises(sqlite3.IntegrityError, match="test audit failure"):
        transfer_student_class(
            tmp_path,
            school_id=school_id,
            student_id=student["id"],
            target_class_id=classes["Class B"]["id"],
            expected_class_ids=[classes["Class A"]["id"]],
            actor_id=actor["id"],
        )
    assert _current_memberships(tmp_path, student["id"]) == [(classes["Class A"]["id"], "Class A")]
    with closing(connect(tmp_path)) as con:
        attempt = con.execute(
            "SELECT class_membership_frozen FROM student_attempts WHERE id = ?",
            (attempt_id,),
        ).fetchone()
        snapshots = con.execute("SELECT COUNT(*) FROM attempt_class_snapshots").fetchone()[0]
        transfers = con.execute("SELECT COUNT(*) FROM student_class_transfers").fetchone()[0]
    assert int(attempt["class_membership_frozen"]) == 0
    assert snapshots == transfers == 0


def test_foreign_current_class_link_is_rejected_without_revealing_its_name(tmp_path: Path) -> None:
    school_id, actor, classes, student = _setup_school(tmp_path, student_no="T005", class_name=None)
    foreign_school = create_school(tmp_path, name="Foreign School")
    foreign_class = create_class(
        tmp_path,
        school_id=foreign_school["id"],
        name="Foreign Secret Class Name",
    )
    with closing(connect(tmp_path)) as con, con:
        con.execute(
            "INSERT INTO class_students (class_id, student_id) VALUES (?, ?)",
            (foreign_class["id"], student["id"]),
        )

    with pytest.raises(StudentClassTransferDataError) as error:
        get_student_class_transfer_preview(tmp_path, school_id=school_id, student_id=student["id"])
    assert "Foreign Secret Class Name" not in str(error.value)
    with pytest.raises(StudentClassTransferDataError):
        transfer_student_class(
            tmp_path,
            school_id=school_id,
            student_id=student["id"],
            target_class_id=classes["Class B"]["id"],
            expected_class_ids=[foreign_class["id"]],
            actor_id=actor["id"],
        )


def _create_api_school_accounts(client: TestClient):
    admin_response = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "transfer_admin", "password": "secret123", "display_name": "Admin"},
    )
    assert admin_response.status_code == 200
    admin_headers = {"Authorization": f"Bearer {admin_response.json()['token']}"}
    school_response = client.post(
        "/api/schools",
        json={"name": "API Transfer School"},
        headers=admin_headers,
    )
    assert school_response.status_code == 200
    school_id = str(school_response.json()["school"]["id"])
    account_response = client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "api_school_admin", "password": "secret123", "display_name": "School Admin"},
        headers=admin_headers,
    )
    assert account_response.status_code == 200
    login = client.post("/api/auth/login", json={"username": "api_school_admin", "password": "secret123"})
    assert login.status_code == 200
    school_headers = {"Authorization": f"Bearer {login.json()['token']}"}
    return admin_headers, school_headers, school_id


def test_school_transfer_api_contract_and_stale_preview_conflict(web_client: TestClient, tmp_path: Path) -> None:
    admin_headers, school_headers, _school_id = _create_api_school_accounts(web_client)
    class_a = web_client.post(
        "/api/school/classes", json={"name": "API Class A", "grade": "G9"}, headers=school_headers,
    ).json()["class"]
    class_b = web_client.post(
        "/api/school/classes", json={"name": "API Class B", "grade": "G10"}, headers=school_headers,
    ).json()["class"]
    class_c = web_client.post(
        "/api/school/classes", json={"name": "API Class C", "grade": "G11"}, headers=school_headers,
    ).json()["class"]
    imported = web_client.post(
        "/api/school/students/import",
        json={"class_id": class_a["id"], "students": [{"student_no": "API001", "display_name": "API Student"}]},
        headers=school_headers,
    )
    assert imported.status_code == 200
    student_id = str(imported.json()["students"][0]["id"])
    path = f"/api/school/students/{student_id}/class-transfer"

    preview = web_client.get(path, headers=school_headers)
    assert preview.status_code == 200
    preview_body = preview.json()
    assert set(preview_body) == {
        "student", "current_classes", "available_classes", "attempt_count", "legacy_attempt_count",
    }
    assert preview_body["current_classes"][0]["id"] == class_a["id"]
    assert {item["id"] for item in preview_body["available_classes"]} >= {class_a["id"], class_b["id"]}

    transferred = web_client.post(
        path,
        json={"target_class_id": class_b["id"], "expected_class_ids": [class_a["id"]]},
        headers=school_headers,
    )
    assert transferred.status_code == 200
    body = transferred.json()
    assert set(body) == {
        "student_id", "current_class", "previous_classes", "retained_attempt_count",
        "captured_legacy_attempt_count", "changed", "transfer_id",
    }
    assert body["student_id"] == student_id
    assert body["current_class"]["id"] == class_b["id"]
    assert body["previous_classes"][0]["id"] == class_a["id"]
    assert body["changed"] is True

    stale = web_client.post(
        path,
        json={"target_class_id": class_c["id"], "expected_class_ids": [class_a["id"]]},
        headers=school_headers,
    )
    assert stale.status_code == 409
    assert "刷新" in stale.json()["detail"]
    with closing(connect(default_platform_root())) as con:
        current_class_ids = [
            str(row["class_id"])
            for row in con.execute(
                "SELECT class_id FROM class_students WHERE student_id = ?",
                (student_id,),
            ).fetchall()
        ]
    assert current_class_ids == [class_b["id"]]

    idempotent = web_client.post(
        path,
        json={"target_class_id": class_b["id"], "expected_class_ids": [class_b["id"]]},
        headers=school_headers,
    )
    assert idempotent.status_code == 200
    assert idempotent.json()["changed"] is False
    assert "transfer_id" not in idempotent.json()
    with closing(connect(default_platform_root())) as con:
        audit_count = con.execute(
            "SELECT COUNT(*) FROM student_class_transfers WHERE student_id = ?",
            (student_id,),
        ).fetchone()[0]
    assert audit_count == 1

    forbidden_admin_get = web_client.get(path, headers=admin_headers)
    forbidden_admin_post = web_client.post(
        path,
        json={"target_class_id": class_a["id"], "expected_class_ids": [class_b["id"]]},
        headers=admin_headers,
    )
    assert forbidden_admin_get.status_code == forbidden_admin_post.status_code == 403


def test_teacher_cannot_use_school_transfer_operation(web_client: TestClient) -> None:
    _admin_headers, school_headers, _school_id = _create_api_school_accounts(web_client)
    teacher = web_client.post(
        "/api/school/teachers",
        json={"username": "transfer_teacher", "password": "teacher123", "display_name": "Teacher", "subjects": ["Math"]},
        headers=school_headers,
    )
    assert teacher.status_code == 200
    login = web_client.post(
        "/api/auth/login",
        json={"username": "transfer_teacher", "password": "teacher123"},
    )
    assert login.status_code == 200
    teacher_headers = {"Authorization": f"Bearer {login.json()['token']}"}
    path = "/api/school/students/not-a-student/class-transfer"
    get_result = web_client.get(path, headers=teacher_headers)
    post_result = web_client.post(
        path,
        json={"target_class_id": "not-a-class", "expected_class_ids": []},
        headers=teacher_headers,
    )
    assert get_result.status_code == post_result.status_code == 403
