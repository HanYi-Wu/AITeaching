"""FastAPI routes for paper management and online publishing."""

from __future__ import annotations

import sqlite3
import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from solaire.web import state
from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.paper_service import (
    analyze_paper,
    grade_paper_answer,
    list_paper_publications,
    list_paper_submissions,
    list_teacher_classes,
    publish_online_paper,
    query_papers,
    revoke_paper_publication,
    suggest_ai_grades_for_attempt,
    sync_paper_for_exam,
    update_paper_publication,
    update_paper_delivery_mode,
)
from solaire.web.project_layout import ensure_project_layout

router = APIRouter()
logger = logging.getLogger(__name__)


class PaperUpdateBody(BaseModel):
    delivery_mode: Literal["offline", "online"]


class PaperFromExamBody(BaseModel):
    exam_id: str = Field(..., min_length=1)


class PaperPublishBody(BaseModel):
    class_ids: list[str] = Field(..., min_length=1)
    title: str | None = None
    description: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    show_results_immediately: bool = False
    randomize_questions: bool = False
    randomize_answers: bool = False
    submission_mode: Literal["online", "image_manual", "image_ai"] = "online"
    max_screen_switches: int = Field(default=0, ge=0, le=999)
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)


class PaperPublicationUpdateBody(BaseModel):
    title: str | None = None
    description: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)
    show_results_immediately: bool | None = None
    status: str | None = None


class PaperAiGradeBody(BaseModel):
    question_ids: list[str] | None = None


class PaperAnswerGradeBody(BaseModel):
    score: float = Field(..., ge=0)
    feedback: str | None = None
    is_correct: bool | None = None


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        logger.warning("paper api permission denied: %s", exc)
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, FileNotFoundError):
        logger.warning("paper api missing resource: %s", exc)
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, (ValueError, sqlite3.IntegrityError)):
        logger.warning("paper api invalid request: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def require_content_project_root():
    root = state.get_content_root()
    ensure_project_layout(root)
    return root


@router.get("/papers")
def papers_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    delivery_mode: str | None = None,
    status: str | None = None,
    subject: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    platform_root = require_platform_root()
    project_root = require_content_project_root()
    try:
        result = query_papers(
            project_root,
            platform_root,
            user,
            q=q,
            delivery_mode=delivery_mode,
            status=status,
            subject=subject,
            page=page,
            page_size=page_size,
        )
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.post("/papers/from-exam")
def papers_from_exam(
    body: PaperFromExamBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    platform_root = require_platform_root()
    project_root = require_content_project_root()
    try:
        paper = sync_paper_for_exam(project_root, platform_root, user, exam_id=body.exam_id)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"paper": paper}


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
    project_root = require_content_project_root()
    try:
        analysis = analyze_paper(root, paper_id=paper_id, user=user, project_root=project_root)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"analysis": analysis}


@router.get("/papers/{paper_id}/publications")
def papers_publications(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        publications = list_paper_publications(root, paper_id=paper_id, user=user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publications": publications}


@router.get("/papers/{paper_id}/submissions")
def papers_submissions(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        submissions = list_paper_submissions(root, project_root, paper_id=paper_id, user=user)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"submissions": submissions}


@router.post("/papers/{paper_id}/attempts/{attempt_id}/ai-grade")
def papers_attempt_ai_grade(
    paper_id: str,
    attempt_id: str,
    body: PaperAiGradeBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        suggestions = suggest_ai_grades_for_attempt(
            root,
            project_root,
            paper_id=paper_id,
            attempt_id=attempt_id,
            user=user,
            question_ids=body.question_ids,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"suggestions": suggestions}


@router.patch("/papers/{paper_id}/attempts/{attempt_id}/answers/{question_id:path}/grade")
def papers_attempt_answer_grade(
    paper_id: str,
    attempt_id: str,
    question_id: str,
    body: PaperAnswerGradeBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        answer = grade_paper_answer(
            root,
            project_root,
            paper_id=paper_id,
            attempt_id=attempt_id,
            question_id=question_id,
            user=user,
            score=body.score,
            feedback=body.feedback,
            is_correct=body.is_correct,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"answer": answer}


@router.patch("/papers/{paper_id}/publications/{publication_id}")
def papers_publications_update(
    paper_id: str,
    publication_id: str,
    body: PaperPublicationUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        publication = update_paper_publication(
            root,
            paper_id=paper_id,
            publication_id=publication_id,
            user=user,
            title=body.title,
            description=body.description,
            start_at=body.start_at,
            end_at=body.end_at,
            time_limit_minutes=body.time_limit_minutes,
            show_results_immediately=body.show_results_immediately,
            status=body.status,
        )
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publication": publication}


@router.delete("/papers/{paper_id}/publications/{publication_id}")
def papers_publications_revoke(
    paper_id: str,
    publication_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        publication = revoke_paper_publication(root, paper_id=paper_id, publication_id=publication_id, user=user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publication": publication}


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
    project_root = require_content_project_root()
    try:
        publication = publish_online_paper(
            root,
            paper_id=paper_id,
            user=user,
            class_ids=body.class_ids,
            project_root=project_root,
            title=body.title,
            description=body.description,
            start_at=body.start_at,
            end_at=body.end_at,
            show_results_immediately=body.show_results_immediately,
            randomize_questions=body.randomize_questions,
            randomize_answers=body.randomize_answers,
            submission_mode=body.submission_mode,
            max_screen_switches=body.max_screen_switches,
            time_limit_minutes=body.time_limit_minutes,
        )
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publication": publication}
