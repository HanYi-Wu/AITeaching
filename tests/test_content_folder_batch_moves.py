"""Batch folder moves must authorize and validate the whole selection before changing any row."""

from contextlib import closing
from pathlib import Path

import pytest

from solaire.web.platform_db import connect, default_platform_root
from tests.test_platform_paper_api import _bootstrap_admin, _create_school_teacher_class, _headers, _teacher_token
from tests.test_content_folder_management import create


@pytest.fixture
def actors(web_client):
    admin_token = _bootstrap_admin(web_client)
    school_id, teacher_id, _ = _create_school_teacher_class(web_client, admin_token)
    teacher_headers = _headers(_teacher_token(web_client))
    school_login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    assert school_login.status_code == 200
    school_headers = _headers(str(school_login.json()["token"]))
    return {
        "admin_headers": _headers(admin_token),
        "school_id": school_id,
        "teacher_id": teacher_id,
        "teacher_headers": teacher_headers,
        "school_headers": school_headers,
    }


def _create_second_teacher(client, actors):
    response = client.post(
        "/api/school/teachers",
        headers=actors["school_headers"],
        json={"username": "teacher_two", "password": "teacher123", "display_name": "Teacher Two", "subjects": ["Math"]},
    )
    assert response.status_code == 200, response.text
    login = client.post("/api/auth/login", json={"username": "teacher_two", "password": "teacher123"})
    assert login.status_code == 200
    return str(response.json()["teacher"]["id"]), _headers(str(login.json()["token"]))


def _insert_paper(root: Path, paper_id: str, owner_id: str, school_id: str, folder_id: str) -> None:
    with closing(connect(root)) as con, con:
        con.execute(
            """INSERT INTO paper_records
               (id, exam_id, title, subject, delivery_mode, owner_teacher_id, school_id, status, created_at, updated_at, folder_id)
               VALUES (?, ?, ?, 'Math', 'offline', ?, ?, 'draft', 'now', 'now', ?)""",
            (paper_id, f"exam-{paper_id}/Math", paper_id, owner_id, school_id, folder_id),
        )


def _insert_publication(root: Path, publication_id: str, paper_id: str, teacher_id: str, folder_id: str, status: str = "published") -> None:
    with closing(connect(root)) as con, con:
        con.execute(
            """INSERT INTO exam_publications (id, paper_id, teacher_id, title, folder_id, status, created_at, updated_at)
               VALUES (?, ?, ?, 'Published', ?, ?, 'now', 'now')""",
            (publication_id, paper_id, teacher_id, folder_id, status),
        )


def _paper_folders(client, headers):
    source = create(client, headers, "来源", scope="paper")
    target = create(client, headers, "目标", scope="paper")
    return source, target


def _paper_folders_in_db(root: Path, paper_ids: list[str]) -> dict[str, str | None]:
    with closing(connect(root)) as con:
        rows = con.execute(
            f"SELECT id, folder_id FROM paper_records WHERE id IN ({','.join('?' for _ in paper_ids)})",
            paper_ids,
        ).fetchall()
    return {str(row["id"]): row["folder_id"] for row in rows}


def test_batch_move_route_is_teacher_only_and_rejects_other_owners(web_client, actors, tmp_path: Path):
    own_source, own_target = _paper_folders(web_client, actors["teacher_headers"])
    other_teacher_id, other_headers = _create_second_teacher(web_client, actors)
    other_source, _ = _paper_folders(web_client, other_headers)
    _insert_paper(default_platform_root(), "own-paper", actors["teacher_id"], actors["school_id"], own_source["id"])
    _insert_paper(default_platform_root(), "other-paper", other_teacher_id, actors["school_id"], other_source["id"])

    as_admin = web_client.post("/api/organizer/folder-items/move", headers=actors["admin_headers"], json={
        "scope": "paper", "item_ids": ["own-paper"], "folder_id": own_target["id"],
    })
    foreign_source = web_client.post("/api/organizer/folder-items/move", headers=actors["teacher_headers"], json={
        "scope": "paper", "item_ids": ["other-paper"], "folder_id": own_target["id"],
    })
    foreign_target = web_client.post("/api/organizer/folder-items/move", headers=actors["teacher_headers"], json={
        "scope": "paper", "item_ids": ["own-paper"], "folder_id": other_source["id"],
    })

    assert as_admin.status_code == 403
    assert foreign_source.status_code == 403
    assert foreign_target.status_code == 400
    assert _paper_folders_in_db(default_platform_root(), ["own-paper", "other-paper"]) == {
        "own-paper": own_source["id"], "other-paper": other_source["id"],
    }


