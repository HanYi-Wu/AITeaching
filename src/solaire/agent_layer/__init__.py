"""AgentLayer — unified LLM orchestration, tools, memory, and sessions (M3)."""

from importlib import import_module

__all__ = [
    "create_session",
    "invoke_registered_tool",
    "list_sessions",
    "load_session",
    "openai_tools_payload",
    "save_session",
    "tool_descriptions_for_prompt",
]

_EXPORT_MODULES = {
    "invoke_registered_tool": ".registry",
    "openai_tools_payload": ".registry",
    "tool_descriptions_for_prompt": ".registry",
    "create_session": ".session",
    "list_sessions": ".session",
    "load_session": ".session",
    "save_session": ".session",
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
