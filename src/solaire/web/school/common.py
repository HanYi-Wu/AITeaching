"""Common utilities and constants for school domain services."""

from __future__ import annotations

import secrets
import uuid
from pathlib import Path
from typing import Any

from solaire.web.platform_db import connect, row_to_dict

MAX_PAGE_SIZE = 100
VALID_ACCOUNT_STATUSES = {"active", "disabled"}


def _new_id() -> str:
    return uuid.uuid4().hex


def _new_student_password() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def _new_student_username(con: Any, school_id: str) -> str:
    """Generate a platform login username, not an exam taker number."""
    for _ in range(20):
        candidate = f"s{secrets.randbelow(90_000_000) + 10_000_000}"
        row = con.execute("SELECT 1 FROM users WHERE username = ?", (candidate,)).fetchone()
        if row is None:
            return candidate
    return f"stu_{school_id[:4]}_{uuid.uuid4().hex}"


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "none" else text


def _fetch_required(root: Path, sql: str, params: tuple[object, ...], message: str) -> dict[str, Any]:
    with connect(root) as con:
        row = con.execute(sql, params).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise ValueError(message)
    return data


def _page(items: list[dict[str, Any]], *, page: int = 1, page_size: int = 10) -> dict[str, Any]:
    clean_page = max(1, int(page or 1))
    clean_page_size = max(1, min(MAX_PAGE_SIZE, int(page_size or 10)))
    total = len(items)
    total_pages = max(1, (total + clean_page_size - 1) // clean_page_size)
    if clean_page > total_pages:
        clean_page = total_pages
    start = (clean_page - 1) * clean_page_size
    return {
        "items": items[start : start + clean_page_size],
        "total": total,
        "page": clean_page,
        "page_size": clean_page_size,
        "total_pages": total_pages,
    }


def _contains_query(item: dict[str, Any], query: str, fields: list[str]) -> bool:
    needle = query.strip().lower()
    if not needle:
        return True
    values: list[str] = []
    for field in fields:
        value = item.get(field)
        if isinstance(value, list):
            values.extend(str(part) for part in value)
        elif value is not None:
            values.append(str(value))
    return needle in " ".join(values).lower()


def _clean_status(status: str) -> str:
    clean = status.strip() or "active"
    if clean not in VALID_ACCOUNT_STATUSES:
        raise ValueError("status must be active or disabled")
    return clean
