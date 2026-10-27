from __future__ import annotations

import json
from contextlib import closing

import yaml
from PIL import Image
import pytest

from solaire.web.learning_progress.comparison import get_practice_comparison
from solaire.web.papers.student_sessions import _ensure_assigned_attempt
from solaire.web.platform_db import connect, default_platform_root, init_platform_db
from solaire.web.routers.learning_progress import _teacher_scope
from solaire.web.school.transfers import transfer_student_class
from solaire.web.student_service import ensure_student_resource_access
from tests.test_platform_student_api import (
    _bootstrap_admin,
    _create_teacher_class_student,
    _headers,
    _school_headers,
    _teacher_headers,
    _write_online_exam,
)


def test_student_keeps_old_assignment_and_gets_new_ordinary_class_release(
    web_client, tmp_path, monkeypatch,
) -> None:
    monkeypatch.setenv("SOLAIRE_PUBLIC_MODE", "1")
    admin_token = _bootstrap_admin(web_client)
    school_headers, _school_id = _school_headers(web_client, admin_token)
    old_class_id, student_account = _create_teacher_class_student(web_client, school_headers)
    new_class_response = web_client.post(
        "/api/school/classes",
        json={"name": "Class 2", "grade": "G10"},
        headers=school_headers,
    )
    assert new_class_response.status_code == 200
    new_class_id = str(new_class_response.json()["class"]["id"])

    platform_root = default_platform_root()
    with closing(connect(platform_root)) as con:
        teacher_id = str(con.execute("SELECT id FROM users WHERE username='teacher_li'").fetchone()["id"])
    assigned = web_client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher_id, "class_id": new_class_id},
        headers=school_headers,
    )
    assert assigned.status_code == 200

    _write_online_exam(tmp_path)
    question_path = tmp_path / "resource" / "math" / "q1.yaml"
    question = yaml.safe_load(question_path.read_text(encoding="utf-8"))
    question["content"] += " :::EMBED_IMG:数学/默认/image/page.png:::"
    question_path.write_text(yaml.safe_dump(question, allow_unicode=True), encoding="utf-8")
    image_dir = tmp_path / "resource" / "数学" / "默认" / "image"
    image_dir.mkdir(parents=True)
    Image.new("RGB", (10, 10)).save(image_dir / "page.png")

    teacher_headers = _teacher_headers(web_client)
    paper = web_client.get("/api/papers", headers=teacher_headers).json()["papers"][0]
    old_publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [old_class_id], "title": "Earlier Class Release"},
        headers=teacher_headers,
    )
    assert old_publication.status_code == 200
    old_publication_id = str(old_publication.json()["publication"]["id"])
    new_publication = web_client.post(
        f"/api/papers/{paper['paper_id']}/publish",
        json={"class_ids": [new_class_id], "title": "Later Class Release"},
        headers=teacher_headers,
    )
    assert new_publication.status_code == 200
    new_publication_id = str(new_publication.json()["publication"]["id"])

    login = web_client.post("/api/auth/login", json=student_account)
    student_headers = _headers(str(login.json()["token"]))
    before = web_client.get("/api/student/papers", headers=student_headers)
    assert before.status_code == 200
    before_papers = before.json()["papers"]
    assert [paper["publication_id"] for paper in before_papers] == [old_publication_id]
    old_attempt_id = str(before_papers[0]["attempt_id"])
    started = web_client.post(
        f"/api/student/publications/{old_publication_id}/start",
        headers=student_headers,
    )
    assert started.status_code == 200
    assert started.json()["attempt"]["id"] == old_attempt_id
    image_url = "/api/resource/数学/默认/image/page.png"
    assert web_client.get(image_url, headers=student_headers).status_code == 200

    with closing(connect(platform_root)) as con:
        student_id = str(con.execute(
            "SELECT s.id FROM students s JOIN users u ON u.id=s.user_id WHERE u.username=?",
            (student_account["username"],),
        ).fetchone()["id"])
    preview = web_client.get(f"/api/school/students/{student_id}/class-transfer", headers=school_headers)
    assert preview.status_code == 200
    student_id = str(preview.json()["student"]["id"])
    assert preview.json()["legacy_attempt_count"] == 0
    transfer = web_client.post(
        f"/api/school/students/{student_id}/class-transfer",
        json={"target_class_id": new_class_id, "expected_class_ids": [old_class_id]},
        headers=school_headers,
    )
    assert transfer.status_code == 200
    assert transfer.json()["changed"] is True

    after = web_client.get("/api/student/papers", headers=student_headers)
    assert after.status_code == 200
    after_by_publication = {paper["publication_id"]: paper for paper in after.json()["papers"]}
    assert set(after_by_publication) == {old_publication_id, new_publication_id}
    assert after_by_publication[old_publication_id]["attempt_id"] == old_attempt_id
    assert after_by_publication[new_publication_id]["status"] == "not_started"
    resumed = web_client.post(
        f"/api/student/publications/{old_publication_id}/start",
        headers=student_headers,
    )
    assert resumed.status_code == 200
    assert resumed.json()["attempt"]["id"] == old_attempt_id
    assert web_client.get(image_url, headers=student_headers).status_code == 200
    revoked = web_client.delete(
        f"/api/papers/{paper['paper_id']}/publications/{old_publication_id}",
        headers=teacher_headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["publication"]["status"] == "revoked"
    assert web_client.get(image_url, headers=student_headers).status_code == 403

    with closing(connect(platform_root)) as con:
        snapshots = {
            (str(row["publication_id"]), str(row["class_id"])): int(row["class_membership_frozen"])
            for row in con.execute(
                """SELECT sa.publication_id, sa.class_membership_frozen, acs.class_id
                   FROM student_attempts sa JOIN attempt_class_snapshots acs ON acs.attempt_id=sa.id
                   WHERE sa.student_id=?""",
                (student_id,),
            ).fetchall()
        }
    assert snapshots == {
        (old_publication_id, old_class_id): 1,
        (new_publication_id, new_class_id): 1,
    }


def test_class_comparison_and_teacher_scope_follow_legacy_attempt_cohort_after_transfer(tmp_path) -> None:
    init_platform_db(tmp_path)
    with closing(connect(tmp_path)) as con, con:
        con.executemany(
            """INSERT INTO schools (id,name,status,created_at,updated_at)
               VALUES (?,?,'active','2026-10-01','2026-10-01')""",
            [("sch-1", "School 1")],
        )
        con.executemany(
            """INSERT INTO users (id,school_id,username,password_hash,role,display_name,status,created_at,updated_at)
               VALUES (?,?,?,'hash',?,?,'active','2026-10-01','2026-10-01')""",
            [
                ("u-school", "sch-1", "school1", "school", "School Admin"),
                ("u-owner", "sch-1", "owner", "teacher", "Owner"),
                ("u-old-teacher", "sch-1", "old-teacher", "teacher", "Old Teacher"),
                ("u-new-teacher", "sch-1", "new-teacher", "teacher", "New Teacher"),
                ("u-student", "sch-1", "student1", "student", "Student 1"),
            ],
        )
        con.executemany(
            """INSERT INTO classes (id,school_id,name,grade,created_at,updated_at)
               VALUES (?, 'sch-1', ?, 'G10','2026-10-01','2026-10-01')""",
            [("cls-old", "Class 1"), ("cls-new", "Class 2")],
        )
        con.execute(
            """INSERT INTO students (id,school_id,user_id,student_no,display_name,status,created_at,updated_at)
               VALUES ('stu-1','sch-1','u-student','S001','Student 1','active','2026-10-01','2026-10-01')"""
        )
        con.execute("INSERT INTO class_students (class_id,student_id) VALUES ('cls-old','stu-1')")
        con.executemany(
            "INSERT INTO teacher_class_assignments (teacher_id,class_id,subject) VALUES (?,?,'Math')",
            [("u-old-teacher", "cls-old"), ("u-new-teacher", "cls-new")],
        )
        con.execute(
            """INSERT INTO paper_records (id,exam_id,title,subject,owner_teacher_id,school_id,created_at,updated_at)
               VALUES ('paper-1','practice/exam','Practice','Math','u-owner','sch-1','2026-10-01','2026-10-01')"""
        )
        con.execute(
            """INSERT INTO exam_publications (id,paper_id,teacher_id,title,status,show_results_immediately,created_at,updated_at)
               VALUES ('pub-1','paper-1','u-owner','Practice','closed',1,'2026-10-01','2026-10-01')"""
        )
        con.executemany(
            "INSERT INTO publication_classes (publication_id,class_id) VALUES ('pub-1',?)",
            [("cls-old",), ("cls-new",)],
        )
        payload = json.dumps([{
            "question_id": "prac-q1",
            "knowledge_node_ids": ["math/fractions"],
            "score_per_item": 2.0,
        }])
        con.execute(
            """INSERT INTO student_attempts
               (id,publication_id,student_id,status,question_payload_json,grading_completed_at)
               VALUES ('att-1','pub-1','stu-1','submitted',?,'2026-10-01T11:00:00Z')""",
            (payload,),
        )
        con.execute(
            """INSERT INTO student_answers
               (id,attempt_id,question_id,answer_payload,score,is_correct,grading_status,responded_at)
               VALUES ('ans-1','att-1','prac-q1','{}',1,0,'graded','2026-10-01T10:00:00Z')"""
        )
        con.execute(
            """INSERT INTO paper_records
               (id,exam_id,title,subject,owner_teacher_id,school_id,created_at,updated_at)
               VALUES ('paper-empty','prior/exam','Prior Practice','Science','u-owner','sch-1',
                       '2026-10-01','2026-10-01')"""
        )
        con.execute(
            """INSERT INTO exam_publications
               (id,paper_id,teacher_id,title,status,show_results_immediately,created_at,updated_at)
               VALUES ('pub-empty','paper-empty','u-owner','Earlier Assignment','closed',1,
                       '2026-10-01','2026-10-01')"""
        )
        con.execute("INSERT INTO publication_classes (publication_id,class_id) VALUES ('pub-empty','cls-old')")
        empty_snapshot_payload = json.dumps([{
            "question_id": "old-q1",
            "type": "short_answer",
            "content": "Question with an image :::IMG:transfer.png:::",
            "score_per_item": 1.0,
        }])
        con.execute(
            """INSERT INTO student_attempts
               (id,publication_id,student_id,status,question_payload_json,grading_completed_at)
               VALUES ('att-empty','pub-empty','stu-1','submitted',?,'2026-10-01T11:00:00Z')""",
            (empty_snapshot_payload,),
        )
        # The old association is no longer visible from current publication metadata.
        con.execute("DELETE FROM publication_classes WHERE publication_id='pub-empty'")

    transfer = transfer_student_class(
        tmp_path,
        school_id="sch-1",
        student_id="stu-1",
        target_class_id="cls-new",
        expected_class_ids=["cls-old"],
        actor_id="u-school",
    )
    assert transfer["captured_legacy_attempt_count"] == 2

    with closing(connect(tmp_path)) as con, con:
        con.execute(
            """INSERT INTO exam_publications
               (id,paper_id,teacher_id,title,status,recipient_scope,show_results_immediately,created_at,updated_at)
               VALUES ('pub-fixed','paper-1','u-owner','Assigned Only','published','student',1,
                       '2026-10-01','2026-10-01')"""
        )
        con.execute("INSERT INTO publication_classes (publication_id,class_id) VALUES ('pub-fixed','cls-new')")
    with pytest.raises(PermissionError, match="No personalized practice assigned"):
        _ensure_assigned_attempt(tmp_path, "pub-fixed", "stu-1")
    with closing(connect(tmp_path)) as con:
        assert con.execute(
            "SELECT 1 FROM student_attempts WHERE publication_id='pub-fixed' AND student_id='stu-1'"
        ).fetchone() is None

    restored = _ensure_assigned_attempt(tmp_path, "pub-empty", "stu-1")
    assert restored["id"] == "att-empty"
    project_root = tmp_path / "workspace"
    resource = project_root / "resource" / "transfer.png"
    resource.parent.mkdir(parents=True)
    Image.new("RGB", (10, 10)).save(resource)
    ensure_student_resource_access(
        tmp_path,
        project_root,
        {"id": "u-student", "role": "student"},
        resource,
    )
    with closing(connect(tmp_path)) as con:
        empty_attempt = con.execute(
            "SELECT class_membership_frozen FROM student_attempts WHERE id='att-empty'"
        ).fetchone()
        empty_snapshots = con.execute(
            "SELECT COUNT(*) FROM attempt_class_snapshots WHERE attempt_id='att-empty'"
        ).fetchone()[0]
    assert int(empty_attempt["class_membership_frozen"]) == 1
    assert int(empty_snapshots) == 0

    old_class = get_practice_comparison(
        tmp_path, None, practice_publication_id="pub-1", class_id="cls-old", include_unreleased=True,
    )
    new_class = get_practice_comparison(
        tmp_path, None, practice_publication_id="pub-1", class_id="cls-new", include_unreleased=True,
    )
    assert set(old_class["student_comparisons"]) == {"stu-1"}
    assert new_class["student_comparisons"] == {}

    with closing(connect(tmp_path)) as con:
        old_teacher_students = _teacher_scope(
            con,
            "pub-1",
            {"id": "u-old-teacher", "role": "teacher", "school_id": "sch-1"},
            "cls-old",
        )
        new_teacher_students = _teacher_scope(
            con,
            "pub-1",
            {"id": "u-new-teacher", "role": "teacher", "school_id": "sch-1"},
            "cls-new",
        )
    assert old_teacher_students == {"stu-1"}
    assert new_teacher_students == set()

    with closing(connect(tmp_path)) as con, con:
        con.execute("DELETE FROM classes WHERE id IN ('cls-old','cls-new')")
        school_admin_students = _teacher_scope(
            con,
            "pub-1",
            {"id": "u-school", "role": "school", "school_id": "sch-1"},
            "cls-old",
        )
    assert school_admin_students == {"stu-1"}
    after_class_deletion = get_practice_comparison(
        tmp_path, None, practice_publication_id="pub-1", class_id="cls-old", include_unreleased=True,
    )
    assert set(after_class_deletion["student_comparisons"]) == {"stu-1"}
    assert _ensure_assigned_attempt(tmp_path, "pub-1", "stu-1")["id"] == "att-1"
