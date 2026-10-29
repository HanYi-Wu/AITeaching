"""Teacher-owned analysis history organization, separate from paper records."""

from __future__ import annotations

import hashlib
import json
import re
from contextlib import closing
from pathlib import Path
from typing import Any, Iterable
import uuid

from solaire.common.atomic_files import write_text_atomic
from solaire.common.security import assert_within_project
from solaire.web.export_lock import FileLease
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.result_service import list_exam_results

VERSION = 1
MAX_FOLDERS = 500
MAX_ITEMS = 10_000
MAX_IDS_PER_REQUEST = 200
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_FOLDER_NAME = 80
MAX_ITEM_ID = 240


class AnalysisFoldersCorruptError(RuntimeError):
    """Stored analysis folder metadata is invalid and must not be overwritten."""


def _owner_id(value: str) -> str:
    owner_id = str(value or "").strip()
    if not owner_id or len(owner_id) > 200 or any(ord(char) < 32 for char in owner_id):
        raise ValueError("教师身份无效")
    return owner_id


def _item_key(value: Any) -> str:
    if not isinstance(value, str) or len(value) > MAX_ITEM_ID + 6:
        raise ValueError("分析记录编号无效")
    kind, separator, item_id = value.partition(":")
    if (
        not separator
        or kind not in {"paper", "exam"}
        or not item_id
        or len(item_id) > MAX_ITEM_ID
        or item_id != item_id.strip()
        or "\\" in item_id
        or any(ord(char) < 32 for char in item_id)
        or any(part in {"", ".", ".."} for part in item_id.split("/"))
    ):
        raise ValueError("分析记录编号无效")
    return f"{kind}:{item_id}"


