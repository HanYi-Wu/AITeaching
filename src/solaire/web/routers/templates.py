"""routers templates."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import yaml
from fastapi import HTTPException, Query
from solaire.exam_compiler.facade import EditorMetadataDefaultsBody, TEMPLATE_EDITOR_LAYOUT_BUILTIN_KEYS_ORDERED, TemplateParsedResponse, load_template, materialize_metadata_defaults_for_editor
from solaire.web.security import assert_within_project, safe_filename_component
from fastapi import APIRouter
from solaire.web.request_context import _require_root
from solaire.web.schemas.templates import TemplateRawFileBody, TemplateRenameBody

router = APIRouter()


def _resolve_under_templates(root: Path, rel: str) -> Path:
    """Return resolved path; must live under project templates/."""
    rel = rel.strip().replace("\\", "/").lstrip("/")
    if not rel.lower().startswith("templates/"):
        raise HTTPException(status_code=400, detail="path must start with templates/")
    target = (root / rel).resolve()
    templates_root = (root / "templates").resolve()
    try:
        target.relative_to(templates_root)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="path must stay under templates/") from e
    assert_within_project(root, target)
    return target


def _rename_template_on_disk(old: Path, new: Path) -> None:
    """Rename template file; on Windows supports case-only renames for the same file."""
    new.parent.mkdir(parents=True, exist_ok=True)
    try:
        same = old.samefile(new)
    except OSError:
        same = False
    if same:
        if old.name == new.name:
            return
        tmp = old.with_name(old.stem + ".__solaire_rename__.yaml")
        n = 0
        while tmp.exists():
            n += 1
            tmp = old.with_name(f"{old.stem}.__solaire_rename_{n}__.yaml")
        old.rename(tmp)
        tmp.rename(new)
        return
    if new.exists():
        raise FileExistsError(new)
    old.rename(new)


@router.get("/api/templates")
def list_templates() -> dict[str, Any]:
    root = _require_root()
    templates_dir = root / "templates"
    if not templates_dir.is_dir():
        return {"templates": []}
    out: list[dict[str, Any]] = []
    for p in sorted(templates_dir.rglob("*.yaml")):
        rel = p.relative_to(root)
        rel_s = rel.as_posix()
        try:
            t = load_template(p)
        except Exception as e:
            out.append({"id": None, "path": rel_s, "error": str(e)})
            continue
        md = dict(t.metadata_defaults) if t.metadata_defaults else {}
        out.append(
            {
                "id": t.template_id,
                "path": rel_s,
                "layout": t.layout,
                "latex_base": t.latex_base,
                "metadata_defaults": md,
                "sections": [
                    {
                        "section_id": s.section_id,
                        "type": s.type,
                        "required_count": s.required_count,
                        "score_per_item": s.score_per_item,
                        "describe": s.describe,
                    }
                    for s in t.sections
                ],
            }
        )
    return {"templates": [x for x in out if x.get("id")]}


@router.get("/api/templates/latex-bases")
def template_latex_bases() -> dict[str, Any]:
    """列出内置与项目 templates/ 下的 *.tex.j2 文件名，供模板工作台选择 latex_base。"""
    from solaire.exam_compiler.facade import list_shipped_latex_j2_names

    root = _require_root()
    shipped = list_shipped_latex_j2_names()
    proj_names: set[str] = set()
    td = root / "templates"
    if td.is_dir():
        for p in td.rglob("*.tex.j2"):
            proj_names.add(p.name)
    choices = sorted(set(shipped) | proj_names)
    return {
        "shipped": shipped,
        "in_project": sorted(proj_names),
        "choices": choices,
    }


@router.get("/api/templates/latex-metadata-ui")
def template_latex_metadata_ui(
    template_path: str = Query(
        ...,
        min_length=1,
        description="模板 YAML 相对项目根路径，如 templates/demo.yaml",
    ),
    latex_base: str = Query(..., min_length=1, description="与模板中 latex_base 一致，如 exam-zh-base.tex.j2"),
) -> dict[str, Any]:
    """
    读取与 ``latex_base`` 同 stem 的 ``*.metadata_ui.yaml``（模板目录优先，其次内置 latex 目录）。
    供模板工作台动态渲染 metadata_defaults 扩展字段，避免在前端写死键名。
    """
    from solaire.exam_compiler.facade import load_latex_metadata_ui_fields

    root = _require_root()
    tpl_yaml = (root / template_path).resolve()
    if not tpl_yaml.is_file():
        raise HTTPException(status_code=400, detail=f"Template YAML not found: {template_path}")
    assert_within_project(root, tpl_yaml)
    template_dir = tpl_yaml.parent
    try:
        fields, src, warnings = load_latex_metadata_ui_fields(template_dir, latex_base)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    rel_source: str | None = None
    if src is not None:
        try:
            rel_source = src.relative_to(root).as_posix()
        except ValueError:
            rel_source = str(src)
    return {"fields": fields, "source": rel_source, "warnings": warnings}


@router.get("/api/templates/editor-metadata-defaults", response_model=EditorMetadataDefaultsBody)
def template_editor_metadata_defaults() -> EditorMetadataDefaultsBody:
    """Materialized metadata_defaults for an empty template (PDF nested defaults, margin_cm, flags)."""
    _require_root()
    return EditorMetadataDefaultsBody(metadata_defaults=materialize_metadata_defaults_for_editor({}))


@router.get("/api/templates/parsed", response_model=TemplateParsedResponse)
def template_parsed(path: str = Query(..., min_length=1, description="e.g. templates/demo.yaml")) -> TemplateParsedResponse:
    """Load template.yaml via ``load_template`` and return editor-ready metadata (materialized)."""
    root = _require_root()
    p = _resolve_under_templates(root, path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        t = load_template(p)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid template YAML: {e}") from e
    md_raw = dict(t.metadata_defaults) if t.metadata_defaults else {}
    md_full = materialize_metadata_defaults_for_editor(md_raw)
    return TemplateParsedResponse.from_exam_template(
        t,
        layout_builtin_keys=list(TEMPLATE_EDITOR_LAYOUT_BUILTIN_KEYS_ORDERED),
        materialized_metadata=md_full,
    )


@router.get("/api/templates/{template_id}/preview")
def template_preview(template_id: str) -> dict[str, Any]:
    root = _require_root()
    templates_dir = root / "templates"
    for p in templates_dir.rglob("*.yaml"):
        try:
            t = load_template(p)
        except Exception:
            continue
        if t.template_id == template_id:
            rel = p.relative_to(root).as_posix()
            md = dict(t.metadata_defaults) if t.metadata_defaults else {}
            return {
                "id": t.template_id,
                "path": rel,
                "latex_base": t.latex_base,
                "layout": t.layout,
                "metadata_defaults": md,
                "sections": [
                    {
                        "section_id": s.section_id,
                        "type": s.type,
                        "required_count": s.required_count,
                        "score_per_item": s.score_per_item,
                        "describe": s.describe,
                    }
                    for s in t.sections
                ],
            }
    raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")


@router.get("/api/templates/raw")
def template_raw_get(path: str = Query(..., min_length=1, description="e.g. templates/demo.yaml")) -> dict[str, Any]:
    root = _require_root()
    p = _resolve_under_templates(root, path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    text = p.read_text(encoding="utf-8")
    return {"path": path.strip().replace("\\", "/"), "yaml": text}


@router.delete("/api/templates/raw")
def template_raw_delete(path: str = Query(..., min_length=1, description="e.g. templates/demo.yaml")) -> dict[str, Any]:
    """Delete a template file under templates/."""
    root = _require_root()
    p = _resolve_under_templates(root, path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    p.unlink()
    return {"ok": True}


@router.put("/api/templates/raw")
def template_raw_put(body: TemplateRawFileBody) -> dict[str, Any]:
    root = _require_root()
    if body.yaml is None:
        raise HTTPException(status_code=400, detail="yaml is required for PUT")
    p = _resolve_under_templates(root, body.path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.yaml, encoding="utf-8")
    try:
        load_template(p)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid template YAML: {e}") from e
    out_path = p
    rel = out_path.relative_to(root).as_posix()
    rename_raw = (body.rename_to or "").strip()
    if rename_raw:
        new = _resolve_under_templates(root, rename_raw)
        if p.parent.resolve() != new.parent.resolve():
            raise HTTPException(status_code=400, detail="Rename must stay in the same templates directory")
        norm_from = p.relative_to(root).as_posix()
        norm_to = new.relative_to(root).as_posix()
        if norm_from != norm_to:
            try:
                if new.exists() and not p.samefile(new):
                    raise HTTPException(
                        status_code=409,
                        detail=f"Target path already exists: {rename_raw}",
                    )
                _rename_template_on_disk(p, new)
            except FileExistsError:
                raise HTTPException(
                    status_code=409,
                    detail=f"Target path already exists: {rename_raw}",
                ) from None
            out_path = new
            try:
                load_template(out_path)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid template YAML after rename: {e}") from e
            rel = out_path.relative_to(root).as_posix()
    return {"ok": True, "path": rel}


@router.post("/api/templates/rename")
def template_rename(body: TemplateRenameBody) -> dict[str, Any]:
    """Rename a template YAML so the file name can follow ``template_id`` after save."""
    root = _require_root()
    old = _resolve_under_templates(root, body.from_path)
    new = _resolve_under_templates(root, body.to_path)
    if not old.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {body.from_path}")
    if old.parent.resolve() != new.parent.resolve():
        raise HTTPException(status_code=400, detail="Rename must stay in the same templates directory")
    norm_from = old.relative_to(root).as_posix()
    norm_to = new.relative_to(root).as_posix()
    if norm_from == norm_to:
        return {"ok": True, "path": norm_from}
    try:
        if new.exists() and not old.samefile(new):
            raise HTTPException(
                status_code=409,
                detail=f"Target path already exists: {body.to_path}",
            )
        _rename_template_on_disk(old, new)
    except FileExistsError:
        raise HTTPException(
            status_code=409,
            detail=f"Target path already exists: {body.to_path}",
        ) from None
    out = _resolve_under_templates(root, body.to_path)
    rel = out.relative_to(root).as_posix()
    try:
        load_template(out)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid template YAML after rename: {e}") from e
    return {"ok": True, "path": rel}


@router.post("/api/templates/create")
def template_create(
    name: str = Query(..., min_length=1, description="File stem under templates/, e.g. my_exam"),
    auto_rename: bool = False,
) -> dict[str, Any]:
    """Create a minimal valid template.yaml under templates/<name>.yaml if it does not exist."""
    from solaire.web.content_names import available_name

    root = _require_root()
    base = safe_filename_component(name).removesuffix(".yaml")
    template_dir = root / "templates"
    template_dir.mkdir(parents=True, exist_ok=True)
    while True:
        stem = available_name(base, (item.stem for item in template_dir.glob("*.yaml"))) if auto_rename else base
        stem_path = f"templates/{stem}.yaml"
        p = _resolve_under_templates(root, stem_path)
        try:
            target = p.open("x", encoding="utf-8")
            break
        except FileExistsError:
            if not auto_rename:
                raise HTTPException(status_code=409, detail=f"Template already exists: {stem_path}") from None
    minimal = {
        "template_id": stem.replace(".yaml", ""),
        "layout": "single_column",
        "latex_base": "exam-zh-base.tex.j2",
        "sections": [
            {
                "section_id": "一、考试说明",
                "type": "text",
                "required_count": 0,
                "score_per_item": 0,
                "describe": "（请在本节填写注意事项）",
            },
            {
                "section_id": "二、选择题",
                "type": "single_choice",
                "required_count": 1,
                "score_per_item": 5,
            },
        ],
    }
    text = yaml.safe_dump(minimal, allow_unicode=True, sort_keys=False)
    with target:
        target.write(text)
    load_template(p)
    rel = p.relative_to(root).as_posix()
    return {"ok": True, "path": rel}
