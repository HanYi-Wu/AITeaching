"""Build chat messages with token budget and compaction hooks."""

from __future__ import annotations

import json
from typing import Any

from solaire.agent_layer.compactor import _json_size, compact_for_llm
from solaire.agent_layer.llm.message_utils import ensure_assistant_tool_calls_have_reasoning as _ensure_assistant_tool_calls_have_reasoning
from solaire.agent_layer.models import ChatMessage, SessionState
from solaire.agent_layer.prompts import build_system_prompt, build_system_prompt_cached
from solaire.agent_layer.registry import RegisteredTool, all_registered_tools, tool_descriptions_for_prompt
from solaire.agent_layer.task_tracker import build_task_plan_dynamic_block
from solaire.agent_layer.llm.token_budget import estimate_message_tokens


def _history_prefix_len(messages: list[dict[str, Any]]) -> int:
    """`build_messages` 前缀为连续的 system（固定两条：cacheable_prefix + dynamic_suffix），其后是会话历史。"""
    count = 0
    for m in messages:
        if m.get("role") != "system":
            break
        count += 1
    return count


def _tool_chain_spans(messages: list[dict[str, Any]], *, start: int) -> list[tuple[int, int]]:
    """每一段为 [assistant+tool_calls, end)，end 为该轮 tool 消息后一位索引。"""
    spans: list[tuple[int, int]] = []
    i = start
    n = len(messages)
    while i < n:
        m = messages[i]
        if m.get("role") == "assistant" and m.get("tool_calls"):
            j = i + 1
            while j < n and messages[j].get("role") == "tool":
                j += 1
            spans.append((i, j))
            i = j
        else:
            i += 1
    return spans


def _fold_tool_outputs_outside_recent_chains(
    messages: list[dict[str, Any]],
    *,
    start: int,
    keep_recent: int,
    general_stub: str,
    skill_stub: str,
    chain_spans: list[tuple[int, int]] | None = None,
) -> list[int]:
    """保留最近几条完整工具链的输出；更旧链内 tool.content 收紧为占位（不改变 tool_call_id / 顺序）。"""
    spans = chain_spans if chain_spans is not None else _tool_chain_spans(messages, start=start)
    if len(spans) <= keep_recent:
        return []
    protect = {(a, b) for a, b in spans[-keep_recent:]}
    changed: list[int] = []
    for a, b in spans:
        if (a, b) in protect:
            continue
        for k in range(a + 1, b):
            if messages[k].get("role") != "tool":
                continue
            name = messages[k].get("name") or ""
            txt = messages[k].get("content") or ""
            use_skill = (
                name in ("agent.activate_skill", "agent.read_skill_reference")
                or '"agent.activate_skill"' in txt
                or '"agent.read_skill_reference"' in txt
            )
            content = skill_stub if use_skill else general_stub
            if messages[k].get("content") != content:
                messages[k]["content"] = content
                changed.append(k)
    return changed


def _fold_reasoning_non_tool_assistants(
    messages: list[dict[str, Any]],
    *,
    start: int,
    keep_recent_tool_chains: int,
    chain_spans: list[tuple[int, int]] | None = None,
) -> None:
    """对「早于最近完整工具链」的非工具助手轮次，清空 reasoning_content。"""
    spans = chain_spans if chain_spans is not None else _tool_chain_spans(messages, start=start)
    if len(spans) <= keep_recent_tool_chains:
        return
    cutoff = spans[-keep_recent_tool_chains][0]
    for i in range(start, cutoff):
        m = messages[i]
        if m.get("role") != "assistant" or m.get("tool_calls"):
            continue
        if m.get("reasoning_content"):
            m["reasoning_content"] = ""


