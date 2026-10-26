"""Request models used by the paper API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

class PaperUpdateBody(BaseModel):
    delivery_mode: Literal["offline", "online"]

class PaperFromExamBody(BaseModel):
    exam_id: str = Field(..., min_length=1)

class PaperPublishBody(BaseModel):
    class_ids: list[str] = Field(default_factory=list)
    student_ids: list[str] = Field(default_factory=list)
    folder_id: str | None = None
    title: str | None = None
    description: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    show_results_immediately: bool = False
    randomize_questions: bool = False
    randomize_answers: bool = False
    submission_mode: Literal["online", "image_manual", "image_ai"] = "online"
    max_screen_switches: int = Field(default=0, ge=0, le=999)
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)
    subject: str | None = Field(default=None, max_length=100)

class PaperPublicationUpdateBody(BaseModel):
    title: str | None = None
    description: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)
    show_results_immediately: bool | None = None
    status: str | None = None

class FolderCreateBody(BaseModel):
    scope: Literal["template", "compose", "paper"]
    name: str = Field(..., min_length=1, max_length=60)
    parent_id: str | None = None
    kind: Literal["category", "paper"] = "category"

class FolderUpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    parent_id: str | None = None
    move: bool = False
    kind: Literal["category", "paper"] | None = None

class TagBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=5)
    color: Literal["slate", "blue", "green", "amber", "rose", "violet"] = "slate"

class TagLinksBody(BaseModel):
    tag_ids: list[str] = Field(default_factory=list, max_length=20)

class FolderItemBody(BaseModel):
    scope: Literal["template", "compose"]
    item_id: str = Field(..., min_length=1)
    folder_id: str | None = None

class PaperAiGradeBody(BaseModel):
    question_ids: list[str] | None = None

class PaperAnswerGradeBody(BaseModel):
    score: float = Field(..., ge=0)
    feedback: str | None = None
    is_correct: bool | None = None

class PracticePublishBase(BaseModel):
    class_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1, max_length=200)
    start_at: str | None = None
    end_at: str | None = None
    show_results_immediately: bool = False
    submission_mode: Literal["online", "image_manual", "image_ai"] = "online"
    max_screen_switches: int = Field(default=0, ge=0, le=999)
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)

class WrongQuestionPracticeBody(PracticePublishBase):
    source_publication_id: str = Field(..., min_length=1)
    max_questions_per_student: int = Field(default=20, ge=1, le=100)

class ReinforcementPracticeBody(PracticePublishBase):
    source_publication_ids: list[str] = Field(..., min_length=1)
    questions_per_student: int = Field(default=5, ge=1, le=20)
