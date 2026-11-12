"""Permission-filtered, read-only help for management workspaces."""

from __future__ import annotations

import re
from typing import Any

from solaire.web.management.access import PERMISSION_CATALOG

ADMIN_SECTIONS = ("schools", "ai", "extensions", "audit", "access", "settings", "activity")
SCHOOL_SECTIONS = (
    "overview", "teachers", "classes", "students", "assignments", "ai", "audit", "access", "settings", "activity",
)

# Every entry is authored from the management UI. Links are static values and
# permission requirements use the same live catalog as the management pages.
GUIDES: tuple[dict[str, Any], ...] = (
    {
        "id": "admin-schools", "roles": ("admin",), "section": "schools", "title": "学校与账号",
        "description": "查看或新建学校；选中学校后可管理该校的学校端账号。",
        "answer": "在管理员工作区打开“学校与账号”。可搜索学校、创建学校；选中学校后，可查看和管理该校学校端账号。",
        "keywords": ("学校", "新建学校", "创建学校", "添加学校", "学校账号", "学校端账号", "账号", "重置密码"),
        "permission": "school.access.read", "link": {"label": "打开学校与账号", "section": "schools", "view": "list"},
    },
    {
        "id": "admin-ai", "roles": ("admin",), "section": "ai", "title": "平台 AI 配置",
        "description": "在平台 AI 页面查看或调整平台模型设置。",
        "answer": "打开管理员工作区的“平台 AI”，可查看和调整平台模型配置。",
        "keywords": ("平台 ai", "平台模型", "模型配置", "配置模型", "人工智能", "ai 设置"),
        "permission": "school.access.read", "link": {"label": "打开平台 AI", "section": "ai"},
    },
    {
        "id": "admin-extensions", "roles": ("admin",), "section": "extensions", "title": "扩展组件",
        "description": "在扩展组件页面查看已提供的扩展及其管理入口。",
        "answer": "打开管理员工作区的“扩展组件”，可查看页面提供的扩展组件及对应操作。",
        "keywords": ("扩展", "扩展组件", "插件", "组件"),
        "permission": "school.access.read", "link": {"label": "打开扩展组件", "section": "extensions"},
    },
    {
        "id": "admin-audit", "roles": ("admin",), "section": "audit", "title": "操作日志",
        "description": "按筛选条件查看平台管理操作记录。",
        "answer": "打开管理员工作区的“操作日志”，可按页面提供的筛选条件查看管理操作记录。",
        "keywords": ("操作日志", "操作记录", "审计", "谁操作", "日志"),
        "permission": "school.access.read", "link": {"label": "打开操作日志", "section": "audit", "view": "trace"},
    },
    {
        "id": "admin-access", "roles": ("admin",), "section": "access", "title": "权限管理",
        "description": "为学校管理账号配置可用的管理角色和访问范围。",
        "answer": "打开管理员工作区的“权限管理”，选择学校后，可维护该校角色及学校账号的访问范围。",
        "keywords": ("权限", "权限管理", "角色", "授权", "访问范围", "管理账号权限", "权限链路", "权限图", "图谱", "溯源", "矩阵"),
        "permission": "school.access.read", "link": {"label": "打开权限管理", "section": "access"},
    },
    {
        "id": "admin-settings", "roles": ("admin",), "section": "settings", "title": "参数字典",
        "description": "查看和维护平台管理默认值及内置选项字典。",
        "answer": "打开管理员工作区的“参数字典”，可查看平台默认管理参数和字典选项，并按页面权限进行维护。",
        "keywords": ("设置", "参数", "参数字典", "字典", "年级", "学科", "默认页大小"),
        "permission": "school.access.read", "link": {"label": "打开参数字典", "section": "settings"},
    },
    {
        "id": "admin-activity", "roles": ("admin",), "section": "activity", "title": "管理活动",
        "description": "查看平台管理操作趋势及页面提供的活动汇总。",
        "answer": "打开管理员工作区的“管理活动”，可查看管理操作趋势和活动汇总。",
        "keywords": ("活动", "管理活动", "趋势", "使用趋势", "活跃账号", "热力图"),
        "permission": "school.access.read", "link": {"label": "打开管理活动", "section": "activity", "view": "matrix"},
    },
    {
        "id": "school-overview", "roles": ("school",), "section": "overview", "title": "总览",
        "description": "查看本校教师、班级、学生和分配的汇总情况。",
        "answer": "打开学校端“总览”，可查看本校教师、班级、学生和教师分配的汇总情况。",
        "keywords": ("总览", "概览", "首页", "汇总", "学校情况"),
        "permission": "school.overview.read", "link": {"label": "打开总览", "section": "overview"},
    },
    {
        "id": "school-analysis-export", "roles": ("school",), "section": "overview", "title": "导出成绩分析",
        "description": "页面右上角的“导出成绩分析”入口用于选择试卷、发布记录、班级和导出格式。",
        "answer": "点击页面右上角“导出成绩分析”，选择试卷和发布记录，再选班级与 Excel 或 PDF 格式，最后点“确认导出”。只有拥有成绩分析导出权限的账号会显示这个入口。",
        "keywords": ("成绩分析", "导出成绩分析", "分析报告", "成绩报告", "考试报告", "导出报告"),
        "permission": "school.reports.export", "link": {"label": "打开成绩分析导出入口", "section": "overview"},
    },
    {
        "id": "school-teachers", "roles": ("school",), "section": "teachers", "title": "教师",
        "description": "查看教师账号；具备管理权限时可创建、导入或维护教师账号。",
        "answer": "打开学校端“教师”。页面可查看教师账号；创建或导入等操作需拥有相应教师管理权限。",
        "keywords": ("教师", "教师账号", "导入教师", "创建教师", "新增教师", "教师名单"),
        "permission": "school.teachers.read", "link": {"label": "打开教师", "section": "teachers", "view": "list"},
    },
    {
        "id": "school-classes", "roles": ("school",), "section": "classes", "title": "班级",
        "description": "查看本校班级；具备管理权限时可新建、导入或维护班级。",
        "answer": "打开学校端“班级”。页面可查看班级；新建或导入等操作需拥有班级管理权限。",
        "keywords": ("班级", "班级管理", "导入班级", "创建班级", "新增班级"),
        "permission": "school.classes.read", "link": {"label": "打开班级", "section": "classes", "view": "list"},
    },
    {
        "id": "school-students", "roles": ("school",), "section": "students", "title": "学生账号",
        "description": "查看本校学生账号；具备管理权限时可导入、维护账号或调整班级。",
        "answer": "打开学校端“学生”。页面可查看本校学生账号；导入、维护账号或调整班级需拥有相应管理权限。",
        "keywords": ("学生账号", "学生", "导入学生", "创建学生", "学生名单", "转班", "学生账号管理"),
        "permission": "school.students.read", "link": {"label": "打开学生", "section": "students", "view": "list"},
    },
    {
        "id": "school-assignments", "roles": ("school",), "section": "assignments", "title": "教师班级分配",
        "description": "查看教师与班级的分配关系；具备管理权限时可调整分配。",
        "answer": "打开学校端“分配”，可查看教师班级分配关系；创建、导入或移除分配需具备相应权限。",
        "keywords": ("分配", "教师班级分配", "教师分班", "班级分配", "分配教师"),
        "permission": "school.assignments.read", "link": {"label": "打开分配", "section": "assignments", "view": "list"},
    },
    {
        "id": "school-ai", "roles": ("school",), "section": "ai", "title": "学校 AI",
        "description": "查看学校 AI 状态；可用操作取决于学校设置和账号权限。",
        "answer": "打开学校端“AI”，查看学校 AI 状态和页面提供的功能。使用助手或导入审核可能读取或修改学校名册，并需要相应权限。",
        "keywords": ("学校 ai", "ai 助手", "人工智能", "导入审核", "ai 导入", "学校ai"),
        "permission": "school.ai.read", "link": {"label": "打开 AI", "section": "ai"},
    },
    {
        "id": "school-audit", "roles": ("school",), "section": "audit", "title": "操作日志",
        "description": "查看本校范围内的管理操作记录。",
        "answer": "打开学校端“操作日志”，可查看本校范围内的管理操作记录。",
        "keywords": ("操作日志", "操作记录", "审计", "谁操作", "日志"),
        "permission": "school.audit.read", "link": {"label": "打开操作日志", "section": "audit", "view": "trace"},
    },
    {
        "id": "school-access", "roles": ("school",), "section": "access", "title": "权限管理",
        "description": "查看本账号权限；管理校内角色和其他账号权限需要相应角色管理权限。",
        "answer": "打开学校端“权限管理”可查看本账号权限。配置校内角色或成员访问范围需要具备校内角色管理权限。",
        "keywords": ("权限", "我的权限", "权限管理", "角色", "授权", "访问范围", "权限链路", "权限图", "图谱", "溯源", "矩阵"),
        "permission": "school.access.read", "link": {"label": "打开权限管理", "section": "access"},
    },
    {
        "id": "school-settings", "roles": ("school",), "section": "settings", "title": "参数字典",
        "description": "查看本校管理参数和字典；修改需要管理设置权限。",
        "answer": "打开学校端“参数字典”查看本校管理参数和可用字典。修改内容需要学校管理设置权限。",
        "keywords": ("设置", "参数", "参数字典", "字典", "年级", "学科", "管理选项"),
        "permission": "school.settings.read", "link": {"label": "打开参数字典", "section": "settings"},
    },
    {
        "id": "school-activity", "roles": ("school",), "section": "activity", "title": "管理活动",
        "description": "查看本校管理操作趋势和活动汇总。",
        "answer": "打开学校端“管理活动”，可查看本校管理操作趋势和活动汇总。",
        "keywords": ("活动", "管理活动", "趋势", "使用趋势", "活跃账号", "热力图"),
        "permission": "school.activity.read", "link": {"label": "打开管理活动", "section": "activity", "view": "matrix"},
    },
)

