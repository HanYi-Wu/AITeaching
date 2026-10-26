"""Class management and teacher-class assignment routes."""

from __future__ import annotations

import sqlite3
from io import BytesIO
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.school_routes.common import (
    _raise_api_error,
    _require_school,
    _rows_from_upload,
    _template_workbook,
    _workbook_response,
)
from solaire.web.school_schemas import (
    ClassCreateBody,
    ClassImportBody,
    ClassUpdateBody,
    TeacherClassAssignmentBody,
)
from solaire.web.school_service import (
    assign_teacher_class,
    create_class,
    delete_class,
    import_classes,
    import_teacher_class_assignments,
    list_teacher_class_assignments,
    query_classes,
    remove_teacher_class_assignment,
    update_class,
)

router = APIRouter()


def _complete_school_template_workbook() -> bytes:
    wb = Workbook()
    specs = (
        ("classes", ("name", "grade"), ("高一1班", "高一")),
        ("teachers", ("username", "password", "display_name", "email", "subjects"), ("teacher_zhang", "teacher123", "张老师", "teacher@example.com", "数学")),
        ("students", ("student_no", "display_name", "email", "class_name"), ("S001", "学生一", "", "高一1班")),
        ("assignments", ("teacher_username", "class_name", "subject"), ("teacher_zhang", "高一1班", "数学")),
    )
    for index, (title, headers, example) in enumerate(specs):
        ws = wb.active if index == 0 else wb.create_sheet()
        ws.title = title
        ws.append(headers)
        ws.append(example)
    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()


# --- Classes ---


@router.get("/school/classes")
def school_classes_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return query_classes(root, school_id=school_id, q=q, page=page, page_size=page_size)


@router.get("/school/classes/template.xlsx")
def school_classes_template(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> StreamingResponse:
    _require_school(user)
    data = _template_workbook(
        ("name", "grade"),
        [("高一 1 班", "高一"), ("高一 2 班", "高一")],
        "classes",
    )
    return _workbook_response(data, "classes_import_template.xlsx")


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


@router.post("/school/classes/import")
def school_classes_import(
    body: ClassImportBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        result = import_classes(root, school_id=school_id, classes=body.classes)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.post("/school/classes/import-file")
async def school_classes_import_file(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        rows = _rows_from_upload(file, expected="classes")
        result = import_classes(root, school_id=school_id, classes=rows)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.patch("/school/classes/{class_id}")
def school_classes_update(
    class_id: str,
    body: ClassUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        klass = update_class(root, school_id=school_id, class_id=class_id, name=body.name, grade=body.grade)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"class": klass}


@router.delete("/school/classes/{class_id}")
def school_classes_delete(
    class_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return delete_class(root, school_id=school_id, class_id=class_id)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)


# --- Complete Template & Teacher Class Assignments ---


@router.get("/school/all/template.xlsx")
def school_complete_import_template(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> StreamingResponse:
    _require_school(user)
    return _workbook_response(_complete_school_template_workbook(), "school_complete_import_template.xlsx")


@router.get("/school/teacher-class-assignments/template.xlsx")
def school_teacher_class_assignments_template(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> StreamingResponse:
    _require_school(user)
    data = _template_workbook(
        ("teacher_username", "class_name", "subject"),
        [("teacher_zhang", "高一1班", "数学")],
        "assignments",
    )
    return _workbook_response(data, "teacher_class_assignments_import_template.xlsx")


@router.post("/school/teacher-class-assignments/import-file")
async def school_teacher_class_assignments_import_file(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        rows = _rows_from_upload(file, expected="assignments")
        return import_teacher_class_assignments(root, school_id=school_id, assignments=rows)
    except (ValueError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)


@router.get("/school/teacher-class-assignments")
def school_teacher_class_assignments_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return list_teacher_class_assignments(root, school_id=school_id, q=q, page=page, page_size=page_size)


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


@router.delete("/school/teacher-class-assignments")
def school_teacher_class_assignments_delete(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    teacher_id: str = Query(..., min_length=1),
    class_id: str = Query(..., min_length=1),
    subject: str | None = None,
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return remove_teacher_class_assignment(
            root,
            school_id=school_id,
            teacher_id=teacher_id,
            class_id=class_id,
            subject=subject,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