def _folder_name(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("文件夹名称无效")
    name = value.strip()
    if (
        not name
        or len(name) > MAX_FOLDER_NAME
        or any(ord(char) < 32 or char in "/\\:*?\"<>|" for char in name)
    ):
        raise ValueError("文件夹名称须为 1 至 80 个字符，且不能包含路径分隔符")
    return name


def _empty_state() -> dict[str, Any]:
    return {"version": VERSION, "folders": [], "items": {}}


def _storage_paths(project_root: Path, owner_id: str) -> tuple[Path, Path, Path]:
    root = project_root.resolve()
    owner_key = hashlib.sha256(_owner_id(owner_id).encode("utf-8")).hexdigest()
    solaire_dir = root / ".solaire"
    storage_dir = solaire_dir / "analysis-folders"
    if solaire_dir.is_symlink() or storage_dir.is_symlink():
        raise ValueError("分析文件夹存储路径无效")
    path = storage_dir / f"{owner_key}.json"
    lock_path = storage_dir / f"{owner_key}.lock"
    assert_within_project(root, storage_dir)
    assert_within_project(root, path)
    assert_within_project(root, lock_path)
    if path.is_symlink() or lock_path.is_symlink():
        raise ValueError("分析文件夹存储路径无效")
    return root, path, lock_path


def _validated_state(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("version") != VERSION:
        raise ValueError("版本号无效")
    folders_raw = raw.get("folders")
    items_raw = raw.get("items")
    if not isinstance(folders_raw, list) or len(folders_raw) > MAX_FOLDERS or not isinstance(items_raw, dict):
        raise ValueError("数据结构无效")
    if len(items_raw) > MAX_ITEMS:
        raise ValueError("条目数量超出限制")

    folders: list[dict[str, str]] = []
    folder_ids: set[str] = set()
    folder_names: set[str] = set()
    for entry in folders_raw:
        if not isinstance(entry, dict):
            raise ValueError("文件夹记录无效")
        folder_id = entry.get("id")
        if not isinstance(folder_id, str) or re.fullmatch(r"[0-9a-f]{32}", folder_id) is None:
            raise ValueError("文件夹编号无效")
        name = _folder_name(entry.get("name"))
        folded = name.casefold()
        if folder_id in folder_ids or folded in folder_names:
            raise ValueError("文件夹重复")
        folder_ids.add(folder_id)
        folder_names.add(folded)
        folders.append({"id": folder_id, "name": name})

    items: dict[str, str] = {}
    for key, folder_id in items_raw.items():
        normalized_key = _item_key(key)
        if normalized_key != key or not isinstance(folder_id, str) or folder_id not in folder_ids:
            raise ValueError("归类记录无效")
        items[normalized_key] = folder_id
    return {"version": VERSION, "folders": folders, "items": items}


def _read_locked(path: Path) -> dict[str, Any]:
    if path.is_symlink():
        raise ValueError("分析文件夹存储路径无效")
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return _empty_state()
    except OSError as exc:
        raise AnalysisFoldersCorruptError("无法读取分析文件夹数据") from exc
    if size > MAX_FILE_BYTES:
        raise AnalysisFoldersCorruptError("分析文件夹数据超出大小限制")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return _validated_state(raw)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        if isinstance(exc, ValueError) and str(exc) == "分析文件夹存储路径无效":
            raise
        raise AnalysisFoldersCorruptError("分析文件夹数据损坏；为保护现有记录，未覆盖该文件") from exc


def _write_locked(path: Path, state: dict[str, Any]) -> None:
    serialized = json.dumps(state, ensure_ascii=False, indent=2)
    if len(serialized.encode("utf-8")) > MAX_FILE_BYTES:
        raise ValueError("分析文件夹数据超出大小限制")
    if path.is_symlink():
        raise ValueError("分析文件夹存储路径无效")
    write_text_atomic(path, serialized)


def read(project_root: Path, *, owner_id: str) -> dict[str, Any]:
    root, path, lock_path = _storage_paths(project_root, owner_id)
    with FileLease(lock_path, timeout=5):
        assert_within_project(root, path)
        return _read_locked(path)


def mutate(
    project_root: Path,
    *,
    owner_id: str,
    action: str,
    visible_item_ids: Iterable[str] = (),
    folder_id: str | None = None,
    name: str | None = None,
    ids: list[str] | None = None,
) -> dict[str, Any]:
    if action not in {"create", "rename", "delete", "assign", "move"}:
        raise ValueError("操作类型无效")
    root, path, lock_path = _storage_paths(project_root, owner_id)
    with FileLease(lock_path, timeout=5):
        assert_within_project(root, path)
        state = _read_locked(path)
        folders = list(state["folders"])
        items = dict(state["items"])
        by_id = {folder["id"]: folder for folder in folders}

        if action == "create":
            clean_name = _folder_name(name)
            if len(folders) >= MAX_FOLDERS:
                raise ValueError("文件夹数量已达上限")
            if any(folder["name"].casefold() == clean_name.casefold() for folder in folders):
                raise ValueError("同名文件夹已存在")
            folders.append({"id": uuid.uuid4().hex, "name": clean_name})
        elif action == "rename":
            if not folder_id or folder_id not in by_id:
                raise ValueError("文件夹不存在")
            clean_name = _folder_name(name)
            if any(
                folder["id"] != folder_id and folder["name"].casefold() == clean_name.casefold()
                for folder in folders
            ):
                raise ValueError("同名文件夹已存在")
            by_id[folder_id]["name"] = clean_name
        elif action == "delete":
            if not folder_id or folder_id not in by_id:
                raise ValueError("文件夹不存在")
            folders = [folder for folder in folders if folder["id"] != folder_id]
            items = {key: value for key, value in items.items() if value != folder_id}
        else:
            clean_ids = list(dict.fromkeys(_item_key(item_id) for item_id in (ids or [])))
            if not clean_ids or len(clean_ids) > MAX_IDS_PER_REQUEST:
                raise ValueError(f"每次请选择 1 至 {MAX_IDS_PER_REQUEST} 条分析记录")
            if folder_id is not None and folder_id not in by_id:
                raise ValueError("目标文件夹不存在")
            allowed = {_item_key(item_id) for item_id in visible_item_ids}
            if any(item_id not in allowed for item_id in clean_ids):
                raise ValueError("部分分析记录不存在或不属于当前教师与项目，未应用变更")
            for item_id in clean_ids:
                if folder_id is None:
                    items.pop(item_id, None)
                else:
                    items[item_id] = folder_id
            if len(items) > MAX_ITEMS:
                raise ValueError("归类记录数量已达上限")

        updated = {"version": VERSION, "folders": folders, "items": items}
        _write_locked(path, updated)
        return updated


def visible_item_ids(project_root: Path, platform_root: Path, *, owner_id: str) -> set[str]:
    """Return item IDs the authenticated teacher may see in the active project."""
    teacher_id = _owner_id(owner_id)
    init_platform_db(platform_root)
    exams = list_exam_results(project_root)
    exams_by_id: dict[str, dict[str, Any]] = {
        str(exam.get("exam_id") or ""): exam
        for exam in exams
        if exam.get("exam_id")
    }
    with closing(connect(platform_root)) as con:
        paper_rows = con.execute(
            "SELECT id, exam_id, owner_teacher_id FROM paper_records"
        ).fetchall()
        publication_rows = con.execute(
            "SELECT DISTINCT paper_id, teacher_id FROM exam_publications"
        ).fetchall()

    owners_by_exam: dict[str, set[str]] = {}
    papers_by_exam: dict[str, list[Any]] = {}
    for row in paper_rows:
        exam_id = str(row["exam_id"] or "")
        owner = str(row["owner_teacher_id"] or "").strip()
        if owner:
            owners_by_exam.setdefault(exam_id, set()).add(owner)
        papers_by_exam.setdefault(exam_id, []).append(row)
    publication_owners: dict[str, set[str]] = {}
    for row in publication_rows:
        publication_owners.setdefault(str(row["paper_id"]), set()).add(str(row["teacher_id"]))

    visible_exams: set[str] = set()
    for exam_id, exam in exams_by_id.items():
        stored_owners = owners_by_exam.get(exam_id, set())
        declared_owner = str(exam.get("owner_teacher_id") or "").strip()
        if stored_owners:
            if stored_owners == {teacher_id}:
                visible_exams.add(exam_id)
        elif declared_owner == teacher_id:
            visible_exams.add(exam_id)

    result = {f"exam:{exam_id}" for exam_id in visible_exams}
    for row in paper_rows:
        paper_id = str(row["id"] or "")
        exam_id = str(row["exam_id"] or "")
        record_owner = str(row["owner_teacher_id"] or "").strip()
        publication_owner_set = publication_owners.get(paper_id, set())
        if exam_id.startswith("adaptive/"):
            if record_owner == teacher_id:
                result.add(f"paper:{paper_id}")
            continue
        if exam_id not in visible_exams:
            continue
        # A paper's explicit owner controls teacher visibility. A separate
        # publication owner must not hide a paper the current teacher owns.
        # For unowned legacy rows, publisher ownership is still needed to
        # distinguish a paper this teacher can claim from another teacher's.
        if record_owner == teacher_id:
            result.add(f"paper:{paper_id}")
        elif not record_owner and not owners_by_exam.get(exam_id) and not (publication_owner_set - {teacher_id}):
            result.add(f"paper:{paper_id}")
    return result