_UNSUPPORTED_DATA_QUERY = re.compile(r"薄弱|薄弱点|错题|学情|学习分析|提升建议|知识点掌握")
_DATA_LOOKUP_QUERY = re.compile(
    r"(?:查|查看|列出|显示|告诉我|分析|统计|找出|筛选).{0,12}(?:成绩|考试成绩|学生表现|学生名单?)|"
    r"(?:学生|班级).{0,10}(?:成绩|分数|考试|排名|名单)|"
    r"(?:成绩|分数|考试).{0,10}(?:学生|班级|名单|结果|排名)|"
    r"(?:学生|班级|考试|成绩).{0,8}(?:多少|排名|结果|情况|列表|名单)"
)
_PERMISSION_QUESTION = re.compile(r"谁(能|可以|有)|哪些.{0,8}(账号|人|角色)|有权限|权限.{0,8}(谁|哪些|什么)|我(能|可以|是否|能不能|能否|有没有|有何|有哪些权限)|本账号(能|有)")
_FILLER = re.compile(r"[\s，。！？、,.!?：:；;（）()【】\[\]{}'\"`~]+")
_VAGUE_QUERY = re.compile(r"^(这个|那里|那边|怎么操作|如何操作|这个怎么用|怎么办|继续|刚才那个|那个功能)$")
_SUGGESTIONS = {
    "admin-schools": "怎么创建学校？",
    "admin-ai": "在哪里调整平台 AI 配置？",
    "admin-extensions": "扩展组件在哪里？",
    "admin-audit": "在哪里查看操作日志？",
    "admin-access": "怎么配置学校账号权限？",
    "admin-settings": "在哪里维护参数字典？",
    "admin-activity": "在哪里查看管理活动？",
    "school-overview": "总览里能看什么？",
    "school-teachers": "怎么导入教师？",
    "school-classes": "怎么导入班级？",
    "school-students": "怎么导入学生账号？",
    "school-assignments": "在哪里调整教师班级分配？",
    "school-ai": "学校 AI 功能在哪里？",
    "school-audit": "在哪里查看操作日志？",
    "school-access": "如何查看自己的权限？",
    "school-settings": "在哪里修改管理设置？",
    "school-activity": "在哪里查看管理活动？",
}
_PERMISSION_DOMAINS: tuple[tuple[str, tuple[str, ...]], ...] = (
    # Put overlapping, compound domains before broad nouns for stable tie breaks.
    ("assignments", ("教师班级分配", "班级分配", "分配")),
    ("teachers", ("教师", "老师")),
    ("classes", ("班级",)),
    ("students", ("学生账号", "学生")),
    ("ai", ("人工智能", "学校ai", "ai")),
    ("audit", ("操作日志", "操作记录", "审计")),
    ("activity", ("管理活动", "活动趋势")),
    ("settings", ("参数字典", "管理设置", "设置", "字典")),
    ("roles", ("角色", "权限管理", "角色权限")),
    ("reports", ("成绩分析", "分析报告", "考试报告", "成绩报告")),
)
_WRITE_ACTIONS = ("管理", "创建", "新增", "新建", "导入", "编辑", "修改", "停用", "重置", "转班", "移除", "维护", "配置")
_READ_ACTIONS = ("查看", "读取", "浏览", "能看", "访问")
_GENERIC_PAGE_REFERENCE = re.compile(r"(这个|当前|本|此)(页面|功能|菜单|模块)|这页")


