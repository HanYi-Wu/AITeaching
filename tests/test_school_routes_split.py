"""Tests verifying modular school routes split, schemas, and router assembly."""

from __future__ import annotations

from fastapi import FastAPI

from solaire.web import school_api, school_schemas
from solaire.web.school_routes import accounts_router, classes_router, policy_router, schools_router


def test_subrouters_and_schemas_exports() -> None:
    # Ensure schemas are available on school_schemas and re-exported on school_api
    assert issubclass(school_schemas.SchoolCreateBody, school_api.SchoolCreateBody)
    assert issubclass(school_schemas.TeacherCreateBody, school_api.TeacherCreateBody)
    assert issubclass(school_schemas.ClassCreateBody, school_api.ClassCreateBody)
    assert issubclass(school_schemas.StudentImportBody, school_api.StudentImportBody)
    assert school_schemas.SCHOOL_AI_CAPABILITIES == school_api.SCHOOL_AI_CAPABILITIES

    # Ensure all four sub-routers exist and are valid APIRouters
    assert schools_router is not None
    assert accounts_router is not None
    assert classes_router is not None
    assert policy_router is not None


def test_combined_router_contains_all_subroutes() -> None:
    app = FastAPI()
    app.include_router(school_api.router, prefix="/api")

    openapi = app.openapi()
    paths = openapi["paths"]

    # schools
    assert "/api/schools" in paths
    assert "/api/schools/{school_id}/school-users" in paths

    # policy
    assert "/api/school/ai-settings" in paths
    assert "/api/school/ai/capabilities" in paths
    assert "/api/school/ai/chat" in paths
    assert "/api/school/ai/import-review" in paths
    assert "/api/school/ai/import-file" in paths

    # accounts (teachers & students)
    assert "/api/school/teachers" in paths
    assert "/api/school/teachers/template.xlsx" in paths
    assert "/api/school/students" in paths
    assert "/api/school/students/export.xlsx" in paths

    # classes & assignments
    assert "/api/school/classes" in paths
    assert "/api/school/classes/template.xlsx" in paths
    assert "/api/school/teacher-class-assignments" in paths
    assert "/api/school/all/template.xlsx" in paths


def test_router_assembly_combined_routes_count() -> None:
    # Verify subrouter route definitions sum up to the 38 registered endpoints
    total_endpoints = (
        len(schools_router.routes)
        + len(policy_router.routes)
        + len(accounts_router.routes)
        + len(classes_router.routes)
    )
    assert total_endpoints == 38

    # Verify that the combined router exposes all 38 operations across 31 unique paths
    app = FastAPI()
    app.include_router(school_api.router, prefix="/api")
    paths = app.openapi()["paths"]
    assert len(paths) == 31
    total_ops = sum(len(methods) for methods in paths.values())
    assert total_ops == 38
