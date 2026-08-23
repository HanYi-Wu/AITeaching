"""FastAPI routes for admin and school management workflows."""

from __future__ import annotations

import json
import sqlite3
from io import BytesIO
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel, Field

from solaire.agent_layer.llm.router import ModelRouter, load_llm_settings
from solaire.web import state
from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.school_service import (
    assign_teacher_class,
    bulk_update_students,
    bulk_update_teachers,
    create_class,
    create_school,
    create_school_user,
    create_teacher,
    delete_class,
    get_school,
    import_classes,
    import_students,
    import_teacher_class_assignments,
    import_teachers,
    list_classes,
    list_students,
    list_teachers,
    list_teacher_class_assignments,
    query_schools,
    query_classes,
    query_students,
    query_teachers,
    remove_teacher_class_assignment,
    reset_student_password,
    reset_teacher_password,
    update_school_ai_enabled,
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


class BulkStatusBody(BaseModel):
    ids: list[str] = Field(default_factory=list)
    status: str = Field(..., min_length=1)


class ResetPasswordBody(BaseModel):
    password: str | None = None


class SchoolAiSettingsBody(BaseModel):
    ai_enabled: bool


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


class SchoolAiChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


SCHOOL_AI_CAPABILITIES: tuple[dict[str, str], ...] = (
    {"id": "teachers.list", "label": "查询教师", "description": "按姓名、账号、学科或状态查询教师账号。"},
    {"id": "teachers.import", "label": "导入教师", "description": "指导 JSON/Excel 批量导入教师账号和学科。"},
    {"id": "teachers.manage", "label": "管理教师", "description": "说明启停教师、重置密码、维护邮箱和学科。"},
    {"id": "classes.manage", "label": "管理班级", "description": "创建、导入、编辑、删除班级并查看人数。"},
    {"id": "students.import", "label": "导入学生", "description": "指导学生 JSON/Excel 导入、班级绑定和初始账号导出。"},
    {"id": "students.manage", "label": "管理学生", "description": "说明学生账号、初始密码、状态、重置密码和导出。"},
    {"id": "assignments.manage", "label": "分配班级", "description": "将教师分配到一个或多个班级，支持 JSON/Excel 批量导入。"},
    {"id": "school.import_all", "label": "整校导入", "description": "通过一个 JSON 或多工作表 Excel 一次导入班级、教师、学生和教师班级分配。"},
    {"id": "ai.toggle", "label": "学校 AI 开关", "description": "在管理员配置 API 后，学校可开启或关闭学校和教师 AI 功能。"},
)


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


def _admin_ai_available() -> bool:
    return bool(load_llm_settings(state.get_root()).api_key)


def _school_ai_payload(root, school_id: str) -> dict[str, Any]:
    school = get_school(root, school_id=school_id)
    ai_enabled = bool(int(school.get("ai_enabled") or 0))
    return {
        "school": school,
        "ai_available": _admin_ai_available(),
        "ai_enabled": ai_enabled,
    }


def _require_school_ai_enabled(root, school_id: str) -> dict[str, Any]:
    payload = _school_ai_payload(root, school_id)
    if not payload["ai_available"]:
        raise HTTPException(status_code=400, detail="AI API is not configured by admin")
    if not payload["ai_enabled"]:
        raise HTTPException(status_code=400, detail="School AI is disabled")
    return payload


def _school_ai_stats(root, school_id: str) -> dict[str, int]:
    teachers = query_teachers(root, school_id=school_id, page=1, page_size=1)
    classes = query_classes(root, school_id=school_id, page=1, page_size=1)
    students = query_students(root, school_id=school_id, page=1, page_size=1)
    assignments = list_teacher_class_assignments(root, school_id=school_id, page=1, page_size=1)
    return {
        "teachers": int(teachers.get("total") or 0),
        "classes": int(classes.get("total") or 0),
        "students": int(students.get("total") or 0),
        "assignments": int(assignments.get("total") or 0),
    }


def _school_ai_context(root, school_id: str) -> dict[str, Any]:
    stats = _school_ai_stats(root, school_id)
    teachers = query_teachers(root, school_id=school_id, page=1, page_size=50).get("teachers", [])
    classes = query_classes(root, school_id=school_id, page=1, page_size=50).get("classes", [])
    students = query_students(root, school_id=school_id, page=1, page_size=50).get("students", [])
    assignments = list_teacher_class_assignments(root, school_id=school_id, page=1, page_size=50).get("assignments", [])
    return {
        "stats": stats,
        "teachers": [
            {
                "username": item.get("username"),
                "display_name": item.get("display_name"),
                "subjects": item.get("subjects") or [],
                "status": item.get("status"),
            }
            for item in teachers
        ],
        "classes": [
            {
                "name": item.get("name"),
                "grade": item.get("grade"),
                "student_count": item.get("student_count") or 0,
                "teacher_count": item.get("teacher_count") or 0,
            }
            for item in classes
        ],
        "students": [
            {
                "student_no": item.get("student_no"),
                "display_name": item.get("display_name"),
                "account_username": item.get("account_username"),
                "class_names": item.get("class_names"),
                "status": item.get("status"),
            }
            for item in students
        ],
        "assignments": [
            {
                "teacher_name": item.get("teacher_name") or item.get("teacher_username"),
                "teacher_username": item.get("teacher_username"),
                "class_name": item.get("class_name"),
                "class_grade": item.get("class_grade"),
                "teacher_status": item.get("teacher_status"),
            }
            for item in assignments
        ],
    }


def _wants_list(message: str, subject_words: tuple[str, ...]) -> bool:
    clean = message.lower()
    return any(word in clean for word in subject_words) and any(
        marker in clean
        for marker in (
            "哪些",
            "名字",
            "名单",
            "列表",
            "有谁",
            "都有谁",
            "list",
            "name",
            "names",
        )
    )


def _school_data_reply(message: str, context: dict[str, Any]) -> str | None:
    if _wants_list(message, ("教师", "老师", "teacher")):
        teachers = context["teachers"]
        if not teachers:
            return "当前学校还没有教师账号。"
        lines = ["当前学校教师名单："]
        for index, teacher in enumerate(teachers, start=1):
            subjects = "、".join(teacher.get("subjects") or []) or "未分配学科"
            lines.append(
                f"{index}. {teacher.get('display_name') or teacher.get('username')}（账号：{teacher.get('username')}，"
                f"学科：{subjects}，状态：{teacher.get('status') or '-'}）"
            )
        return "\n".join(lines)
    if _wants_list(message, ("班级", "class")):
        classes = context["classes"]
        if not classes:
            return "当前学校还没有班级。"
        lines = ["当前学校班级："]
        for index, klass in enumerate(classes, start=1):
            lines.append(
                f"{index}. {klass.get('grade') or '-'} {klass.get('name')}（学生 {klass.get('student_count') or 0}，"
                f"教师 {klass.get('teacher_count') or 0}）"
            )
        return "\n".join(lines)
    if _wants_list(message, ("学生", "student")):
        students = context["students"]
        if not students:
            return "当前学校还没有学生账号。"
        lines = ["当前学校学生名单（最多展示前 50 个）："]
        for index, student in enumerate(students, start=1):
            lines.append(
                f"{index}. {student.get('display_name')}（学号：{student.get('student_no')}，"
                f"登录名：{student.get('account_username') or '-'}，班级：{student.get('class_names') or '-'}）"
            )
        return "\n".join(lines)
    if _wants_list(message, ("分配", "assignment")):
        assignments = context["assignments"]
        if not assignments:
            return "当前学校还没有教师班级分配。"
        lines = ["当前教师班级分配："]
        for index, item in enumerate(assignments, start=1):
            lines.append(
                f"{index}. {item.get('teacher_name')}（{item.get('teacher_username')}） -> "
                f"{item.get('class_grade') or ''} {item.get('class_name')}"
            )
        return "\n".join(lines)
    return None


def _local_school_ai_reply(message: str, context: dict[str, Any]) -> str:
    direct = _school_data_reply(message, context)
    if direct:
        return direct
    stats = context["stats"]
    clean = message.strip()
    teacher_names = "、".join(
        str(item.get("display_name") or item.get("username")) for item in context["teachers"][:8]
    )
    class_names = "、".join(str(item.get("name")) for item in context["classes"][:8])
    return (
        "学校端 AI 已接入独立管理能力接口。当前学校数据："
        f"教师 {stats['teachers']} 人、班级 {stats['classes']} 个、学生 {stats['students']} 人、"
        f"教师班级分配 {stats['assignments']} 条。"
        f"教师示例：{teacher_names or '暂无'}；班级示例：{class_names or '暂无'}。"
        "你可以围绕教师导入、学生账号、班级管理、教师分配和 AI 开关继续提问。"
        f"本次问题：{clean}"
    )


def _local_import_review(kind: str, rows: list[dict[str, Any]]) -> str:
    labels = {"teachers": "教师", "classes": "班级", "students": "学生", "assignments": "教师班级分配", "all": "整校"}
    fields = sorted({str(key) for row in rows for key in row.keys()})
    preview = rows[:3]
    return (
        f"AI 导入审核：识别到 {len(rows)} 行{labels.get(kind, kind)}数据。"
        f"字段：{', '.join(fields) if fields else '无'}。"
        f"前 {len(preview)} 行样例：{json.dumps(preview, ensure_ascii=False)}"
    )


async def _review_school_import_with_ai(kind: str, rows: list[dict[str, Any]]) -> str:
    local_review = _local_import_review(kind, rows)
    if not rows:
        return local_review
    try:
        adapter = ModelRouter(load_llm_settings(state.get_root())).fast()
        response = await adapter.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "你是学校端导入审核助手。请检查 JSON/Excel 解析出的行是否符合学校管理导入字段，"
                        "只输出简短审核结论、字段问题和导入建议，不要编造后台操作结果。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps({"kind": kind, "rows": rows[:30]}, ensure_ascii=False),
                },
            ],
            temperature=0.1,
            max_tokens=600,
        )
        return (response.content or "").strip() or local_review
    except Exception:
        return local_review


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, sqlite3.IntegrityError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def _worksheet_rows(ws) -> list[dict[str, Any]]:
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(value or "").strip() for value in rows[0]]
    result: list[dict[str, Any]] = []
    for values in rows[1:]:
        item = {key: value for key, value in zip(headers, values) if key}
        if any(value not in (None, "") for value in item.values()):
            result.append(item)
    return result


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
    return _worksheet_rows(wb.active)


