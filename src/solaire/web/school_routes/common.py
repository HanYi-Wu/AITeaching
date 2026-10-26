"""Shared dependencies, workbook utilities, and validation helpers for school routes."""

from __future__ import annotations

import json
import sqlite3
from io import BytesIO
from typing import Any

from fastapi import HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook

from solaire.agent_layer.llm.router import load_llm_settings
from solaire.web import state


def _require_admin(user: dict[str, Any]) -> None:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")


def _require_school(user: dict[str, Any]) -> str:
    if user.get("role") != "school":
        raise HTTPException(status_code=403, detail="School role required")
    school_id = user.get("school_id")
    if not isinstance(school_id, str) or not school_id:
        raise HTTPException(status_code=403, detail="School account is not bound to a school")
    return school_id


def _admin_ai_available() -> bool:
    return bool(load_llm_settings(state.get_root()).api_key)


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, sqlite3.IntegrityError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def _worksheet_rows(ws: Any) -> list[dict[str, Any]]:
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(value or "").strip() for value in rows[0]]
    result: list[dict[str, Any]] = []
    for values in rows[1:]:
        item = {key: value for key, value in zip(headers, values) if key}
        if any(value not in (None, "") for value in item.values()):
            result.append(item)
    return result


def _rows_from_upload(file: UploadFile, *, expected: str) -> list[dict[str, Any]]:
    raw = file.file.read()
    name = (file.filename or "").lower()
    if name.endswith(".json"):
        try:
            parsed = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError("invalid json import file") from e
        if isinstance(parsed, dict):
            parsed = parsed.get(expected) or parsed.get("items") or []
        if not isinstance(parsed, list):
            raise ValueError("json import file must contain a list")
        return [dict(item) for item in parsed if isinstance(item, dict)]
    if not name.endswith(".xlsx"):
        raise ValueError("import file must be .json or .xlsx")
    wb = load_workbook(BytesIO(raw), data_only=True)
    return _worksheet_rows(wb.active)


def _template_workbook(headers: tuple[str, ...], examples: list[tuple[object, ...]], title: str) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = title
    ws.append(headers)
    for row in examples:
        ws.append(row)
    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()


def _workbook_response(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
