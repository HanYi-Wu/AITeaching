from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from solaire.exam_compiler.facade import QuestionGroupRecord, QuestionItem
from solaire.knowledge_forge.migration import ensure_graph_layout
from solaire.knowledge_forge.models import ConceptNode, GraphMeta, QuestionBinding, SubjectMeta
from solaire.knowledge_forge.mutation_session import GraphMutationSession
from solaire.knowledge_forge.storage import _load_subject_state, _save_meta
from solaire.web import auth_api, bank_folders
from solaire.web.auth_service import bootstrap_admin
from solaire.web.bank_service import bank_catalog, get_question_detail, save_bank_record
from solaire.web.platform_db import init_platform_db
from solaire.web.routers import bank as bank_router
from solaire.web.school.accounts import create_user
from solaire.web.school.organization import create_school


def _make_question(qid: str, content: str = "题目内容") -> QuestionItem:
    return QuestionItem(
        id=qid,
        type="single_choice",
        content=content,
        options={"A": "1", "B": "2", "C": "3", "D": "4"},
        answer="A",
        analysis="解析",
        metadata={},
    )


def test_save_bank_record_renames_question_folder_and_bindings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "project"
    old_qid = "数学/默认/第一题"
    new_qid = "数学/默认/重命名题"
    other_qid = "数学/默认/第二题"

    save_bank_record(root, old_qid, _make_question("第一题"), create_only=True)
    save_bank_record(root, other_qid, _make_question("第二题"), create_only=True)

    bank_folders.act(root, "create", path="复习目录")
    bank_folders.act(root, "move", path="复习目录", qualified_ids=[old_qid])

    ensure_graph_layout(root)
    _save_meta(root, GraphMeta(subjects=[SubjectMeta(slug="math", display_name="数学")]))
    with GraphMutationSession(root) as session:
        state = session.state("math")
        state.nodes.append(ConceptNode(id="node-1", canonical_name="函数概念"))
        state.bindings.append(QuestionBinding(question_qualified_id=old_qid, node_id="node-1"))
        session.save("math")

    app = FastAPI()
    app.include_router(bank_router.router)
    monkeypatch.setattr(bank_router, "_require_root", lambda: root)
    client = TestClient(app)

    # Renaming to an existing question ID returns 409 Conflict
    conflict = client.put(
        f"/api/bank/items/{old_qid}",
        json=_make_question("第二题").model_dump(),
    )
    assert conflict.status_code == 409
    assert (root / "resource" / "数学" / "默认" / "第一题.yaml").is_file()

    # Renaming to an unused Chinese ID succeeds, unlinks old file, migrates folder & binding
    detail = get_question_detail(root, old_qid)
    ok_resp = client.put(
        f"/api/bank/items/{old_qid}",
        headers={"If-Match": detail["version"]},
        json=_make_question("重命名题", content="更新题干").model_dump(),
    )
    assert ok_resp.status_code == 200
    payload = ok_resp.json()
    assert payload["qualified_id"] == new_qid
    assert not (root / "resource" / "数学" / "默认" / "第一题.yaml").exists()
    assert (root / "resource" / "数学" / "默认" / "重命名题.yaml").is_file()

    folder_state = bank_folders.read(root)
    assert old_qid not in folder_state["assignments"]
    assert folder_state["assignments"][new_qid] == "复习目录"

    graph_state = _load_subject_state(root, "math")
    assert [(b.question_qualified_id, b.node_id) for b in graph_state.bindings] == [(new_qid, "node-1")]


