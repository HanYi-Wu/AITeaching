"""schemas analysis."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field

class ScoresImportBody(BaseModel):
    batch_id: str | None = None  # optional, for overwrite


class AnalysisScriptBody(BaseModel):
    script_id: str | None = None
    name: str = Field(..., min_length=1)
    language: str = Field(default="python", min_length=1)
    code: str = Field(..., min_length=1)


class AnalysisRunBuiltinBody(BaseModel):
    builtin_id: str = Field(..., min_length=1)
    exam_id: str = Field(..., min_length=1)
    batch_id: str = Field(..., min_length=1)
    recompute: bool = False
    request_id: str | None = None


class AnalysisRunScriptBody(BaseModel):
    script_id: str = Field(..., min_length=1)
    exam_id: str = Field(..., min_length=1)
    batch_id: str = Field(..., min_length=1)
    request_id: str | None = None


class AnalysisRunFolderScriptBody(BaseModel):
    script_path: str = Field(..., min_length=1, description="Path relative to project analysis/")
    exam_id: str = Field(..., min_length=1)
    batch_id: str = Field(..., min_length=1)
    request_id: str | None = None


class AnalysisRemediationDraftBody(BaseModel):
    exam_id: str = Field(..., min_length=1)
    batch_id: str = Field(..., min_length=1)
    weak_limit: int = Field(default=5, ge=1, le=20)
    practice_per_node: int = Field(default=4, ge=1, le=50)
    exclude_source_exam_questions: bool = True
    template_ref: str | None = None
    template_path: str | None = None
    export_label: str | None = None
    source_batch_id: str | None = None


class AnalysisToolInvokeBody(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)
