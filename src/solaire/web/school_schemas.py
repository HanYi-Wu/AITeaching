"""Pydantic schemas and capability constants for school management APIs."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SchoolCreateBody(BaseModel):
    name: str = Field(..., min_length=1)


class UserCreateBody(BaseModel):
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)
    display_name: str = Field(default="")
    email: str | None = None


class SchoolUserUpdateBody(BaseModel):
    username: str | None = None
    display_name: str | None = None
    email: str | None = None
    status: str | None = None


class SchoolUserResetPasswordBody(BaseModel):
    password: str = Field(..., min_length=6)


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


class StudentClassTransferBody(BaseModel):
    target_class_id: str = Field(..., min_length=1)
    expected_class_ids: list[str]


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
