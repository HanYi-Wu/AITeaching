"""Exact and character-ngram duplicate checks without external services."""

from __future__ import annotations

from collections import Counter, defaultdict
import math
import re
import unicodedata
from typing import Iterable

from solaire.web.auto_compose.catalog import Candidate


_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")
_MATH_SYMBOLS = frozenset("+-−*/^_=<>≤≥≠≈±×÷√∫∑∏∞%().[]{}|\\#$")


def _visible_text(candidate: Candidate) -> str:
    return candidate.text or candidate.content or ""


def _normalize_text(value: str, *, numeric_template: bool = False) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    if numeric_template:
        normalized = _NUMBER_RE.sub("#", normalized)
    chars: list[str] = []
    for character in normalized:
        if character.isspace():
            continue
        category = unicodedata.category(character)
        if category[0] in {"L", "N"} or character in _MATH_SYMBOLS:
            chars.append(character)
    return "".join(chars)


def _grams(value: str) -> Counter[str]:
    if not value:
        return Counter()
    width = 3 if len(value) >= 3 else (2 if len(value) == 2 else 1)
    return Counter(value[index : index + width] for index in range(len(value) - width + 1))


def _features(candidate: Candidate) -> tuple[Counter[str], Counter[str]]:
    source = _visible_text(candidate)
    return _grams(_normalize_text(source)), _grams(_normalize_text(source, numeric_template=True))


def _dice(left: Counter[str], right: Counter[str]) -> float:
    left_total = sum(left.values())
    right_total = sum(right.values())
    if not left_total or not right_total:
        return 0.0
    shared = sum(min(count, right.get(gram, 0)) for gram, count in left.items())
    return 2.0 * shared / (left_total + right_total)


def _similarity(
    left_features: tuple[Counter[str], Counter[str]],
    right_features: tuple[Counter[str], Counter[str]],
) -> float:
    raw = _dice(left_features[0], right_features[0])
    template = _dice(left_features[1], right_features[1])
    # The template is deliberately discounted: it can bridge changed numbers,
    # while changed operators and surrounding characters still lower the score.
    return max(raw, 0.9 * template)


def _exact_signature(candidate: Candidate) -> str:
    """Text identity guard so a stale/colliding fingerprint cannot erase digits or operators."""
    value = unicodedata.normalize("NFKC", _visible_text(candidate))
    return "".join(character for character in value if not character.isspace())


def _candidate_key(candidate: Candidate) -> tuple[str, str, str, str]:
    return (
        candidate.qid,
        candidate.fingerprint,
        str(candidate.exam_id or "").replace("\\", "/").casefold(),
        candidate.exam_title or "",
    )