def _sanitize_tool_chains(messages: list[dict[str, Any]], *, start: int) -> None:
    """移除「孤儿」tool 消息（前方无 assistant+tool_calls 锚点的），
    然后为每个 assistant+tool_calls 补全缺失的 tool 响应占位；start 为非负历史起点。"""
    # Rebuild the suffix once: filtering orphan responses and appending missing
    # placeholders in-place with list.insert can otherwise shift the same tail
    # repeatedly when a damaged history has many incomplete tool chains.
    anchor_valid = False
    if 0 < start <= len(messages):
        anchor = messages[start - 1]
        anchor_valid = anchor.get("role") == "assistant" and bool(anchor.get("tool_calls"))
    sanitized = messages[:start]
    i = start
    while i < len(messages):
        message = messages[i]
        if message.get("role") == "tool":
            if anchor_valid:
                sanitized.append(message)
            i += 1
            continue

        sanitized.append(message)
        if message.get("role") != "assistant" or not message.get("tool_calls"):
            anchor_valid = False
            i += 1
            continue

        # Copy the complete existing response block in order and remove IDs as
        # they are satisfied. Missing IDs are appended at the same boundary as
        # before, using the same set iteration order.
        expected_ids = {tc.get("id") for tc in message["tool_calls"] if tc.get("id")}
        j = i + 1
        while j < len(messages) and messages[j].get("role") == "tool":
            sanitized.append(messages[j])
            expected_ids.discard(messages[j].get("tool_call_id"))
            j += 1
        for missing_id in expected_ids:
            sanitized.append({
                "role": "tool",
                "tool_call_id": missing_id,
                "content": '{"error": "结果已丢失，请重新调用相应工具。"}',
            })
        anchor_valid = True
        i = j
    messages[:] = sanitized


def _drop_oldest_history_segment(messages: list[dict[str, Any]], *, prefix_len: int) -> bool:
    """在限定前缀（system）之后删除一段最旧历史，且不拆散 assistant↔tool 成对结构。"""
    if len(messages) <= prefix_len + 1:
        return False
    start = prefix_len
    end = _history_segment_end(messages, start)
    del messages[start:end]
    return True


def _history_segment_end(messages: list[dict[str, Any]], start: int) -> int:
    """Return the end of the oldest indivisible history segment at ``start``."""
    role0 = messages[start].get("role")
    if role0 == "tool":
        end = start
        while end < len(messages) and messages[end].get("role") == "tool":
            end += 1
        return end
    if role0 == "assistant" and messages[start].get("tool_calls"):
        end = start + 1
        while end < len(messages) and messages[end].get("role") == "tool":
            end += 1
        return end
    if role0 == "user":
        end = start + 1
        while end < len(messages) and messages[end].get("role") != "user":
            end += 1
        return end
    return start + 1