def visible_guides(scope: str, permissions: set[str] | frozenset[str] | list[str]) -> list[dict[str, Any]]:
    """Filter authored guidance by the current, server-computed access snapshot."""
    allowed = set(permissions)
    return [
        guide for guide in GUIDES
        if scope in guide["roles"] and guide["section"] in (ADMIN_SECTIONS if scope == "admin" else SCHOOL_SECTIONS)
        and guide["permission"] in allowed
    ]


def help_index(scope: str, permissions: set[str] | frozenset[str] | list[str]) -> dict[str, Any]:
    guides = visible_guides(scope, permissions)
    sections: list[dict[str, Any]] = []
    for section in (ADMIN_SECTIONS if scope == "admin" else SCHOOL_SECTIONS):
        items = [
            {key: guide[key] for key in ("id", "title", "description", "link")}
            for guide in guides if guide["section"] == section
        ]
        if items:
            sections.append({"section": section, "title": items[0]["title"], "items": items})
    suggestions = [_SUGGESTIONS[guide["id"]] for guide in guides if guide["id"] in _SUGGESTIONS][:4]
    return {"sections": sections, "suggestions": suggestions}


def _retrieval_text(question: str, messages: list[dict[str, str]]) -> str:
    current = question.strip()
    if len(current) <= 14 or _VAGUE_QUERY.fullmatch(_FILLER.sub("", current)):
        recent = [message["content"].strip() for message in messages[-6:] if message.get("role") == "user"]
        if recent:
            return " ".join(recent[-2:] + [current])
    return current


