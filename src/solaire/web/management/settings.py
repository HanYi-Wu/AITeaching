"""Effective management defaults and school-local dictionary overrides."""

from __future__ import annotations

import sqlite3
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, init_platform_db

DEFAULT_SETTINGS = {"default_page_size": 10, "activity_default_days": 30}
SETTING_VALUES = {"default_page_size": {10, 20, 50}, "activity_default_days": {7, 30, 90}}
BUILTIN_DICTIONARIES = {
    "subjects": ("语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "科学", "信息技术"),
    "grades": ("一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"),
}


def _scope_key(school_id: str | None) -> str:
    return f"school:{school_id}" if school_id else "platform"


def _check_school(con: sqlite3.Connection, school_id: str | None) -> None:
    if school_id and con.execute("SELECT 1 FROM schools WHERE id = ?", (school_id,)).fetchone() is None:
        raise ValueError("school not found")


def get_settings(root: Path, *, school_id: str | None = None) -> dict[str, Any]:
    init_platform_db(root)
    with closing(connect(root)) as con:
        _check_school(con, school_id)
        platform_row = con.execute("SELECT * FROM management_settings WHERE scope_key = 'platform'").fetchone()
        school_row = con.execute(
            "SELECT * FROM management_settings WHERE scope_key = ?", (_scope_key(school_id),)
        ).fetchone() if school_id else None
    effective = dict(DEFAULT_SETTINGS)
    inherited = dict(DEFAULT_SETTINGS)
    sources = dict.fromkeys(DEFAULT_SETTINGS, "builtin")
    for source, row in (("platform", platform_row), ("school", school_row)):
        if source == "school" and school_id:
            inherited = dict(effective)
        if row:
            for key in DEFAULT_SETTINGS:
                if row[key] is not None:
                    effective[key] = int(row[key])
                    sources[key] = source
    own_row = school_row if school_id else platform_row
    return {
        "settings": effective,
        "inherited_settings": inherited,
        "overrides": {key: own_row[key] if own_row else None for key in DEFAULT_SETTINGS},
        "sources": sources,
    }


def update_settings(root: Path, *, school_id: str | None = None, changes: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    if not changes or set(changes) - set(DEFAULT_SETTINGS):
        raise ValueError("请选择有效的管理参数")
    for key, value in changes.items():
        if value is not None and (type(value) is not int or value not in SETTING_VALUES[key]):
            raise ValueError("管理参数的取值无效")
    with closing(connect(root)) as con, con:
        con.execute("BEGIN IMMEDIATE")
        _check_school(con, school_id)
        key = _scope_key(school_id)
        previous = con.execute("SELECT * FROM management_settings WHERE scope_key = ?", (key,)).fetchone()
        values = {name: previous[name] if previous else None for name in DEFAULT_SETTINGS}
        values.update(changes)
        con.execute(
            """INSERT INTO management_settings(scope_key, school_id, default_page_size, activity_default_days, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(scope_key) DO UPDATE SET default_page_size=excluded.default_page_size,
                 activity_default_days=excluded.activity_default_days, updated_at=excluded.updated_at""",
            (key, school_id, values["default_page_size"], values["activity_default_days"], utc_now()),
        )
    return get_settings(root, school_id=school_id)


def _category(category: str) -> str:
    if category not in BUILTIN_DICTIONARIES:
        raise ValueError("不支持的字典类型")
    return category


def _item(row: Any) -> dict[str, Any]:
    item = dict(row)
    item.pop("scope_key", None)
    item["source"] = "school" if item.get("school_id") else "platform"
    return item


def _builtins(category: str) -> list[dict[str, Any]]:
    return [
        {"id": f"builtin:{category}:{value}", "category": category, "value": value, "label": value,
         "sort_order": index * 10, "status": "active", "school_id": None, "source": "builtin"}
        for index, value in enumerate(BUILTIN_DICTIONARIES[category], start=1)
    ]


def list_dictionary(root: Path, *, category: str, school_id: str | None = None) -> dict[str, Any]:
    init_platform_db(root)
    category = _category(category)
    by_value = {item["value"]: item for item in _builtins(category)}
    with closing(connect(root)) as con:
        _check_school(con, school_id)
        keys = ["platform", _scope_key(school_id)] if school_id else ["platform"]
        for scope_key in keys:
            for row in con.execute(
                "SELECT * FROM management_dictionary_items WHERE scope_key = ? AND category = ?",
                (scope_key, category),
            ):
                by_value[str(row["value"])] = _item(row)
    items = sorted(by_value.values(), key=lambda item: (int(item["sort_order"]), str(item["label"]), str(item["value"])))
    return {"category": category, "items": items, "effective_items": [item for item in items if item["status"] == "active"]}


def _clean_item(values: dict[str, Any]) -> dict[str, Any]:
    result = dict(values)
    result["category"] = _category(str(result["category"]))
    for key in ("value", "label"):
        result[key] = str(result[key]).strip()
        if not result[key] or len(result[key]) > 80:
            raise ValueError("字典值和名称须为 1 至 80 个字符")
    if result.get("status", "active") not in {"active", "disabled"}:
        raise ValueError("字典状态无效")
    result["status"] = result.get("status", "active")
    order = result.get("sort_order", 0)
    if type(order) is not int or not -9999 <= order <= 9999:
        raise ValueError("排序值须在 -9999 至 9999 之间")
    result["sort_order"] = order
    return result


def _insert_item(con: sqlite3.Connection, school_id: str | None, values: dict[str, Any]) -> dict[str, Any]:
    item_id = uuid.uuid4().hex
    now = utc_now()
    con.execute(
        """INSERT INTO management_dictionary_items
           (id, scope_key, school_id, category, value, label, sort_order, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (item_id, _scope_key(school_id), school_id, values["category"], values["value"], values["label"],
         values["sort_order"], values["status"], now, now),
    )
    return _item(con.execute("SELECT * FROM management_dictionary_items WHERE id = ?", (item_id,)).fetchone())


def create_dictionary_item(root: Path, *, school_id: str | None = None, values: dict[str, Any]) -> dict[str, Any]:
    init_platform_db(root)
    clean = _clean_item(values)
    with closing(connect(root)) as con, con:
        con.execute("BEGIN IMMEDIATE")
        _check_school(con, school_id)
        return _insert_item(con, school_id, clean)


def update_dictionary_item(
    root: Path, *, item_id: str, changes: dict[str, Any], school_id: str | None = None,
) -> dict[str, Any]:
    init_platform_db(root)
    if not changes:
        raise ValueError("请至少修改一个字典字段")
    with closing(connect(root)) as con, con:
        con.execute("BEGIN IMMEDIATE")
        _check_school(con, school_id)
        row = con.execute("SELECT * FROM management_dictionary_items WHERE id = ?", (item_id,)).fetchone()
        original = _item(row) if row else next(
            (item for category in BUILTIN_DICTIONARIES for item in _builtins(category) if item["id"] == item_id), None
        )
        if original is None or (row and row["school_id"] not in (None, school_id)):
            raise ValueError("dictionary item not found")
        if changes.get("category", original["category"]) != original["category"]:
            raise ValueError("不能更改字典类型")
        own_item = row is not None and row["scope_key"] == _scope_key(school_id)
        if not own_item and changes.get("value", original["value"]) != original["value"]:
            raise ValueError("继承条目的值不可修改，请新增条目")
        clean = _clean_item({**original, **changes})
        if not own_item:
            existing = con.execute(
                "SELECT id FROM management_dictionary_items WHERE scope_key=? AND category=? AND value=?",
                (_scope_key(school_id), original["category"], original["value"]),
            ).fetchone()
            if existing:
                raise ValueError("条目已被更新，请刷新后重试")
            return _insert_item(con, school_id, clean)
        con.execute(
            """UPDATE management_dictionary_items SET value=?, label=?, sort_order=?, status=?, updated_at=?
               WHERE id=? AND scope_key=?""",
            (clean["value"], clean["label"], clean["sort_order"], clean["status"], utc_now(), item_id, _scope_key(school_id)),
        )
        return _item(con.execute("SELECT * FROM management_dictionary_items WHERE id = ?", (item_id,)).fetchone())


def get_options(root: Path, *, school_id: str | None = None) -> dict[str, Any]:
    return {
        "settings": get_settings(root, school_id=school_id)["settings"],
        "subjects": list_dictionary(root, category="subjects", school_id=school_id)["effective_items"],
        "grades": list_dictionary(root, category="grades", school_id=school_id)["effective_items"],
    }
