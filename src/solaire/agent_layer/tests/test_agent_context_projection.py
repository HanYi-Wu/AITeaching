"""Exactness and scaling regressions for context projection."""

from __future__ import annotations

import json

from solaire.agent_layer.compactor import _json_size, compact_for_llm
from solaire.agent_layer.context import _paper_submissions_for_llm


def test_incremental_json_size_matches_json_dumps_and_stops_at_budget():
    values = [
        None,
        True,
        15,
        "课堂\n记录",
        [1, "二", {"value": object()}],
        {"items": [{"id": "q1", "tags": ["基础", "易错"]}]},
    ]
    for value in values:
        exact = len(json.dumps(value, ensure_ascii=False, default=str))
        assert _json_size(value) == exact
        if exact:
            assert _json_size(value, stop_after=exact - 1) > exact - 1
            assert _json_size(value, stop_after=exact) == exact


def test_paper_submission_projection_keeps_the_same_exact_budget_prefix():
    raw_items = [
        {
            "attempt_id": f"attempt-{index:03d}",
            "publication_id": f"pub-{index:03d}",
            "student_name": "学" * (60 + index % 11),
            "status": "submitted",
            "answers": [
                {"question_id": f"q-{index}-p", "grading_status": "pending", "images": [{"url": "x"}]},
                {"question_id": f"q-{index}-r", "grading_status": "reviewed", "images": []},
            ],
            "scan_images": [{"url": "private-image-payload"}],
        }
        for index in range(100)
    ]
    data = {"data": {"items": raw_items}, "status": "ok", "page": 4}
    actual = _paper_submissions_for_llm(data)

    expected_items: list[dict] = []
    truncated = False
    for raw in raw_items[:100]:
        statuses = {"pending": [], "needs_review": [], "reviewed": []}
        image_answer_count = 0
        for answer in raw["answers"]:
            image_answer_count += int(bool(answer["images"]))
            status = str(answer.get("grading_status") or "pending")
            bucket = statuses.get(status)
            if bucket is not None and len(bucket) < 30:
                bucket.append(str(answer.get("question_id") or ""))
        compact = {
            key: raw.get(key)
            for key in (
                "attempt_id", "publication_id", "paper_id", "student_id", "student_no",
                "student_name", "account_username", "status", "submission_mode", "score",
                "max_score", "submitted_at",
            )
        }
        compact |= {
            "scan_image_count": len(raw["scan_images"]),
            "answer_count": len(raw["answers"]),
            "pending_count": len(statuses["pending"]),
            "needs_review_count": len(statuses["needs_review"]),
            "reviewed_count": len(statuses["reviewed"]),
            "pending_question_ids": statuses["pending"],
            "needs_review_question_ids": statuses["needs_review"],
            "reviewed_question_ids": statuses["reviewed"],
            "image_answer_count": image_answer_count,
        }
        candidate = expected_items + [compact]
        if len(json.dumps({"items": candidate}, ensure_ascii=False, default=str)) > 8500:
            truncated = True
            break
        expected_items.append(compact)

    expected_data = {
        "items": expected_items,
        "total": len(raw_items),
        "truncated": truncated or len(raw_items) > len(expected_items),
        "id_guidance": "后续批改必须使用 items[].attempt_id；publication_id 不是 attempt_id，不得代替。",
    }
    assert actual == {"status": "ok", "page": 4, "data": expected_data}


def test_graph_payload_compaction_preserves_the_same_projection():
    payload = {
        "kind_counts": {"concept": 1500},
        "nodes": [
            {
                "id": f"node-{index}",
                "canonical_name": f"concept-{index}",
                "node_kind": "concept",
                "subject": "math",
                "level": "middle",
                "tags": ["core", "exam"],
                "description": "x" * 400,
            }
            for index in range(1500)
        ],
        "unrelated": "large payload",
    }

    compacted, truncated = compact_for_llm(payload, max_chars=4000)

    assert truncated
    assert compacted["node_total"] == 1500
    assert len(compacted["nodes"]) < 35
    assert compacted["nodes"][0]["id"] == "node-0"
    assert compacted["nodes"][-1]["id"] == "node-1499"
