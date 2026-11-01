import copy

from solaire.agent_layer.llm.message_utils import ensure_assistant_tool_calls_have_reasoning
from solaire.agent_layer.llm.openai_compat import _prepare_compat_request_payload


def test_preparation_preserves_original_history_and_schema():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "题目"}]},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "bank.read", "arguments": "{}", "extra": "retained"}}]},
        {"role": "tool", "tool_call_id": "call-1", "name": "bank.read", "content": '{"result": 1}'},
    ]
    tools = [{"type": "function", "function": {"name": "bank.read", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}}}}]
    before = copy.deepcopy((messages, tools))
    projected, definitions = _prepare_compat_request_payload(messages, tools)
    ensure_assistant_tool_calls_have_reasoning(projected)
    assert (messages, tools) == before
    assert projected[1]["tool_calls"][0]["function"] == {"name": "bank_read", "arguments": "{}", "extra": "retained"}
    assert projected[2]["name"] == "bank_read"
    assert projected[2]["tool_call_id"] == "call-1"
    assert definitions[0]["function"]["name"] == "bank_read"
    assert definitions[0]["function"]["parameters"] == tools[0]["function"]["parameters"]


def test_empty_tool_definitions_keep_omitted_payload():
    assert _prepare_compat_request_payload([], None) == ([], None)
    assert _prepare_compat_request_payload([], []) == ([], None)
