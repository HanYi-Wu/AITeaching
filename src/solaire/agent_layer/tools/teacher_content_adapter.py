"""Teacher content organizer and question bank collection management adapter."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.teacher_tool_helpers import _actor, _ok, _required, _run
from solaire.web.bank_service import (
    delete_question,
    delete_question_collection,
    rename_question_collection,
)
from solaire.web.platform_db import default_platform_root
from solaire.web.content_organizer import (
    assign_paper_folder,
    assign_folder_item,
    create_folder,
    list_folders,
    list_tags,
    save_tag,
    set_item_tags,
    update_folder,
)

def tool_bank_delete_item(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (
            delete_question(ctx.project_root, _required(args, "qualified_id"), str(args.get("storage_path") or "") or None),
            {"ok": True},
        )[1]
    )

def tool_bank_rename_collection(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: rename_question_collection(
            ctx.project_root,
            namespace=_required(args, "namespace"),
            new_subject=_required(args, "new_subject"),
            new_collection=_required(args, "new_collection"),
        )
    )

def tool_bank_delete_collection(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (delete_question_collection(ctx.project_root, _required(args, "namespace")), {"ok": True})[1]
    )

def tool_content_folders(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: {"folders": list_folders(default_platform_root(), _actor(ctx), _required(args, "scope"))})

def tool_content_folder_create(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: {"folder": create_folder(default_platform_root(), _actor(ctx), scope=_required(args, "scope"),
        name=_required(args, "name"), parent_id=str(args.get("parent_id") or "") or None, kind=str(args.get("kind") or "category"))})

def tool_content_folder_update(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: {"folder": update_folder(default_platform_root(), _actor(ctx), _required(args, "folder_id"),
        name=str(args["name"]) if "name" in args else None, parent_id=str(args.get("parent_id") or "") or None,
        move=bool(args.get("move")), kind=str(args["kind"]) if "kind" in args else None)})

def tool_content_move_item(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def invoke() -> dict[str, Any]:
        scope = _required(args, "scope")
        item_id = _required(args, "item_id")
        folder_id = _required(args, "folder_id")
        if scope == "paper":
            assign_paper_folder(default_platform_root(), _actor(ctx), item_id, folder_id)
        else:
            assign_folder_item(default_platform_root(), _actor(ctx), scope=scope, item_id=item_id, folder_id=folder_id)
        return {"ok": True}
    return _run(invoke)

def tool_content_tags(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: {"tags": list_tags(default_platform_root(), _actor(ctx))})

def tool_content_tag_save(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: {"tag": save_tag(default_platform_root(), _actor(ctx), name=_required(args, "name"),
        color=str(args.get("color") or "slate"), tag_id=str(args.get("tag_id") or "") or None)})

def tool_content_item_tags(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def invoke() -> dict[str, Any]:
        tag_ids = args.get("tag_ids")
        if not isinstance(tag_ids, list):
            raise ValueError("tag_ids 必须是数组")
        return {"tag_ids": set_item_tags(default_platform_root(), _actor(ctx), scope=_required(args, "scope"),
            item_id=_required(args, "item_id"), tag_ids=[str(item) for item in tag_ids])}
    return _run(invoke)
