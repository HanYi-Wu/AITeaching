"""Request-scoped reads and pure indexes for frozen question payloads."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any

from solaire.web.papers.scoring import question_score_map


@dataclass
class _QuestionEntry:
    value: Any
    first_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    ordered_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    order_index: dict[str, int] = field(default_factory=dict)
    score_by_id: dict[str, float] | None = None


@dataclass
class _MappedQuestionSet:
    questions: list[dict[str, Any]]
    score_by_id: dict[str, float]


class FrozenQuestionReadContext:
    """Share parsed immutable-by-convention data only within one read request.

    Cached values never escape directly: callers receive copies so a later
    scoring or response-building mutation cannot bleed into another attempt.
    """

    def __init__(self) -> None:
        self._questions: dict[str, _QuestionEntry] = {}
        self._answer_keys: dict[str, Any] = {}
        self._mapped: dict[tuple[str, str], _MappedQuestionSet] = {}

    @staticmethod
    def _question_key(raw_questions: object) -> str:
        return str(raw_questions or "[]")

    @staticmethod
    def _answer_key(raw_answers: object) -> str:
        return str(raw_answers or "{}")

    def _entry(self, raw_questions: object) -> _QuestionEntry:
        key = self._question_key(raw_questions)
        entry = self._questions.get(key)
        if entry is not None:
            return entry

        value = json.loads(key)
        entry = _QuestionEntry(value=value)
        if isinstance(value, list):
            for index, item in enumerate(value):
                if not isinstance(item, dict):
                    continue
                question_id = str(item.get("question_id"))
                entry.ordered_by_id[question_id] = item
                entry.order_index[question_id] = index
                first_key = str(item.get("question_id") or "")
                entry.first_by_id.setdefault(first_key, item)
        self._questions[key] = entry
        return entry

    def load_payload(self, raw_questions: object, raw_answers: object) -> tuple[Any, Any]:
        """Parse the two serialized snapshot fields once and return isolated copies."""
        questions = self._entry(raw_questions).value
        return copy.deepcopy(questions), copy.deepcopy(self._answer_payload(raw_answers))

    def first_answer_key(self, raw_answers: object, question_id: str) -> tuple[bool, Any]:
        answer_keys = self._answer_payload(raw_answers)
        if not isinstance(answer_keys, dict) or question_id not in answer_keys:
            return False, None
        return True, copy.deepcopy(answer_keys[question_id])

    def _answer_payload(self, raw_answers: object) -> Any:
        key = self._answer_key(raw_answers)
        if key not in self._answer_keys:
            self._answer_keys[key] = json.loads(key)
        return self._answer_keys[key]

    def question_count(self, raw_questions: object) -> int:
        value = self._entry(raw_questions).value
        return len(value) if isinstance(value, list) else 0

    def first_question(self, raw_questions: object, question_id: str) -> dict[str, Any] | None:
        question = self._entry(raw_questions).first_by_id.get(question_id)
        return copy.deepcopy(question) if question is not None else None

    def first_questions(self, raw_questions: object) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
        entry = self._entry(raw_questions)
        first_by_id = {
            question_id: question
            for question_id, question in entry.first_by_id.items()
            if question_id
        }
        questions = copy.deepcopy(list(first_by_id.values()))
        copied_by_id = {str(item["question_id"]): item for item in questions}
        if entry.score_by_id is None:
            entry.score_by_id = {
                question_id: float(question.get("score_per_item") or 0)
                for question_id, question in first_by_id.items()
                if question_id
            }
        return questions, copied_by_id, dict(entry.score_by_id)

    def indexed_questions(
        self,
        raw_questions: object,
        questions: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, int]]:
        """Return the question order and ID index used by student result reads."""
        entry = self._entry(raw_questions)
        copied_questions = copy.deepcopy(questions)
        if questions == entry.value:
            by_id = copy.deepcopy(entry.ordered_by_id)
        else:
            by_id = {str(item.get("question_id")): item for item in copied_questions}
        order = dict(entry.order_index)
        if not order:
            order = {str(item.get("question_id")): index for index, item in enumerate(copied_questions)}
        return copied_questions, by_id, order

    def question_maps(
        self,
        raw_questions: object,
        raw_answers: object,
        questions: list[dict[str, Any]],
        answer_keys: dict[str, str],
        *,
        include_correct_answer: bool = False,
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, float]]:
        """Build score and question indexes once for a shared frozen snapshot."""
        snapshot_key = (self._question_key(raw_questions), self._answer_key(raw_answers))
        mapped = self._mapped.get(snapshot_key)
        if mapped is None:
            scores = question_score_map(questions)
            mapped = _MappedQuestionSet(copy.deepcopy(questions), scores)
            self._mapped[snapshot_key] = mapped
        copied_questions = copy.deepcopy(mapped.questions)
        by_id = {str(item.get("question_id")): item for item in copied_questions}
        if include_correct_answer:
            by_id = {
                question_id: {**question, "correct_answer": answer_keys.get(question_id)}
                for question_id, question in by_id.items()
            }
        return copied_questions, by_id, dict(mapped.score_by_id)
