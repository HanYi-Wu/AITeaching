"""Analysis cache and narrow source fingerprinting for exam score batches."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from solaire.common.atomic_files import write_text_atomic

if TYPE_CHECKING:
    from solaire.web.results.models import ExamQuestion

FINGERPRINT_VERSION = "v1"

CACHE_REQUIRED_FIELDS = frozenset(
    {
        "batch_id",
        "exam_id",
        "student_count",
        "question_count",
        "imported_at",
        "warnings",
        "question_order",
        "student_mastery_rows",
        "question_stats",
        "node_stats",
        "student_stats",
        "class_avg_ratio",
        "class_avg_fuzzy",
    }
)


def compute_source_fingerprint(
    *,
    exam_id: str,
    batch_id: str,
    questions: list[ExamQuestion],
    scores_bytes: bytes,
    bindings: list[tuple[str, str]] | set[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    """Compute narrow, stable fingerprint strictly over consumed statistics inputs."""
    q_data = [
        [
            q.section_idx,
            q.section_id,
            q.question_in_section,
            q.question_id,
            float(q.score_per_item),
        ]
        for q in questions
    ]
    scores_sha256 = hashlib.sha256(scores_bytes).hexdigest()
    sorted_bindings = sorted(list(bindings or []))

    payload = {
        "v": FINGERPRINT_VERSION,
        "exam_id": exam_id,
        "batch_id": batch_id,
        "questions": q_data,
        "scores_sha256": scores_sha256,
        "bindings": sorted_bindings,
    }
    raw_json = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    fp_hash = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
    return {
        "version": FINGERPRINT_VERSION,
        "hash": fp_hash,
        "exam_id": exam_id,
        "batch_id": batch_id,
    }


def is_cache_valid(
    cached_data: Any,
    expected_fingerprint: dict[str, Any],
) -> bool:
    """Verify that cached data contains required fields and matching source fingerprint."""
    if not isinstance(cached_data, dict):
        return False
    if not CACHE_REQUIRED_FIELDS.issubset(cached_data.keys()):
        return False
    cached_fp = cached_data.get("_fingerprint")
    if not isinstance(cached_fp, dict):
        return False
    return (
        cached_fp.get("version") == expected_fingerprint.get("version")
        and cached_fp.get("hash") == expected_fingerprint.get("hash")
        and cached_fp.get("exam_id") == expected_fingerprint.get("exam_id")
        and cached_fp.get("batch_id") == expected_fingerprint.get("batch_id")
    )


def strip_cache_metadata(cached_data: dict[str, Any]) -> dict[str, Any]:
    """Strip internal cache metadata so private fields never leak to API callers."""
    return {k: v for k, v in cached_data.items() if not k.startswith("_")}


def save_analysis_cache_atomic(
    analysis_path: Path,
    analysis_data: dict[str, Any],
    fingerprint: dict[str, Any],
) -> None:
    """Atomically persist computed analysis data along with its source fingerprint."""
    cache_payload = dict(analysis_data)
    cache_payload["_fingerprint"] = fingerprint
    json_text = json.dumps(cache_payload, ensure_ascii=False, indent=2)
    write_text_atomic(analysis_path, json_text)
