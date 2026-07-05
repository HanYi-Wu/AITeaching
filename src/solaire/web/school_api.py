"""FastAPI routes for admin and school management workflows."""

from __future__ import annotations

import json
import sqlite3
from io import BytesIO
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel, Field

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.school_service import (
    assign_teacher_class,
    create_class,
    create_school,
    create_school_user,
    create_teacher,
    get_school,
    import_classes,
    import_students,
    import_teachers,
    list_classes,
    list_schools,
    list_students,
    list_teachers,
    update_class,
    update_student,
    update_teacher,
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


class TeacherImportBody(BaseModel):
    teachers: list[dict[str, Any]]


class TeacherUpdateBody(BaseModel):
    display_name: str | None = None
    email: str | None = None
    subjects: list[str] | None = None
    password: str | None = None
    status: str | None = None


class ClassCreateBody(BaseModel):
    name: str = Field(..., min_length=1)
    grade: str | None = None
    subject_hint: str | None = None


class ClassImportBody(BaseModel):
    classes: list[dict[str, Any]]


class ClassUpdateBody(BaseModel):
    name: str | None = None
    grade: str | None = None


class StudentImportItem(BaseModel):
    student_no: str = Field(..., min_length=1)
    display_name: str = Field(..., min_length=1)
    email: str | None = None
    class_name: str | None = None


class StudentImportBody(BaseModel):
    students: list[dict[str, Any]]
    class_id: str | None = None


class StudentUpdateBody(BaseModel):
    student_no: str | None = None
    display_name: str | None = None
    email: str | None = None
    status: str | None = None


class TeacherClassAssignmentBody(BaseModel):
    teacher_id: str = Field(..., min_length=1)
    class_id: str = Field(..., min_length=1)
    subject: str | None = None


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
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(value or "").strip() for value in rows[0]]
    result: list[dict[str, Any]] = []
    for values in rows[1:]:
        item: dict[str, Any] = {}
        for key, value in zip(headers, values):
            if key:
                item[key] = value
        if any(value not in (None, "") for value in item.values()):
            result.append(item)
    return result


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


@router.get("/school/students")
def school_students_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    class_id: str | None = None,
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return {"students": list_students(root, school_id=school_id, class_id=class_id)}


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
    return StreamingResponse(
        BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="student_accounts.xlsx"'},
    )


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
