"""Validated, read-only requests for goal-based paper selection."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Difficulty = Literal["easy", "medium", "hard", "unknown"]
SelectionType = Literal[
    "choice", "single_choice", "multiple_choice", "fill", "judge",
    "short_answer", "reasoning", "essay", "group",
]
Weight = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Count = Annotated[int, Field(ge=0, le=500, strict=True)]
NonemptyString = Annotated[str, Field(min_length=1, max_length=500)]


class DuplicateCheckBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question_ids: list[NonemptyString] = Field(min_length=1, max_length=500)
    exclude_exam_id: str | None = Field(default=None, max_length=500)
    similarity_threshold: float = Field(default=0.85, ge=0.5, le=1, allow_inf_nan=False)


class AutoComposeBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    template_path: NonemptyString
    template_ref: str = Field(default="", max_length=500)
    subject: NonemptyString
    total_count: int = Field(ge=1, le=500, strict=True)
    knowledge_points: list[NonemptyString] = Field(default_factory=list, max_length=200)
    coverage_ratio: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)
    difficulty_distribution: dict[Difficulty, Weight] = Field(default_factory=dict)
    type_distribution: dict[SelectionType, Weight] = Field(default_factory=dict)
    section_counts: dict[NonemptyString, Count] = Field(default_factory=dict, max_length=100)
    namespaces: list[NonemptyString] = Field(default_factory=list, max_length=200)
    exclude_question_ids: list[NonemptyString] = Field(default_factory=list, max_length=500)
    avoid_history: bool = False
    exclude_exam_id: str | None = Field(default=None, max_length=500)
    similarity_threshold: float = Field(default=0.85, ge=0.5, le=1, allow_inf_nan=False)
    seed: int | None = None

    @field_validator("knowledge_points", "namespaces", "exclude_question_ids")
    @classmethod
    def unique_values(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(values))

    @field_validator("difficulty_distribution", "type_distribution")
    @classmethod
    def positive_distribution(cls, weights: dict) -> dict:
        # Normalize before summing so even finite but very large weights are safe.
        if weights and not any(weight > 0 for weight in weights.values()):
            raise ValueError("比例至少需要一个大于零的值")
        return weights

    @model_validator(mode="after")
    def consistent_counts(self) -> AutoComposeBody:
        if "choice" in self.type_distribution and any(
            key in self.type_distribution for key in ("single_choice", "multiple_choice")
        ):
            raise ValueError("选择题总比例与单选、多选比例不能同时指定")
        if self.section_counts:
            if self.type_distribution:
                raise ValueError("小节题量与题型比例不能同时指定")
            if sum(self.section_counts.values()) != self.total_count:
                raise ValueError("小节题量之和必须等于总题量")
        return self
