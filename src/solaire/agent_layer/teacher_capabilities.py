"""Teacher-facing AI capability catalogue.

Every operation exposed to a teacher is represented either by an executable
agent tool or by a complete, deliberately manual guide for host/security work.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal


@dataclass(frozen=True)
class OperationGuide:
    prerequisites: tuple[str, ...]
    steps: tuple[str, ...]
    safety_note: str


@dataclass(frozen=True)
class TeacherCapability:
    id: str
    area: str
    title: str
    mode: Literal["ai_tool", "manual_required"]
    tool_name: str | None = None
    guide: OperationGuide | None = None


def _tool(capability_id: str, area: str, title: str, tool_name: str) -> TeacherCapability:
    return TeacherCapability(capability_id, area, title, "ai_tool", tool_name=tool_name)


def _manual(
    capability_id: str,
    area: str,
    title: str,
    prerequisites: tuple[str, ...],
    steps: tuple[str, ...],
    safety_note: str,
) -> TeacherCapability:
    return TeacherCapability(
        capability_id,
        area,
        title,
        "manual_required",
        guide=OperationGuide(prerequisites, steps, safety_note),
    )


TEACHER_CAPABILITIES: tuple[TeacherCapability, ...] = (
    _tool("find_submissions", "paper", "按学生和批改状态定位答卷", "paper.find_submissions"),
    _tool("batch_ai_pregrade", "paper", "批量生成待批改答卷的 AI 建议", "paper.ai_grade_pending"),
    _tool("offline_scan_guide", "paper", "获取线下答卷照片采集说明", "paper.offline_upload_guide"),
    _tool("student_profile", "student", "查看班级学生画像与个体分析", "teacher.student_profile"),
    _tool("list_graphs", "knowledge_graph", "查看知识图谱", "graph.list_graphs"),
    _tool("create_graph", "knowledge_graph", "创建知识图谱", "graph.create_graph"),
    _tool("rename_graph", "knowledge_graph", "重命名知识图谱", "graph.rename_graph"),
    _tool("delete_graph", "knowledge_graph", "删除知识图谱", "graph.delete_graph"),
    _tool("edit_graph_nodes", "knowledge_graph", "创建、修改和删除知识点", "graph.update_node"),
    _tool("edit_graph_relations", "knowledge_graph", "创建、修改和删除知识关系", "graph.update_relation"),
    _tool("configure_taxonomy", "knowledge_graph", "配置学科和年级分类", "graph.set_taxonomy"),
    _tool("bind_questions", "knowledge_graph", "关联或解除题目", "graph.unbind_question"),
    _tool("attach_resources", "knowledge_graph", "挂载或移除资源", "graph.detach_resource"),
    _tool("search_question_bank", "question_bank", "检索题库", "bank.search_items"),
    _tool("create_question", "question_bank", "创建题目", "bank.create_item"),
    _tool("update_question", "question_bank", "修改题目", "bank.update_item"),
    _tool("delete_question", "question_bank", "删除题目", "bank.delete_item"),
    _tool("list_templates", "exam", "查看试卷模板", "template.list"),
    _tool("create_template", "exam", "创建试卷模板", "template.create"),
    _tool("update_template", "exam", "修改试卷模板", "template.update"),
    _tool("rename_template", "exam", "重命名试卷模板", "template.rename"),
    _tool("delete_template", "exam", "删除试卷模板", "template.delete"),
    _tool("manage_exam_workspace", "exam", "查看、保存、复制和删除组卷草稿", "exam.workspace_save"),
    _tool("validate_exam", "exam", "校验试卷", "exam.validate_paper"),
    _tool("export_exam", "exam", "导出试卷", "exam.export_paper"),
    _tool("list_papers", "paper", "查看试卷记录", "paper.list"),
    _tool("analyze_paper", "paper", "分析试卷和学情", "paper.analyze"),
    _tool("publish_paper", "paper", "发布在线考试", "exam.publish_online_paper"),
    _tool("query_practice_history", "paper", "查询班级历史试卷与专项巩固资格", "paper.practice_history"),
    _tool("publish_wrong_question_practice", "paper", "发布个性化历史错题卷", "paper.publish_wrong_question_practice"),
    _tool("publish_reinforcement_practice", "paper", "AI 生成并发布三卷专项巩固卷", "paper.publish_reinforcement_practice"),
    _tool("manage_publication", "paper", "修改或撤销考试发布", "paper.update_publication"),
    _tool("review_submissions", "paper", "查看答卷", "paper.submissions"),
    _tool("manual_grade", "paper", "人工复核评分", "paper.manual_grade"),
    _tool("run_analysis", "analysis", "运行学情分析和生成补练", "analysis.run_builtin"),
    _manual(
        "configure_ai_provider",
        "system",
        "配置 AI 服务密钥和模型",
        ("拥有部署环境的管理员权限", "已从服务商安全地取得 API 密钥"),
        (
            "打开系统设置中的 AI 服务配置页，不要在对话框或聊天消息中粘贴密钥。",
            "选择服务商和模型，在受保护的密钥输入框中录入密钥并保存。",
            "运行页面提供的连接测试，确认模型、网络和配额均正常后再启用。",
        ),
        "密钥属于高敏感凭据，AI 不会代填、读取或回显；如怀疑泄露请立即轮换。",
    ),
    _manual(
        "install_document_dependencies",
        "system",
        "安装 OCR、TeX 或文档转换组件",
        ("拥有本机软件安装权限", "已确认安装包来自可信官方来源"),
        (
            "在系统设置的文档能力检测中确认缺少的具体组件。",
            "从页面给出的官方来源下载并人工核对发布者、版本和校验信息。",
            "关闭未保存的文档后执行安装，重启应用并再次运行能力检测。",
        ),
        "安装程序会修改主机环境，必须由教师或管理员亲自确认，AI 不会静默安装。",
    ),
    _manual(
        "manage_accounts",
        "system",
        "创建账号、重置密码或调整权限",
        ("使用学校管理员账号登录", "已核实相关人员身份和授权范围"),
        (
            "进入学校管理的账号与班级页面并定位目标人员。",
            "核对姓名、角色、学校和班级，选择创建、重置密码或变更权限。",
            "阅读影响范围并亲自确认，安全地将临时凭据交给本人并要求首次登录修改。",
        ),
        "账号和权限变更影响真实人员访问，AI 只提供导航和检查清单，不直接执行。",
    ),
    _manual(
        "open_or_create_project",
        "system",
        "打开、创建或切换本地项目",
        ("已保存当前项目中的未提交内容", "知道目标目录及其数据归属"),
        (
            "打开项目菜单，选择新建、打开或切换项目。",
            "在系统文件选择器中核对目标绝对路径，避免选择系统目录或他人目录。",
            "确认切换并等待索引完成，再检查当前项目名称和内容根目录。",
        ),
        "项目切换涉及主机文件访问，必须由教师在系统选择器中亲自确认。",
    ),
)


def capability_manifest() -> dict[str, object]:
    capabilities = [asdict(item) for item in TEACHER_CAPABILITIES]
    ai_count = sum(item.mode == "ai_tool" for item in TEACHER_CAPABILITIES)
    return {
        "summary": {
            "total": len(TEACHER_CAPABILITIES),
            "ai_tool": ai_count,
            "manual_required": len(TEACHER_CAPABILITIES) - ai_count,
        },
        "capabilities": capabilities,
    }


def get_capability(capability_id: str) -> TeacherCapability | None:
    return next((item for item in TEACHER_CAPABILITIES if item.id == capability_id), None)