class ContextManager:
    TOKEN_BUDGET_TOTAL = 200000
    # 软压缩阈值设为接近模型上下文极限（~160K），避免过早 stub 破坏 KV Cache 前缀匹配。
    # DeepSeek 的 common prefix detection 需要多次请求才能注册独立前缀单元；
    # 过早压缩会改变历史消息字节，导致缓存命中率大幅下降。
    HISTORY_SOFT_BUDGET_TOKENS = 160000
    KEEP_RECENT_TOOL_CHAINS_SOFT = 6

    def __init__(self, *, include_subtask_tool: bool = True) -> None:
        self.include_subtask_tool = include_subtask_tool

    def build_system_parts(
        self,
        project_ctx: dict[str, Any],
        *,
        session: SessionState,
        tools: list[RegisteredTool] | None = None,
        skill_guidance: str | None = None,
        current_focus: str | None = None,
        plan_mode_active: bool = False,
        execution_plan_path: str | None = None,
        skill_catalog: str | None = None,
        page_context_brief: str | None = None,
        include_focus_info: bool = True,
    ) -> tuple[str, str]:
        """Return (cacheable_prefix, dynamic_suffix) for two system messages.

        Stable prefix (role + constraints + tools) goes in first system message.
        Dynamic info (context / focus / plan state) goes in second system message.
        This split keeps the prefix byte-identical across turns for KV Cache hits.
        """
        tlist = tools
        if tlist is None:
            tlist = all_registered_tools(include_subtask=self.include_subtask_tool)
        desc = tool_descriptions_for_prompt(tlist)
        root = project_ctx.get("_project_root")
        public_ctx = {k: v for k, v in project_ctx.items() if not str(k).startswith("_") and k != "page_context"}
        task_plan_block = build_task_plan_dynamic_block(session)
        return build_system_prompt_cached(
            tool_descriptions=desc,
            project_ctx=public_ctx,
            skill_guidance=skill_guidance,
            current_focus=current_focus,
            plan_mode_active=plan_mode_active,
            execution_plan_path=execution_plan_path,
            skill_catalog=skill_catalog,
            task_plan_block=task_plan_block or None,
            page_context_brief=None,  # moved to user message prefix for KV cache stability
            project_root=root,
            include_focus_info=include_focus_info,
        )

    def build_system_content(
        self,
        project_ctx: dict[str, Any],
        *,
        tools: list[RegisteredTool] | None = None,
        skill_guidance: str | None = None,
        current_focus: str | None = None,
        plan_mode_active: bool = False,
        execution_plan_path: str | None = None,
        skill_catalog: str | None = None,
    ) -> str:
        """Legacy: return single joined system prompt string."""
        tlist = tools
        if tlist is None:
            tlist = all_registered_tools(include_subtask=self.include_subtask_tool)
        desc = tool_descriptions_for_prompt(tlist)
        root = project_ctx.get("_project_root")
        public_ctx = {k: v for k, v in project_ctx.items() if not str(k).startswith("_") and k != "page_context"}
        return build_system_prompt(
            tool_descriptions=desc,
            project_ctx=public_ctx,
            skill_guidance=skill_guidance,
            current_focus=current_focus,
            plan_mode_active=plan_mode_active,
            execution_plan_path=execution_plan_path,
            skill_catalog=skill_catalog,
            project_root=root,
        )

    def build_messages(
        self,
        *,
        system_content: str | None = None,
        system_prefix: str | None = None,
        system_suffix: str | None = None,
        session: SessionState,
        user_message: str,
    ) -> list[dict[str, Any]]:
        if system_prefix is not None:
            msgs: list[dict[str, Any]] = [
                {"role": "system", "content": system_prefix},
                {"role": "system", "content": system_suffix or ""},
            ]
        elif system_content is not None:
            msgs = [{"role": "system", "content": system_content}]
        else:
            msgs = []
        for m in session.messages:
            d: dict[str, Any] = {"role": m.role}
            if m.role == "tool":
                d["content"] = m.content or ""
                d["tool_call_id"] = m.tool_call_id or ""
                if m.name:
                    d["name"] = m.name
            else:
                if m.content is not None:
                    d["content"] = m.content
                if m.reasoning_content is not None:
                    d["reasoning_content"] = m.reasoning_content
                if m.tool_calls:
                    d["tool_calls"] = m.tool_calls
                    if m.role == "assistant" and "reasoning_content" not in d:
                        d["reasoning_content"] = ""
            msgs.append(d)
        if user_message.strip():
            msgs.append({"role": "user", "content": user_message.strip()})
        self._maybe_compact(msgs)
        _ensure_assistant_tool_calls_have_reasoning(msgs)
        return msgs

    def _maybe_compact(self, messages: list[dict[str, Any]]) -> None:
        """折叠旧工具输出/推理，必要时删减最旧片段；始终在变更后重做 tool 链卫生。"""
        stub = "[较早的工具输出已折叠；如需细节请重新运行相应工具。]"
        stub_skill = "[较早的技能载入或参考资料内容已省略；需要时请重新激活或读取参考。]"
        prefix = _history_prefix_len(messages)
        min_tail = 2

        _sanitize_tool_chains(messages, start=prefix)
        token_costs = [estimate_message_tokens(message) for message in messages]
        estimated_tokens = sum(token_costs)

        def _replace_content(index: int, content: str) -> None:
            nonlocal estimated_tokens
            messages[index]["content"] = content
            previous = token_costs[index]
            updated = estimate_message_tokens(messages[index])
            token_costs[index] = updated
            estimated_tokens += updated - previous

        if estimated_tokens > self.HISTORY_SOFT_BUDGET_TOKENS:
            chain_spans = _tool_chain_spans(messages, start=prefix)
            changed_content_indices = _fold_tool_outputs_outside_recent_chains(
                messages,
                start=prefix,
                keep_recent=self.KEEP_RECENT_TOOL_CHAINS_SOFT,
                general_stub=stub,
                skill_stub=stub_skill,
                chain_spans=chain_spans,
            )
            for i in changed_content_indices:
                previous = token_costs[i]
                updated = estimate_message_tokens(messages[i])
                token_costs[i] = updated
                estimated_tokens += updated - previous
            _fold_reasoning_non_tool_assistants(
                messages,
                start=prefix,
                keep_recent_tool_chains=self.KEEP_RECENT_TOOL_CHAINS_SOFT,
                chain_spans=chain_spans,
            )

        cursor = prefix
        while estimated_tokens > self.TOKEN_BUDGET_TOTAL and len(messages) > prefix + min_tail:
            for i in range(cursor, max(cursor, len(messages) - 1)):
                m = messages[i]
                if m.get("role") == "tool" and (m.get("content") or "") not in (stub, stub_skill):
                    _replace_content(i, stub)
                    cursor = i + 1
                    break
            else:
                # All eligible tool outputs are now stubs. Predict the exact
                # old-segment removals against the original indices, then shift
                # the history only once instead of repeated list deletions.
                drop_end = prefix
                projected_len = len(messages)
                while estimated_tokens > self.TOKEN_BUDGET_TOTAL and projected_len > prefix + min_tail:
                    segment_end = _history_segment_end(messages, drop_end)
                    if segment_end <= drop_end:
                        break
                    removed_tokens = sum(token_costs[drop_end:segment_end])
                    estimated_tokens -= removed_tokens
                    projected_len -= segment_end - drop_end
                    drop_end = segment_end
                if drop_end > prefix:
                    del messages[prefix:drop_end]
                    del token_costs[prefix:drop_end]
                break
            if estimated_tokens <= self.TOKEN_BUDGET_TOTAL:
                continue


