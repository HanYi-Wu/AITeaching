"""Read-only management help endpoints."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.management.access import get_management_access
from solaire.web.management.graph import build_permission_graph
from solaire.web.management.help import (
    help_index,
    is_permission_question,
    local_answer,
    local_access_view_answer,
    match_guides,
    permission_question_for_section,
)

router = APIRouter()


class HelpMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=500)


class ManagementHelpAsk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=500)
    messages: list[HelpMessage] = Field(default_factory=list, max_length=8)
    school_id: str | None = Field(default=None, max_length=128)
    section: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def bounded_history(self) -> "ManagementHelpAsk":
        self.question = self.question.strip()
        if not self.question:
            raise ValueError("请输入你想了解的管理功能")
        if sum(len(message.content) for message in self.messages) > 2400:
            raise ValueError("对话上下文过长，请开始新的提问")
        self.messages = [message.model_copy(update={"content": message.content.strip()}) for message in self.messages]
        return self


def _scope_for_request(request: Request, user: dict[str, Any]) -> tuple[Any, str, dict[str, Any]]:
    path = request.url.path
    if path.startswith("/api/admin/management/help"):
        scope = "admin"
    elif path.startswith("/api/school/management/help"):
        scope = "school"
    else:
        raise HTTPException(status_code=404, detail="帮助页面不存在")
    if user.get("role") != scope:
        raise HTTPException(status_code=403, detail="当前账号不能访问该管理端帮助")
    root = require_platform_root()
    access = get_management_access(root, user)
    return root, scope, access


@router.get("/admin/management/help")
@router.get("/school/management/help")
def read_management_help(
    request: Request,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    _, scope, access = _scope_for_request(request, user)
    return help_index(scope, access.get("effective_permissions", []))


def _graph_for_question(
    root,
    scope: str,
    user: dict[str, Any],
    access: dict[str, Any],
    requested_school_id: str | None,
) -> tuple[str | None, dict[str, Any] | None]:
    if scope == "admin":
        if not requested_school_id:
            return None, None
        school_id = requested_school_id.strip()
        if not school_id:
            return None, None
        graph = build_permission_graph(root, school_id, page=1, page_size=100)
        return school_id, graph

    school_id = str(user.get("school_id") or "").strip()
    actor_id = str(user.get("id") or "").strip()
    if not school_id or not actor_id:
        raise HTTPException(status_code=403, detail="学校账号未绑定学校")
    if requested_school_id and requested_school_id != school_id:
        raise HTTPException(status_code=403, detail="学校权限图只能查看当前绑定学校")
    graph = build_permission_graph(
        root,
        school_id,
        page=1,
        page_size=100,
        self_user_id=None if access.get("full_access") else actor_id,
        school_actor_id=actor_id,
    )
    return school_id, graph


def _permission_answer(
    graph: dict[str, Any],
    scope: str,
    school_id: str,
    target: str,
    question: str,
) -> dict[str, Any]:
    descriptor = next((item for item in graph.get("catalog", []) if item.get("key") == target), None)
    if descriptor is None:
        return local_answer([])

    users = [item for item in graph.get("users", []) if target in item.get("effective_permissions", [])]
    roles = [
        item for item in graph.get("roles", [])
        if target in item.get("effective_permissions", []) and int(item.get("user_count", 0)) > 0
    ]
    self_only = bool(graph.get("self_only"))
    own_id = str(graph.get("users", [{}])[0].get("id") or "") if self_only and graph.get("users") else ""
    asks_about_self = any(word in question for word in ("我能", "我可以", "我有", "我是否", "自己", "本账号"))
    permission_label = str(descriptor.get("label") or target)
    links: list[dict[str, Any]] = [{
        "label": f"查看{permission_label}权限",
        "section": "access",
        "view": "trace",
        "school_id": school_id,
        "trace": {"kind": "permission", "id": target},
    }]

    if self_only:
        own = graph.get("users", [{}])[0] if graph.get("users") else {}
        has_target = target in own.get("effective_permissions", [])
        label = "具有" if has_target else "没有"
        if asks_about_self:
            answer = f"当前账号{label}“{permission_label}”权限。此权限视图仅包含当前账号。"
        else:
            answer = (
                f"当前账号{label}“{permission_label}”权限。由于当前账号只能查看自己的权限图，"
                "我无法据此确认其他账号是否拥有该权限。"
            )
        if own_id:
            links.append({"label": f"查看账号：{own.get('display_name') or own.get('username') or '当前账号'}", "section": "access", "view": "trace", "school_id": school_id, "trace": {"kind": "user", "id": own_id}})
        own_role_ids = set(own.get("role_ids", []))
        for role in graph.get("roles", []):
            if role.get("id") in own_role_ids and len(links) < 5:
                links.append({"label": f"查看角色：{role.get('name') or '校内角色'}", "section": "access", "view": "trace", "school_id": school_id, "trace": {"kind": "role", "id": str(role["id"])}})
    else:
        total = int(graph.get("total", len(graph.get("users", []))))
        returned = len(graph.get("users", []))
        partial = total > returned
        if users:
            labels = [str(item.get("display_name") or item.get("username") or "学校账号") for item in users[:5]]
            answer = f"具备“{permission_label}”权限的账号：{ '、'.join(labels) }。"
            if len(users) > len(labels):
                answer += f"本页另有 {len(users) - len(labels)} 个符合条件的账号。"
            for item in users[:4]:
                links.append({
                    "label": f"查看账号：{item.get('display_name') or item.get('username') or '学校账号'}",
                    "section": "access", "view": "trace", "school_id": school_id,
                    "trace": {"kind": "user", "id": str(item["id"])},
                })
        elif partial:
            answer = f"当前返回的第 1 页（{returned} / {total} 个账号）中，没有找到具备“{permission_label}”权限的账号。"
        else:
            answer = f"当前未找到具备“{permission_label}”权限的学校账号。"
        if partial:
            answer += f"结果只覆盖第 1 页的 {returned} / {total} 个账号，不能据此判断全校完整名单。"
        active_roles = [role for role in roles if role.get("status") == "active"]
        for role in active_roles[:3]:
            if len(links) >= 9:
                break
            links.append({
                "label": f"查看角色：{role.get('name') or '校内角色'}",
                "section": "access", "view": "trace", "school_id": school_id,
                "trace": {"kind": "role", "id": str(role["id"])},
            })
    return {"answer": answer, "links": links, "source": "local"}


@router.post("/admin/management/help/ask")
@router.post("/school/management/help/ask")
async def ask_management_help(
    request: Request,
    body: ManagementHelpAsk,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root, scope, access = _scope_for_request(request, user)
    permissions = access.get("effective_permissions", [])
    if scope == "school" and body.school_id and body.school_id != str(user.get("school_id") or ""):
        raise HTTPException(status_code=403, detail="学校端帮助只能使用当前绑定学校")
    target = permission_question_for_section(body.question, body.section)
    if is_permission_question(body.question):
        if target is None:
            return {
                "answer": "请补充具体页面或操作，例如“谁能管理教师账号”或“我能查看操作日志吗”？",
                "links": [],
                "source": "local",
            }
        school_id, graph = _graph_for_question(root, scope, user, access, body.school_id)
        if graph is None or school_id is None:
            return {
                "answer": "请先在“学校与账号”选择一所学校，再查询学校账号或角色权限。",
                "links": [
                    {"label": "打开学校与账号", "section": "schools", "view": "list"},
                    {"label": "打开权限管理", "section": "access"},
                ],
                "source": "local",
            }
        return _permission_answer(graph, scope, school_id, target, body.question)

    history = [message.model_dump() for message in body.messages]
    matches = match_guides(scope, permissions, body.question, history)
    view_answer = local_access_view_answer(matches, body.question)
    if view_answer:
        return view_answer
    return local_answer(matches)
