"""Teacher paper management, publication, and adaptive practice adapter."""

from __future__ import annotations

import asyncio
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.teacher_tool_helpers import _actor, _ok, _required, _run
from solaire.web.adaptive_practice_service import (
    list_practice_history,
    publish_reinforcement_practice,
    publish_wrong_question_practice,
)
from solaire.web.content_organizer import analyze_paper_folder
from solaire.web.platform_db import default_platform_root
from solaire.web.paper_service import (
    analyze_paper,
    list_paper_publications,
    query_papers,
    revoke_paper_publication,
    update_paper_delivery_mode,
    update_paper_publication,
)

def tool_paper_list(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: query_papers(
            ctx.project_root,
            default_platform_root(),
            _actor(ctx),
            q=str(args.get("q") or "").strip() or None,
            delivery_mode=str(args.get("delivery_mode") or "").strip() or None,
            status=str(args.get("status") or "").strip() or None,
            subject=str(args.get("subject") or "").strip() or None,
            page=int(args.get("page") or 1),
            page_size=int(args.get("page_size") or 10),
        )
    )

def tool_paper_analyze(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: analyze_paper(
            default_platform_root(), paper_id=_required(args, "paper_id"), user=_actor(ctx), project_root=ctx.project_root,
            publication_id=str(args.get("publication_id") or "").strip() or None,
            class_id=str(args.get("class_id") or "").strip() or None,
        )
    )

def tool_paper_publications(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: list_paper_publications(default_platform_root(), paper_id=_required(args, "paper_id"), user=_actor(ctx))
    )

def tool_paper_folder_analyze(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: analyze_paper_folder(default_platform_root(), _actor(ctx), _required(args, "folder_id")))

def _practice_settings(args: dict[str, Any]) -> dict[str, Any]:
    return {
        "start_at": str(args.get("start_at") or "").strip() or None,
        "end_at": str(args.get("end_at") or "").strip() or None,
        "show_results_immediately": bool(args.get("show_results_immediately", False)),
        "submission_mode": str(args.get("submission_mode") or "online"),
        "max_screen_switches": int(args.get("max_screen_switches") or 0),
        "time_limit_minutes": int(args.get("time_limit_minutes") or 0) or None,
    }

def tool_paper_practice_history(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: list_practice_history(
            default_platform_root(),
            class_id=_required(args, "class_id"),
            user=_actor(ctx),
        )
    )

def tool_paper_publish_wrong_question_practice(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: publish_wrong_question_practice(
            default_platform_root(),
            ctx.project_root,
            class_id=_required(args, "class_id"),
            source_publication_id=_required(args, "source_publication_id"),
            title=_required(args, "title"),
            max_questions_per_student=int(args.get("max_questions_per_student") or 20),
            student_id=_required(args, "student_id") if args.get("student_id") else None,
            user=_actor(ctx),
            **_practice_settings(args),
        )
    )

def tool_paper_publish_reinforcement_practice(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def invoke() -> dict[str, Any]:
        source_ids = args.get("source_publication_ids")
        if not isinstance(source_ids, list):
            raise ValueError("source_publication_ids must be an array")
        return asyncio.run(
            publish_reinforcement_practice(
                default_platform_root(),
                ctx.project_root,
                class_id=_required(args, "class_id"),
                source_publication_ids=[str(item) for item in source_ids],
                title=_required(args, "title"),
                questions_per_student=int(args.get("questions_per_student") or 5),
                user=_actor(ctx),
                **_practice_settings(args),
            )
        )

    return _run(invoke)

def tool_paper_offline_upload_guide(_ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    return _ok(
        title="线下答卷照片采集",
        supported_formats=["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "heic", "heif"],
        limits={"max_files_per_student": 20, "max_file_mb": 15, "max_total_mb": 100},
        steps=[
            "教师在试卷管理页下载并打开“线下答卷采集器”。",
            "使用教师账号登录，选择试卷、班级和学生。",
            "按页码顺序选择该学生的多张答卷照片并上传。",
            "返回系统的在线提交批改页，运行 AI 预批改并逐题复核保存。",
        ],
        safety_note="本地照片选择和账号登录必须由教师亲自完成；AI 不会读取未主动选择的本机文件，也不会直接确认最终分数。",
    )

def tool_paper_update_delivery(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: update_paper_delivery_mode(
            default_platform_root(), _required(args, "paper_id"), _required(args, "delivery_mode"), _actor(ctx)
        )
    )

def tool_paper_update_publication(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    optional = {
        key: args[key]
        for key in (
            "title",
            "description",
            "start_at",
            "end_at",
            "time_limit_minutes",
            "show_results_immediately",
            "status",
        )
        if key in args
    }
    return _run(
        lambda: update_paper_publication(
            default_platform_root(),
            paper_id=_required(args, "paper_id"),
            publication_id=_required(args, "publication_id"),
            user=_actor(ctx),
            **optional,
        )
    )

def tool_paper_revoke_publication(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: revoke_paper_publication(
            default_platform_root(),
            paper_id=_required(args, "paper_id"),
            publication_id=_required(args, "publication_id"),
            user=_actor(ctx),
        )
    )
