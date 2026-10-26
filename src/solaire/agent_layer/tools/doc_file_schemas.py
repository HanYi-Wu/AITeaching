from __future__ import annotations



from solaire.agent_layer.models import ToolRisk

from solaire.agent_layer.tools import doc_tools, file_tools

from solaire.agent_layer.tools.schema_builder import RegisteredTool, _fn



DOC_FILE_TOOLS: list[RegisteredTool] = [

    _fn(

            "file.read",

            "读取内容目录中的文本文件。支持 offset/limit 按行范围读取大文件。",

            {

                "type": "object",

                "properties": {

                    "path": {"type": "string", "description": "内容目录相对路径"},

                    "offset": {"type": "integer", "description": "起始行号（0-based），默认 0"},

                    "limit": {"type": "integer", "description": "读取行数，默认全部"},

                },

                "required": ["path"],

                "additionalProperties": False,

            },

            file_tools.tool_file_read,

            risk=ToolRisk.READ,

            ui_label="正在读取文件…",

        ),

    _fn(

            "file.write",

            "创建新文件或整体覆写文件内容（写入操作）。",

            {

                "type": "object",

                "properties": {

                    "path": {"type": "string", "description": "内容目录相对路径"},

                    "content": {"type": "string", "description": "文件内容"},

                },

                "required": ["path", "content"],

                "additionalProperties": False,

            },

            file_tools.tool_file_write,

            ui_label="正在写入文件…",

        ),

    _fn(

            "file.edit",

            "精确字符串替换编辑：old_string 须在文件中唯一匹配后替换为 new_string。",

            {

                "type": "object",

                "properties": {

                    "path": {"type": "string", "description": "内容目录相对路径"},

                    "old_string": {"type": "string", "description": "要替换的原文（须在文件中唯一）"},

                    "new_string": {"type": "string", "description": "替换后的内容"},

                    "replace_all": {"type": "boolean", "description": "是否替换所有匹配项，默认 false"},

                },

                "required": ["path", "old_string", "new_string"],

                "additionalProperties": False,

            },

            file_tools.tool_file_edit,

            ui_label="正在编辑文件…",

        ),

    _fn(

            "file.list",

            "列出目录内容，支持 glob 模式筛选。",

            {

                "type": "object",

                "properties": {

                    "path": {"type": "string", "description": "内容目录相对路径，默认根目录"},

                    "pattern": {"type": "string", "description": "文件名匹配模式（如 *.yaml），默认 *"},

                },

                "additionalProperties": False,

            },

            file_tools.tool_file_list,

            risk=ToolRisk.READ,

            ui_label="正在列出文件…",

        ),

    _fn(

            "file.search",

            "在文件内容中搜索正则模式，返回匹配行。",

            {

                "type": "object",

                "properties": {

                    "pattern": {"type": "string", "description": "正则表达式"},

                    "path": {"type": "string", "description": "搜索起始路径（文件或目录），默认项目根目录"},

                    "ignore_case": {"type": "boolean", "description": "是否忽略大小写"},

                    "max_matches": {"type": "integer", "description": "最大匹配数，默认 50"},

                },

                "required": ["pattern"],

                "additionalProperties": False,

            },

            file_tools.tool_file_search,

            risk=ToolRisk.READ,

            ui_label="正在搜索文件内容…",

        ),

    _fn(

            "doc.convert_to_markdown",

            "将 Word/DOCX 文件转换为 Markdown 格式（需要系统安装 pandoc）。",

            {

                "type": "object",

                "properties": {

                    "path": {"type": "string", "description": "DOCX 文件的内容目录相对路径"},

                },

                "required": ["path"],

                "additionalProperties": False,

            },

            doc_tools.tool_doc_convert_to_markdown,

            risk=ToolRisk.READ,

            ui_label="正在转换文档…",

        ),

    _fn(

            "doc.extract_pdf_text",

            "从 PDF 文件中提取文字内容。",

            {

                "type": "object",

                "properties": {

                    "path": {"type": "string", "description": "PDF 文件的内容目录相对路径"},

                },

                "required": ["path"],

                "additionalProperties": False,

            },

            doc_tools.tool_doc_extract_pdf_text,

            risk=ToolRisk.READ,

            ui_label="正在提取 PDF 文本…",

        ),

    _fn(

            "doc.ocr_image",

            "对图片进行 OCR 文字识别。",

            {

                "type": "object",

                "properties": {

                    "path": {"type": "string", "description": "图片文件的内容目录相对路径"},

                    "lang": {"type": "string", "description": "OCR 语言，默认 chi_sim+eng"},

                },

                "required": ["path"],

                "additionalProperties": False,

            },

            doc_tools.tool_doc_ocr_image,

            risk=ToolRisk.READ,

            ui_label="正在识别图片文字…",

        ),

]

