"""LLM adapters for Agent Harness."""

from importlib import import_module

__all__ = [
    "AnthropicMessagesAdapter",
    "ChatChunk",
    "ChatResponse",
    "LLMAdapter",
    "OpenAICompatAdapter",
    "OpenAIResponsesAdapter",
    "ModelRouter",
    "load_llm_settings",
]

_EXPORT_MODULES = {
    "AnthropicMessagesAdapter": ".anthropic_messages",
    "ChatChunk": ".adapter",
    "ChatResponse": ".adapter",
    "LLMAdapter": ".adapter",
    "OpenAICompatAdapter": ".openai_compat",
    "OpenAIResponsesAdapter": ".openai_responses",
    "ModelRouter": ".router",
    "load_llm_settings": ".router",
}


def __getattr__(name: str):
    module_name = _EXPORT_MODULES.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(module_name, __name__), name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