class SimilarityIndex:
    """Inverted character-ngram index shared by report and history filtering."""

    def __init__(self, candidates: Iterable[Candidate]):
        records: list[Candidate] = []
        seen: set[tuple[str, str, str, str]] = set()
        for candidate in candidates:
            key = _candidate_key(candidate)
            if key in seen:
                continue
            seen.add(key)
            records.append(candidate)
        self.records = records
        self.features = [_features(candidate) for candidate in records]
        self.signatures = [_exact_signature(candidate) for candidate in records]
        self.by_qid: dict[str, list[int]] = defaultdict(list)
        self.by_fingerprint: dict[str, list[int]] = defaultdict(list)
        self.postings: dict[tuple[str, str], dict[int, int]] = defaultdict(dict)
        self.totals: list[tuple[int, int]] = []
        for index, candidate in enumerate(records):
            self.by_qid[candidate.qid].append(index)
            if candidate.fingerprint:
                self.by_fingerprint[candidate.fingerprint].append(index)
            totals: list[int] = []
            for feature_name, grams in zip(("raw", "template"), self.features[index]):
                totals.append(sum(grams.values()))
                for gram, count in grams.items():
                    self.postings[(feature_name, gram)][index] = count
            self.totals.append((totals[0], totals[1]))

    def find(self, candidate: Candidate, threshold: float = 0.85) -> list[tuple[Candidate, str, float]]:
        query_features = _features(candidate)
        possible: set[int] = set(self.by_fingerprint.get(candidate.fingerprint, ()))
        raw_overlap: dict[int, int] = defaultdict(int)
        template_overlap: dict[int, int] = defaultdict(int)
        for feature_name, grams in zip(("raw", "template"), query_features):
            overlaps = raw_overlap if feature_name == "raw" else template_overlap
            for gram in grams:
                posting = self.postings.get((feature_name, gram), {})
                for index, record_count in posting.items():
                    possible.add(index)
                    overlaps[index] += min(grams[gram], record_count)
        query_totals = (sum(query_features[0].values()), sum(query_features[1].values()))
        matches: list[tuple[Candidate, str, float]] = []
        for index in sorted(possible):
            other = self.records[index]
            if (candidate.fingerprint and candidate.fingerprint == other.fingerprint
                    and _exact_signature(candidate) == self.signatures[index]):
                matches.append((other, "exact", 1.0))
                continue
            record_totals = self.totals[index]
            raw_denom = query_totals[0] + record_totals[0]
            template_denom = query_totals[1] + record_totals[1]
            raw_score = 2.0 * raw_overlap.get(index, 0) / raw_denom if raw_denom else 0.0
            template_score = 2.0 * template_overlap.get(index, 0) / template_denom if template_denom else 0.0
            score = max(raw_score, 0.9 * template_score)
            if score >= threshold:
                matches.append((other, "similar", score))
        return matches

    def has_match(self, candidate: Candidate, threshold: float = 0.85) -> bool:
        """Boolean threshold probe that stops as soon as a sufficient overlap appears."""
        if candidate.fingerprint and self.by_fingerprint.get(candidate.fingerprint):
            signature = _exact_signature(candidate)
            if any(signature == self.signatures[index]
                   for index in self.by_fingerprint[candidate.fingerprint]):
                return True
        query_features = _features(candidate)
        if threshold == 0.0:
            return any(
                self.postings.get((feature_name, gram))
                for feature_name, grams in zip(("raw", "template"), query_features)
                for gram in grams
            )
        query_totals = (sum(query_features[0].values()), sum(query_features[1].values()))
        for feature_index, (feature_name, grams) in enumerate(zip(("raw", "template"), query_features)):
            if not grams:
                continue
            postings_for_query = [
                (len(self.postings.get((feature_name, gram), {})), gram, count)
                for gram, count in grams.items()
                if self.postings.get((feature_name, gram))
            ]
            postings_for_query.sort(key=lambda item: item[0])
            overlaps: dict[int, int] = defaultdict(int)
            query_total = query_totals[feature_index]
            for _frequency, gram, query_count in postings_for_query:
                posting = self.postings[(feature_name, gram)]
                for index, record_count in posting.items():
                    overlaps[index] += min(query_count, record_count)
                    denominator = query_total + self.totals[index][feature_index]
                    score = 2.0 * overlaps[index] / denominator if denominator else 0.0
                    if feature_index == 1:
                        score *= 0.9
                    if score >= threshold:
                        return True
        return False

    def same_qid(self, qid: str) -> list[Candidate]:
        return [self.records[index] for index in self.by_qid.get(qid, ())]


