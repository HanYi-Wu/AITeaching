from concurrent.futures import ThreadPoolExecutor

import pytest

from solaire.exam_compiler.models import QuestionItem
from solaire.web.bank_service import get_question_detail, save_bank_record, upload_bank_image
from solaire.web.bank_storage import BankVersionConflict
from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class, _headers, _teacher_token


def question(content="original"):
    return QuestionItem(id="q1", type="fill", content=content, answer="7")


def test_two_windows_reject_stale_save_and_allow_legacy_requests(web_client):
    _create_school_teacher_class(web_client, _bootstrap_admin(web_client))
    headers = _headers(_teacher_token(web_client))
    url = "/api/bank/items/math/set/q1"
    assert web_client.post("/api/bank/items", headers=headers, json={
        "subject": "math", "collection": "set", "question": question().model_dump(),
    }).status_code == 200
    original = web_client.get(url, headers=headers)
    version = original.json()["version"]
    assert original.headers["etag"] == f'"{version}"'
    saved = web_client.put(url, headers={**headers, "If-Match": version}, json=question("first window").model_dump())
    assert saved.status_code == 200
    assert saved.json()["version"] != version
    stale = web_client.put(url, headers={**headers, "If-Match": f'"{version}"'}, json=question("stale window").model_dump())
    assert stale.status_code == 409
    assert stale.headers["etag"] == saved.headers["etag"]
    assert web_client.get(url, headers=headers).json()["question"]["content"] == "first window"
    assert web_client.put(url, headers=headers, json=question("legacy").model_dump()).status_code == 200


def test_conditional_saves_share_the_library_write_boundary(tmp_path):
    save_bank_record(tmp_path, "math/set/q1", question())
    version = get_question_detail(tmp_path, "math/set/q1")["version"]

    def save(content):
        try:
            return save_bank_record(tmp_path, "math/set/q1", question(content), expected_version=version)
        except BankVersionConflict as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ["one", "two"]))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, BankVersionConflict) for result in results) == 1


def test_version_tracks_external_edits_and_storage_identity(tmp_path):
    save_bank_record(tmp_path, "math/set/q1", question())
    detail = get_question_detail(tmp_path, "math/set/q1")
    path = tmp_path / "resource" / detail["storage_path"]
    # Whitespace changes alone leave the semantic version unchanged.
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    assert get_question_detail(tmp_path, "math/set/q1")["version"] == detail["version"]
    path.rename(path.with_name("moved.yaml"))
    with pytest.raises(BankVersionConflict):
        save_bank_record(tmp_path, "math/set/q1", question("edited"), expected_version=detail["version"])


def test_identical_question_in_other_project_cannot_satisfy_old_precondition(tmp_path):
    first, second = tmp_path / "first", tmp_path / "second"
    for root in (first, second):
        save_bank_record(root, "math/set/q1", question())
    version = get_question_detail(first, "math/set/q1")["version"]
    with pytest.raises(BankVersionConflict):
        save_bank_record(second, "math/set/q1", question("old project draft"), expected_version=version)
    with pytest.raises(BankVersionConflict):
        upload_bank_image(second, "math/set/q1", b"image", "x.png", expected_version=version)
    assert get_question_detail(second, "math/set/q1")["question"]["content"] == "original"
    assert not list((second / "resource/math/set").rglob("*.png"))


def test_image_upload_rejects_stale_question_before_writing(web_client):
    _create_school_teacher_class(web_client, _bootstrap_admin(web_client))
    headers = _headers(_teacher_token(web_client))
    url = "/api/bank/items/math/set/q1"
    assert web_client.post("/api/bank/items", headers=headers, json={
        "subject": "math", "collection": "set", "question": question().model_dump(),
    }).status_code == 200
    version = web_client.get(url, headers=headers).json()["version"]
    assert web_client.put(url, headers=headers, json=question("changed").model_dump()).status_code == 200
    stale = web_client.post(url + "/image", headers={**headers, "If-Match": version}, files={"file": ("x.png", b"image", "image/png")})
    assert stale.status_code == 409
    legacy = web_client.post(url + "/image", headers=headers, files={"file": ("x.png", b"image", "image/png")})
    assert legacy.status_code == 200