def match_guides(
    scope: str,
    permissions: set[str] | frozenset[str] | list[str],
    question: str,
    messages: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Return up to two strongly matched entries; never use user supplied links."""
    query = _retrieval_text(question, messages or []).lower()
    compact = _FILLER.sub("", query)
    if not compact or _UNSUPPORTED_DATA_QUERY.search(compact):
        return []
    if _DATA_LOOKUP_QUERY.search(compact) and not any(term in compact for term in ("导出", "下载")):
        return []
    ranked: list[tuple[int, dict[str, Any]]] = []
    for guide in visible_guides(scope, permissions):
        score = 0
        for keyword in guide["keywords"]:
            term = keyword.lower()
            if term and (term in query or term in compact):
                score += min(4, len(term))
        if score:
            ranked.append((score, guide))
    ranked.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    if not ranked:
        return []
    best_score = ranked[0][0]
    if best_score < 2:
        return []
    return [guide for score, guide in ranked[:2] if score >= max(2, best_score // 2)]


def local_answer(matches: list[dict[str, Any]]) -> dict[str, Any]:
    if not matches:
        return {
            "answer": "我目前只了解管理工作区中已开放且你有权限访问的功能。你可以说得更具体些，例如“怎么导入教师”或“在哪里看操作日志”？",
            "links": [],
            "source": "local",
        }
    return {
        "answer": matches[0]["answer"],
        "links": [dict(match["link"]) for match in matches],
        "source": "local",
    }


def local_access_view_answer(matches: list[dict[str, Any]], question: str) -> dict[str, Any] | None:
    """Give exact navigation help for the real access graph views."""
    if not matches or not any(item["section"] == "access" for item in matches):
        return None
    compact = _FILLER.sub("", question.lower())
    link = {"label": "打开权限管理", "section": "access"}
    if "矩阵" in compact:
        link["view"] = "matrix"
        answer = "打开“权限管理”，切换到“矩阵”视图可按角色和菜单查看授权关系；点击矩阵单元可查看对应授权链路。"
    elif any(term in compact for term in ("权限链路", "溯源", "图谱", "权限图")):
        link["view"] = "trace"
        answer = "打开“权限管理”的“溯源”视图，可沿账号、角色、菜单和权限查看授权链路。"
    elif "列表" in compact:
        link["view"] = "list"
        answer = "打开“权限管理”，切换到“列表”视图可查看权限和账号清单。"
    else:
        return None
    # Keep the destination within the returned, permission-filtered guide set.
    return {"answer": answer, "links": [link], "source": "local"}


def valid_scope_sections(scope: str) -> frozenset[str]:
    return frozenset(ADMIN_SECTIONS if scope == "admin" else SCHOOL_SECTIONS)


def is_permission_question(question: str) -> bool:
    return bool(_PERMISSION_QUESTION.search(_FILLER.sub("", question)))


def _has_action_outside_domain(
    query: str,
    actions: tuple[str, ...],
    domain_span: tuple[int, int],
) -> bool:
    domain_start, domain_end = domain_span
    for action in actions:
        search_from = 0
        while True:
            action_start = query.find(action, search_from)
            if action_start < 0:
                break
            action_end = action_start + len(action)
            if action_end <= domain_start or action_start >= domain_end:
                return True
            search_from = action_start + 1
    return False


def permission_question_target(question: str) -> str | None:
    """Map a narrow access question to an existing management permission key."""
    query = _FILLER.sub("", question.lower())
    if not is_permission_question(query):
        return None
    domain_matches = [
        (len(term), -priority, name, query.find(term.lower()), len(term))
        for priority, (name, terms) in enumerate(_PERMISSION_DOMAINS)
        for term in terms
        if term.lower() in query
    ]
    # Prefer the most specific phrase (for example, "教师班级分配" over
    # "教师"); tuple priority only breaks ties between equally specific terms.
    matched_domain = max(domain_matches, key=lambda match: match[:2]) if domain_matches else None
    if matched_domain is None:
        return None
    domain = matched_domain[2]
    domain_span = (matched_domain[3], matched_domain[3] + matched_domain[4])

    if any(term in query for term in ("删除",)):
        if domain != "classes":
            return None
        suffix = "manage"
    elif any(term in query for term in ("导出",)):
        suffix = "export"
    elif _has_action_outside_domain(query, _WRITE_ACTIONS, domain_span):
        suffix = "manage"
    elif _has_action_outside_domain(query, _READ_ACTIONS, domain_span):
        suffix = "read"
    elif "分配" in query:
        # "分配" is both the assignment domain name and a write action. Explicit
        # read wording above wins when it is part of the noun phrase, while an
        # otherwise bare assignment question still resolves to the manage grant.
        suffix = "manage"
    else:
        suffix = "read"

    domain_keys = {
        "teachers": ("school.teachers.read", "school.teachers.manage", "school.teachers.export"),
        "classes": ("school.classes.read", "school.classes.manage"),
        "students": ("school.students.read", "school.students.manage", "school.students.export"),
        "assignments": ("school.assignments.read", "school.assignments.manage"),
        "ai": ("school.ai.read", "school.ai.manage"),
        "audit": ("school.audit.read",),
        "activity": ("school.activity.read",),
        "settings": ("school.settings.read", "school.settings.manage"),
        "roles": ("school.access.read", "school.roles.manage"),
        "reports": ("school.reports.read", "school.reports.export"),
    }
    candidates = domain_keys[domain]
    if domain == "roles" and suffix == "manage":
        target = "school.roles.manage"
    elif suffix == "export":
        target = next((key for key in candidates if key.endswith(".export")), None)
    elif suffix == "manage":
        target = next((key for key in candidates if key.endswith(".manage")), None)
    else:
        target = next((key for key in candidates if key.endswith(".read")), candidates[0])
    return target if target in PERMISSION_CATALOG else None


def permission_question_for_section(question: str, section: str | None) -> str | None:
    target = permission_question_target(question)
    if target:
        return target
    if not is_permission_question(question):
        return None
    compact = _FILLER.sub("", question.lower())
    if not _GENERIC_PAGE_REFERENCE.search(compact):
        return None
    if any(term in compact for term in (*_WRITE_ACTIONS, "导出", "删除")):
        return None
    if not any(term in compact for term in ("使用", "打开", "访问", "查看", "进入", "能用", "可以用")):
        return None
    by_section = {
        "overview": "school.overview.read",
        "teachers": "school.teachers.read",
        "classes": "school.classes.read",
        "students": "school.students.read",
        "assignments": "school.assignments.read",
        "ai": "school.ai.read",
        "audit": "school.audit.read",
        "access": "school.access.read",
        "settings": "school.settings.read",
        "activity": "school.activity.read",
    }
    return by_section.get(str(section or ""))