def _preview(candidate: Candidate, limit: int = 240) -> str:
    text = " ".join(_visible_text(candidate).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _match_payload(
    source: str,
    kind: str,
    similarity: float,
    candidate: Candidate,
) -> dict[str, object]:
    result: dict[str, object] = {
        "source": source,
        "kind": kind,
        "similarity": round(max(0.0, min(1.0, similarity)), 4),
        "qualified_id": candidate.qid,
        "content_preview": _preview(candidate),
    }
    if source == "history":
        if candidate.exam_id is not None:
            result["exam_id"] = candidate.exam_id
        if candidate.exam_title is not None:
            result["exam_title"] = candidate.exam_title
    return result


def _valid_threshold(threshold: float) -> float:
    try:
        value = float(threshold)
    except (TypeError, ValueError) as error:
        raise ValueError("threshold must be a number between 0 and 1") from error
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise ValueError("threshold must be a number between 0 and 1")
    return value


def _ordered_matches(matches: list[dict[str, object]]) -> list[dict[str, object]]:
    source_order = {"history": 0, "bank": 1, "paper": 2}
    kind_order = {"exact": 0, "reused": 1, "similar": 2}
    return sorted(matches, key=lambda match: (
        kind_order.get(str(match.get("kind")), 9),
        source_order.get(str(match.get("source")), 9),
        -float(match.get("similarity") or 0.0),
        str(match.get("qualified_id") or ""),
        str(match.get("exam_id") or ""),
        str(match.get("exam_title") or ""),
    ))


def _limit_matches(matches: list[dict[str, object]], limit: int) -> list[dict[str, object]]:
    """Keep at least one match per available source before filling the cap."""
    if limit <= 0:
        return []
    ordered = _ordered_matches(matches)
    priority = ("paper", "history", "bank")
    chosen_indices: list[int] = []
    for source in priority:
        index = next((i for i, match in enumerate(ordered)
                      if i not in chosen_indices and match.get("source") == source), None)
        if index is not None:
            chosen_indices.append(index)
            if len(chosen_indices) >= limit:
                break
    for index in range(len(ordered)):
        if len(chosen_indices) >= limit:
            break
        if index not in chosen_indices:
            chosen_indices.append(index)
    return _ordered_matches([ordered[index] for index in chosen_indices])


def check_duplicates(
    question_ids: list[str],
    bank: list[Candidate],
    history: list[Candidate],
    threshold: float = 0.85,
    max_matches: int = 20,
) -> dict[str, object]:
    """Check selected IDs against the bank, history, and this paper.

    Matching uses an exact normalized fingerprint first, then character-ngram
    Dice with a discounted numeric-template Dice score. This is text similarity,
    not semantic or AI-based duplicate detection.
    """
    threshold = _valid_threshold(threshold)
    try:
        match_limit = max(0, int(max_matches))
    except (TypeError, ValueError) as error:
        raise ValueError("max_matches must be a non-negative integer") from error

    bank_by_qid: dict[str, Candidate] = {}
    for candidate in bank:
        bank_by_qid.setdefault(candidate.qid, candidate)
    occurrences: dict[str, int] = {}
    ordered_qids: list[str] = []
    for qid in question_ids:
        if qid not in bank_by_qid:
            raise ValueError(f"unknown question ID: {qid}")
        if qid not in occurrences:
            occurrences[qid] = 0
            ordered_qids.append(qid)
        occurrences[qid] += 1
    selected = [bank_by_qid[qid] for qid in ordered_qids]
    bank_index = SimilarityIndex(bank)
    history_index = SimilarityIndex(history)
    paper_index = SimilarityIndex(selected)

    question_rows: list[dict[str, object]] = []
    exact_count = 0
    similar_count = 0
    flagged_count = 0
    within_paper_count = 0
    history_flagged_count = 0
    for qid, candidate in zip(ordered_qids, selected):
        matches: list[dict[str, object]] = []

        # A record is not a duplicate of itself. Other bank IDs remain eligible.
        for other, kind, score in bank_index.find(candidate, threshold):
            if other.qid == qid:
                continue
            matches.append(_match_payload("bank", kind, score, other))

        history_seen: set[tuple[str, str, str, str]] = set()
        for other, kind, score in history_index.find(candidate, threshold):
            key = _candidate_key(other)
            history_seen.add(key)
            if other.qid == qid and kind != "exact":
                score = _similarity(_features(candidate), _features(other))
                kind = "reused"
            matches.append(_match_payload("history", kind, score, other))
        # Same qualified ID in historical source is reportable even after its
        # wording has changed enough to fall below the similarity threshold.
        for other in history_index.same_qid(qid):
            key = _candidate_key(other)
            if key in history_seen:
                continue
            score = 1.0 if candidate.fingerprint == other.fingerprint else _similarity(
                _features(candidate), _features(other),
            )
            kind = "exact" if candidate.fingerprint == other.fingerprint else "reused"
            matches.append(_match_payload("history", kind, score, other))

        # Repeating the exact same qid in one paper is still a reuse occurrence.
        for _ in range(max(0, occurrences[qid] - 1)):
            matches.append(_match_payload("paper", "reused", 1.0, candidate))
        for other, kind, score in paper_index.find(candidate, threshold):
            if other.qid == qid:
                continue
            matches.append(_match_payload("paper", kind, score, other))

        matches = _ordered_matches(matches)
        row_exact = any(match["kind"] == "exact" for match in matches)
        row_similar = any(match["kind"] == "similar" for match in matches)
        row_flagged = bool(matches)
        exact_count += int(row_exact)
        similar_count += int(row_similar)
        flagged_count += int(row_flagged)
        has_paper_match = any(match["source"] == "paper" for match in matches)
        has_history_match = any(match["source"] == "history" for match in matches)
        within_paper_count += int(has_paper_match)
        history_flagged_count += int(has_history_match)
        question_rows.append({
            "qualified_id": qid,
            "occurrences": occurrences[qid],
            "matches": _limit_matches(matches, match_limit),
            "match_count": len(matches),
            "truncated": len(matches) > match_limit,
        })

    return {
        "method": "text_ngram_v1",
        "threshold": threshold,
        "summary": {
            "question_count": len(question_ids),
            "flagged_count": flagged_count,
            "exact_count": exact_count,
            "similar_count": similar_count,
            "history_count": history_flagged_count,
            "within_paper_count": within_paper_count,
        },
        "questions": question_rows,
        "warnings": [],
    }


def history_conflicts(
    candidates: list[Candidate],
    history: list[Candidate],
    threshold: float = 0.85,
) -> set[str]:
    """Return candidate IDs reused or textually similar to history only."""
    threshold = _valid_threshold(threshold)
    index = SimilarityIndex(history)
    conflicts: set[str] = set()
    for candidate in candidates:
        if index.same_qid(candidate.qid) or index.has_match(candidate, threshold):
            conflicts.add(candidate.qid)
    return conflicts

