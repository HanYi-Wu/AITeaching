"""AI question generation payload extraction and question validation."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any


def _extract_json(value: str) -> dict[str, Any] | None:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return data if isinstance(data, dict) else None


def _extract_generated_payload(response: Any) -> dict[str, Any] | None:
    for tool_call in getattr(response, "tool_calls", None) or []:
        function = tool_call.get("function") if isinstance(tool_call, dict) else None
        if not isinstance(function, dict) or function.get("name") != "submit_reinforcement_questions":
            continue
        arguments = function.get("arguments")
        if isinstance(arguments, dict):
            parsed = arguments
        elif isinstance(arguments, str):
            parsed = _extract_json(arguments)
        else:
            parsed = None
        if isinstance(parsed, dict):
            return parsed
    parsed = _extract_json(str(getattr(response, "content", None) or ""))
    if parsed is not None and not isinstance(parsed.get("questions"), list):
        alias = parsed.get("wrong_questions")
        if isinstance(alias, list):
            parsed = {key: value for key, value in parsed.items() if key != "wrong_questions"}
            parsed["questions"] = alias
    return parsed


def _validate_generated_questions(
    result: dict[str, Any],
    *,
    student_id: str,
    requested_count: int,
) -> dict[str, Any]:
    raw_questions = result.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise ValueError("AI did not return any reinforcement questions")
    if len(raw_questions) != requested_count:
        raise ValueError(f"AI must return exactly {requested_count} reinforcement questions")
    supported_types = {"single_choice", "multiple_choice", "choice", "judge", "fill", "short_answer", "essay"}
    questions: list[dict[str, Any]] = []
    answer_keys: dict[str, str] = {}
    for index, raw in enumerate(raw_questions[:requested_count], start=1):
        if not isinstance(raw, dict):
            raise ValueError("AI reinforcement question is invalid")
        qtype = str(raw.get("type") or "").strip()
        content = str(raw.get("content") or "").strip()
        answer = str(raw.get("answer") or "").strip()
        if not qtype or not content or not answer:
            raise ValueError("AI reinforcement question is missing type, content, or answer")
        if qtype not in supported_types:
            raise ValueError(f"AI reinforcement question type is unsupported: {qtype}")
        if len(content) > 10_000 or len(answer) > 2_000:
            raise ValueError("AI reinforcement question text is too long")
        options = raw.get("options")
        if qtype in {"single_choice", "multiple_choice", "choice", "judge"} and not isinstance(options, dict):
            raise ValueError("AI choice question is missing options")
        if isinstance(options, dict):
            if len(options) < 2 or len(options) > 20:
                raise ValueError("AI choice question has an invalid option count")
            if any(len(str(key)) > 20 or len(str(value)) > 2_000 for key, value in options.items()):
                raise ValueError("AI choice option is too long")
        if isinstance(options, dict) and qtype in {"single_choice", "choice", "judge"}:
            if answer not in {str(key) for key in options}:
                raise ValueError("AI choice answer does not exist in options")
        if isinstance(options, dict) and qtype == "multiple_choice":
            option_keys = {str(key) for key in options}
            compact_answer = re.sub(r"[^0-9A-Za-z]", "", answer)
            answer_keys_set = set(compact_answer) if all(len(key) == 1 for key in option_keys) else {answer}
            if not answer_keys_set or not answer_keys_set.issubset(option_keys):
                raise ValueError("AI choice answer does not exist in options")
        qid = str(raw.get("question_id") or f"reinforcement/{student_id}/{index}").strip()
        if qid in answer_keys:
            raise ValueError("AI returned duplicate question IDs")
        try:
            score_per_item = float(raw.get("score_per_item") or 5)
        except (TypeError, ValueError) as exc:
            raise ValueError("AI reinforcement question score is invalid") from exc
        if not math.isfinite(score_per_item) or score_per_item <= 0 or score_per_item > 100:
            raise ValueError("AI reinforcement question score is invalid")

        # Explicit knowledge node ID validation: do not guess via text similarity.
        # If no reliable knowledge node ID is attached, explicit None indicates incomparable.
        knowledge_node_id = str(raw.get("knowledge_node_id") or raw.get("node_id") or "").strip() or None

        payload: dict[str, Any] = {
            "question_id": qid,
            "header": str(raw.get("header") or f"举一反三 {index}"),
            "section_id": str(raw.get("section_id") or "practice"),
            "score_per_item": score_per_item,
            "type": qtype,
            "content": content,
            "options": options if isinstance(options, dict) else None,
        }
        if knowledge_node_id:
            payload["knowledge_node_id"] = knowledge_node_id
        questions.append(payload)
        answer_keys[qid] = answer
    if not questions:
        raise ValueError("AI did not return a valid reinforcement question")
    return {"questions": questions, "answer_keys": answer_keys}


async def generate_reinforcement_questions(
    *,
    project_root: Path,
    student: dict[str, Any],
    wrong_questions: list[dict[str, Any]],
    question_count: int,
) -> dict[str, Any]:
    from solaire.agent_layer.llm.router import ModelRouter, load_llm_settings

    settings = load_llm_settings(project_root)
    if not settings.api_key:
        raise ValueError("AI provider is not configured; reinforcement practice was not published")
    adapter = ModelRouter(settings=settings).main()
    compact_sources = [
        {
            "type": item.get("type"),
            "content": item.get("content"),
            "options": item.get("options"),
            "answer": item.get("answer"),
            "score_per_item": item.get("score_per_item"),
        }
        for item in wrong_questions[:30]
    ]
    response = await adapter.chat(
        [
            {
                "role": "system",
                "content": (
                    "你是严谨的中学教师。优先根据学生历史错题生成同知识点、同难度但数值或情境不同的举一反三题；"
                    "如果学生全部答对，则根据所选历史试卷的题目生成同知识点相关变式题。"
                    "必须调用 submit_reinforcement_questions 工具提交结果。每题必须含 "
                    "type/content/options/answer/score_per_item，不得照抄原题。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"student": student.get("display_name"), "question_count": question_count, "wrong_questions": compact_sources},
                    ensure_ascii=False,
                ),
            },
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "submit_reinforcement_questions",
                    "description": "提交给学生的举一反三题，只能在所有题目生成完毕后调用一次。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "questions": {
                                "type": "array",
                                "minItems": question_count,
                                "maxItems": question_count,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "question_id": {"type": "string"},
                                        "type": {"type": "string"},
                                        "content": {"type": "string"},
                                        "options": {
                                            "type": "object",
                                            "additionalProperties": {"type": "string"},
                                        },
                                        "answer": {"type": "string"},
                                        "score_per_item": {"type": "number"},
                                        "knowledge_node_id": {"type": "string"},
                                    },
                                    "required": ["type", "content", "options", "answer", "score_per_item"],
                                    "additionalProperties": False,
                                },
                            }
                        },
                        "required": ["questions"],
                        "additionalProperties": False,
                    },
                },
            }
        ],
        temperature=0.35,
        max_tokens=max(4000, question_count * 800),
    )
    parsed = _extract_generated_payload(response)
    if parsed is None:
        raise ValueError("AI returned malformed JSON; reinforcement practice was not published")
    return {
        **parsed,
        "provider": str(settings.provider),
        "model": settings.main_model,
        "usage": response.usage,
    }
