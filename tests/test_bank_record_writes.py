from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import yaml

from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.web.bank_service import get_question_detail, save_bank_record


def question(qid="q1", content="before"):
    return {"id": qid, "type": "fill", "content": content, "answer": "7"}


def test_edit_in_legacy_list_preserves_neighbors_and_extensions(tmp_path: Path):
    path = tmp_path / "resource/math/set/legacy.yaml"
    path.parent.mkdir(parents=True)
    original = [
        {**question(), "custom": {"review": "pending"}},
        {"id": "group", "type": "group", "unified": "fill",
         "material": "material :::EMBED_IMG:math/set/image/x.png:::",
         "items": [{"content": "part", "answer": "1", "custom_item": True}],
         "custom_group": [1, 2]},
        question("q2"),
    ]
    path.write_text(yaml.safe_dump(original), encoding="utf-8")
    save_bank_record(tmp_path, "math/set/q1", QuestionItem.model_validate(question(content="edited")))
    saved = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(saved, list)
    assert saved[0]["content"] == "edited"
    assert saved[0]["custom"] == original[0]["custom"]
    assert saved[1:] == original[1:]
    assert get_question_detail(tmp_path, "math/set/group")["question_group"]["material"] == original[1]["material"]


def test_serialization_failure_keeps_original_file(tmp_path: Path, monkeypatch):
    save_bank_record(tmp_path, "math/set/q1", QuestionItem.model_validate(question()))
    path = tmp_path / "resource/math/set/q1.yaml"
    original = path.read_bytes()

    def fail(*args, **kwargs):
        raise OSError("serialization failed")

    monkeypatch.setattr("solaire.web.bank_service.yaml.safe_dump", fail)
    with pytest.raises(OSError):
        save_bank_record(tmp_path, "math/set/q1", QuestionItem.model_validate(question(content="edited")))
    assert path.read_bytes() == original


def test_failed_atomic_replace_keeps_original_file(tmp_path: Path, monkeypatch):
    save_bank_record(tmp_path, "math/set/q1", QuestionItem.model_validate(question()))
    path = tmp_path / "resource/math/set/q1.yaml"
    original = path.read_bytes()

    def fail(*args):
        raise OSError("disk unavailable")

    monkeypatch.setattr("solaire.common.atomic_files.os.replace", fail)
    with pytest.raises(OSError):
        save_bank_record(tmp_path, "math/set/q1", QuestionItem.model_validate(question(content="edited")))
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.tmp"))


def test_group_edit_retains_root_and_member_extensions(tmp_path: Path):
    path = tmp_path / "resource/math/set/legacy.yaml"
    path.parent.mkdir(parents=True)
    group = {"id": "group", "type": "group", "unified": False, "material": "material",
             "custom": "keep", "items": [{"type": "fill", "content": "part", "answer": "1", "extra": 3}]}
    path.write_text(yaml.safe_dump([question(), group]), encoding="utf-8")
    group["material"] = "edited material"
    save_bank_record(tmp_path, "math/set/group", QuestionGroupRecord.model_validate(group))
    saved = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert saved[0] == question()
    assert saved[1]["material"] == "edited material"
    assert saved[1]["custom"] == "keep"
    assert saved[1]["items"][0]["extra"] == 3


def test_concurrent_creates_keep_one_stable_id(tmp_path: Path):
    def create(index):
        try:
            save_bank_record(tmp_path, "math/set/q1", QuestionItem.model_validate(question(content=str(index))), create_only=True)
            return "created"
        except FileExistsError:
            return "exists"

    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(create, range(4)))
    assert outcomes.count("created") == 1
    assert outcomes.count("exists") == 3
    assert len(list((tmp_path / "resource/math/set").glob("*.yaml"))) == 1
