"""Per-student wrong-question and AI reinforcement publication services."""

from __future__ import annotations

from solaire.web.adaptive import (
    MIN_REINFORCEMENT_HISTORY,
    PRACTICE_KINDS,
    SUBMISSION_MODES,
    _class_students,
    _ensure_class_access,
    _ensure_teacher,
    _extract_generated_payload,
    _extract_json,
    _new_id,
    _publish_personalized,
    _source_questions_for_student,
    _validate_generated_questions,
    _validate_sources,
    _wrong_questions_for_student,
    generate_reinforcement_questions,
    list_practice_history,
    publish_reinforcement_practice,
    publish_wrong_question_practice,
)

__all__ = [
    "MIN_REINFORCEMENT_HISTORY",
    "PRACTICE_KINDS",
    "SUBMISSION_MODES",
    "_class_students",
    "_ensure_class_access",
    "_ensure_teacher",
    "_extract_generated_payload",
    "_extract_json",
    "_new_id",
    "_publish_personalized",
    "_source_questions_for_student",
    "_validate_generated_questions",
    "_validate_sources",
    "_wrong_questions_for_student",
    "generate_reinforcement_questions",
    "list_practice_history",
    "publish_reinforcement_practice",
    "publish_wrong_question_practice",
]