def _school_bundle_from_upload(file: UploadFile) -> dict[str, list[dict[str, Any]]]:
    kinds = ("classes", "teachers", "students", "assignments")
    raw = file.file.read()
    name = (file.filename or "").lower()
    if name.endswith(".json"):
        try:
            parsed = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid json import file") from exc
        if not isinstance(parsed, dict):
            raise ValueError("complete school json must be an object")
        bundle: dict[str, list[dict[str, Any]]] = {}
        for kind in kinds:
            values = parsed.get(kind) or []
            if not isinstance(values, list):
                raise ValueError(f"{kind} must be a list")
            bundle[kind] = [dict(item) for item in values if isinstance(item, dict)]
        return bundle
    if not name.endswith(".xlsx"):
        raise ValueError("import file must be .json or .xlsx")
    wb = load_workbook(BytesIO(raw), data_only=True)
    sheets = {name.strip().lower(): ws for name, ws in ((ws.title, ws) for ws in wb.worksheets)}
    return {kind: _worksheet_rows(sheets[kind]) if kind in sheets else [] for kind in kinds}


def _flatten_school_bundle(bundle: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    return [{"data_kind": kind, **row} for kind in ("classes", "teachers", "students", "assignments") for row in bundle[kind]]


def _import_school_bundle(root, school_id: str, bundle: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    results = {
        "classes": import_classes(root, school_id=school_id, classes=bundle["classes"]),
        "teachers": import_teachers(root, school_id=school_id, teachers=bundle["teachers"]),
        "students": import_students(root, school_id=school_id, students=bundle["students"]),
        "assignments": import_teacher_class_assignments(
            root, school_id=school_id, assignments=bundle["assignments"]
        ),
    }
    return {
        "imported": sum(int(result.get("imported") or 0) for result in results.values()),
        **results,
    }


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


def _template_workbook(headers: tuple[str, ...], examples: list[tuple[object, ...]], title: str) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = title
    ws.append(headers)
    for row in examples:
        ws.append(row)
    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()


def _workbook_response(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/schools")
def schools_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    _require_admin(user)
    root = require_platform_root()
    return query_schools(root, q=q, status=status, page=page, page_size=page_size)


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


@router.get("/school/ai-settings")
def school_ai_settings_get(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    return _school_ai_payload(root, school_id)


@router.patch("/school/ai-settings")
def school_ai_settings_update(
    body: SchoolAiSettingsBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    if body.ai_enabled and not _admin_ai_available():
        raise HTTPException(status_code=400, detail="AI API is not configured by admin")
    try:
        update_school_ai_enabled(root, school_id=school_id, ai_enabled=body.ai_enabled)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return _school_ai_payload(root, school_id)


@router.get("/school/ai/capabilities")
def school_ai_capabilities(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    payload = _school_ai_payload(root, school_id)
    return {
        **payload,
        "capabilities": list(SCHOOL_AI_CAPABILITIES),
        "stats": _school_ai_stats(root, school_id),
    }


@router.post("/school/ai/chat")
async def school_ai_chat(
    body: SchoolAiChatBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    payload = _require_school_ai_enabled(root, school_id)
    context = _school_ai_context(root, school_id)
    stats = context["stats"]
    capabilities = list(SCHOOL_AI_CAPABILITIES)
    direct_reply = _school_data_reply(body.message, context)
    if direct_reply:
        return {
            **payload,
            "reply": direct_reply,
            "source": "local",
            "capabilities": capabilities,
            "stats": stats,
        }
    prompt = (
        "你是学校端管理助手，只能回答和学校端权限、教师、学生、班级、教师班级分配、学生初始账号导出、"
        "学校 AI 开关相关的问题。不要假装已经执行后台操作；需要执行时指出用户应使用哪个页面或接口。\n"
        f"当前数据：教师 {stats['teachers']} 人，班级 {stats['classes']} 个，学生 {stats['students']} 人，"
        f"教师班级分配 {stats['assignments']} 条。\n"
        f"本校数据上下文：{json.dumps(context, ensure_ascii=False)}\n"
        f"可用能力：{json.dumps(capabilities, ensure_ascii=False)}"
    )
    try:
        adapter = ModelRouter(load_llm_settings(state.get_root())).fast()
        response = await adapter.chat(
            [
                {"role": "system", "content": prompt},
                {"role": "user", "content": body.message.strip()},
            ],
            temperature=0.2,
            max_tokens=900,
        )
        reply = (response.content or "").strip() or _local_school_ai_reply(body.message, context)
        source = "llm" if response.content else "local"
    except Exception as exc:  # Keep the school management page usable if provider calls fail.
        reply = _local_school_ai_reply(body.message, context)
        source = "local"
        return {
            **payload,
            "reply": reply,
            "source": source,
            "capabilities": capabilities,
            "stats": stats,
            "error": str(exc),
        }
    return {
        **payload,
        "reply": reply,
        "source": source,
        "capabilities": capabilities,
        "stats": stats,
    }


@router.post("/school/ai/import-review")
async def school_ai_import_review(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    kind: str = Form(...),
    class_id: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    payload = _require_school_ai_enabled(root, school_id)
    clean_kind = kind.strip()
    if clean_kind not in {"teachers", "classes", "students", "assignments", "all"}:
        raise HTTPException(status_code=400, detail="invalid import kind")
    try:
        if clean_kind == "all":
            bundle = _school_bundle_from_upload(file)
            rows = _flatten_school_bundle(bundle)
        else:
            rows = _rows_from_upload(file, expected=clean_kind)
        review = await _review_school_import_with_ai(clean_kind, rows)
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {
        **payload,
        "kind": clean_kind,
        "class_id": class_id,
        "row_count": len(rows),
        "review": review,
        "preview": rows[:10],
        "stats": _school_ai_stats(root, school_id),
    }


@router.post("/school/ai/import-file")
async def school_ai_import_file(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    kind: str = Form(...),
    class_id: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    school_id = _require_school(user)
    root = require_platform_root()
    payload = _require_school_ai_enabled(root, school_id)
    clean_kind = kind.strip()
    if clean_kind not in {"teachers", "classes", "students", "assignments", "all"}:
        raise HTTPException(status_code=400, detail="invalid import kind")
    try:
        bundle = _school_bundle_from_upload(file) if clean_kind == "all" else None
        rows = _flatten_school_bundle(bundle) if bundle is not None else _rows_from_upload(file, expected=clean_kind)
        review = await _review_school_import_with_ai(clean_kind, rows)
        if clean_kind == "teachers":
            result = import_teachers(root, school_id=school_id, teachers=rows)
        elif clean_kind == "classes":
            result = import_classes(root, school_id=school_id, classes=rows)
        elif clean_kind == "students":
            result = import_students(root, school_id=school_id, students=rows, class_id=class_id)
        elif clean_kind == "assignments":
            result = import_teacher_class_assignments(root, school_id=school_id, assignments=rows)
        else:
            result = _import_school_bundle(root, school_id, bundle or {})
    except (ValueError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {
        **payload,
        "kind": clean_kind,
        "imported": int(result.get("imported") or 0),
        "review": review,
        "result": result,
    }


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
