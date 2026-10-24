"""routers projects."""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any
from fastapi import HTTPException
from solaire.web import bundled_paths, recent_projects, state
from solaire.web.public_access import redact_project_root
from solaire.web.project_layout import ensure_project_layout
from solaire.web.project_scope import project_scope_id
from solaire.web.platform_db import init_platform_db
from solaire.web.security import safe_project_name, unique_child_dir
from fastapi import APIRouter
from solaire.web.host_dialogs import _pick_directory_dialog
from solaire.web.schemas.projects import ProjectCreateBody, ProjectOpenBody, RecentProjectRemoveBody

router = APIRouter()


@router.get("/api/project/info")
def project_info() -> dict[str, Any]:
    r = state.get_content_root()
    ensure_project_layout(r)
    return redact_project_root({"bound": True, "root": str(r), "project_id": project_scope_id(r)})


@router.get("/api/recent-projects")
def api_recent_projects() -> dict[str, Any]:
    items = recent_projects.load_recent_projects()
    return {
        "items": [
            {"name": e.name, "path": e.path, "last_opened": e.last_opened}
            for e in items
        ]
    }


@router.post("/api/recent-projects/remove")
def api_recent_projects_remove(body: RecentProjectRemoveBody) -> dict[str, Any]:
    """Remove one entry from the persisted recent list (does not delete the project folder)."""
    p = body.path.strip()
    if not p:
        raise HTTPException(status_code=400, detail="路径不能为空")
    removed = recent_projects.remove_recent_project(p)
    return {"ok": True, "removed": removed}


@router.post("/api/project/pick-open")
async def project_pick_open() -> dict[str, Any]:
    """
    Open OS folder dialog on the **server** machine, then bind that folder as project root.
    The browser cannot read arbitrary disk paths; this delegates to the local backend process.
    """
    try:
        path = await asyncio.to_thread(_pick_directory_dialog)
    except RuntimeError as e:
        if str(e) == "TKINTER_UNAVAILABLE":
            raise HTTPException(
                status_code=501,
                detail="当前 Python 环境未提供 Tk（tkinter），无法弹出系统选文件夹。请使用下方手动输入路径，"
                "或安装带 Tcl/Tk 的 Python；无图形界面环境（如部分 SSH）也不支持此功能。",
            ) from e
        raise HTTPException(status_code=500, detail=str(e)) from e
    if not path:
        raise HTTPException(status_code=400, detail="未选择文件夹或已取消")
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {root}")
    ensure_project_layout(root)
    init_platform_db(root)
    state.set_root(root)
    recent_projects.record_project_opened(root)
    return {"ok": True, "root": str(root)}


@router.post("/api/project/pick-parent")
async def project_pick_parent() -> dict[str, Any]:
    """Pick a parent directory for «新建项目» — same dialog as pick-open, returns path only."""
    try:
        path = await asyncio.to_thread(_pick_directory_dialog)
    except RuntimeError as e:
        if str(e) == "TKINTER_UNAVAILABLE":
            raise HTTPException(
                status_code=501,
                detail="当前 Python 环境未提供 Tk（tkinter），无法弹出系统选文件夹。请手动输入父目录路径。",
            ) from e
        raise HTTPException(status_code=500, detail=str(e)) from e
    if not path:
        raise HTTPException(status_code=400, detail="未选择文件夹或已取消")
    parent = Path(path).expanduser().resolve()
    if not parent.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {parent}")
    return {"ok": True, "path": str(parent)}


@router.post("/api/project/close")
def project_close() -> dict[str, Any]:
    """取消显式内容目录绑定，之后回到默认内容目录。"""
    state.clear_root()
    return {"ok": True}


@router.post("/api/project/open")
def project_open(body: ProjectOpenBody) -> dict[str, Any]:
    root = Path(body.root).expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {root}")
    ensure_project_layout(root)
    init_platform_db(root)
    state.set_root(root)
    recent_projects.record_project_opened(root)
    return {"ok": True, "root": str(root)}


@router.post("/api/project/create")
def project_create(body: ProjectCreateBody) -> dict[str, Any]:
    parent = Path(body.parent).expanduser().resolve()
    if not parent.is_dir():
        raise HTTPException(status_code=400, detail=f"Parent not a directory: {parent}")
    name = safe_project_name(body.name)
    root = unique_child_dir(parent, name)

    if body.template == "math":
        src = bundled_paths.resolve_math_project_template_dir()
        if src is None:
            raise HTTPException(
                status_code=503,
                detail="数学项目模板暂不可用，请使用完整安装包或联系管理员。",
            )
        shutil.copytree(src, root)
        ensure_project_layout(root)
        init_platform_db(root)
    else:
        root.mkdir(parents=False)
        ensure_project_layout(root)
        init_platform_db(root)
        readme = root / "templates" / "README.txt"
        readme.parent.mkdir(parents=True, exist_ok=True)
        readme.write_text("在此目录放置 template.yaml 与 LaTeX 基架（与 exam 解耦）。\n", encoding="utf-8")
    state.set_root(root)
    recent_projects.record_project_opened(root)
    return {"ok": True, "root": str(root)}
