"""Teacher-owned folders and labels shared by content workspaces."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.content_names import available_name
from solaire.web.platform_db import connect, init_platform_db, row_to_dict

SCOPES = {"template", "compose", "paper"}
TAG_SCOPES = SCOPES | {"bank"}
COLORS = {"slate", "blue", "green", "amber", "rose", "violet"}


def _owner(user: dict[str, Any]) -> str:
    if user.get("role") != "teacher" or not user.get("id"):
        raise PermissionError("此操作仅限教师")
    return str(user["id"])


def _folder(con: Any, folder_id: str, owner: str, scope: str) -> dict[str, Any]:
    row = con.execute(
        "SELECT * FROM content_folders WHERE id=? AND owner_teacher_id=? AND scope=?",
        (folder_id, owner, scope),
    ).fetchone()
    if row is None:
        raise ValueError("文件夹不存在或无权访问")
    return row_to_dict(row) or {}


def list_folders(root: Path, user: dict[str, Any], scope: str) -> list[dict[str, Any]]:
    owner = _owner(user)
    if scope not in SCOPES:
        raise ValueError("不支持的文件夹类型")
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute(
            "SELECT * FROM content_folders WHERE owner_teacher_id=? AND scope=? ORDER BY name, id",
            (owner, scope),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def create_folder(root: Path, user: dict[str, Any], *, scope: str, name: str,
                  parent_id: str | None = None, kind: str = "category") -> dict[str, Any]:
    owner = _owner(user)
    clean_name = name.strip()
    if scope not in SCOPES or not clean_name or len(clean_name) > 60:
        raise ValueError("文件夹名称须为 1–60 个字符")
    if kind not in {"category", "paper"} or (kind == "paper" and scope != "paper"):
        raise ValueError("该位置不能创建试卷文件夹")
    if kind == "paper" and not parent_id:
        raise ValueError("试卷文件夹不能建在根目录")
    init_platform_db(root)
    now = utc_now()
    folder_id = uuid.uuid4().hex
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        if parent_id and _folder(con, parent_id, owner, scope)["kind"] != "category":
            raise ValueError("试卷文件夹下不能建立子文件夹")
        names = con.execute(
            "SELECT name FROM content_folders WHERE owner_teacher_id=? AND scope=? AND parent_id IS ?",
            (owner, scope, parent_id),
        ).fetchall()
        clean_name = available_name(clean_name, (str(row["name"]) for row in names), max_length=60)
        con.execute(
            "INSERT INTO content_folders VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (folder_id, owner, scope, parent_id, kind, clean_name, now, now),
        )
        row = con.execute("SELECT * FROM content_folders WHERE id=?", (folder_id,)).fetchone()
    return row_to_dict(row) or {}


def update_folder(root: Path, user: dict[str, Any], folder_id: str, *,
                  name: str | None = None, parent_id: str | None = None,
                  move: bool = False, kind: str | None = None) -> dict[str, Any]:
    owner = _owner(user)
    init_platform_db(root)
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        current = _folder(con, folder_id, owner, "paper") if kind == "paper" else None
        if current is None:
            row = con.execute("SELECT * FROM content_folders WHERE id=? AND owner_teacher_id=?", (folder_id, owner)).fetchone()
            if row is None:
                raise ValueError("文件夹不存在或无权访问")
            current = row_to_dict(row) or {}
        scope = str(current["scope"])
        new_kind = kind or str(current["kind"])
        if kind and (scope != "paper" or kind not in {"category", "paper"}):
            raise ValueError("只有试卷目录可以转换类型")
        if kind and kind != current["kind"]:
            occupied = con.execute(
                "SELECT 1 FROM content_folders WHERE parent_id=? UNION SELECT 1 FROM paper_records WHERE folder_id=? UNION SELECT 1 FROM exam_publications WHERE folder_id=? LIMIT 1",
                (folder_id, folder_id, folder_id),
            ).fetchone()
            if occupied:
                raise ValueError("只有空文件夹可以转换类型")
        destination = parent_id if move else current["parent_id"]
        if new_kind == "paper" and not destination:
            raise ValueError("试卷文件夹不能位于根目录")
        if move and destination == folder_id:
            raise ValueError("不能移动到自身")
        if destination:
            parent = _folder(con, destination, owner, scope)
            if parent["kind"] != "category":
                raise ValueError("只能移动到归类文件夹")
            ancestor = destination
            while ancestor:
                if ancestor == folder_id:
                    raise ValueError("不能移动到自己的子目录")
                ancestor_row = con.execute("SELECT parent_id FROM content_folders WHERE id=?", (ancestor,)).fetchone()
                ancestor = str(ancestor_row["parent_id"]) if ancestor_row and ancestor_row["parent_id"] else None
        clean_name = str(name if name is not None else current["name"]).strip()
        if not clean_name or len(clean_name) > 60:
            raise ValueError("文件夹名称须为 1–60 个字符")
        if clean_name != current["name"] or destination != current["parent_id"]:
            _assert_folder_name_available(con, owner, scope, destination, clean_name, exclude_id=folder_id)
        con.execute("UPDATE content_folders SET name=?, parent_id=?, kind=?, updated_at=? WHERE id=?",
                    (clean_name, destination, new_kind, utc_now(), folder_id))
        row = con.execute("SELECT * FROM content_folders WHERE id=?", (folder_id,)).fetchone()
    return row_to_dict(row) or {}


def _assert_folder_name_available(con: Any, owner: str, scope: str, parent_id: str | None,
                                  name: str, *, exclude_id: str) -> None:
    rows = con.execute(
        "SELECT name FROM content_folders WHERE owner_teacher_id=? AND scope=? AND parent_id IS ? AND id<>?",
        (owner, scope, parent_id, exclude_id),
    ).fetchall()
    if any(str(row["name"]).casefold() == name.casefold() for row in rows):
        raise ValueError("该目录下已有同名文件夹，请修改名称后再重命名或移动")


def delete_folder(root: Path, user: dict[str, Any], folder_id: str) -> dict[str, Any]:
    """Remove organization only; never remove source files, papers or attempts."""
    owner = _owner(user)
    init_platform_db(root)
    with connect(root) as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT * FROM content_folders WHERE id=? AND owner_teacher_id=?", (folder_id, owner)
        ).fetchone()
        if row is None:
            raise ValueError("文件夹不存在或无权访问")
        current = dict(row)
        scope, parent_id = str(current["scope"]), current["parent_id"]
        if folder_id == f"paper-default-{owner}":
            raise ValueError("默认文件夹由系统保留，不能删除；可以重命名或新建其他文件夹")
        if scope == "paper":
            occupied = con.execute(
                "SELECT 1 FROM paper_records WHERE folder_id=? UNION SELECT 1 FROM exam_publications WHERE folder_id=? LIMIT 1",
                (folder_id, folder_id),
            ).fetchone()
            if occupied:
                raise ValueError("文件夹中仍有试卷或发布记录，不能删除；请先移走未发布试卷，已有发布记录的文件夹需保留")
        children = con.execute("SELECT * FROM content_folders WHERE parent_id=?", (folder_id,)).fetchall()
        child_names: set[str] = set()
        for child in children:
            if child["kind"] == "paper" and not parent_id:
                raise ValueError("请先移动子试卷文件夹到其他归类文件夹，再删除此文件夹")
            name = str(child["name"])
            _assert_folder_name_available(con, owner, scope, parent_id, name, exclude_id=folder_id)
            if name.casefold() in child_names:
                raise ValueError("子文件夹存在重名，请先重命名后再删除上级文件夹")
            child_names.add(name.casefold())
        con.execute("UPDATE content_folders SET parent_id=?, updated_at=? WHERE parent_id=?", (parent_id, utc_now(), folder_id))
        if scope in {"template", "compose"}:
            if parent_id:
                con.execute("UPDATE content_folder_items SET folder_id=? WHERE folder_id=?", (parent_id, folder_id))
            else:
                con.execute("DELETE FROM content_folder_items WHERE folder_id=?", (folder_id,))
        con.execute("DELETE FROM content_folders WHERE id=?", (folder_id,))
    return {"scope": scope, "parent_id": parent_id}


def assign_paper_folder(root: Path, user: dict[str, Any], paper_id: str, folder_id: str) -> None:
    owner = _owner(user)
    init_platform_db(root)
    with connect(root) as con:
        _folder(con, folder_id, owner, "paper")
        paper = con.execute("SELECT owner_teacher_id FROM paper_records WHERE id=?", (paper_id,)).fetchone()
        if paper is None or paper["owner_teacher_id"] != owner:
            raise PermissionError("无权移动该试卷")
        published = con.execute("SELECT 1 FROM exam_publications WHERE paper_id=? LIMIT 1", (paper_id,)).fetchone()
        if published:
            raise ValueError("已有发布记录的试卷不能单独移出原文件夹；请移动整个文件夹")
        con.execute("UPDATE paper_records SET folder_id=?, updated_at=? WHERE id=?", (folder_id, utc_now(), paper_id))


def list_folder_items(root: Path, user: dict[str, Any], scope: str) -> dict[str, str]:
    owner = _owner(user)
    if scope not in {"template", "compose"}:
        raise ValueError("不支持的内容类型")
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute("SELECT item_id, folder_id FROM content_folder_items WHERE owner_teacher_id=? AND scope=?", (owner, scope)).fetchall()
    return {str(row["item_id"]): str(row["folder_id"]) for row in rows}


def assign_folder_item(root: Path, user: dict[str, Any], *, scope: str, item_id: str, folder_id: str | None) -> None:
    owner = _owner(user)
    if scope not in {"template", "compose"} or not item_id.strip():
        raise ValueError("内容标识无效")
    init_platform_db(root)
    with connect(root) as con:
        if folder_id:
            _folder(con, folder_id, owner, scope)
            con.execute(
                "INSERT INTO content_folder_items(owner_teacher_id, scope, item_id, folder_id) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(owner_teacher_id, scope, item_id) DO UPDATE SET folder_id=excluded.folder_id",
                (owner, scope, item_id, folder_id),
            )
        else:
            con.execute("DELETE FROM content_folder_items WHERE owner_teacher_id=? AND scope=? AND item_id=?", (owner, scope, item_id))


def list_tags(root: Path, user: dict[str, Any]) -> list[dict[str, Any]]:
    owner = _owner(user)
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute("SELECT * FROM content_tags WHERE owner_teacher_id=? ORDER BY name", (owner,)).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def save_tag(root: Path, user: dict[str, Any], *, name: str, color: str, tag_id: str | None = None) -> dict[str, Any]:
    owner = _owner(user)
    clean = name.strip()
    if not clean or len(clean) > 5 or color not in COLORS:
        raise ValueError("标签名称最多 5 字，颜色需从预设色中选择")
    init_platform_db(root)
    now = utc_now()
    with connect(root) as con:
        if tag_id:
            row = con.execute("SELECT 1 FROM content_tags WHERE id=? AND owner_teacher_id=?", (tag_id, owner)).fetchone()
            if not row:
                raise PermissionError("无权编辑该标签")
            con.execute("UPDATE content_tags SET name=?, color=? WHERE id=?", (clean, color, tag_id))
        else:
            tag_id = uuid.uuid4().hex
            con.execute("INSERT INTO content_tags VALUES (?, ?, ?, ?, ?)", (tag_id, owner, clean, color, now))
        row = con.execute("SELECT * FROM content_tags WHERE id=?", (tag_id,)).fetchone()
    return row_to_dict(row) or {}


def set_item_tags(root: Path, user: dict[str, Any], *, scope: str, item_id: str, tag_ids: list[str]) -> list[str]:
    owner = _owner(user)
    if scope not in TAG_SCOPES or not item_id.strip() or len(tag_ids) > 20:
        raise ValueError("标签目标无效或标签过多")
    init_platform_db(root)
    unique_ids = list(dict.fromkeys(tag_ids))
    with connect(root) as con:
        if scope == "paper":
            paper = con.execute("SELECT owner_teacher_id FROM paper_records WHERE id=?", (item_id,)).fetchone()
            if not paper or paper["owner_teacher_id"] != owner:
                raise PermissionError("无权标记该试卷")
        if unique_ids:
            count = con.execute(
                f"SELECT COUNT(*) FROM content_tags WHERE owner_teacher_id=? AND id IN ({','.join('?' for _ in unique_ids)})",
                (owner, *unique_ids),
            ).fetchone()[0]
            if count != len(unique_ids):
                raise PermissionError("标签不属于当前教师")
        con.execute("DELETE FROM content_tag_links WHERE scope=? AND item_id=? AND tag_id IN (SELECT id FROM content_tags WHERE owner_teacher_id=?)",
                    (scope, item_id, owner))
        con.executemany("INSERT INTO content_tag_links VALUES (?, ?, ?)", [(tag_id, scope, item_id) for tag_id in unique_ids])
    return unique_ids


def item_tags(root: Path, user: dict[str, Any], scope: str, item_id: str) -> list[dict[str, Any]]:
    owner = _owner(user)
    if scope not in TAG_SCOPES:
        raise ValueError("不支持的内容类型")
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute(
            "SELECT t.* FROM content_tags t JOIN content_tag_links l ON l.tag_id=t.id WHERE t.owner_teacher_id=? AND l.scope=? AND l.item_id=? ORDER BY t.name",
            (owner, scope, item_id),
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def all_item_tags(root: Path, user: dict[str, Any], scope: str) -> dict[str, list[dict[str, Any]]]:
    owner = _owner(user)
    if scope not in TAG_SCOPES:
        raise ValueError("不支持的内容类型")
    init_platform_db(root)
    with connect(root) as con:
        rows = con.execute(
            "SELECT l.item_id, t.id, t.name, t.color FROM content_tag_links l JOIN content_tags t ON t.id=l.tag_id WHERE t.owner_teacher_id=? AND l.scope=? ORDER BY t.name",
            (owner, scope),
        ).fetchall()
    out: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        out.setdefault(str(row["item_id"]), []).append({"id": row["id"], "name": row["name"], "color": row["color"]})
    return out


def analyze_paper_folder(root: Path, user: dict[str, Any], folder_id: str) -> dict[str, Any]:
    """Analyze actual recipients only; never count unassigned classmates as zero."""
    owner = _owner(user)
    init_platform_db(root)
    with connect(root) as con:
        folder = _folder(con, folder_id, owner, "paper")
        rows = con.execute(
            """WITH RECURSIVE subtree(id) AS (
                 SELECT id FROM content_folders WHERE id=?
                 UNION ALL SELECT child.id FROM content_folders child JOIN subtree parent ON child.parent_id=parent.id
               )
               SELECT sa.id, sa.student_id, sa.status, sa.score, sa.max_score,
                      sa.grading_completed_at, ep.id AS publication_id, ep.title, ep.recipient_scope,
                      ep.paper_id, s.display_name, s.student_no
               FROM exam_publications ep
               JOIN student_attempts sa ON sa.publication_id=ep.id
               JOIN students s ON s.id=sa.student_id
               WHERE ep.folder_id IN (SELECT id FROM subtree) AND ep.teacher_id=? AND ep.status<>'revoked'
               ORDER BY s.student_no, ep.created_at""",
            (folder_id, owner),
        ).fetchall()
    attempts = [row_to_dict(row) or {} for row in rows]
    primary = attempts if folder["kind"] == "paper" else [item for item in attempts if item["recipient_scope"] == "class"]
    personal = [item for item in attempts if item["recipient_scope"] == "student"]
    graded = [item for item in primary if item.get("grading_completed_at") is not None]
    percents = [100 * float(item["score"]) / float(item["max_score"])
                for item in graded if item.get("score") is not None and float(item.get("max_score") or 0) > 0]
    return {
        "folder": folder,
        "summary": {
            "assigned_count": len(primary),
            "submitted_count": sum(item.get("status") in {"submitted", "completed"} for item in primary),
            "graded_count": len(graded),
            "average_score_percent": round(sum(percents) / len(percents), 1) if percents else None,
            "publication_count": len({str(item["publication_id"]) for item in primary}),
        },
        "personal_summary": {
            "assigned_count": len(personal),
            "submitted_count": sum(item.get("status") in {"submitted", "completed"} for item in personal),
        } if folder["kind"] == "category" else None,
        "attempts": attempts,
    }
