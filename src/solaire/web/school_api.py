"""FastAPI routes for admin and school management workflows."""

from __future__ import annotations

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.school_service import (
    assign_teacher_class,
    create_class,
    create_school,
    create_school_user,
    create_teacher,
    get_school,
    import_students,
    list_classes,
    list_schools,
    list_teachers,
)

router = APIRouter()


class SchoolCreateBody(BaseModel):
    name: str = Field(..., min_length=1)


class UserCreateBody(BaseModel):
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)
    display_name: str = Field(default="")
    email: str | None = None


class TeacherCreateBody(UserCreateBody):
    subjects: list[str] = Field(default_factory=list)


class ClassCreateBody(BaseModel):
    name: str = Field(..., min_length=1)
    grade: str | None = None
    subject_hint: str | None = None


class StudentImportItem(BaseModel):
    student_no: str = Field(..., min_length=1)
    display_name: str = Field(..., min_length=1)
    email: str | None = None


class StudentImportBody(BaseModel):
    students: list[StudentImportItem]
    class_id: str | None = None


class TeacherClassAssignmentBody(BaseModel):
    teacher_id: str = Field(..., min_length=1)
    class_id: str = Field(..., min_length=1)
    subject: str = Field(..., min_length=1)


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


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, sqlite3.IntegrityError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


@router.get("/schools")
def schools_list(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    return {"schools": list_schools(root)}


@router.post("/schools")
def schools_create(
    body: SchoolCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    try:
        school = create_school(root, name=body.name)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"school": school}


@router.post("/schools/{school_id}/school-users")
def school_users_create(
    school_id: str,
    body: UserCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    try:
        school = get_school(root, school_id=school_id)
        created = create_school_user(
            root,
            school_id=school_id,
            username=body.username,
            password=body.password,
            display_name=body.display_name,
            email=body.email,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"school": school, "user": created}


@router.get("/school/teachers")
def school_teachers_list(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return {"teachers": list_teachers(root, school_id=school_id)}


@router.post("/school/teachers")
def school_teachers_create(
    body: TeacherCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        teacher = create_teacher(
            root,
            school_id=school_id,
            username=body.username,
            password=body.password,
            display_name=body.display_name,
            email=body.email,
            subjects=body.subjects,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"teacher": teacher}


@router.get("/school/classes")
def school_classes_list(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return {"classes": list_classes(root, school_id=school_id)}


@router.post("/school/classes")
def school_classes_create(
    body: ClassCreateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        klass = create_class(
            root,
            school_id=school_id,
            name=body.name,
            grade=body.grade,
            subject_hint=body.subject_hint,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"class": klass}


@router.post("/school/students/import")
def school_students_import(
    body: StudentImportBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        result = import_students(
            root,
            school_id=school_id,
            students=[item.model_dump() for item in body.students],
            class_id=body.class_id,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.post("/school/teacher-class-assignments")
def school_teacher_class_assignments_create(
    body: TeacherClassAssignmentBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        assignment = assign_teacher_class(
            root,
            school_id=school_id,
            teacher_id=body.teacher_id,
            class_id=body.class_id,
            subject=body.subject,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"assignment": assignment}
