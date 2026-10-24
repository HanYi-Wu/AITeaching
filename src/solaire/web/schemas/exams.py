"""schemas exams."""

from __future__ import annotations

from pydantic import BaseModel, Field

class SelectedSectionIn(BaseModel):
    section_id: str
    question_ids: list[str]
    score_per_item: float | None = None
    score_overrides: dict[str, float] | None = None
    required_count: int | None = Field(default=None, ge=0, le=500)


class ExamDraftBody(BaseModel):
    template_ref: str
    """Must match template_id inside the YAML file."""
    template_path: str = Field(..., description="Path relative to project root, e.g. templates/demo.yaml")
    selected_items: list[SelectedSectionIn]


class ExamExportBody(ExamDraftBody):
    export_label: str = Field(..., min_length=1)
    subject: str = Field(..., min_length=1)
    metadata_title: str | None = None
    """When set, must match an existing ``exams/<标签>/<学科>/`` 目录标识及其试卷说明/学科。"""
    overwrite_existing: str | None = None
    exam_ids_to_delete_on_success: list[str] | None = None
    """导出成功后删除的其它 ``exams/<标签段>/<学科段>/``（例如旧副本）。"""
    exam_workspace_id: str | None = None
    """当前考试目录标识（``标签段/学科段``）；导出成功后更新状态，不删除该目录。"""


class ExamExportConflictBody(BaseModel):
    export_label: str = Field(..., min_length=1)
    subject: str = Field(..., min_length=1)


class ExamSaveDraftBody(BaseModel):
    name: str | None = None
    subject: str = Field(..., min_length=1)
    export_label: str = Field(..., min_length=1)
    template_ref: str = ""
    template_path: str = Field(..., min_length=1, description="Relative to project root")
    selected_items: list[SelectedSectionIn] = Field(default_factory=list)
    auto_rename: bool = False


class CopyFromExamBody(BaseModel):
    """从历史试卷复制为新草稿时必填：新试卷说明；学科沿用源考试。"""

    export_label: str = Field(..., min_length=1)


class OpenResultPdfBody(BaseModel):
    variant: str = "student"
