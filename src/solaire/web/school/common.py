"""Common utilities and constants for school domain services."""

from __future__ import annotations

import sqlite3
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


def _new_student_usernames(con: Any, school_id: str, count: int) -> list[str]:
    """Reserve a batch of unique account names with bounded IN queries."""
    if count <= 0:
        return []
    names: list[str | None] = [None] * count
    retries = [0] * count
    pending = list(range(count))
    reserved: set[str] = set()
    while pending:
        candidates = {
            index: f"s{secrets.randbelow(90_000_000) + 10_000_000}"
            for index in pending
            if retries[index] < 20
        }
        occupied = {
            str(row["username"])
            for row in _fetch_in_values(
                con,
                "SELECT username FROM users WHERE username IN ({})",
                list(candidates.values()),
            )
        } if candidates else set()
        next_pending: list[int] = []
        for index in pending:
            candidate = candidates.get(index)
            if candidate is not None and candidate not in occupied and candidate not in reserved:
                names[index] = candidate
                reserved.add(candidate)
                continue
            retries[index] += 1
            if retries[index] >= 20:
                fallback = f"stu_{school_id[:4]}_{uuid.uuid4().hex}"
                while fallback in reserved:
                    fallback = f"stu_{school_id[:4]}_{uuid.uuid4().hex}"
                names[index] = fallback
                reserved.add(fallback)
            else:
                next_pending.append(index)
        pending = next_pending
    return [str(name) for name in names]


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


def _page_bounds(*, page: int, page_size: int, total: int) -> tuple[int, int, int, int]:
    clean_page = max(1, int(page or 1))
    clean_page_size = max(1, min(MAX_PAGE_SIZE, int(page_size or 10)))
    total_pages = max(1, (total + clean_page_size - 1) // clean_page_size)
    clean_page = min(clean_page, total_pages)
    return clean_page, clean_page_size, total_pages, (clean_page - 1) * clean_page_size


def _register_school_query_functions(con: Any) -> None:
    """Register Python-equivalent text search for SQLite queries."""
    con.create_function("school_text_contains", -1, _sql_text_contains, deterministic=True)


def _sql_text_contains(query: object, *values: object) -> int:
    needle = str(query or "").strip().lower()
    if not needle:
        return 1
    text = " ".join(str(value) for value in values if value is not None).lower()
    return int(needle in text)


def _sql_search_clause(query: str | None, values_sql: str) -> tuple[str, list[object]]:
    if not query:
        return "", []
    return f" AND school_text_contains(?, {values_sql})", [query]


def _fetch_in_values(
    con: Any,
    sql_template: str,
    values: list[str],
    *,
    prefix_params: tuple[object, ...] = (),
) -> list[Any]:
    unique_values = list(dict.fromkeys(values))
    rows: list[Any] = []
    for start in range(0, len(unique_values), 400):
        chunk = unique_values[start : start + 400]
        placeholders = ",".join("?" for _ in chunk)
        rows.extend(con.execute(sql_template.format(placeholders), (*prefix_params, *chunk)).fetchall())
    return rows


def _fetch_sql_page(
    con: Any,
    *,
    ctes: str,
    rows_sql: str,
    params: tuple[object, ...],
    order_by: str,
    identity_column: str,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int, int, int, int]:
    requested_page = max(1, int(page or 1))
    clean_page_size = max(1, min(MAX_PAGE_SIZE, int(page_size or 10)))
    materialized = "MATERIALIZED " if sqlite3.sqlite_version_info >= (3, 35, 0) else ""
    rows = con.execute(
        f"""
        WITH {ctes},
        matched_rows AS {materialized}({rows_sql}),
        page_totals AS {materialized}(
            SELECT COUNT(*) AS __page_total,
                   MAX(1, (COUNT(*) + ? - 1) / ?) AS __page_total_pages
            FROM matched_rows
        ),
        page_stats AS {materialized}(
            SELECT __page_total, __page_total_pages,
                   CASE
                       WHEN ? > __page_total_pages THEN (__page_total_pages - 1) * ?
                       ELSE (? - 1) * ?
                   END AS __page_offset
            FROM page_totals
        )
        SELECT page_stats.__page_total AS __page_total,
               page_stats.__page_total_pages AS __page_total_pages,
               matched_rows.*
        FROM page_stats LEFT JOIN matched_rows ON 1 = 1
        ORDER BY {order_by}
        LIMIT ?
        OFFSET (SELECT __page_offset FROM page_stats)
        """,
        (
            *params,
            clean_page_size,
            clean_page_size,
            requested_page,
            clean_page_size,
            requested_page,
            clean_page_size,
            clean_page_size,
        ),
    ).fetchall()
    total = int(rows[0]["__page_total"])
    clean_page, clean_page_size, total_pages, _ = _page_bounds(
        page=requested_page, page_size=clean_page_size, total=total
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        item = row_to_dict(row) or {}
        item.pop("__page_total", None)
        item.pop("__page_total_pages", None)
        if item.get(identity_column) is not None:
            items.append(item)
    return items, total, clean_page, clean_page_size, total_pages


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


def _student_with_account(con: Any, student_id: str) -> dict[str, Any]:
    row = con.execute(
        """
        SELECT s.*, u.username AS account_username
        FROM students s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
        """,
        (student_id,),
    ).fetchone()
    data = row_to_dict(row)
    if data is None:
        raise RuntimeError("failed to load student")
    return data
