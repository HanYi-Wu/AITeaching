"""Teacher and student account lifecycle, status, import, and export routes."""

from __future__ import annotations

import sqlite3
from io import BytesIO
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
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
    BulkStatusBody,
    ResetPasswordBody,
    StudentImportBody,
    StudentClassTransferBody,
    StudentUpdateBody,
    TeacherCreateBody,
    TeacherImportBody,
    TeacherUpdateBody,
)
from solaire.web.school_service import (
    bulk_update_students,
    bulk_update_teachers,
    create_teacher,
    import_students,
    import_teachers,
    list_students,
    query_students,
    query_teachers,
    reset_student_password,
    reset_teacher_password,
    update_student,
    update_teacher,
)
from solaire.web.school.transfers import (
    StudentClassTransferConflict,
    StudentClassTransferForbidden,
    StudentClassTransferNotFound,
    get_student_class_transfer_preview,
    transfer_student_class,
)

router = APIRouter()


def _students_export_workbook(students: list[dict[str, Any]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "students"
    headers = ("student_no", "display_name", "class_name", "account_username", "initial_password")
    ws.append(headers)
    for student in students:
        ws.append(
            [
                student.get("student_no"),
                student.get("display_name"),
                student.get("class_names") or "",
                student.get("account_username") or "",
                student.get("initial_password") or "",
            ]
        )
    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()


# --- Teachers ---


@router.get("/school/teachers")
def school_teachers_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return query_teachers(root, school_id=school_id, q=q, status=status, page=page, page_size=page_size)


@router.get("/school/teachers/template.xlsx")
def school_teachers_template(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> StreamingResponse:
    _require_school(user)
    data = _template_workbook(
        ("username", "password", "display_name", "email", "subjects"),
        [("teacher_zhang", "teacher123", "张老师", "teacher@example.com", "数学,物理")],
        "teachers",
    )
    return _workbook_response(data, "teachers_import_template.xlsx")


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


@router.post("/school/teachers/import")
def school_teachers_import(
    body: TeacherImportBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        result = import_teachers(root, school_id=school_id, teachers=body.teachers)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.post("/school/teachers/import-file")
async def school_teachers_import_file(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        rows = _rows_from_upload(file, expected="teachers")
        result = import_teachers(root, school_id=school_id, teachers=rows)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.patch("/school/teachers/{teacher_id}")
def school_teachers_update(
    teacher_id: str,
    body: TeacherUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        teacher = update_teacher(
            root,
            school_id=school_id,
            teacher_id=teacher_id,
            display_name=body.display_name,
            email=body.email,
            subjects=body.subjects,
            password=body.password,
            status=body.status,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"teacher": teacher}


@router.post("/school/teachers/bulk-status")
def school_teachers_bulk_status(
    body: BulkStatusBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return bulk_update_teachers(root, school_id=school_id, teacher_ids=body.ids, status=body.status)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)


@router.post("/school/teachers/{teacher_id}/reset-password")
def school_teachers_reset_password(
    teacher_id: str,
    body: ResetPasswordBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return reset_teacher_password(root, school_id=school_id, teacher_id=teacher_id, password=body.password)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)


# --- Students ---


@router.get("/school/students")
def school_students_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    class_id: str | None = None,
    q: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return query_students(root, school_id=school_id, class_id=class_id, q=q, status=status, page=page, page_size=page_size)


@router.get("/school/students/{student_id}/class-transfer")
def school_students_class_transfer_preview(
    student_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return get_student_class_transfer_preview(root, school_id=school_id, student_id=student_id)
    except StudentClassTransferNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        _raise_api_error(error)


@router.post("/school/students/{student_id}/class-transfer")
def school_students_class_transfer(
    student_id: str,
    body: StudentClassTransferBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return transfer_student_class(
            root,
            school_id=school_id,
            student_id=student_id,
            target_class_id=body.target_class_id,
            expected_class_ids=body.expected_class_ids,
            actor_id=str(user["id"]),
        )
    except StudentClassTransferConflict as error:
        raise HTTPException(status_code=409, detail="学生班级信息已变化，请刷新后重试") from error
    except StudentClassTransferNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except StudentClassTransferForbidden as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except (ValueError, sqlite3.IntegrityError) as error:
        _raise_api_error(error)


@router.get("/school/students/template.xlsx")
def school_students_template(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> StreamingResponse:
    _require_school(user)
    data = _template_workbook(
        ("student_no", "display_name", "email", "class_name"),
        [("S001", "学生一", "student@example.com", "高一 1 班")],
        "students",
    )
    return _workbook_response(data, "students_import_template.xlsx")


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
            students=body.students,
            class_id=body.class_id,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.patch("/school/students/{student_id}")
def school_students_update(
    student_id: str,
    body: StudentUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        student = update_student(
            root,
            school_id=school_id,
            student_id=student_id,
            student_no=body.student_no,
            display_name=body.display_name,
            email=body.email,
            status=body.status,
        )
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"student": student}


@router.post("/school/students/bulk-status")
def school_students_bulk_status(
    body: BulkStatusBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return bulk_update_students(root, school_id=school_id, student_ids=body.ids, status=body.status)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)


@router.post("/school/students/{student_id}/reset-password")
def school_students_reset_password(
    student_id: str,
    body: ResetPasswordBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        return reset_student_password(root, school_id=school_id, student_id=student_id, password=body.password)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)


@router.post("/school/students/import-file")
async def school_students_import_file(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    class_id: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    try:
        rows = _rows_from_upload(file, expected="students")
        result = import_students(root, school_id=school_id, students=rows, class_id=class_id)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.get("/school/students/export.xlsx")
def school_students_export(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> StreamingResponse:
    school_id = _require_school(user)
    root = require_platform_root()
    data = _students_export_workbook(list_students(root, school_id=school_id))
    return _workbook_response(data, "student_accounts.xlsx")
