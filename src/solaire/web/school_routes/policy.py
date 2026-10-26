"""School AI policy, settings, interactive chat, and AI import review routes."""

from __future__ import annotations

import json
import sqlite3
import sys
from io import BytesIO
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from openpyxl import load_workbook

from solaire.agent_layer.llm.router import ModelRouter, load_llm_settings
from solaire.web import state
from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.school_routes.common import (
    _admin_ai_available,
    _raise_api_error,
    _require_school,
    _rows_from_upload,
    _worksheet_rows,
)
from solaire.web.school_schemas import SCHOOL_AI_CAPABILITIES, SchoolAiChatBody, SchoolAiSettingsBody
from solaire.web.school_service import (
    get_school,
    import_classes,
    import_students,
    import_teacher_class_assignments,
    import_teachers,
    list_teacher_class_assignments,
    query_classes,
    query_students,
    query_teachers,
    update_school_ai_enabled,
)

router = APIRouter()


# [Wiring Point C05]: G4 provides unified school AI policy check / management query.
# Without G4 freeze, maintain original API behavior and thin wrapper.
def _school_ai_payload(root: Any, school_id: str) -> dict[str, Any]:
    school = get_school(root, school_id=school_id)
    ai_enabled = bool(int(school.get("ai_enabled") or 0))
    return {
        "school": school,
        "ai_available": _admin_ai_available(),
        "ai_enabled": ai_enabled,
    }


# [Wiring Point C05]: G4 provides school AI execution guard.
def _require_school_ai_enabled(root: Any, school_id: str) -> dict[str, Any]:
    payload = _school_ai_payload(root, school_id)
    if not payload["ai_available"]:
        raise HTTPException(status_code=400, detail="AI API is not configured by admin")
    if not payload["ai_enabled"]:
        raise HTTPException(status_code=400, detail="School AI is disabled")
    return payload


def _school_ai_stats(root: Any, school_id: str) -> dict[str, int]:
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


def _school_ai_context(root: Any, school_id: str) -> dict[str, Any]:
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


def _import_school_bundle(root: Any, school_id: str, bundle: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
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


def _get_review_school_import_with_ai():
    mod = sys.modules.get("solaire.web.school_api")
    if mod and hasattr(mod, "_review_school_import_with_ai"):
        return getattr(mod, "_review_school_import_with_ai")
    return _review_school_import_with_ai


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
        review_fn = _get_review_school_import_with_ai()
        review = await review_fn(clean_kind, rows)
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
        review_fn = _get_review_school_import_with_ai()
        review = await review_fn(clean_kind, rows)
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
