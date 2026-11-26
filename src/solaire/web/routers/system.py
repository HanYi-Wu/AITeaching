"""routers system."""

from __future__ import annotations

import asyncio
from typing import Any
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from solaire.exam_compiler import __version__
from solaire.primebrush.api import parse_primebrush, render as render_primebrush
from solaire.web import extension_registry, help_docs, system_tools
from fastapi import APIRouter
from solaire.web.host_dialogs import _pick_directory_dialog
from solaire.web.host_dialogs import _pick_executable_dialog
from solaire.web.public_access import public_mode_enabled
from solaire.web.schemas.system import ExtensionManualPathBody, ExtensionPickDialogBody, PrimeBrushRenderBody

router = APIRouter()


@router.get("/api/health")
def health() -> dict[str, str]:
    """
    健康检查。字段 ``exam_workspace_layout`` 为 ``two_level`` 时表示后端从本仓库加载，
    考试目录为 ``exams/<试卷说明>/<学科>/``；若缺失或为其它值，多为未加 ``--app-dir src`` 而加载了旧版已安装包。
    """
    return {
        "status": "ok",
        "version": __version__,
        "product": "education_helper",
        "exam_workspace_layout": "two_level",
    }


@router.post("/api/primebrush/render")
def primebrush_render(body: PrimeBrushRenderBody) -> dict[str, str]:
    try:
        doc = parse_primebrush(body.source)
        return {"svg": render_primebrush(doc, seed=body.seed)}
    except (ValueError, TypeError, NotImplementedError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/system/tex-status")
def api_tex_status() -> dict[str, Any]:
    """Detect latexmk / xelatex on PATH for PDF export."""
    return system_tools.tex_status()


@router.post("/api/system/tex-install")
def api_tex_install() -> dict[str, Any]:
    """Try to start MiKTeX install via winget (Windows)."""
    return system_tools.tex_install_miktex_via_winget()


@router.get("/api/system/extensions")
def api_system_extensions(request: Request) -> dict[str, Any]:
    """Detect optional host extensions (LaTeX, Pandoc, OCR, Mermaid renderer)."""
    allowed = not public_mode_enabled() or bool(getattr(request.state, "host_control_authorized", False))
    result = extension_registry.detect_all()
    if not allowed:
        result = {**result, "extensions": [
            {**extension, "manual_paths": {}, "executables": [{**tool, "path": None} for tool in extension.get("executables", [])]}
            for extension in result["extensions"]
        ]}
    return {**result, "host_control_allowed": allowed}


@router.post("/api/system/extensions/{ext_id}/install")
def api_system_extension_install(ext_id: str) -> dict[str, Any]:
    """Try to start winget install for a registered extension (Windows)."""
    return extension_registry.install_extension(ext_id)


@router.put("/api/system/extensions/{ext_id}/manual-path")
def api_extension_manual_path_put(ext_id: str, body: ExtensionManualPathBody) -> dict[str, Any]:
    r = extension_registry.validate_and_save_manual_path(
        ext_id,
        body.path,
        location_kind=body.location_kind,
    )
    if not r.get("ok"):
        raise HTTPException(status_code=400, detail=str(r.get("message", "保存失败")))
    return {"ok": True, "extensions": extension_registry.detect_all()["extensions"]}


@router.delete("/api/system/extensions/{ext_id}/manual-path")
def api_extension_manual_path_delete(ext_id: str) -> dict[str, Any]:
    r = extension_registry.clear_manual_path(ext_id)
    if not r.get("ok"):
        raise HTTPException(status_code=400, detail=str(r.get("message", "清除失败")))
    return {"ok": True, "extensions": extension_registry.detect_all()["extensions"]}


@router.post("/api/system/extensions/pick-path")
async def api_extension_pick_path(body: ExtensionPickDialogBody) -> dict[str, Any]:
    """Open OS dialog on the machine running the API (browser + local backend)."""
    try:
        if body.dialog == "dir":
            path = await asyncio.to_thread(_pick_directory_dialog)
        else:
            path = await asyncio.to_thread(_pick_executable_dialog)
    except RuntimeError as e:
        if str(e) == "TKINTER_UNAVAILABLE":
            raise HTTPException(
                status_code=501,
                detail="当前环境无法弹出系统选择窗口，请在本机手动输入路径。",
            ) from e
        raise HTTPException(status_code=500, detail=str(e)) from e
    if not path:
        raise HTTPException(status_code=400, detail="未选择或已取消")
    return {"ok": True, "path": path}


@router.get("/api/help/index")
def api_help_index() -> dict[str, Any]:
    return help_docs.help_index()


@router.get("/api/help/page/{page_id}")
def api_help_page(page_id: str) -> dict[str, Any]:
    return help_docs.help_page(page_id)


@router.get("/api/help/asset/{rel_path:path}")
def api_help_asset(rel_path: str) -> FileResponse:
    """手册内嵌静态资源（如 PrimeBrush 示例 SVG），位于 help_docs/assets/。"""
    target = help_docs.resolve_help_asset(rel_path)
    mt = "image/svg+xml" if target.suffix.lower() == ".svg" else None
    return FileResponse(target, media_type=mt)
