"""Pure scoring rules with finite numeric boundaries and legacy rounding."""

from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any

from solaire.common.answer_logic import PREFIX, matches


def finite_score(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("score must be finite") from exc
    if not math.isfinite(number):
        raise ValueError("score must be finite")
    return number


def validate_manual_score(value: object, maximum: object) -> float:
    score, max_score = finite_score(value), finite_score(maximum)
    if max_score < 0 or score < 0 or (max_score > 0 and score > max_score):
        raise ValueError("score is out of range")
    return score


def rounded_total(values: Iterable[float]) -> float:
    # Keep the existing sum order and round(..., 2) policy for legal scores.
    total = round(sum(finite_score(value) for value in values), 2)
    return finite_score(total)


def question_score_map(questions: list[dict[str, Any]]) -> dict[str, float]:
    scores = {str(q["question_id"]): finite_score(q.get("score_per_item") or 0) for q in questions}
    if any(score < 0 for score in scores.values()):
        raise ValueError("score is out of range")
    rounded_total(scores.values())
    return scores


def normalise_answer(value: object, qtype: str | None = None) -> str:
    text = str(value or "").strip()
    if qtype in {"single_choice", "multiple_choice", "choice", "judge"}:
        chars = [ch for ch in text.upper() if ch.isalnum()]
        if qtype == "multiple_choice":
            return "".join(sorted(dict.fromkeys(chars)))
        return "".join(chars)
    return " ".join(text.split()).lower()


def score_objective_answer(raw_answer: object, expected: object, qtype: str | None,
                           maximum: float, *, zero_unanswered: bool = False) -> tuple[int | None, float | None]:
    maximum = finite_score(maximum)
    if maximum < 0:
        raise ValueError("score is out of range")
    if expected is None or raw_answer is None or str(raw_answer).strip() == "":
        return (0, 0.0) if zero_unanswered else (None, None)
    if str(expected).startswith(PREFIX) or str(raw_answer).startswith(PREFIX):
        correct = matches(raw_answer, expected, choice=qtype in {"single_choice", "multiple_choice", "choice"})
    else:
        correct = normalise_answer(raw_answer, qtype) == normalise_answer(expected, qtype)
    return (1 if correct else 0), (maximum if correct else 0.0)


def clamp_suggested_score(value: object, maximum: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        raw, maximum = finite_score(value), finite_score(maximum)
    except ValueError:
        return None
    if maximum < 0:
        return None
    clean = max(0.0, raw)
    if maximum > 0:
        clean = min(maximum, clean)
    return round(clean, 2)


def score_percent(score: object, maximum: object, *, legacy_zero_max: bool = False) -> float | None:
    if score is None or (maximum is None and not legacy_zero_max):
        return None
    try:
        raw = finite_score(score)
        max_score = finite_score((maximum or 0) if legacy_zero_max else maximum)
    except ValueError:
        return None
    if max_score <= 0:
        return round(raw, 2) if legacy_zero_max else None
    percent = round(raw / max_score * 100, 2)
    return percent if math.isfinite(percent) else None
