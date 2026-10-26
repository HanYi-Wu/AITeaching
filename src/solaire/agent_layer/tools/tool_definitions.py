"""Unified tool schema definitions — composed from domain schema modules."""



from __future__ import annotations



from dataclasses import replace



from solaire.agent_layer.models import ToolResult, ToolRisk

from solaire.agent_layer.tools.analysis_schemas import ANALYSIS_TOOLS

from solaire.agent_layer.tools.bank_schemas import BANK_TOOLS

from solaire.agent_layer.tools.base_schemas import BASE_TOOLS

from solaire.agent_layer.tools.doc_file_schemas import DOC_FILE_TOOLS

from solaire.agent_layer.tools.exam_schemas import EXAM_TOOLS

from solaire.agent_layer.tools.grading_schemas import GRADING_TOOLS

from solaire.agent_layer.tools.graph_schemas import GRAPH_TOOLS

from solaire.agent_layer.tools.schema_builder import (

    RegisteredTool,

    ToolHandler,

    _analysis,

    _fn,

    _teacher_schema,

)



_ORIGINAL_TOOL_ORDER: tuple[str, ...] = ('analysis.list_datasets', 'analysis.list_builtins', 'analysis.run_builtin', 'analysis.save_script', 'analysis.run_script', 'analysis.get_job', 'analysis.create_remediation_draft', 'exam.list_templates', 'exam.get_template_preview', 'exam.validate_paper', 'exam.export_paper', 'exam.publish_online_paper', 'exam.ai_grade_submission', 'bank.search_items', 'bank.export_items', 'bank.get_item', 'bank.update_item', 'bank.organize', 'bank.adapt_answers', 'bank.legacy_answer_candidates', 'bank.create_items', 'bank.create_item', 'graph.list_graphs', 'graph.create_graph', 'graph.delete_graph', 'graph.list_nodes', 'graph.search_nodes', 'graph.create_node', 'graph.batch_create_nodes', 'graph.update_node', 'graph.delete_node', 'graph.list_relations', 'graph.create_relation', 'graph.update_relation', 'graph.batch_create_relations', 'graph.delete_relation', 'graph.bind_question', 'graph.batch_bind_questions', 'graph.attach_resource', 'memory.read_index', 'memory.read_topic', 'memory.search', 'agent.set_task_plan', 'agent.update_task_step', 'web.search', 'web.fetch', 'agent.run_tool_pipeline', 'agent.switch_focus', 'agent.enter_plan_mode', 'agent.exit_plan_mode', 'agent.activate_skill', 'agent.read_skill_reference', 'file.read', 'file.write', 'file.edit', 'file.list', 'file.search', 'doc.convert_to_markdown', 'doc.extract_pdf_text', 'doc.ocr_image', 'teacher.list_capabilities', 'teacher.operation_guide', 'graph.rename_graph', 'graph.get_taxonomy', 'graph.set_taxonomy', 'graph.unbind_question', 'graph.detach_resource', 'bank.delete_item', 'template.list', 'template.get', 'template.create', 'template.update', 'template.rename', 'template.delete', 'exam.workspace_list', 'exam.workspace_get', 'exam.workspace_save', 'exam.workspace_delete', 'exam.workspace_copy', 'paper.list', 'paper.analyze', 'paper.publications', 'content.folders', 'content.folder_create', 'content.folder_update', 'content.move_item', 'content.tags', 'content.tag_save', 'content.item_tags', 'paper.folder_analyze', 'paper.practice_history', 'paper.publish_wrong_question_practice', 'paper.publish_reinforcement_practice', 'paper.find_submissions', 'paper.ai_grade_pending', 'paper.offline_upload_guide', 'teacher.student_profile', 'paper.submissions', 'paper.update_delivery', 'paper.update_publication', 'paper.revoke_publication', 'paper.manual_grade', 'paper.complete_grading')



_ALL_DOMAIN_TOOLS_BY_NAME: dict[str, RegisteredTool] = {

    t.name: t

    for group in (

        ANALYSIS_TOOLS,

        BANK_TOOLS,

        GRAPH_TOOLS,

        EXAM_TOOLS,

        GRADING_TOOLS,

        DOC_FILE_TOOLS,

        BASE_TOOLS,

    )

    for t in group

}



_RAW_TOOLS: list[RegisteredTool] = [

    _ALL_DOMAIN_TOOLS_BY_NAME[name] for name in _ORIGINAL_TOOL_ORDER

]



_CONFIRM_LABELS: dict[str, str] = {

    "bank.adapt_answers": "批量适配答案且/或关系（保留原答案）",

    "paper.ai_grade_pending": "批量生成 AI 预批改建议",

    "paper.complete_grading": "确认完成批改并向学生发布成绩",

    "paper.publish_wrong_question_practice": "发布个性化历史错题卷",

    "paper.publish_reinforcement_practice": "调用 AI 生成并发布专项巩固卷",

    "exam.export_paper": "导出试卷文件",

    "exam.validate_paper": "校验选题与卷面结构并写入临时配置",

    "graph.delete_node": "删除知识要点及其关联",

    "graph.delete_relation": "删除要点之间的关联",

    "graph.create_node": "新建知识要点",

    "graph.update_node": "修改知识要点",

    "graph.create_relation": "新建要点关联",

    "graph.update_relation": "修改要点关联",

    "graph.batch_create_nodes": "批量新建知识要点",

    "graph.batch_create_relations": "批量新建要点关联",

    "graph.batch_bind_questions": "批量将题目挂接到知识要点",

    "graph.bind_question": "将题目挂接到知识要点",

    "graph.attach_resource": "为要点挂载资料",

    "graph.create_graph": "新建科目图谱",

    "graph.delete_graph": "删除科目图谱",

    "bank.update_item": "修改题库中的题目内容",

    "bank.create_item": "在个人题库中新建题目",

    "analysis.save_script": "保存分析脚本",

    "analysis.run_script": "运行分析脚本",

    "analysis.run_builtin": "运行内置学情分析",

    "analysis.create_remediation_draft": "生成补练卷草稿",

    "agent.run_subtask": "分步深入分析子任务",

    "agent.run_tool_pipeline": "按序执行多步工具",

    "file.write": "写入内容目录文件",

    "file.edit": "编辑内容目录文件",

}





def _apply_confirm_labels(tools: list[RegisteredTool]) -> list[RegisteredTool]:

    return [replace(t, action_label=t.action_label or _CONFIRM_LABELS.get(t.name)) for t in tools]





TOOLS = _apply_confirm_labels(_RAW_TOOLS)



SUBTASK_TOOL_NAME = "agent.run_subtask"





def subtask_tool_schema() -> RegisteredTool:

    return RegisteredTool(

        name=SUBTASK_TOOL_NAME,

        description=(

            "启动子任务深度分析：在隔离上下文中多步调用工具，仅将精简结论返回主对话。"

            "用于复杂诊断、脚本调试或综合报告素材收集。"

        ),

        parameters_schema={

            "type": "object",

            "properties": {

                "objective": {"type": "string", "description": "子任务目标与成功标准"},

                "allowed_tool_prefixes": {

                    "type": "array",

                    "items": {"type": "string"},

                    "description": "允许的工具名前缀，如 analysis.、memory.；留空表示不额外限制",

                },

            },

            "required": ["objective"],

            "additionalProperties": False,

        },

        handler=lambda ctx, args: ToolResult(status="failed", error_message="handled in orchestrator"),

        risk=ToolRisk.WRITE,

        ui_label="正在分步深入分析…",

        action_label=_CONFIRM_LABELS.get(SUBTASK_TOOL_NAME),

    )
