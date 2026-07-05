"""FastAPI routes for student online exams."""

from __future__ import annotations

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from solaire.web import state
from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.project_layout import ensure_project_layout
from solaire.web.student_service import (
    list_student_papers,
    list_student_results,
    record_student_proctor_event,
    save_student_answers,
    start_student_publication,
    submit_student_attempt,
)

router = APIRouter()


class StudentAnswerIn(BaseModel):
    question_id: str = Field(..., min_length=1)
    answer: Any = None
    images: list[dict[str, Any]] | None = None


class StudentAnswersBody(BaseModel):
    answers: list[StudentAnswerIn] = Field(default_factory=list)


class StudentSubmitBody(BaseModel):
    time_spent_seconds: int | None = Field(default=None, ge=0)


class StudentProctorEventBody(BaseModel):
    event_type: str = Field(..., min_length=1)
    duration_ms: int | None = Field(default=None, ge=0)
    payload: dict[str, Any] | None = None


def _content_root():
    root = state.get_content_root()
    ensure_project_layout(root)
    return root


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, FileNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, (ValueError, sqlite3.IntegrityError)):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


@router.get("/student/papers")
def student_papers(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    root = require_platform_root()
    project_root = _content_root()
    try:
        papers = list_student_papers(root, project_root, user)
    except (PermissionError, FileNotFoundError, ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"papers": papers}


@router.post("/student/publications/{publication_id}/start")
def student_publication_start(
    publication_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = _content_root()
    try:
        return start_student_publication(root, project_root, publication_id=publication_id, user=user)
    except (PermissionError, FileNotFoundError, ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    raise RuntimeError("unreachable")


@router.post("/student/attempts/{attempt_id}/answers")
def student_attempt_answers(
    attempt_id: str,
    body: StudentAnswersBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        return save_student_answers(
            root,
            attempt_id=attempt_id,
            user=user,
            answers=[item.model_dump(mode="json") for item in body.answers],
        )
    except (PermissionError, FileNotFoundError, ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    raise RuntimeError("unreachable")


@router.post("/student/attempts/{attempt_id}/proctor-events")
def student_attempt_proctor_event(
    attempt_id: str,
    body: StudentProctorEventBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        event = record_student_proctor_event(
            root,
            attempt_id=attempt_id,
            user=user,
            event_type=body.event_type,
            duration_ms=body.duration_ms,
            payload=body.payload,
        )
    except (PermissionError, FileNotFoundError, ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"event": event}


@router.post("/student/attempts/{attempt_id}/submit")
def student_attempt_submit(
    attempt_id: str,
    body: StudentSubmitBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = _content_root()
    try:
        attempt = submit_student_attempt(
            root,
            project_root,
            attempt_id=attempt_id,
            user=user,
            time_spent_seconds=body.time_spent_seconds,
        )
    except (PermissionError, FileNotFoundError, ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"attempt": attempt}


@router.get("/student/results")
def student_results(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    root = require_platform_root()
    project_root = _content_root()
    try:
        results = list_student_results(root, project_root, user)
    except (PermissionError, FileNotFoundError, ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"results": results}
