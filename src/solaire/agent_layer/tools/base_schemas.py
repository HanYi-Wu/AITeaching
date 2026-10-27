from __future__ import annotations

from solaire.agent_layer.models import ToolRisk
from solaire.agent_layer.tools import (
    memory_tools,
    pipeline_tools,
    session_tools,
    teacher_tools,
    web_tools,
)
from solaire.agent_layer.tools.schema_builder import RegisteredTool, _S, _fn, _teacher_schema

BASE_TOOLS: list[RegisteredTool] = [
    _fn(
            "memory.read_index",
            "读取跨会话记忆索引（提示性质，引用前建议再读主题文件核对）。",
            {"type": "object", "properties": {}, "additionalProperties": False},
            memory_tools.tool_read_index,
            risk=ToolRisk.READ,
            ui_label="正在读取长期备忘索引…",
        ),
    _fn(
            "memory.read_topic",
            "读取指定主题记忆文件正文（文件名含 .md）。",
            {
                "type": "object",
                "properties": {"topic": {"type": "string"}},
                "required": ["topic"],
                "additionalProperties": False,
            },
            memory_tools.tool_read_topic,
            risk=ToolRisk.READ,
            ui_label="正在打开备忘主题…",
        ),
    _fn(
            "memory.search",
            "在主题记忆文件中按关键词做简单检索。",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_hits": {"type": "integer"},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            memory_tools.tool_search,
            risk=ToolRisk.READ,
            ui_label="正在搜索备忘内容…",
        ),
    _fn(
            "agent.set_task_plan",
            "为本轮对话登记多步任务清单，便于跟进进度（仅当前会话有效）。",
            {
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "status": {"type": "string"},
                            },
                            "required": ["title"],
                        },
                    }
                },
                "required": ["steps"],
                "additionalProperties": False,
            },
            session_tools.tool_set_task_plan,
            risk=ToolRisk.READ,
            ui_label="正在整理任务步骤…",
        ),
    _fn(
            "agent.update_task_step",
            "更新任务清单中某一序号的完成状态（如 pending、doing、done）。",
            {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "从 0 开始的序号"},
                    "status": {"type": "string"},
                },
                "required": ["index", "status"],
                "additionalProperties": False,
            },
            session_tools.tool_update_task_step,
            risk=ToolRisk.READ,
            ui_label="正在更新任务进度…",
        ),
    _fn(
            "agent.run_tool_pipeline",
            "按顺序执行多步工具调用（用于减少往返；若某步需教师确认则会中止并提示分步执行）。",
            {
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "tool": {"type": "string"},
                                "arguments": {"type": "object"},
                            },
                            "required": ["tool"],
                        },
                    }
                },
                "required": ["steps"],
                "additionalProperties": False,
            },
            pipeline_tools.tool_run_tool_pipeline,
            ui_label="正在执行多步操作…",
        ),
    _fn(
            "agent.switch_focus",
            "切换当前聚焦域以获取不同领域的工具能力。可选域：general / bank / graph / analysis / compose / doc_process。",
            {
                "type": "object",
                "properties": {
                    "domain": {
                        "type": "string",
                        "enum": ["general", "bank", "graph", "analysis", "compose", "doc_process"],
                        "description": "目标聚焦域",
                    },
                },
                "required": ["domain"],
                "additionalProperties": False,
            },
            session_tools.tool_switch_focus,
            risk=ToolRisk.READ,
            ui_label="正在切换工作域…",
        ),
    _fn(
            "agent.enter_plan_mode",
            "进入计划模式：只读探索当前状况并生成结构化执行计划，等待教师审批后再执行。适用于复杂任务。",
            {"type": "object", "properties": {}, "additionalProperties": False},
            session_tools.tool_enter_plan_mode,
            risk=ToolRisk.READ,
            ui_label="正在进入计划模式…",
        ),
    _fn(
            "agent.exit_plan_mode",
            "提交计划并退出计划模式，将计划呈现给教师审批。",
            {
                "type": "object",
                "properties": {
                    "plan_file_path": {"type": "string", "description": "计划文件的内容目录相对路径"},
                },
                "additionalProperties": False,
            },
            session_tools.tool_exit_plan_mode,
            risk=ToolRisk.READ,
            ui_label="正在提交计划…",
        ),
    _fn(
            "agent.activate_skill",
            "激活一项技能以获取其详细工作流指引。请先阅读系统提示中的技能目录，匹配后再调用。",
            {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "技能标识名"},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
            session_tools.tool_activate_skill,
            risk=ToolRisk.READ,
            ui_label="正在加载技能指引…",
        ),
    _fn(
            "agent.read_skill_reference",
            "读取技能包内参考文件（如 references/*.md）。path 为相对该技能根目录的路径，例如 references/geometry-2d.md。"
            "内置技能文件不在教师项目目录中，请勿用 file.read 拼仓库源码路径。",
            {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "技能标识名（与 agent.activate_skill 一致）"},
                    "path": {"type": "string", "description": "相对技能根目录的路径，如 references/overview.md"},
                    "offset": {"type": "integer", "description": "起始行号（0-based），默认 0"},
                    "limit": {"type": "integer", "description": "读取行数，默认全部"},
                },
                "required": ["name", "path"],
                "additionalProperties": False,
            },
            session_tools.tool_read_skill_reference,
            risk=ToolRisk.READ,
            ui_label="正在读取技能参考…",
        ),
    _fn(
            "web.search",
            "联网检索公开网页摘要（用于教学参考；需在环境中配置检索服务密钥）。",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "description": "默认 5，最大 10"},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            web_tools.tool_web_search,
            risk=ToolRisk.READ,
            ui_label="正在搜索公开资料…",
        ),
    _fn(
            "web.fetch",
            "抓取并提取网页正文纯文本（去除导航/广告/样式/脚本，仅保留可读内容）。"
            "适用于教师提供网页链接后分析页面内容，不需要配置 API 密钥。",
            {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要抓取的网页 URL"},
                },
                "required": ["url"],
                "additionalProperties": False,
            },
            web_tools.tool_web_fetch,
            risk=ToolRisk.READ,
            ui_label="正在提取网页内容…",
        ),
    _fn("teacher.list_capabilities", "列出教师可通过 AI 完成的操作及必须人工确认的安全操作。", _teacher_schema(), teacher_tools.tool_list_capabilities, risk=ToolRisk.READ),
    _fn("teacher.operation_guide", "返回某项高风险人工操作的前置条件、完整步骤和安全提醒。", _teacher_schema({"capability_id": _S}, ["capability_id"]), teacher_tools.tool_operation_guide, risk=ToolRisk.READ),
    _fn(
                "teacher.student_profile",
                "按可选日期范围读取教师班级内某名学生的完成率、得分、考试行为事件、答题时长和薄弱题目。",
                _teacher_schema(
                    {"class_id": _S, "student_id": _S, "student_query": _S, "date_from": _S, "date_to": _S},
                    [],
                ),
                teacher_tools.tool_teacher_student_profile,
                risk=ToolRisk.READ,
            ),
]
