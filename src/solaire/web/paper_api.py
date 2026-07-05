"""FastAPI routes for paper management and online publishing."""

from __future__ import annotations

import sqlite3
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from solaire.web import state
from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.paper_service import (
    analyze_paper,
    list_papers,
    list_teacher_classes,
    publish_online_paper,
    update_paper_delivery_mode,
)
from solaire.web.project_layout import ensure_project_layout

router = APIRouter()


class PaperUpdateBody(BaseModel):
    delivery_mode: Literal["offline", "online"]


class PaperPublishBody(BaseModel):
    class_ids: list[str] = Field(..., min_length=1)
    title: str | None = None
    description: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    show_results_immediately: bool = False
    randomize_questions: bool = False
    randomize_answers: bool = False


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, (ValueError, sqlite3.IntegrityError)):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def require_content_project_root():
    root = state.get_content_root()
    ensure_project_layout(root)
    return root


@router.get("/papers")
def papers_list(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    platform_root = require_platform_root()
    project_root = require_content_project_root()
    try:
        papers = list_papers(project_root, platform_root, user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"papers": papers}


@router.patch("/papers/{paper_id}")
def papers_update(
    paper_id: str,
    body: PaperUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        paper = update_paper_delivery_mode(root, paper_id, body.delivery_mode, user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"paper": paper}


@router.get("/papers/{paper_id}/analysis")
def papers_analysis(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        analysis = analyze_paper(root, paper_id=paper_id, user=user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"analysis": analysis}


@router.get("/teacher/classes")
def teacher_classes_list(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    root = require_platform_root()
    try:
        classes = list_teacher_classes(root, user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"classes": classes}


@router.post("/papers/{paper_id}/publish")
def papers_publish(
    paper_id: str,
    body: PaperPublishBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        publication = publish_online_paper(
            root,
            paper_id=paper_id,
            user=user,
            class_ids=body.class_ids,
            title=body.title,
            description=body.description,
            start_at=body.start_at,
            end_at=body.end_at,
            show_results_immediately=body.show_results_immediately,
            randomize_questions=body.randomize_questions,
            randomize_answers=body.randomize_answers,
        )
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publication": publication}
