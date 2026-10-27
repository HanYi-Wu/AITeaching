from __future__ import annotations

from solaire.agent_layer.models import ToolRisk
from solaire.agent_layer.tools import bank_tools, teacher_tools
from solaire.agent_layer.tools.schema_builder import RegisteredTool, _S, _fn, _teacher_schema

BANK_TOOLS: list[RegisteredTool] = [
    _fn(
            "bank.search_items",
            "在题库中按关键词或题型筛选题目，返回完整标识与内容摘要。",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "关键词，可匹配题干摘要或标识；留空则仅按题型筛选"},
                    "question_type": {
                        "type": "string",
                        "description": "题型：single_choice / multiple_choice / fill / judge / short_answer / reasoning / essay；旧 choice 可兼容读取；可留空",
                    },
                    "max_hits": {"type": "integer", "description": "最多返回条数，默认 30，最大 80"},
                },
                "additionalProperties": False,
            },
            bank_tools.tool_bank_search_items,
            risk=ToolRisk.READ,
            ui_label="正在检索题库…",
        ),
    _fn(
            "bank.export_items",
            "将已检索并选定的部分题目按题型和标识梳理为 EducationHelper YAML 文件，并在对话中提供直接下载按钮。",
            {
                "type": "object",
                "properties": {
                    "qualified_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 300},
                    "title": {"type": "string"},
                },
                "required": ["qualified_ids"],
                "additionalProperties": False,
            },
            bank_tools.tool_bank_export_items,
            risk=ToolRisk.READ,
            ui_label="正在梳理并导出题目…",
        ),
    _fn(
            "bank.get_item",
            "读取教师个人题库中一道题目的完整内容与结构。",
            {
                "type": "object",
                "properties": {"qualified_id": {"type": "string", "description": "题目完整标识"}},
                "required": ["qualified_id"],
                "additionalProperties": False,
            },
            bank_tools.tool_bank_get_item,
            risk=ToolRisk.READ,
            ui_label="正在打开题目详情…",
        ),
    _fn(
            "bank.update_item",
            "修改已有独立题目的题干、答案、解析或选项（写入操作，可能需确认）。保存后会返回 format_warnings；若 format_ok=false，必须继续修正。",
            {
                "type": "object",
                "properties": {
                    "qualified_id": {"type": "string"},
                    "content": {"type": "string"},
                    "answer": {"type": "string"},
                    "analysis": {"type": "string"},
                    "options": {"type": "string", "description": "选择题选项，JSON 对象字符串，如 {\"A\":\"...\",\"B\":\"...\"}"},
                    "metadata": {"type": "string", "description": "附加说明字段的 JSON 字符串"},
                },
                "required": ["qualified_id"],
                "additionalProperties": False,
            },
            bank_tools.tool_bank_update_item,
            ui_label="正在保存题目修改…",
        ),
    _fn(
            "bank.organize",
            "管理题库逻辑文件夹：list 列目录；create 新建父/子目录；rename 重命名；move 将最多500题移到path（空为根）；move_folder 将path及子目录移到target父目录；remove 仅删目录不删题。share 为path生成7天邀请CDK（最多300题，含图片快照）；redeem 输入code在根目录复制同名目录；revoke 撤销本人code。先检索真实题目ID，分享会授予持码教师复制权限。",
            {"type": "object", "properties": {
                "action": {"type": "string", "enum": ["list", "create", "rename", "move", "remove", "move_folder", "share", "redeem", "revoke"]},
                "code": {"type": "string"},
                "path": {"type": "string"}, "target": {"type": "string"},
                "qualified_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 500}
            }, "required": ["action"], "additionalProperties": False},
            bank_tools.tool_bank_organize,
            ui_label="正在整理题目目录…",
        ),
    _fn(
            'bank.adapt_answers',
            '仅通过教师助手AI适配多答案和旧答案关系。先用bank.get_item读取原答案，结合题意解释或/或者/且/而且/和，不得机械替换自然语言。保留原答案并批量保存，一次确认最多50题。logic为JSON树：{op:value,value:答案}或{op:and/or,items:[子树,子树]}；且优先于或，可任意嵌套。多个可接受答案用or；同时要求用and；不要编造或丢失条件。不会修改历史已发布的快照。',
            {'type': 'object', 'properties': {'questions': {'type': 'array', 'minItems': 1, 'maxItems': 50,
              'items': {'type': 'object', 'properties': {'qualified_id': {'type': 'string'}, 'logic': {'type': 'string'}},
              'required': ['qualified_id', 'logic'], 'additionalProperties': False}}}, 'required': ['questions'], 'additionalProperties': False},
            bank_tools.tool_bank_adapt_answers,
            ui_label='正在适配答案关系…',
        ),
    _fn('bank.legacy_answer_candidates',
            '自动检索本人题库尚未适配、包含或者/而且/或/且/和的旧答案候选。仅检测不改写，不能把自然语言误当逻辑。读取完整题意后通过bank.adapt_answers分批确认适配。每页最多50题，next_offset非空时继续。',
            {'type':'object','properties':{'offset':{'type':'integer','minimum':0}},'additionalProperties':False},
            bank_tools.tool_bank_legacy_answer_candidates, risk=ToolRisk.READ, ui_label='正在检查旧答案关系…'),
    _fn(
            "bank.create_items",
            "批量创建1至50道题目，一次确认整批。生成或导入多题时优先使用，禁止逐题要求确认。每题返回成功/失败；只重试失败项。metadata.category 用于分类。",
            {"type": "object", "properties": {
                "subject": {"type": "string"},
                "questions": {"type": "array", "minItems": 1, "maxItems": 50, "items": {
                    "type": "object", "properties": {
                        "question_id": {"type": "string"}, "question_type": {"type": "string"},
                        "content": {"type": "string"}, "answer": {"type": "string"}, "analysis": {"type": "string"},
                        "options": {"type": "object", "additionalProperties": {"type": "string"}},
                        "metadata": {"type": "object"},
                        "source_kind": {"type": "string", "enum": ["AI生成", "AI辅助导入"]}},
                    "required": ["question_id", "question_type", "content", "answer"], "additionalProperties": False}}},
             "required": ["questions"], "additionalProperties": False},
            bank_tools.tool_bank_create_items,
            ui_label="正在创建整批题目…",
            requires_confirmation_override=True,
            action_label="创建整批题目（一次确认全部）",
        ),
    _fn(
            "bank.create_item",
            "在教师个人题库中新建一道题目。由模型原创时 source_kind=AI生成；依据教师文件整理导入时必须用 AI辅助导入。",
            {
                "type": "object",
                "properties": {
                    "subject": {
                        "type": "string",
                        "description": "题目所属学科，未提供时使用通用",
                    },
                    "question_id": {"type": "string"},
                    "question_type": {"type": "string"},
                    "content": {"type": "string"},
                    "answer": {"type": "string"},
                    "analysis": {"type": "string"},
                    "options": {"type": "string", "description": "选择题必填，JSON 对象字符串"},
                    "metadata": {"type": "string", "description": "JSON 对象字符串"},
                    "source_kind": {"type": "string", "enum": ["AI生成", "AI辅助导入"]},
                },
                "required": ["question_id", "question_type", "content", "answer"],
                "additionalProperties": False,
            },
            bank_tools.tool_bank_create_item,
            ui_label="正在新建题目…",
            allegro_auto_add=True,
        ),
    _fn("bank.delete_item", "删除一道题目。", _teacher_schema({"qualified_id": _S, "storage_path": _S}, ["qualified_id"]), teacher_tools.tool_bank_delete_item, risk=ToolRisk.DESTRUCTIVE),
    _fn("content.folders", "列出教师自己的模板、组卷或试卷文件夹。", _teacher_schema({"scope": _S}, ["scope"]), teacher_tools.tool_content_folders, risk=ToolRisk.READ),
    _fn("content.folder_create", "创建归类文件夹或试卷文件夹；试卷文件夹必须位于归类文件夹下。", _teacher_schema({"scope": _S, "name": _S, "parent_id": _S, "kind": _S}, ["scope", "name"]), teacher_tools.tool_content_folder_create),
    _fn("content.folder_update", "重命名、移动文件夹或把空归类文件夹转换为试卷文件夹。", _teacher_schema({"folder_id": _S, "name": _S, "parent_id": _S, "move": {"type": "boolean"}, "kind": _S}, ["folder_id"]), teacher_tools.tool_content_folder_update),
    _fn("content.move_item", "将模板、组卷草稿或试卷移动到教师自己的文件夹。", _teacher_schema({"scope": _S, "item_id": _S, "folder_id": _S}, ["scope", "item_id", "folder_id"]), teacher_tools.tool_content_move_item),
    _fn("content.tags", "列出教师自己的标签。", _teacher_schema(), teacher_tools.tool_content_tags, risk=ToolRisk.READ),
    _fn("content.tag_save", "创建标签或修改名称和颜色，名称最多五字。", _teacher_schema({"tag_id": _S, "name": _S, "color": _S}, ["name"]), teacher_tools.tool_content_tag_save),
    _fn("content.item_tags", "为题目、模板、组卷或试卷设置标签。", _teacher_schema({"scope": _S, "item_id": _S, "tag_ids": {"type": "array", "items": _S}}, ["scope", "item_id", "tag_ids"]), teacher_tools.tool_content_item_tags),
]
