from __future__ import annotations

from solaire.agent_layer.models import ToolRisk
from solaire.agent_layer.tools import analysis_tools
from solaire.agent_layer.tools.schema_builder import RegisteredTool, _analysis, _fn

ANALYSIS_TOOLS: list[RegisteredTool] = [
    _analysis(
            "analysis.list_datasets",
            "列出当前内容库中可用的考试成绩数据集（考试与批次）。",
            {"type": "object", "properties": {}, "additionalProperties": False},
            risk=ToolRisk.READ,
            ui_label="正在读取考试数据列表…",
        ),
    _analysis(
            "analysis.list_builtins",
            "列出可用的内置分析流水线标识。",
            {"type": "object", "properties": {}, "additionalProperties": False},
            risk=ToolRisk.READ,
            ui_label="正在读取可用分析类型…",
        ),
    _analysis(
            "analysis.run_builtin",
            "运行一条内置分析流水线并创建作业；完成后可用 analysis.get_job 取结果。",
            {
                "type": "object",
                "properties": {
                    "builtin_id": {"type": "string"},
                    "exam_id": {"type": "string"},
                    "batch_id": {"type": "string"},
                    "recompute": {"type": "boolean"},
                    "request_id": {"type": "string"},
                },
                "required": ["builtin_id", "exam_id", "batch_id"],
                "additionalProperties": False,
            },
            ui_label="正在启动学情分析…",
            allegro_auto_add=True,
        ),
    _analysis(
            "analysis.save_script",
            "保存或更新一条分析脚本（执行受沙箱限制）。",
            {
                "type": "object",
                "properties": {
                    "script_id": {"type": "string"},
                    "name": {"type": "string"},
                    "language": {"type": "string"},
                    "code": {"type": "string"},
                },
                "required": ["name", "code"],
                "additionalProperties": False,
            },
            ui_label="正在保存分析脚本…",
        ),
    _analysis(
            "analysis.run_script",
            "在沙箱中运行已保存的分析脚本。",
            {
                "type": "object",
                "properties": {
                    "script_id": {"type": "string"},
                    "exam_id": {"type": "string"},
                    "batch_id": {"type": "string"},
                    "request_id": {"type": "string"},
                },
                "required": ["script_id", "exam_id", "batch_id"],
                "additionalProperties": False,
            },
            ui_label="正在运行分析脚本…",
            allegro_auto_add=True,
        ),
    _analysis(
            "analysis.get_job",
            "按作业标识获取分析作业状态与输出。",
            {
                "type": "object",
                "properties": {"job_id": {"type": "string"}, "include_output": {"type": "boolean"}},
                "required": ["job_id"],
                "additionalProperties": False,
            },
            risk=ToolRisk.READ,
            ui_label="正在查询分析进度…",
        ),
    _fn(
            "analysis.create_remediation_draft",
            "根据某次考试成绩批次的学情诊断结果，生成一份可编辑的补练卷组卷草稿。",
            {
                "type": "object",
                "properties": {
                    "exam_id": {"type": "string", "description": "源考试标识，如 期中/数学"},
                    "batch_id": {"type": "string", "description": "成绩批次 id"},
                    "weak_limit": {"type": "integer", "description": "最多参考的薄弱知识点数量，默认 5"},
                    "practice_per_node": {"type": "integer", "description": "每个知识点最多取题数，默认 4"},
                    "exclude_source_exam_questions": {
                        "type": "boolean",
                        "description": "是否排除原考试已用题，默认 true",
                    },
                    "template_ref": {"type": "string", "description": "可选，覆盖源考试模板 id"},
                    "template_path": {"type": "string", "description": "可选，覆盖源考试模板路径"},
                    "export_label": {"type": "string", "description": "可选，新草稿试卷说明"},
                },
                "required": ["exam_id", "batch_id"],
                "additionalProperties": False,
            },
            analysis_tools.tool_create_remediation_draft,
            ui_label="正在生成补练卷草稿…",
        ),
]