def test_published_or_revoked_paper_in_mixed_batch_rolls_back_every_move(web_client, actors, tmp_path: Path):
    source, target = _paper_folders(web_client, actors["teacher_headers"])
    _insert_paper(default_platform_root(), "draft-paper", actors["teacher_id"], actors["school_id"], source["id"])
    _insert_paper(default_platform_root(), "published-paper", actors["teacher_id"], actors["school_id"], source["id"])
    _insert_paper(default_platform_root(), "revoked-paper", actors["teacher_id"], actors["school_id"], source["id"])
    _insert_publication(default_platform_root(), "publication-1", "published-paper", actors["teacher_id"], source["id"])
    _insert_publication(default_platform_root(), "publication-revoked", "revoked-paper", actors["teacher_id"], source["id"], status="revoked")
    from solaire.web.papers.visibility import publication_stats
    revoked_stats = publication_stats(default_platform_root(), "revoked-paper", {"id": actors["teacher_id"], "role": "teacher"})
    assert revoked_stats["has_publication_history"] is True
    assert revoked_stats["publication_count"] == 0

    response = web_client.post("/api/organizer/folder-items/move", headers=actors["teacher_headers"], json={
        "scope": "paper", "item_ids": ["draft-paper", "revoked-paper"], "folder_id": target["id"],
    })

    assert response.status_code == 400
    assert _paper_folders_in_db(default_platform_root(), ["draft-paper", "published-paper", "revoked-paper"]) == {
        "draft-paper": source["id"], "published-paper": source["id"], "revoked-paper": source["id"],
    }


def test_invalid_paper_id_or_blank_batch_entry_leaves_all_papers_untouched(web_client, actors, tmp_path: Path):
    source, target = _paper_folders(web_client, actors["teacher_headers"])
    _insert_paper(default_platform_root(), "valid-paper", actors["teacher_id"], actors["school_id"], source["id"])

    missing = web_client.post("/api/organizer/folder-items/move", headers=actors["teacher_headers"], json={
        "scope": "paper", "item_ids": ["valid-paper", "missing-paper"], "folder_id": target["id"],
    })
    blank = web_client.post("/api/organizer/folder-items/move", headers=actors["teacher_headers"], json={
        "scope": "paper", "item_ids": ["valid-paper", "  "], "folder_id": target["id"],
    })

    assert missing.status_code == 403
    assert blank.status_code == 400
    assert _paper_folders_in_db(default_platform_root(), ["valid-paper"]) == {"valid-paper": source["id"]}


def test_compose_move_deduplicates_ids_and_can_remove_folder_assignment(web_client, actors, tmp_path: Path):
    headers = actors["teacher_headers"]
    folder = create(web_client, headers, "归档", scope="compose")
    source = tmp_path / "exams" / "archive-me" / "exam.yaml"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("preserve source", encoding="utf-8")

    moved = web_client.post("/api/organizer/folder-items/move", headers=headers, json={
        "scope": "compose", "item_ids": ["archive-me/Math", "archive-me/Math"], "folder_id": folder["id"],
    })
    listed = web_client.get("/api/organizer/folder-items?scope=compose", headers=headers)
    removed = web_client.post("/api/organizer/folder-items/move", headers=headers, json={
        "scope": "compose", "item_ids": ["archive-me/Math"], "folder_id": None,
    })
    after_remove = web_client.get("/api/organizer/folder-items?scope=compose", headers=headers)

    assert moved.status_code == 200, moved.text
    assert moved.json() == {"ok": True, "moved_count": 1}
    assert listed.json()["items"]["archive-me/Math"] == folder["id"]
    assert removed.status_code == 200, removed.text
    assert "archive-me/Math" not in after_remove.json()["items"]
    assert source.read_text(encoding="utf-8") == "preserve source"


def test_batch_move_rejects_invalid_scope_and_out_of_range_lists(web_client, actors):
    headers = actors["teacher_headers"]
    empty = web_client.post("/api/organizer/folder-items/move", headers=headers, json={
        "scope": "compose", "item_ids": [], "folder_id": None,
    })
    invalid_scope = web_client.post("/api/organizer/folder-items/move", headers=headers, json={
        "scope": "template", "item_ids": ["item"], "folder_id": None,
    })

    assert empty.status_code == 422
    assert invalid_scope.status_code == 422
