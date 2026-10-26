"""Data types and schemas for learning progress evidence and frozen baselines."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ProgressComparisonStatus = Literal[
    "valid",
    "source_missing",
    "source_modified",
    "target_unsubmitted",
    "target_ungraded",
    "target_unreleased",
    "missing_knowledge_node",
    "incomparable_identity",
]


@dataclass(frozen=True)
class PracticeSourceLink:
    """Publication-level linkage to diagnostic batches or previous online publications."""

    id: str
    practice_publication_id: str
    practice_kind: str
    source_type: Literal["diagnostic_batch", "exam_publication"]
    source_exam_id: str | None
    source_batch_id: str | None
    source_publication_id: str | None
    captured_at: str
    calculation_rule_version: str = "v1_equal_split"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "practice_publication_id": self.practice_publication_id,
            "practice_kind": self.practice_kind,
            "source_type": self.source_type,
            "source_exam_id": self.source_exam_id,
            "source_batch_id": self.source_batch_id,
            "source_publication_id": self.source_publication_id,
            "captured_at": self.captured_at,
            "calculation_rule_version": self.calculation_rule_version,
            "metadata": self.metadata,
        }


@dataclass(frozen=True)
class FrozenBaselineItem:
    """Frozen per-student, per-node, per-question score baseline captured at practice publication."""

    id: str
    practice_publication_id: str
    student_id: str
    source_type: str
    source_ref_id: str
    source_attempt_id: str | None
    source_question_id: str
    knowledge_node_id: str
    effective_score: float
    effective_max_score: float
    weight: float
    raw_score: float | None
    raw_max_score: float | None
    rule_version: str
    source_snapshot_hash: str
    captured_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "practice_publication_id": self.practice_publication_id,
            "student_id": self.student_id,
            "source_type": self.source_type,
            "source_ref_id": self.source_ref_id,
            "source_attempt_id": self.source_attempt_id,
            "source_question_id": self.source_question_id,
            "knowledge_node_id": self.knowledge_node_id,
            "effective_score": self.effective_score,
            "effective_max_score": self.effective_max_score,
            "weight": self.weight,
            "raw_score": self.raw_score,
            "raw_max_score": self.raw_max_score,
            "rule_version": self.rule_version,
            "source_snapshot_hash": self.source_snapshot_hash,
            "captured_at": self.captured_at,
        }


@dataclass(frozen=True)
class TargetEvidenceItem:
    """Student answer evidence from target practice attempt."""

    student_id: str
    attempt_id: str
    publication_id: str
    question_id: str
    knowledge_node_id: str | None
    score: float | None
    max_score: float
    weight: float
    is_correct: int | None
    submission_status: str
    grading_status: str
    is_released: bool
    status: ProgressComparisonStatus
    incomparable_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "student_id": self.student_id,
            "attempt_id": self.attempt_id,
            "publication_id": self.publication_id,
            "question_id": self.question_id,
            "knowledge_node_id": self.knowledge_node_id,
            "score": self.score,
            "max_score": self.max_score,
            "weight": self.weight,
            "is_correct": self.is_correct,
            "submission_status": self.submission_status,
            "grading_status": self.grading_status,
            "is_released": self.is_released,
            "status": self.status,
            "incomparable_reason": self.incomparable_reason,
        }