def _paper_submissions_for_llm(data: dict[str, Any]) -> dict[str, Any]:
    """Keep identifiers/statuses visible while removing large answer image payloads."""
    container = data.get("data") if isinstance(data.get("data"), dict) else data
    raw_items = container.get("items") if isinstance(container, dict) else None
    if not isinstance(raw_items, list):
        return data
    items: list[dict[str, Any]] = []
    truncated = False
    # Exact json.dumps length of the empty wrapper; each item adds its own
    # encoded length and, after the first, the standard ", " list separator.
    serialized_items_size = _json_size({"items": []})
    max_serialized_items_size = 8500
    for raw in raw_items[:100]:
        if not isinstance(raw, dict):
            continue
        raw_answers = raw.get("answers") if isinstance(raw.get("answers"), list) else None
        answer_statuses: dict[str, list[str]] = {"pending": [], "needs_review": [], "reviewed": []}
        image_answer_count = 0
        for answer in raw_answers or []:
            if not isinstance(answer, dict):
                continue
            images = answer.get("images") if isinstance(answer.get("images"), list) else []
            image_answer_count += int(bool(images))
            status = str(answer.get("grading_status") or "pending")
            bucket = answer_statuses.get(status)
            if bucket is not None and len(bucket) < 30:
                bucket.append(str(answer.get("question_id") or ""))
        compact_item = {
                key: raw.get(key)
                for key in (
                    "attempt_id",
                    "publication_id",
                    "paper_id",
                    "student_id",
                    "student_no",
                    "student_name",
                    "account_username",
                    "status",
                    "submission_mode",
                    "score",
                    "max_score",
                    "submitted_at",
                )
            }
        compact_item |= {
                "scan_image_count": len(raw.get("scan_images") or []) if isinstance(raw.get("scan_images"), list) else 0,
                "answer_count": len(raw_answers) if raw_answers is not None else raw.get("answer_count"),
                "pending_count": (
                    len(answer_statuses["pending"])
                    if raw_answers is not None
                    else raw.get("pending_answer_count")
                ),
                "needs_review_count": (
                    len(answer_statuses["needs_review"])
                    if raw_answers is not None
                    else raw.get("ai_suggested_count")
                ),
                "reviewed_count": (
                    len(answer_statuses["reviewed"])
                    if raw_answers is not None
                    else raw.get("reviewed_answer_count")
                ),
                "pending_question_ids": answer_statuses["pending"],
                "needs_review_question_ids": answer_statuses["needs_review"],
                "reviewed_question_ids": answer_statuses["reviewed"],
                "image_answer_count": image_answer_count,
            }
        separator_size = 2 if items else 0
        item_size = _json_size(
            compact_item,
            stop_after=max_serialized_items_size - serialized_items_size - separator_size,
        )
        if serialized_items_size + separator_size + item_size > max_serialized_items_size:
            truncated = True
            break
        items.append(compact_item)
        serialized_items_size += separator_size + item_size
    result: dict[str, Any] = {
        "items": items,
        "total": len(raw_items),
        "truncated": truncated or len(raw_items) > len(items),
        "id_guidance": "后续批改必须使用 items[].attempt_id；publication_id 不是 attempt_id，不得代替。",
    }
    if container is data:
        return result
    wrapped = {key: value for key, value in data.items() if key != "data"}
    wrapped["data"] = result
    return wrapped


def tool_result_to_content(tool_name: str, data: dict[str, Any]) -> str:
    source = _paper_submissions_for_llm(data) if tool_name in {"paper.submissions", "paper.find_submissions"} else data
    payload, _ = compact_for_llm(source, max_chars=10000)
    return json.dumps({"tool": tool_name, "result": payload}, ensure_ascii=False, default=str)
