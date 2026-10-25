"""Input and public views for asynchronous exam export."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from solaire.web.schemas.exams import ExamExportBody


class ExportTaskCreateBody(ExamExportBody):
    format: Literal["pdf", "docx"] = "pdf"
    request_key: str | None = Field(default=None, min_length=1, max_length=100)


class ExportTaskError(BaseModel):
    status: int
    detail: Any


class ExportTaskView(BaseModel):
    id: str
    exam_workspace_id: str | None = None
    export_label: str | None = None
    subject: str | None = None
    format: Literal["pdf", "docx"]
    status: Literal["queued", "running", "succeeded", "failed"]
    created_at: str
    updated_at: str
    attempt: int
    result: dict[str, Any] | None
    error: ExportTaskError | None


class ExportTaskList(BaseModel):
    tasks: list[ExportTaskView]
