"""Shared contiguous question-group traversal for exam renderers."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass

from solaire.exam_compiler.pipeline.hydrate import HydratedQuestion


@dataclass(frozen=True, slots=True)
class QuestionRun:
    """One standalone question or all contiguous rows from a group file."""

    questions: tuple[HydratedQuestion, ...]
    grouped: bool


def iter_question_runs(questions: Sequence[HydratedQuestion]) -> Iterator[QuestionRun]:
    """Yield source-ordered rows using the shared hydrate group boundary rule."""
    i = 0
    n = len(questions)
    while i < n:
        first = questions[i]
        if first.item.group_root_id is None:
            yield QuestionRun((first,), grouped=False)
            i += 1
            continue

        end = i + 1
        while end < n and questions[end].qualified_id == first.qualified_id:
            end += 1
        yield QuestionRun(tuple(questions[i:end]), grouped=True)
        i = end
