"""Stable public identity for frozen exam questions and draft recovery."""

from copy import deepcopy

import pytest
import yaml

from solaire.web.papers.snapshots import public_snapshot_identity, project_scope_identity
from tests.test_platform_student_api import _publish_exam_for_student, _write_online_exam


def test_snapshot_identity_is_canonical_without_answer_or_analysis_secrets():
    questions = [{"question_id": "math/q1", "content": "1+1=?", "score_per_item": 5,
                  "options": {"B": "3", "A": "2"}, "answer": "A", "analysis": "secret"}]
    before = deepcopy(questions)
    reordered = [{"options": {"A": "2", "B": "3"}, "score_per_item": 5,
                  "content": "1+1=?", "question_id": "math/q1", "correct_answer": "B"}]
    assert public_snapshot_identity(questions) == public_snapshot_identity(reordered)
    assert questions == before


@pytest.mark.parametrize("field,value", [("content", "new question"), ("score_per_item", 6),
                                       ("question_id", "math/q2"), ("options", {"A": "4"})])
def test_snapshot_identity_changes_when_effective_question_changes(field, value):
    original = [{"question_id": "math/q1", "content": "1+1=?", "score_per_item": 5}]
    changed = deepcopy(original)
    changed[0][field] = value
    assert public_snapshot_identity(original) != public_snapshot_identity(changed)


def test_snapshot_identity_preserves_question_order_and_rejects_nonfinite_data():
    questions = [{"question_id": "q1"}, {"question_id": "q2"}]
    assert public_snapshot_identity(questions) != public_snapshot_identity(list(reversed(questions)))
    with pytest.raises(ValueError):
        public_snapshot_identity([{"score_per_item": float("nan")}])


def test_student_snapshot_identity_and_attempt_survive_source_question_edits(web_client, tmp_path):
    exam_id = _write_online_exam(tmp_path)
    headers, publication_id, _ = _publish_exam_for_student(web_client, tmp_path, exam_id=exam_id)
    url = f"/api/student/publications/{publication_id}/start"
    first = web_client.post(url, headers=headers)
    assert first.status_code == 200
    started = first.json()
    assert started["attempt"]["snapshot_version"].startswith("questions-v1:")
    assert started["attempt"]["project_scope"] == project_scope_identity(tmp_path)
    assert all(not ({"answer", "correct_answer", "analysis"} & question.keys())
               for question in started["questions"])

    question_path = tmp_path / "resource/math/q1.yaml"
    payload = yaml.safe_load(question_path.read_text(encoding="utf-8"))
    payload.update(content="Changed after publication", answer="B", analysis="Changed explanation")
    question_path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    resumed = web_client.post(url, headers=headers)
    assert resumed.status_code == 200
    assert resumed.json()["attempt"]["id"] == started["attempt"]["id"]
    assert resumed.json()["attempt"]["snapshot_version"] == started["attempt"]["snapshot_version"]
    assert resumed.json()["questions"] == started["questions"]


def test_project_scope_is_stable_and_does_not_disclose_filesystem_paths(tmp_path):
    identity = project_scope_identity(tmp_path)
    assert identity == project_scope_identity(tmp_path / "nested" / "..")
    assert identity != project_scope_identity(tmp_path / "another")
    assert identity.startswith("project-v1:")
    assert str(tmp_path) not in identity
