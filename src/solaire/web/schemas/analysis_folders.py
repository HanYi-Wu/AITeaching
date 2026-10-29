"""Request schema for analysis history folders."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AnalysisFolderMutationBody(BaseModel):
    action: str = Field(..., min_length=1, max_length=16)
    folder_id: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, max_length=80)
    ids: list[str] = Field(default_factory=list, max_length=200)
