"""Teacher capability tools that bridge agent chat to existing web services."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Callable

import yaml
from jinja2 import Environment

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.teacher_capabilities import capability_manifest, get_capability
from solaire.exam_compiler.loaders.template_loader import load_template
from solaire.knowledge_forge import (
    detach_file_link,
    get_taxonomy,
    rename_graph,
    set_taxonomy,
    unbind_question_from_node,
)
from solaire.web.actor_scope import teacher_graph_root
from solaire.web.bank_service import delete_question, delete_question_collection, rename_question_collection
from solaire.web.exam_workspace_service import (
    create_workspace_from_exam,
    delete_exam_workspace,
    list_exam_workspaces,
    load_exam_workspace,
    save_exam_workspace,
)
from solaire.web.paper_service import (
    analyze_paper,
    grade_paper_answer,
    list_paper_publications,
    list_paper_submissions,
    query_papers,
    revoke_paper_publication,
    update_paper_delivery_mode,
    update_paper_publication,
)
from solaire.web.platform_db import default_platform_root


def _ok(**data: Any) -> ToolResult:
    return ToolResult(status="succeeded", data=data)


def _run(fn: Callable[[], dict[str, Any] | list[Any] | None]) -> ToolResult:
    try:
        value = fn()
        if value is None:
            return _ok(ok=True)
        if isinstance(value, dict):
            return ToolResult(status="succeeded", data=value)
        return _ok(items=value)
    except FileNotFoundError as exc:
        return ToolResult(status="failed", error_code="not_found", error_message=str(exc))
    except PermissionError as exc:
        return ToolResult(status="failed", error_code="permission_denied", error_message=str(exc))
    except (TypeError, ValueError) as exc:
        return ToolResult(status="failed", error_code="invalid_arguments", error_message=str(exc))
    except OSError as exc:
        return ToolResult(status="failed", error_code="io_error", error_message=str(exc))


def _required(args: dict[str, Any], key: str) -> str:
    value = str(args.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _actor(ctx: InvocationContext) -> dict[str, Any]:
    user = ctx.platform_user or {}
    if str(user.get("role") or "") not in {"teacher", "admin"} or not user.get("id"):
        raise PermissionError("This operation requires an authenticated teacher or admin")
    return user


def tool_list_capabilities(_ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    return ToolResult(status="succeeded", data=capability_manifest())


def tool_operation_guide(_ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    capability_id = str(args.get("capability_id") or "").strip()
    item = get_capability(capability_id)
    if item is None:
        return ToolResult(status="failed", error_code="not_found", error_message="Unknown teacher capability")
    if item.guide is None:
        return _ok(
            capability_id=item.id,
            mode=item.mode,
            tool_name=item.tool_name,
            message="This operation can be completed directly through AI chat.",
        )
    return _ok(
        capability_id=item.id,
        mode=item.mode,
        guide={
            "prerequisites": list(item.guide.prerequisites),
            "steps": list(item.guide.steps),
            "safety_note": item.guide.safety_note,
        },
    )


def tool_graph_rename(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (
            rename_graph(
                teacher_graph_root(ctx.project_root, ctx.platform_user),
                _required(args, "slug"),
                _required(args, "display_name"),
            ),
            {"ok": True},
        )[1]
    )


def tool_graph_get_taxonomy(ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    return _run(lambda: get_taxonomy(teacher_graph_root(ctx.project_root, ctx.platform_user)))


def tool_graph_set_taxonomy(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def action() -> dict[str, Any]:
        subjects = args.get("subjects")
        levels = args.get("levels")
        set_taxonomy(
            teacher_graph_root(ctx.project_root, ctx.platform_user),
            subjects=[str(x) for x in subjects] if isinstance(subjects, list) else None,
            levels=[str(x) for x in levels] if isinstance(levels, list) else None,
        )
        return {"ok": True}

    return _run(action)


def tool_graph_unbind_question(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (
            unbind_question_from_node(
                teacher_graph_root(ctx.project_root, ctx.platform_user),
                {
                    "question_qualified_id": _required(args, "question_qualified_id"),
                    "node_id": _required(args, "node_id"),
                },
                graph=str(args.get("graph") or "").strip() or None,
            ),
            {"ok": True},
        )[1]
    )


def tool_graph_detach_resource(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: (
            detach_file_link(
                teacher_graph_root(ctx.project_root, ctx.platform_user),
                _required(args, "link_id"),
                graph=str(args.get("graph") or "").strip() or None,
            ),
            {"ok": True},
        )[1]
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


_TEMPLATE_SUFFIXES = (".yaml", ".yml", ".tex.j2", ".metadata_ui.yaml")


def _template_root(ctx: InvocationContext) -> Path:
    root = (ctx.project_root / "templates").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _template_path(ctx: InvocationContext, raw: str, *, default_suffix: str = ".yaml") -> Path:
    value = raw.strip().replace("\\", "/").removeprefix("templates/")
    if not value:
        raise ValueError("path is required")
    if not any(value.endswith(suffix) for suffix in _TEMPLATE_SUFFIXES):
        value += default_suffix
    root = _template_root(ctx)
    path = (root / value).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Template path must stay inside templates/") from exc
    return path


def tool_template_list(ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    root = _template_root(ctx)
    items = [str(path.relative_to(ctx.project_root)).replace("\\", "/") for path in root.rglob("*") if path.is_file()]
    return _ok(templates=sorted(items))


def tool_template_get(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def action() -> dict[str, Any]:
        path = _template_path(ctx, _required(args, "path"))
        if not path.is_file():
            raise FileNotFoundError(str(path))
        return {"path": str(path.relative_to(ctx.project_root)).replace("\\", "/"), "content": path.read_text("utf-8")}

    return _run(action)


def _validate_template_file(path: Path) -> None:
    try:
        if path.name.endswith(".metadata_ui.yaml"):
            parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
            if not isinstance(parsed, dict):
                raise ValueError("Template metadata must be a YAML mapping")
        elif path.name.endswith((".yaml", ".yml")):
            load_template(path)
        elif path.name.endswith(".tex.j2"):
            Environment(autoescape=False).parse(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Invalid template content: {exc}") from exc


def _write_template(ctx: InvocationContext, args: dict[str, Any], *, must_be_new: bool) -> dict[str, Any]:
    path = _template_path(ctx, _required(args, "path"))
    if must_be_new and path.exists():
        raise ValueError("Template already exists")
    if not must_be_new and not path.is_file():
        raise FileNotFoundError(str(path))
    content = str(args.get("content") or "")
    if not content.strip():
        raise ValueError("content is required")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.stem}.{uuid.uuid4().hex}.tmp{''.join(path.suffixes)}")
    try:
        temp_path.write_text(content, encoding="utf-8")
        _validate_template_file(temp_path)
        temp_path.replace(path)
    finally:
        temp_path.unlink(missing_ok=True)
    return {"ok": True, "path": str(path.relative_to(ctx.project_root)).replace("\\", "/")}


def tool_template_create(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: _write_template(ctx, args, must_be_new=True))


def tool_template_update(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: _write_template(ctx, args, must_be_new=False))


def tool_template_rename(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    def action() -> dict[str, Any]:
        source = _template_path(ctx, _required(args, "path"))
        target = _template_path(ctx, _required(args, "new_path"))
        if not source.is_file():
            raise FileNotFoundError(str(source))
        if target.exists():
            raise ValueError("Target template already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        source.replace(target)
        return {"ok": True, "path": str(target.relative_to(ctx.project_root)).replace("\\", "/")}

    return _run(action)


def tool_template_delete(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: (_template_path(ctx, _required(args, "path")).unlink(), {"ok": True})[1])


def tool_exam_workspace_list(ctx: InvocationContext, _args: dict[str, Any]) -> ToolResult:
    return _ok(workspaces=list_exam_workspaces(ctx.project_root))


def tool_exam_workspace_get(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: load_exam_workspace(ctx.project_root, _required(args, "exam_id")))


def tool_exam_workspace_save(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: save_exam_workspace(
            ctx.project_root,
            exam_id=str(args.get("exam_id") or "").strip() or None,
            name=str(args.get("name") or "").strip() or None,
            subject=_required(args, "subject"),
            export_label=_required(args, "export_label"),
            template_ref=str(args.get("template_ref") or ""),
            template_path=_required(args, "template_path"),
            selected_items=args.get("selected_items") if isinstance(args.get("selected_items"), list) else [],
        )
    )


def tool_exam_workspace_delete(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(lambda: (delete_exam_workspace(ctx.project_root, _required(args, "exam_id")), {"ok": True})[1])


def tool_exam_workspace_copy(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: create_workspace_from_exam(
            ctx.project_root,
            _required(args, "source_exam_id"),
            export_label=_required(args, "export_label"),
        )
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
            default_platform_root(), paper_id=_required(args, "paper_id"), user=_actor(ctx), project_root=ctx.project_root
        )
    )


def tool_paper_publications(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: list_paper_publications(default_platform_root(), paper_id=_required(args, "paper_id"), user=_actor(ctx))
    )


def tool_paper_submissions(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: list_paper_submissions(
            default_platform_root(), ctx.project_root, paper_id=_required(args, "paper_id"), user=_actor(ctx)
        )
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


def tool_paper_manual_grade(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: grade_paper_answer(
            default_platform_root(),
            ctx.project_root,
            paper_id=_required(args, "paper_id"),
            attempt_id=_required(args, "attempt_id"),
            question_id=_required(args, "question_id"),
            user=_actor(ctx),
            score=float(args.get("score")),
            feedback=str(args.get("feedback") or "") or None,
            is_correct=args.get("is_correct") if isinstance(args.get("is_correct"), bool) else None,
        )
    )