def test_teacher_guide_allows_direct_dismiss_step_8(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "platform"
    init_platform_db(root)
    bootstrap_admin(root, username="admin", password="test-password", display_name="管理员")
    school = create_school(root, name="实验中学")
    teacher = create_user(
        root,
        role="teacher",
        school_id=school["id"],
        username="teacher-guide",
        password="test-password",
        display_name="教师一",
    )

    app = FastAPI()
    app.include_router(auth_api.router, prefix="/api")
    app.dependency_overrides[auth_api.current_platform_user] = lambda: teacher
    monkeypatch.setattr(auth_api, "require_platform_root", lambda: root)
    client = TestClient(app)

    bad = client.post("/api/auth/teacher-guide", json={"step": 5})
    assert bad.status_code == 400

    dismissed = client.post("/api/auth/teacher-guide", json={"step": 8})
    assert dismissed.status_code == 200
    assert dismissed.json()["user"]["teacher_guide_step"] == 8


def test_bank_create_and_rename_rejects_duplicate_trimmed_and_case_variants(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "project"
    save_bank_record(root, "数学/默认/第一题", _make_question("第一题"), create_only=True)
    save_bank_record(root, "数学/默认/Alpha", _make_question("Alpha"), create_only=True)

    app = FastAPI()
    app.include_router(bank_router.router)
    monkeypatch.setattr(bank_router, "_require_root", lambda: root)
    client = TestClient(app)

    # Whitespace-padded duplicate on create returns 409 instead of slipping past precheck
    ws_dup = client.post(
        "/api/bank/items",
        json={"subject": "数学", "collection": "默认", "question": _make_question(" 第一题 ").model_dump()},
    )
    assert ws_dup.status_code == 409

    # Case-insensitive duplicate on create returns 409
    case_dup = client.post(
        "/api/bank/items",
        json={"subject": "数学", "collection": "默认", "question": _make_question("alpha").model_dump()},
    )
    assert case_dup.status_code == 409

    # Invalid slash ID on create returns 400
    bad_id = client.post(
        "/api/bank/items",
        json={"subject": "数学", "collection": "默认", "question": _make_question("bad/id").model_dump()},
    )
    assert bad_id.status_code == 400

    # Renaming 第一题 to case variant of existing Alpha returns 409 without deleting 第一题
    rename_case_dup = client.put(
        "/api/bank/items/数学/默认/第一题",
        json=_make_question("ALPHA").model_dump(),
    )
    assert rename_case_dup.status_code == 409
    assert (root / "resource" / "数学" / "默认" / "第一题.yaml").is_file()


def test_bank_catalog_populates_group_members_and_case_only_rename_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "project"
    save_bank_record(
        root,
        "数学/默认/组题",
        QuestionGroupRecord(
            id="组题",
            material="阅读材料",
            unified="single_choice",
            items=[
                {"content": "小题1", "options": {"A": "1", "B": "2"}, "answer": "A"},
                {"content": "小题2", "options": {"A": "3", "B": "4"}, "answer": "B"},
            ],
        ),
        create_only=True,
    )
    save_bank_record(root, "数学/默认/caseQ", _make_question("caseQ"), create_only=True)

    catalog, diagnostics = bank_catalog(root)
    assert diagnostics == []
    group_entry = next(item for item in catalog if item["qualified_id"] == "数学/默认/组题")
    assert group_entry["group_member_qualified_ids"] == ["数学/默认/组题__01", "数学/默认/组题__02"]

    app = FastAPI()
    app.include_router(bank_router.router)
    monkeypatch.setattr(bank_router, "_require_root", lambda: root)
    client = TestClient(app)

    # Single question matching a group's synthetic member ID is rejected with 409
    sub_collision = client.post(
        "/api/bank/items",
        json={"subject": "数学", "collection": "默认", "question": _make_question("组题__01").model_dump()},
    )
    assert sub_collision.status_code == 409

    # Case-only rename on the same record succeeds cleanly on case-insensitive Windows FS
    detail = get_question_detail(root, "数学/默认/caseQ")
    renamed = client.put(
        "/api/bank/items/数学/默认/caseQ",
        headers={"If-Match": detail["version"]},
        json=_make_question("Caseq", content="大小写更名").model_dump(),
    )
    assert renamed.status_code == 200
    assert renamed.json()["qualified_id"] == "数学/默认/Caseq"
    target_path = root / "resource" / "数学" / "默认" / "Caseq.yaml"
    assert target_path.is_file()
    assert target_path.resolve().name == "Caseq.yaml"
    after = get_question_detail(root, "数学/默认/Caseq")
    assert after["question"]["content"] == "大小写更名"
