from __future__ import annotations



from solaire.agent_layer.models import ToolRisk

from solaire.agent_layer.tools import exam_tools, teacher_tools

from solaire.agent_layer.tools.schema_builder import RegisteredTool, _S, _fn, _teacher_schema



GRADING_TOOLS: list[RegisteredTool] = [

    _fn(

            "exam.ai_grade_submission",

            "为某次学生提交生成 AI 批改建议；建议不会直接改分，教师仍需审核确认。",

            {

                "type": "object",

                "properties": {

                    "paper_id": {"type": "string"},

                    "attempt_id": {"type": "string"},

                    "student_query": {

                        "type": "string",

                        "description": "学生学号、登录账号或姓名；未提供 attempt_id 时使用。",

                    },

                    "question_ids": {"type": "array", "items": {"type": "string"}},

                },

                "required": ["paper_id"],

                "additionalProperties": False,

            },

            exam_tools.tool_ai_grade_submission,

            ui_label="正在生成 AI 批改建议...",

            action_label="生成 AI 批改建议",

        ),

    _fn(

                "paper.ai_grade_pending",

                "为已提交且仍待批改的答卷批量生成 AI 建议；只生成建议，不直接写入最终分。",

                _teacher_schema(

                    {

                        "paper_id": _S,

                        "max_attempts": {"type": "integer", "minimum": 1, "maximum": 20},

                        "max_questions_total": {"type": "integer", "minimum": 1, "maximum": 100},

                    },

                    ["paper_id"],

                ),

                teacher_tools.tool_paper_ai_grade_pending,

            ),

    _fn("paper.manual_grade", "人工复核并保存一道主观题得分和反馈。", _teacher_schema({"paper_id": _S, "attempt_id": _S, "question_id": _S, "score": {"type": "number"}, "feedback": _S, "is_correct": {"type": "boolean"}}, ["paper_id", "attempt_id", "question_id", "score"]), teacher_tools.tool_paper_manual_grade),

    _fn("paper.complete_grading", "确认一份答卷已全部批改并向学生发布成绩。", _teacher_schema({"paper_id": _S, "attempt_id": _S}, ["paper_id", "attempt_id"]), teacher_tools.tool_paper_complete_grading),

]

