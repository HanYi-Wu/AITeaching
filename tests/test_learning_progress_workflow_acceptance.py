"""Repeatable synthetic end-to-end acceptance for the learning-progress workflow."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

import yaml
from fastapi.testclient import TestClient

from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web.app import ensure_project_layout


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _api_json(response, status_code: int = 200) -> dict:
    assert response.status_code == status_code, response.text
    return response.json()


def _create_school(
    client: TestClient,
    admin_headers: dict[str, str],
    *,
    school_name: str,
    school_username: str,
    teacher_username: str,
    class_name: str,
    student_rows: list[dict[str, str]],
) -> dict:
    school_result = _api_json(
        client.post("/api/schools", headers=admin_headers, json={"name": school_name})
    )
    school_id = str(school_result["school"]["id"])
    _api_json(
        client.post(
            f"/api/schools/{school_id}/school-users",
            headers=admin_headers,
            json={"username": school_username, "password": "SchoolPass123!", "display_name": school_name},
        )
    )
    school_login = _api_json(
        client.post(
            "/api/auth/login",
            json={"username": school_username, "password": "SchoolPass123!"},
        )
    )
    school_headers = _headers(str(school_login["token"]))

    teacher_result = _api_json(
        client.post(
            "/api/school/teachers",
            headers=school_headers,
            json={
                "username": teacher_username,
                "password": "TeacherPass123!",
                "display_name": f"{teacher_username} synthetic teacher",
                "subjects": ["Math"],
            },
        )
    )
    teacher_id = str(teacher_result["teacher"]["id"])
    class_result = _api_json(
        client.post(
            "/api/school/classes",
            headers=school_headers,
            json={"name": class_name, "grade": "G10", "subject_hint": "Math"},
        )
    )
    class_id = str(class_result["class"]["id"])
    _api_json(
        client.post(
            "/api/school/teacher-class-assignments",
            headers=school_headers,
            json={"teacher_id": teacher_id, "class_id": class_id, "subject": "Math"},
        )
    )
    imported = _api_json(
        client.post(
            "/api/school/students/import",
            headers=school_headers,
            json={"class_id": class_id, "students": student_rows},
        )
    )
    students = imported["students"]

    teacher_login = _api_json(
        client.post(
            "/api/auth/login",
            json={"username": teacher_username, "password": "TeacherPass123!"},
        )
    )
    return {
        "school_id": school_id,
        "school_headers": school_headers,
        "teacher_id": teacher_id,
        "teacher_headers": _headers(str(teacher_login["token"])),
        "class_id": class_id,
        "students": {
            str(student["student_no"]): {
                "id": str(student["id"]),
                "username": str(student["account_username"]),
                "password": str(student["initial_password"]),
            }
            for student in students
        },
    }


def _student_headers(client: TestClient, account: dict[str, str]) -> dict[str, str]:
    login = _api_json(
        client.post(
            "/api/auth/login",
            json={"username": account["username"], "password": account["password"]},
        )
    )
    return _headers(str(login["token"]))


def _add_peer_teacher(client: TestClient, school: dict) -> dict[str, str]:
    school_headers = school["school_headers"]
    teacher = _api_json(
        client.post(
            "/api/school/teachers",
            headers=school_headers,
            json={
                "username": "c21-teacher-a-peer",
                "password": "TeacherPass123!",
                "display_name": "Same-school peer teacher",
                "subjects": ["Math"],
            },
        )
    )
    class_result = _api_json(
        client.post(
            "/api/school/classes",
            headers=school_headers,
            json={"name": "C21 Peer Class", "grade": "G10", "subject_hint": "Math"},
        )
    )
    _api_json(
        client.post(
            "/api/school/teacher-class-assignments",
            headers=school_headers,
            json={
                "teacher_id": str(teacher["teacher"]["id"]),
                "class_id": str(class_result["class"]["id"]),
                "subject": "Math",
            },
        )
    )
    login = _api_json(
        client.post(
            "/api/auth/login",
            json={"username": "c21-teacher-a-peer", "password": "TeacherPass123!"},
        )
    )
    return _headers(str(login["token"]))


def _write_synthetic_source_exam(root: Path) -> str:
    ensure_project_layout(root)
    question_dir = root / "resource" / "math"
    question_dir.mkdir(parents=True, exist_ok=True)
    (question_dir / "fraction_review.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "fraction_review",
                "type": "short_answer",
                "content": "用一句话解释：分数 2/4 与 1/2 有什么关系？",
                "answer": "等值分数",
                "analysis": "分子分母同时除以 2，得到 1/2。",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    exam_id = "c21-synthetic/Math"
    exam_dir = root / "exams" / "c21-synthetic" / "Math"
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": "C21 synthetic source exam", "subject": "Math", "export_label": "c21-synthetic"},
        question_libraries=[QuestionLibraryRef(namespace="math", path="../../../resource/math")],
        template_path="templates/test.yaml",
        selected_items=[
            SelectedSection(section_id="Short answer", question_ids=["math/fraction_review"], score_per_item=4.0)
        ],
    )
    (exam_dir / "exam.yaml").write_text(
        yaml.safe_dump(exam.model_dump(mode="json"), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    return exam_id


def _manual_grade(
    client: TestClient,
    *,
    teacher_headers: dict[str, str],
    paper_id: str,
    attempt_id: str,
    score: float,
) -> None:
    response = client.patch(
        f"/api/papers/{paper_id}/attempts/{attempt_id}/answers/{quote('math/fraction_review', safe='')}/grade",
        headers=teacher_headers,
        json={"score": score, "feedback": "Synthetic rubric review", "is_correct": False},
    )
    _api_json(response)


def _complete_grading(
    client: TestClient,
    *,
    teacher_headers: dict[str, str],
    paper_id: str,
    attempt_id: str,
) -> dict:
    result = _api_json(
        client.post(
            f"/api/papers/{paper_id}/attempts/{attempt_id}/complete-grading",
            headers=teacher_headers,
        )
    )
    assert result["attempt"]["grading_completed_at"]
    return result["attempt"]


def test_synthetic_online_remediation_workflow_and_learning_progress_permissions(
    web_client: TestClient,
    tmp_path: Path,
) -> None:
    client = web_client
    admin = _api_json(
        client.post(
            "/api/auth/bootstrap-admin",
            json={"username": "c21-root", "password": "AdminPass123!", "display_name": "C21 synthetic admin"},
        )
    )
    admin_headers = _headers(str(admin["token"]))

    school_a = _create_school(
        client,
        admin_headers,
        school_name="C21 Synthetic School A",
        school_username="c21-school-a",
        teacher_username="c21-teacher-a",
        class_name="C21 Class A",
        student_rows=[
            {"student_no": "C21-A001", "display_name": "Synthetic student one"},
            {"student_no": "C21-A002", "display_name": "Synthetic student two"},
        ],
    )
    school_b = _create_school(
        client,
        admin_headers,
        school_name="C21 Synthetic School B",
        school_username="c21-school-b",
        teacher_username="c21-teacher-b",
        class_name="C21 Class B",
        student_rows=[{"student_no": "C21-B001", "display_name": "Outside synthetic student"}],
    )
    peer_teacher_headers = _add_peer_teacher(client, school_a)

    student_a1 = school_a["students"]["C21-A001"]
    student_a2 = school_a["students"]["C21-A002"]
    student_b1 = school_b["students"]["C21-B001"]
    student_a1_headers = _student_headers(client, student_a1)
    student_a2_headers = _student_headers(client, student_a2)
    student_b1_headers = _student_headers(client, student_b1)
    teacher_headers = school_a["teacher_headers"]

    exam_id = _write_synthetic_source_exam(tmp_path)
    node_id = "math/fractions/equivalent-values"
    replacement_node_id = "math/fractions/alternate-binding"
    _api_json(
        client.post(
            "/api/graph/nodes",
            headers=teacher_headers,
            json={"id": node_id, "canonical_name": "Equivalent fractions", "subject": "Math", "aliases": []},
        )
    )
    _api_json(
        client.post(
            "/api/graph/nodes",
            headers=teacher_headers,
            json={"id": replacement_node_id, "canonical_name": "Replacement node", "subject": "Math", "aliases": []},
        )
    )
    _api_json(
        client.post(
            "/api/graph/bindings",
            headers=teacher_headers,
            json={"question_qualified_id": "math/fraction_review", "node_id": node_id},
        )
    )

    paper = _api_json(
        client.post("/api/papers/from-exam", headers=teacher_headers, json={"exam_id": exam_id})
    )["paper"]
    paper_id = str(paper["paper_id"])
    source_publication = _api_json(
        client.post(
            f"/api/papers/{paper_id}/publish",
            headers=teacher_headers,
            json={
                "class_ids": [school_a["class_id"]],
                "title": "C21 synthetic first assessment",
                "show_results_immediately": True,
            },
        )
    )["publication"]
    source_publication_id = str(source_publication["id"])

    source_attempts: dict[str, str] = {}
    for account, student_headers in ((student_a1, student_a1_headers), (student_a2, student_a2_headers)):
        started = _api_json(
            client.post(f"/api/student/publications/{source_publication_id}/start", headers=student_headers)
        )
        source_attempt_id = str(started["attempt"]["id"])
        assert started["questions"][0]["question_id"] == "math/fraction_review"
        submitted = _api_json(
            client.post(
                f"/api/student/attempts/{source_attempt_id}/submit",
                headers=student_headers,
                json={"answers": [{"question_id": "math/fraction_review", "answer": "not equivalent"}]},
            )
        )
        assert submitted["attempt"]["status"] == "submitted"
        assert submitted["attempt"]["score"] is None
        source_attempts[account["id"]] = source_attempt_id

        hidden_result = _api_json(client.get("/api/student/results", headers=student_headers))
        hidden_source = next(row for row in hidden_result["results"] if row["attempt_id"] == source_attempt_id)
        assert hidden_source["score"] is None
        assert hidden_source["answers"] == []

    source_submissions = _api_json(
        client.get(f"/api/papers/{paper_id}/submissions", headers=teacher_headers)
    )["submissions"]
    for student_id, attempt_id in source_attempts.items():
        _manual_grade(
            client,
            teacher_headers=teacher_headers,
            paper_id=paper_id,
            attempt_id=attempt_id,
            score=2.0,
        )
        completed = _complete_grading(
            client,
            teacher_headers=teacher_headers,
            paper_id=paper_id,
            attempt_id=attempt_id,
        )
        assert completed["score"] == 2.0
        assert completed["max_score"] == 4.0
    assert {item["student_id"] for item in source_submissions} == set(source_attempts)

    released_source = _api_json(client.get("/api/student/results", headers=student_a1_headers))
    visible_source = next(row for row in released_source["results"] if row["attempt_id"] == source_attempts[student_a1["id"]])
    assert visible_source["score"] == 2.0
    assert visible_source["score_percent"] == 50.0

    practice = _api_json(
        client.post(
            "/api/teacher/practice-publications/wrong-questions",
            headers=teacher_headers,
            json={
                "class_id": school_a["class_id"],
                "source_publication_id": source_publication_id,
                "title": "C21 synthetic historical wrong-question practice",
                "max_questions_per_student": 5,
                "show_results_immediately": True,
            },
        )
    )
    practice_publication_id = str(practice["publication"]["id"])
    practice_paper_id = str(practice["publication"]["paper_id"])
    assert practice["assigned_student_count"] == 2
    assert practice["publication"]["practice_kind"] == "wrong_questions"
    assert practice["publication"]["source_publication_ids"] == [source_publication_id]

    # Rebinding after publication must not move either the frozen baseline or target item.
    _api_json(
        client.post(
            "/api/graph/bindings/unbind",
            headers=teacher_headers,
            json={"question_qualified_id": "math/fraction_review", "node_id": node_id},
        )
    )
    _api_json(
        client.post(
            "/api/graph/bindings",
            headers=teacher_headers,
            json={"question_qualified_id": "math/fraction_review", "node_id": replacement_node_id},
        )
    )

    target_started = _api_json(
        client.post(
            f"/api/student/publications/{practice_publication_id}/start",
            headers=student_a1_headers,
        )
    )
    target_attempt_id = str(target_started["attempt"]["id"])
    assert target_started["questions"][0]["question_id"] == "math/fraction_review"
    target_submitted = _api_json(
        client.post(
            f"/api/student/attempts/{target_attempt_id}/submit",
            headers=student_a1_headers,
            json={"answers": [{"question_id": "math/fraction_review", "answer": "partially explained"}]},
        )
    )
    assert target_submitted["attempt"]["score"] is None

    _manual_grade(
        client,
        teacher_headers=teacher_headers,
        paper_id=practice_paper_id,
        attempt_id=target_attempt_id,
        score=3.0,
    )
    before_release = _api_json(
        client.get(
            f"/api/learning-progress/student/comparison?practice_publication_id={practice_publication_id}",
            headers=student_a1_headers,
        )
    )["comparison"]
    target_before_release = next(row for row in before_release["node_comparisons"] if row["knowledge_node_id"] == node_id)
    assert target_before_release["status"] == "target_unreleased"
    assert target_before_release["pre_percentage"] == 50.0
    assert target_before_release["post_percentage"] is None
    hidden_practice_result = _api_json(client.get("/api/student/results", headers=student_a1_headers))
    hidden_target = next(row for row in hidden_practice_result["results"] if row["attempt_id"] == target_attempt_id)
    assert hidden_target["score"] is None
    assert hidden_target["answers"] == []

    completed_target = _complete_grading(
        client,
        teacher_headers=teacher_headers,
        paper_id=practice_paper_id,
        attempt_id=target_attempt_id,
    )
    assert completed_target["score"] == 3.0
    assert completed_target["max_score"] == 4.0

    teacher_comparison = _api_json(
        client.get(
            f"/api/learning-progress/teacher/comparison?practice_publication_id={practice_publication_id}",
            headers=teacher_headers,
        )
    )
    summary = next(
        row for row in teacher_comparison["class_comparison"]["node_summaries"]
        if row["knowledge_node_id"] == node_id
    )
    assert summary["pre_percentage"] == 50.0
    assert summary["post_percentage"] == 75.0
    assert summary["delta_percentage_points"] == 25.0
    assert summary["matched_student_count"] == 1
    assert summary["unpaired_student_count"] == 1
    assert teacher_comparison["knowledge_names"][node_id] == "Equivalent fractions"
    assert set(teacher_comparison["student_names"]) == {student_a1["id"], student_a2["id"]}

    own_comparison = _api_json(
        client.get(
            f"/api/learning-progress/student/comparison?practice_publication_id={practice_publication_id}",
            headers=student_a1_headers,
        )
    )["comparison"]
    own_node = next(row for row in own_comparison["node_comparisons"] if row["knowledge_node_id"] == node_id)
    assert (own_node["pre_percentage"], own_node["post_percentage"], own_node["delta_percentage_points"]) == (50.0, 75.0, 25.0)

    waiting = _api_json(
        client.get(
            f"/api/learning-progress/student/comparison?practice_publication_id={practice_publication_id}",
            headers=student_a2_headers,
        )
    )["comparison"]
    waiting_node = next(row for row in waiting["node_comparisons"] if row["knowledge_node_id"] == node_id)
    assert waiting_node["status"] == "target_unsubmitted"
    assert waiting_node["post_percentage"] is None
    own_results_a2 = _api_json(client.get("/api/student/results", headers=student_a2_headers))
    assert target_attempt_id not in {row["attempt_id"] for row in own_results_a2["results"]}

    # A later source regrade changes the source hash, while the captured 2/4 baseline stays fixed.
    _manual_grade(
        client,
        teacher_headers=teacher_headers,
        paper_id=paper_id,
        attempt_id=source_attempts[student_a1["id"]],
        score=3.0,
    )
    _complete_grading(
        client,
        teacher_headers=teacher_headers,
        paper_id=paper_id,
        attempt_id=source_attempts[student_a1["id"]],
    )
    source_regraded = _api_json(
        client.get(
            f"/api/learning-progress/student/comparison?practice_publication_id={practice_publication_id}",
            headers=student_a1_headers,
        )
    )
    assert source_regraded["source_status"]["status"] == "source_modified"
    frozen_node = next(
        row for row in source_regraded["comparison"]["node_comparisons"]
        if row["knowledge_node_id"] == node_id
    )
    assert frozen_node["pre_percentage"] == 50.0
    assert frozen_node["post_percentage"] == 75.0

    # Regrading the target replaces its latest score; it does not accumulate another answer.
    _manual_grade(
        client,
        teacher_headers=teacher_headers,
        paper_id=practice_paper_id,
        attempt_id=target_attempt_id,
        score=2.0,
    )
    _complete_grading(
        client,
        teacher_headers=teacher_headers,
        paper_id=practice_paper_id,
        attempt_id=target_attempt_id,
    )
    regraded_comparison = _api_json(
        client.get(
            f"/api/learning-progress/student/comparison?practice_publication_id={practice_publication_id}",
            headers=student_a1_headers,
        )
    )
    regraded_node = next(
        row for row in regraded_comparison["comparison"]["node_comparisons"]
        if row["knowledge_node_id"] == node_id
    )
    assert regraded_node["pre_percentage"] == 50.0
    assert regraded_node["post_percentage"] == 50.0
    assert regraded_node["delta_percentage_points"] == 0.0

    # Same-school peer instructor, another school, and a student from another school stay out of scope.
    for outsider_teacher in (peer_teacher_headers, school_b["teacher_headers"]):
        denied = client.get(
            f"/api/learning-progress/teacher/comparison?practice_publication_id={practice_publication_id}",
            headers=outsider_teacher,
        )
        assert denied.status_code == 403
    denied_student = client.get(
        f"/api/learning-progress/student/comparison?practice_publication_id={practice_publication_id}",
        headers=student_b1_headers,
    )
    assert denied_student.status_code == 403
    impersonation = client.get(
        f"/api/learning-progress/student/comparison?practice_publication_id={practice_publication_id}&student_id={student_a1['id']}",
        headers=student_a2_headers,
    )
    assert impersonation.status_code == 403

