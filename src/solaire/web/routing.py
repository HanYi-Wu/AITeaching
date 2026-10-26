"""Explicit composition of platform and business routers."""

from __future__ import annotations

from fastapi import FastAPI

from solaire.web.agent_api import router as agent_router
from solaire.web.auth_api import router as auth_router
from solaire.web.paper_api import router as paper_router
from solaire.web.school_api import router as school_router
from solaire.web.student_api import router as student_router
from solaire.web.routers.learning_progress import router as learning_progress_router
from solaire.web.routers import (
    analysis,
    bank,
    exams,
    export_tasks,
    graph,
    projects,
    system,
    task_tracking,
    templates,
)


def register_routes(app: FastAPI) -> None:
    for router in (
        agent_router,
        auth_router,
        school_router,
        paper_router,
        student_router,
        learning_progress_router,
    ):
        app.include_router(router, prefix="/api")
    for module in (
        system,
        projects,
        bank,
        templates,
        exams,
        graph,
        analysis,
        export_tasks,
        task_tracking,
    ):
        app.include_router(module.router)
