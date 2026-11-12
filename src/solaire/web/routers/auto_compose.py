"""Teacher-facing, read-only goal selection and duplicate-check endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
import yaml

from solaire.common.actor_context import actor
from solaire.web.auto_compose.service import check_paper_duplicates, compose_options, generate_paper
from solaire.web.request_context import _require_root
from solaire.web.schemas.auto_compose import AutoComposeBody, DuplicateCheckBody

router = APIRouter(tags=["自动组卷与查重"])


def _teacher_root():
    user = actor.get()
    if not user or user.get("role") not in {"teacher", "admin"}:
        raise HTTPException(status_code=403, detail="仅教师和管理员可使用自动组卷与查重")
    return _require_root()


@router.get("/api/exam/auto-compose/options")
def auto_compose_options(subject: str | None = Query(default=None, max_length=500)) -> dict[str, Any]:
    return compose_options(_teacher_root(), subject)


@router.post("/api/exam/auto-compose")
def auto_compose(body: AutoComposeBody) -> dict[str, Any]:
    root = _teacher_root()
    try:
        return generate_paper(root, body)
    except (ValueError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/exam/check-duplicates")
def check_duplicates(body: DuplicateCheckBody) -> dict[str, Any]:
    root = _teacher_root()
    try:
        return check_paper_duplicates(root, body)
    except (ValueError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
