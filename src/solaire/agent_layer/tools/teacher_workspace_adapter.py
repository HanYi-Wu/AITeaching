"""Teacher exam workspace and template management adapter."""

from __future__ import annotations

from contextlib import closing
import uuid
from pathlib import Path
from typing import Any

import yaml
from jinja2 import Environment

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.teacher_tool_helpers import _actor, _ok, _required, _run
from solaire.exam_compiler.loaders.template_loader import load_template
from solaire.web.exam_workspace_service import (
    create_workspace_from_exam,
    delete_exam_workspace,
    list_exam_workspaces,
    load_exam_workspace,
    save_exam_workspace,
)
from solaire.web.platform_db import default_platform_root

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
    def action() -> dict[str, Any]:
        from solaire.web.exam_workspace_service import workspace_dir, _safe_exam_id
        from solaire.web.platform_db import connect, init_platform_db
        from solaire.web.paper_service import _ensure_paper_access
        from solaire.common.security import assert_within_project
        import shutil
        exam_id = _safe_exam_id(_required(args, 'exam_id'))
        source = workspace_dir(ctx.project_root, exam_id)
        assert_within_project(ctx.project_root, source)
        if not source.is_dir():
            raise FileNotFoundError('试卷不存在，请先用 exam.workspace_list 核对 exam_id。')
        if ctx.platform_user or ctx.public_mode:
            actor = _actor(ctx)
            from solaire.agent_layer.tools import teacher_tools
            root = getattr(teacher_tools, "default_platform_root", default_platform_root)()
            init_platform_db(root)
            with closing(connect(root)) as con, con:
                paper = con.execute('SELECT * FROM paper_records WHERE exam_id = ?', (exam_id,)).fetchone()
                if actor.get('role') != 'admin' and (not paper or paper['owner_teacher_id'] != actor['id']):
                    raise PermissionError('无法确认该草稿归属于当前教师；请由管理员核实归属，不能越权删除。')
                if paper:
                    _ensure_paper_access(dict(paper), actor)
                    if con.execute('SELECT 1 FROM exam_publications WHERE paper_id = ? LIMIT 1', (paper['id'],)).fetchone():
                        raise ValueError('该试卷已有发布记录，为保留学生答卷和成绩不能删除源文件。请用 paper.update_publication 撤销发布，或复制为新草稿后修改。')
        target = ctx.project_root / '.solaire' / 'trash' / 'exams' / uuid.uuid4().hex
        assert_within_project(ctx.project_root, target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))
        return {'ok': True, 'exam_id': exam_id, 'recovery_path': target.relative_to(ctx.project_root).as_posix(),
                'message': '试卷草稿已移至回收站，可由管理员恢复到原 exams 路径。'}
    return _run(action)

def tool_exam_workspace_copy(ctx: InvocationContext, args: dict[str, Any]) -> ToolResult:
    return _run(
        lambda: create_workspace_from_exam(
            ctx.project_root,
            _required(args, "source_exam_id"),
            export_label=_required(args, "export_label"),
        )
    )
