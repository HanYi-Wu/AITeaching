"""FastAPI application: project binding, questions, templates, validate, export."""

from __future__ import annotations

from solaire.web.routers.analysis import router as analysis_router

from solaire.web.routers.graph import router as graph_router

from solaire.web.routers.bank import router as bank_router

from solaire.web.routers.templates import router as templates_router

from solaire.web.routers.projects import router as projects_router

from solaire.web.routers.system import router as system_router

from solaire.web.host_dialogs import _pick_directory_dialog, _pick_executable_dialog

from solaire.web.request_context import _require_root, bind_request_context

import asyncio
import contextvars
import json
import logging
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from typing import Annotated, Any, Literal, Union

import yaml
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from solaire.common.runtime_config import load_runtime_config

load_runtime_config()

from solaire.exam_compiler.facade import (
    EditorMetadataDefaultsBody,
    ExamConfig,
    QuestionGroupRecord,
    QuestionItem,
    SelectedSection,
    TEMPLATE_EDITOR_LAYOUT_BUILTIN_KEYS_ORDERED,
    TemplateParsedResponse,
    load_all_questions,
    load_template,
    materialize_metadata_defaults_for_editor,
    strip_hydrate_fields,
)
from solaire.primebrush.api import parse_primebrush, render as render_primebrush

from solaire.web import bundled_paths, extension_registry, help_docs, recent_projects, state, system_tools
from solaire.web.agent_api import router as agent_router
from solaire.web.actor_scope import teacher_graph_root
from solaire.web.auth_api import extract_session_token, require_platform_root, router as auth_router
from solaire.web.auth_service import get_session_user
from solaire.web.bank_exchange import export_bank_exchange_zip, import_bank_exchange_zip
from solaire.web.paper_api import router as paper_router
from solaire.web.public_access import allowed_origins, enforce_public_access, redact_project_root
from solaire.web.student_api import router as student_router
from solaire.web.result_service import (
    compute_statistics,
    delete_score_batch,
    find_exported_docx_path,
    find_exported_pdf_path,
    generate_score_template,
    get_exam_summary,
    get_score_analysis,
    import_scores,
    list_exam_results,
    open_docx_with_default_app,
    open_pdf_with_default_app,
)
from solaire.edu_analysis.core import (
    delete_script_api,
    get_job,
    get_script_api,
    invoke_tool,
    list_jobs_api,
    list_scripts_api,
    list_tools,
    run_builtin,
    run_script_with_request_id,
    save_script_doc,
)
from solaire.edu_analysis.diagnosis import (
    class_heatmap_v1,
    knowledge_diagnosis_v1,
    student_knowledge_diagnosis_v1,
    teaching_suggestions_v1,
)
from solaire.web.bank_service import (
    collections_list,
    create_question_selection_export,
    delete_question,
    delete_question_collection,
    expand_question_for_web,
    get_question_detail,
    import_merged_yaml,
    list_bank_entries,
    list_subjects,
    question_exists,
    question_selection_export_path,
    rename_question_collection,
    save_bank_record,
    save_question,
    upload_bank_image,
)
from solaire.web.graph_service import (
    attach_file_to_node,
    bind_question_to_node,
    bind_questions_batch,
    count_nodes_by_kind,
    create_concept_node,
    create_graph,
    create_node_relation,
    delete_concept_node,
    delete_graph,
    delete_node_relation,
    detach_file_link,
    export_graph,
    generate_unique_node_id,
    get_concept_node,
    get_taxonomy,
    import_graph,
    list_concept_nodes,
    list_file_links_for_node,
    list_graphs,
    list_node_relations,
    list_nodes_for_question,
    list_questions_for_node,
    list_resource_files,
    load_graph,
    rename_graph,
    set_taxonomy,
    unbind_question_from_node,
    unbind_questions_batch,
    update_concept_node,
    update_node_relation,
)
from solaire.web.library_discovery import discover_question_library_refs
from solaire.web.exam_workspace_service import (
    create_workspace_from_exam,
    delete_exam_workspace,
    exam_id_from_labels,
    exam_yaml_path,
    list_exam_workspaces,
    load_exam_workspace,
    mark_exported,
    resolve_template_under_project,
    save_exam_workspace,
    save_exam_workspace_after_export_failure,
)
from solaire.web.exam_service import (
    VALIDATE_EXAM_NAME,
    discard_build_yaml_backup,
    ensure_probe_list_yaml,
    exam_export_error_detail_short,
    export_docx,
    export_pdfs,
    export_preview_pdfs,
    find_export_conflict,
    restore_build_yaml_from_backup,
    run_validate,
    snapshot_build_yaml_before_export,
    write_build_exam_yaml,
    write_exam_yaml,
    write_preview_exam_yaml,
)
from solaire.web.project_layout import ensure_project_layout
from solaire.web.platform_db import init_platform_db
from solaire.web.security import (
    assert_within_project,
    content_disposition_attachment,
    safe_filename_component,
    safe_project_name,
    unique_child_dir,
)
from solaire.web.result_service import ResultServiceAdapter
from solaire.web.school_api import router as school_router
from solaire.edu_analysis.ports import configure as _configure_edu_analysis
from solaire.web.remediation_service import create_remediation_draft, plan_remediation_draft

# 在模块加载时注入 edu_analysis 所需的数据访问实现，解除 edu_analysis 对 web 层的反向依赖
_configure_edu_analysis(result_port=ResultServiceAdapter())


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    state.init_from_env()
    yield


app = FastAPI(title="OriginReach API", version="1.6.7", lifespan=_lifespan)
app.include_router(agent_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(school_router, prefix="/api")
app.include_router(paper_router, prefix="/api")
app.include_router(student_router, prefix="/api")

app.include_router(analysis_router)

app.include_router(graph_router)

app.include_router(bank_router)

app.include_router(templates_router)

app.include_router(projects_router)

app.include_router(system_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Solaire-Session",
        "X-Solaire-Control-Token",
    ],
)

app.middleware("http")(bind_request_context)


class SelectedSectionIn(BaseModel):
    section_id: str
    question_ids: list[str]
    score_per_item: float | None = None
    score_overrides: dict[str, float] | None = None
    required_count: int | None = Field(default=None, ge=0, le=500)


class ExamDraftBody(BaseModel):
    template_ref: str
    """Must match template_id inside the YAML file."""
    template_path: str = Field(..., description="Path relative to project root, e.g. templates/demo.yaml")
    selected_items: list[SelectedSectionIn]


class ExamExportBody(ExamDraftBody):
    export_label: str = Field(..., min_length=1)
    subject: str = Field(..., min_length=1)
    metadata_title: str | None = None
    """When set, must match an existing ``exams/<标签>/<学科>/`` 目录标识及其试卷说明/学科。"""
    overwrite_existing: str | None = None
    exam_ids_to_delete_on_success: list[str] | None = None
    """导出成功后删除的其它 ``exams/<标签段>/<学科段>/``（例如旧副本）。"""
    exam_workspace_id: str | None = None
    """当前考试目录标识（``标签段/学科段``）；导出成功后更新状态，不删除该目录。"""


class ExamExportConflictBody(BaseModel):
    export_label: str = Field(..., min_length=1)
    subject: str = Field(..., min_length=1)


class ExamSaveDraftBody(BaseModel):
    name: str | None = None
    subject: str = Field(..., min_length=1)
    export_label: str = Field(..., min_length=1)
    template_ref: str = ""
    template_path: str = Field(..., min_length=1, description="Relative to project root")
    selected_items: list[SelectedSectionIn] = Field(default_factory=list)
    auto_rename: bool = False


class CopyFromExamBody(BaseModel):
    """从历史试卷复制为新草稿时必填：新试卷说明；学科沿用源考试。"""

    export_label: str = Field(..., min_length=1)


class OpenResultPdfBody(BaseModel):
    variant: str = "student"


def _draft_to_sections(body: ExamDraftBody) -> list[SelectedSection]:
    out: list[SelectedSection] = []
    for s in body.selected_items:
        ov = s.score_overrides
        out.append(
            SelectedSection(
                section_id=s.section_id,
                question_ids=list(s.question_ids),
                score_per_item=s.score_per_item,
                score_overrides=dict(ov) if ov else None,
                required_count=s.required_count,
            )
        )
    return out


def _assert_overwrite_target(
    root: Path, exam_id: str, export_label: str, subject: str
) -> Path:
    """Return resolved ``exams/<标签>/<学科>/`` directory; raises HTTPException if invalid or metadata mismatch."""
    dest = exam_yaml_path(root, exam_id).parent.resolve()
    assert_within_project(root, dest)
    exam_yaml = dest / "exam.yaml"
    if not exam_yaml.is_file():
        raise HTTPException(status_code=400, detail="覆盖目标不存在或缺少试卷配置")
    try:
        with exam_yaml.open(encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        exam = ExamConfig.model_validate(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail="无法读取已有试卷配置") from e
    meta = exam.metadata or {}
    if str(meta.get("export_label", "")).strip() != export_label.strip():
        raise HTTPException(status_code=400, detail="覆盖目标的试卷说明与当前不一致")
    if str(meta.get("subject", "")).strip() != subject.strip():
        raise HTTPException(status_code=400, detail="覆盖目标的学科与当前不一致")
    return dest


def _assert_export_destination_owner(root: Path, dest_dir: Path, teacher_id: str | None) -> None:
    """A teacher must not replace a colleague's exam with the same label/path."""
    if not teacher_id:
        return
    from solaire.web.platform_db import connect, default_platform_root
    exam_id = dest_dir.relative_to(root / "exams").as_posix()
    with connect(default_platform_root()) as con:
        row = con.execute("SELECT id, owner_teacher_id FROM paper_records WHERE exam_id=?", (exam_id,)).fetchone()
        publishers = {str(item[0]) for item in con.execute(
            "SELECT DISTINCT teacher_id FROM exam_publications WHERE paper_id=?", (str(row["id"]),)
        )} if row is not None else set()
    if row is not None and row["owner_teacher_id"] and str(row["owner_teacher_id"]) != teacher_id:
        raise HTTPException(status_code=403, detail="该试卷属于其他教师，请使用不同的试卷说明")
    if publishers and publishers != {teacher_id}:
        raise HTTPException(status_code=403, detail="该试卷已有其他教师的发布记录，请使用不同的试卷说明")
    existing = dest_dir / "exam.yaml"
    if existing.is_file():
        try:
            metadata = (yaml.safe_load(existing.read_text(encoding="utf-8")) or {}).get("metadata") or {}
            previous_owner = str(metadata.get("owner_teacher_id") or "").strip()
        except (OSError, ValueError, AttributeError) as exc:
            raise HTTPException(status_code=400, detail="现有试卷归属信息无法读取，拒绝覆盖") from exc
        if previous_owner and previous_owner != teacher_id:
            raise HTTPException(status_code=403, detail="该试卷属于其他教师，请使用不同的试卷说明")


@app.post("/api/exam/validate")
def exam_validate(body: ExamDraftBody) -> dict[str, Any]:
    root = _require_root()
    tpl, tpl_rel = resolve_template_under_project(root, body.template_path, body.template_ref)
    assert_within_project(root, tpl)
    if not tpl.is_file():
        raise HTTPException(status_code=400, detail=f"Template file not found: {body.template_path}")
    sections = _draft_to_sections(body)
    exam_yaml = write_exam_yaml(
        root,
        yaml_basename=VALIDATE_EXAM_NAME,
        exam_id="validate",
        template_ref=body.template_ref,
        template_relative=tpl_rel,
        metadata={},
        selected_items=sections,
    )
    try:
        run_validate(root, exam_yaml)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


def _exam_export_failure_detail(root: Path, body: ExamExportBody, exc: BaseException) -> dict[str, Any]:
    """Structured HTTP detail: message + optional exam_saved after restore."""
    log = logging.getLogger(__name__)
    doc: dict[str, Any] | None = None
    try:
        items = [s.model_dump(mode="json", exclude_none=True) for s in body.selected_items]
        doc = save_exam_workspace_after_export_failure(
            root,
            template_ref=body.template_ref,
            template_path=body.template_path,
            export_label=body.export_label,
            subject=body.subject,
            selected_items=items,
        )
    except Exception:
        log.exception("failed to save exam workspace after export failure")

    msg = exam_export_error_detail_short(exc) if isinstance(exc, Exception) else str(exc).strip()
    if not msg:
        msg = "导出失败，请查看运行日志。"
    detail: dict[str, Any] = {"message": msg}
    if doc:
        detail["exam_saved"] = {"exam_id": str(doc.get("exam_id") or ""), "name": str(doc.get("name") or "")}
    return detail


@app.post("/api/exam/export")
def exam_export(body: ExamExportBody) -> dict[str, Any]:
    root = _require_root()
    tpl, tpl_rel = resolve_template_under_project(root, body.template_path, body.template_ref)
    assert_within_project(root, tpl)
    if not tpl.is_file():
        raise HTTPException(status_code=400, detail=f"Template file not found: {body.template_path}")

    title = body.metadata_title or body.export_label
    metadata: dict[str, Any] = {
        "title": title,
        "subject": body.subject,
        "export_label": body.export_label,
    }
    from solaire.common.actor_context import actor
    export_actor = actor.get()
    if export_actor and export_actor.get("role") == "teacher":
        metadata["owner_teacher_id"] = str(export_actor["id"])
    sections = _draft_to_sections(body)

    log = logging.getLogger(__name__)
    backup = snapshot_build_yaml_before_export(root)
    try:
        exam_yaml = write_build_exam_yaml(
            root,
            exam_id="web_export",
            template_ref=body.template_ref,
            template_relative=tpl_rel,
            metadata=metadata,
            selected_items=sections,
        )
        run_validate(root, exam_yaml)
        template = load_template(tpl)
        dest_dir: Path
        if body.overwrite_existing:
            dest_dir = _assert_overwrite_target(
                root, body.overwrite_existing, body.export_label, body.subject
            )
        else:
            wid = str(body.exam_workspace_id or "").strip()
            if wid:
                dest_dir = exam_yaml_path(root, wid).parent.resolve()
            else:
                try:
                    dest_dir = exam_yaml_path(
                        root, exam_id_from_labels(body.export_label, body.subject)
                    ).parent.resolve()
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e)) from e
        _assert_export_destination_owner(root, dest_dir, str(metadata.get("owner_teacher_id") or "") or None)
        result_dir, s_name, t_name = export_pdfs(
            root,
            exam_yaml=exam_yaml,
            export_label=body.export_label,
            subject=body.subject,
            template=template,
            dest_dir=dest_dir,
        )
    except ValueError as e:
        restore_build_yaml_from_backup(root, backup)
        log.warning("exam export validation failed: %s", e)
        raise HTTPException(status_code=400, detail=_exam_export_failure_detail(root, body, e)) from e
    except FileNotFoundError as e:
        restore_build_yaml_from_backup(root, backup)
        log.warning("exam export file not found: %s", e)
        raise HTTPException(status_code=400, detail=_exam_export_failure_detail(root, body, e)) from e
    except RuntimeError as e:
        restore_build_yaml_from_backup(root, backup)
        log.exception("exam export PDF build failed")
        raise HTTPException(status_code=500, detail=_exam_export_failure_detail(root, body, e)) from e
    except Exception as e:
        restore_build_yaml_from_backup(root, backup)
        log.exception("exam export failed")
        raise HTTPException(status_code=500, detail=_exam_export_failure_detail(root, body, e)) from e
    else:
        discard_build_yaml_backup(backup)

    rel = result_dir.relative_to(root)
    wid = str(body.exam_workspace_id or "").strip()
    mark_id = wid
    if not mark_id:
        try:
            mark_id = exam_id_from_labels(body.export_label, body.subject)
        except ValueError:
            mark_id = ""
    if mark_id:
        try:
            mark_exported(root, mark_id)
        except Exception:
            log.warning("mark exam workspace exported failed: %s", mark_id, exc_info=True)

    skip_delete = {wid} if wid else set()
    to_delete = body.exam_ids_to_delete_on_success or []
    for raw_id in to_delete:
        did = str(raw_id).strip()
        if not did or did in skip_delete:
            continue
        try:
            if exam_yaml_path(root, did).is_file():
                delete_exam_workspace(root, did)
        except Exception:
            log.warning("delete exam workspace after export success failed: %s", did)

    return {
        "ok": True,
        "exam_dir": rel.as_posix(),
        "student_pdf": s_name,
        "teacher_pdf": t_name,
    }


@app.post("/api/exam/export-word")
def exam_export_word(body: ExamExportBody) -> dict[str, Any]:
    root = _require_root()
    tpl, tpl_rel = resolve_template_under_project(root, body.template_path, body.template_ref)
    assert_within_project(root, tpl)
    if not tpl.is_file():
        raise HTTPException(status_code=400, detail=f"Template file not found: {body.template_path}")

    title = body.metadata_title or body.export_label
    metadata: dict[str, Any] = {
        "title": title,
        "subject": body.subject,
        "export_label": body.export_label,
    }
    from solaire.common.actor_context import actor
    export_actor = actor.get()
    if export_actor and export_actor.get("role") == "teacher":
        metadata["owner_teacher_id"] = str(export_actor["id"])
    sections = _draft_to_sections(body)

    log = logging.getLogger(__name__)
    backup = snapshot_build_yaml_before_export(root)
    try:
        exam_yaml = write_build_exam_yaml(
            root,
            exam_id="web_export",
            template_ref=body.template_ref,
            template_relative=tpl_rel,
            metadata=metadata,
            selected_items=sections,
        )
        run_validate(root, exam_yaml)
        template = load_template(tpl)
        dest_dir: Path
        if body.overwrite_existing:
            dest_dir = _assert_overwrite_target(
                root, body.overwrite_existing, body.export_label, body.subject
            )
        else:
            wid = str(body.exam_workspace_id or "").strip()
            if wid:
                dest_dir = exam_yaml_path(root, wid).parent.resolve()
            else:
                try:
                    dest_dir = exam_yaml_path(
                        root, exam_id_from_labels(body.export_label, body.subject)
                    ).parent.resolve()
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e)) from e
        _assert_export_destination_owner(root, dest_dir, str(metadata.get("owner_teacher_id") or "") or None)
        result_dir, s_name, t_name = export_docx(
            root,
            exam_yaml=exam_yaml,
            export_label=body.export_label,
            subject=body.subject,
            template=template,
            dest_dir=dest_dir,
        )
    except ValueError as e:
        restore_build_yaml_from_backup(root, backup)
        log.warning("exam Word export validation failed: %s", e)
        raise HTTPException(status_code=400, detail=_exam_export_failure_detail(root, body, e)) from e
    except FileNotFoundError as e:
        restore_build_yaml_from_backup(root, backup)
        log.warning("exam Word export file not found: %s", e)
        raise HTTPException(status_code=400, detail=_exam_export_failure_detail(root, body, e)) from e
    except RuntimeError as e:
        restore_build_yaml_from_backup(root, backup)
        log.exception("exam Word export build failed")
        raise HTTPException(status_code=500, detail=_exam_export_failure_detail(root, body, e)) from e
    except Exception as e:
        restore_build_yaml_from_backup(root, backup)
        log.exception("exam Word export failed")
        raise HTTPException(status_code=500, detail=_exam_export_failure_detail(root, body, e)) from e
    else:
        discard_build_yaml_backup(backup)

    rel = result_dir.relative_to(root)
    wid = str(body.exam_workspace_id or "").strip()
    mark_id = wid
    if not mark_id:
        try:
            mark_id = exam_id_from_labels(body.export_label, body.subject)
        except ValueError:
            mark_id = ""
    if mark_id:
        try:
            mark_exported(root, mark_id)
        except Exception:
            log.warning("mark exam workspace exported failed: %s", mark_id, exc_info=True)

    skip_delete = {wid} if wid else set()
    to_delete = body.exam_ids_to_delete_on_success or []
    for raw_id in to_delete:
        did = str(raw_id).strip()
        if not did or did in skip_delete:
            continue
        try:
            if exam_yaml_path(root, did).is_file():
                delete_exam_workspace(root, did)
        except Exception:
            log.warning("delete exam workspace after Word export success failed: %s", did)

    return {
        "ok": True,
        "exam_dir": rel.as_posix(),
        "student_docx": s_name,
        "teacher_docx": t_name,
    }

@app.post("/api/exam/export/check-conflict")
def exam_export_check_conflict(body: ExamExportConflictBody) -> dict[str, Any]:
    root = _require_root()
    return find_export_conflict(root, body.export_label, body.subject)


_PREVIEW_CACHE_MAX_SEC = 3600
_PREVIEW_CACHE_MAX_DIRS = 48


def _cleanup_old_previews(root: Path) -> None:
    prev_root = root / ".solaire" / "previews"
    if not prev_root.is_dir():
        return
    now = time.time()
    entries = [p for p in prev_root.iterdir() if p.is_dir()]
    entries.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for i, d in enumerate(entries):
        try:
            age = now - d.stat().st_mtime
            if age > _PREVIEW_CACHE_MAX_SEC or i >= _PREVIEW_CACHE_MAX_DIRS:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            continue


@app.post("/api/exam/preview-pdf")
def exam_preview_pdf(body: ExamExportBody) -> dict[str, Any]:
    """
    Build a non-strict preview PDF under .solaire/previews/<id>/ (not under result/).
    """
    root = _require_root()
    tpl, tpl_rel = resolve_template_under_project(root, body.template_path, body.template_ref)
    assert_within_project(root, tpl)
    if not tpl.is_file():
        raise HTTPException(status_code=400, detail=f"Template file not found: {body.template_path}")

    title = body.metadata_title or body.export_label
    metadata: dict[str, Any] = {
        "title": title,
        "subject": body.subject,
        "export_label": body.export_label,
    }
    sections = _draft_to_sections(body)
    preview_id = uuid.uuid4().hex
    preview_dir = root / ".solaire" / "previews" / preview_id
    _cleanup_old_previews(root)

    log = logging.getLogger(__name__)
    try:
        exam_yaml = write_preview_exam_yaml(
            root,
            preview_dir,
            exam_id=f"preview_{preview_id}",
            template_ref=body.template_ref,
            template_relative=tpl_rel,
            metadata=metadata,
            selected_items=sections,
        )
        s_name, t_name, warnings = export_preview_pdfs(
            root,
            exam_yaml=exam_yaml,
            export_label=body.export_label,
            subject=body.subject,
        )
    except ValueError as e:
        log.warning("exam preview validation failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        log.exception("exam preview PDF build failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        log.exception("exam preview failed")
        raise HTTPException(status_code=500, detail=exam_export_error_detail_short(e)) from e

    manifest = {"student_pdf": s_name, "teacher_pdf": t_name}
    (preview_dir / "preview_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )

    return {
        "ok": True,
        "preview_id": preview_id,
        "student_pdf": s_name,
        "teacher_pdf": t_name,
        "warnings": warnings,
    }


@app.get("/api/exam/preview-pdf/{preview_id}/file")
def exam_preview_pdf_file(
    preview_id: str,
    variant: str = Query("student", description="student 或 teacher"),
) -> FileResponse:
    root = _require_root()
    vid = (preview_id or "").strip()
    if not vid or not all(c in "0123456789abcdef" for c in vid.lower()) or len(vid) > 64:
        raise HTTPException(status_code=400, detail="Invalid preview id")
    preview_dir = (root / ".solaire" / "previews" / vid).resolve()
    try:
        preview_dir.relative_to(root.resolve())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid preview path") from e
    if not preview_dir.is_dir():
        raise HTTPException(status_code=404, detail="预览已过期或不存在")
    manifest_path = preview_dir / "preview_manifest.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=404, detail="预览文件缺失")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail="预览清单损坏") from e
    v = variant.strip().lower()
    if v not in ("student", "teacher"):
        raise HTTPException(status_code=400, detail="variant 须为 student 或 teacher")
    key = "teacher_pdf" if v == "teacher" else "student_pdf"
    fname = manifest.get(key)
    if not fname or not isinstance(fname, str):
        raise HTTPException(status_code=500, detail="预览清单缺少文件名")
    path = (preview_dir / fname).resolve()
    try:
        path.relative_to(preview_dir.resolve())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid file path") from e
    if not path.is_file():
        raise HTTPException(status_code=404, detail="预览文件不存在")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=path.name,
        content_disposition_type="inline",
    )


@app.get("/api/exams")
def exams_list(
    status: str | None = Query(None, description="draft | exported | all（默认 all）"),
) -> dict[str, Any]:
    root = _require_root()
    rows = list_exam_workspaces(root)
    if status and status.strip().lower() != "all":
        s = status.strip().lower()
        if s not in ("draft", "exported"):
            raise HTTPException(status_code=400, detail="status 须为 draft、exported 或 all")
        rows = [r for r in rows if str(r.get("status") or "draft") == s]
    return {"exams": rows}


_exam_creation_lock = Lock()


@app.post("/api/exams")
def exams_create(body: ExamSaveDraftBody) -> dict[str, Any]:
    root = _require_root()
    items = [s.model_dump(mode="json", exclude_none=True) for s in body.selected_items]
    try:
        with _exam_creation_lock:
            export_label = body.export_label.strip()
            if body.auto_rename:
                from solaire.web.content_names import available_name
                from solaire.web.exam_workspace_service import label_subject_taken

                taken: list[str] = []
                while label_subject_taken(root, export_label, body.subject):
                    taken.append(export_label)
                    export_label = available_name(body.export_label.strip(), taken, max_length=80)
            doc = save_exam_workspace(
                root,
                exam_id=None,
                name=body.name,
                subject=body.subject,
                export_label=export_label,
                template_ref=body.template_ref,
                template_path=body.template_path,
                selected_items=items,
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "exam": doc}


@app.get("/api/exams/analysis-list")
def exams_analysis_list() -> dict[str, Any]:
    """成绩分析用：列出含 ``exam.yaml`` 的考试目录（新接口，替代原 ``/api/results`` 列表）。"""
    from solaire.common.actor_context import actor
    from solaire.web.platform_db import connect, default_platform_root

    root = _require_root()
    exams = list_exam_results(root)
    user = actor.get()
    if user and user.get("role") == "teacher":
        teacher_id = str(user.get("id") or "")
        with connect(default_platform_root()) as con:
            owners = {
                str(row["exam_id"]): str(row["owner_teacher_id"] or "")
                for row in con.execute("SELECT exam_id, owner_teacher_id FROM paper_records").fetchall()
            }
        exams = [
            exam for exam in exams
            if (owners.get(str(exam["exam_id"])) or str(exam.get("owner_teacher_id") or "")) == teacher_id
        ]
    return {"exams": exams}


@app.post("/api/exams/from-exam/{exam_path:path}")
def exams_from_exam(exam_path: str, body: CopyFromExamBody) -> dict[str, Any]:
    root = _require_root()
    try:
        doc = create_workspace_from_exam(root, exam_path, export_label=body.export_label)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "exam": doc}


@app.get("/api/exams/download/{exam_path:path}")
def exams_download_bundle(
    exam_path: str,
    format: str = Query("pdf", description="pdf 或 docx"),
) -> Response:
    """Download the actual exported student/teacher files as one ZIP."""
    import io
    import zipfile
    from urllib.parse import quote
    from solaire.common.actor_context import actor
    from solaire.web.platform_db import connect, default_platform_root

    root = _require_root()
    user = actor.get()
    if not user or user.get("role") not in {"teacher", "admin"}:
        raise HTTPException(status_code=403, detail="只有教师或管理员可以下载试卷")
    if format not in {"pdf", "docx"}:
        raise HTTPException(status_code=400, detail="format 须为 pdf 或 docx")
    if user.get("role") == "teacher":
        with connect(default_platform_root()) as con:
            row = con.execute("SELECT owner_teacher_id FROM paper_records WHERE exam_id=?", (exam_path,)).fetchone()
        if row is None or str(row["owner_teacher_id"] or "") != str(user.get("id")):
            raise HTTPException(status_code=403, detail="无权下载此试卷")
    finder = find_exported_pdf_path if format == "pdf" else find_exported_docx_path
    try:
        files = [finder(root, exam_path, variant=variant) for variant in ("student", "teacher")]
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for path in files:
            target.write(path, arcname=path.name)
    filename = f"{Path(exam_path).name}-{format}-学生版与教师版.zip"
    return Response(
        archive.getvalue(), media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@app.get("/api/exams/{exam_path:path}/pdf-file")
def exams_pdf_file(
    exam_path: str,
    variant: str = Query("student", description="student 或 teacher"),
) -> FileResponse:
    """内联预览已导出 PDF。"""
    root = _require_root()
    v = variant.strip().lower()
    if v not in ("student", "teacher"):
        raise HTTPException(status_code=400, detail="variant 须为 student 或 teacher")
    try:
        path = find_exported_pdf_path(root, exam_path, variant=v)  # type: ignore[arg-type]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=path.name,
        content_disposition_type="inline",
    )


@app.post("/api/exams/{exam_path:path}/open-pdf")
def exams_open_pdf(
    exam_path: str,
    body: OpenResultPdfBody | None = Body(default=None),
) -> dict[str, Any]:
    """使用系统默认应用打开 PDF（仅本地后端）。"""
    root = _require_root()
    raw = (body.variant if body else "student").strip().lower()
    if raw not in ("student", "teacher"):
        raise HTTPException(status_code=400, detail="variant 须为 student 或 teacher")
    try:
        path = find_exported_pdf_path(root, exam_path, variant=raw)  # type: ignore[arg-type]
        open_pdf_with_default_app(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"无法通过系统打开文件: {e}") from e
    return {"ok": True}


@app.get("/api/exams/{exam_path:path}/docx-file")
def exams_docx_file(
    exam_path: str,
    variant: str = Query("student", description="student 或 teacher"),
) -> FileResponse:
    """Download an exported Word document."""
    root = _require_root()
    v = variant.strip().lower()
    if v not in ("student", "teacher"):
        raise HTTPException(status_code=400, detail="variant 须为 student 或 teacher")
    try:
        path = find_exported_docx_path(root, exam_path, variant=v)  # type: ignore[arg-type]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=path.name,
        content_disposition_type="attachment",
    )


@app.post("/api/exams/{exam_path:path}/open-docx")
def exams_open_docx(
    exam_path: str,
    body: OpenResultPdfBody | None = Body(default=None),
) -> dict[str, Any]:
    """Open a Word document with the OS default handler (local backend only)."""
    root = _require_root()
    raw = (body.variant if body else "student").strip().lower()
    if raw not in ("student", "teacher"):
        raise HTTPException(status_code=400, detail="variant 须为 student 或 teacher")
    try:
        path = find_exported_docx_path(root, exam_path, variant=raw)  # type: ignore[arg-type]
        open_docx_with_default_app(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"无法通过系统打开文件: {e}") from e
    return {"ok": True}

@app.get("/api/exams/{exam_path:path}/summary")
def exams_summary(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return get_exam_summary(root, exam_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/exams/{exam_path:path}/score-template")
def exams_score_template(exam_path: str) -> Response:
    root = _require_root()
    try:
        csv_content, filename = generate_score_template(root, exam_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return Response(
        content=csv_content.encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": content_disposition_attachment(filename)},
    )


@app.post("/api/exams/{exam_path:path}/scores")
async def exams_scores_import(exam_path: str, file: UploadFile = File(...)) -> dict[str, Any]:
    root = _require_root()
    try:
        content = await file.read()
        result = import_scores(root, exam_path, content, file.filename or "scores.csv")
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/exams/{exam_path:path}/scores")
def exams_scores_list(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    try:
        summary = get_exam_summary(root, exam_path)
        return {"batches": summary.get("score_batches", [])}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/exams/{exam_path:path}/scores/{batch_id}")
def exams_score_analysis(exam_path: str, batch_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return get_score_analysis(root, exam_path, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/exams/{exam_path:path}/scores/{batch_id}/recompute")
def exams_score_recompute(exam_path: str, batch_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return compute_statistics(root, exam_path, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.delete("/api/exams/{exam_path:path}/scores/{batch_id}")
def exams_score_batch_delete(exam_path: str, batch_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return delete_score_batch(root, exam_path, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/exams/{exam_path:path}")
def exams_get(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    try:
        doc = load_exam_workspace(root, exam_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="考试工作区不存在") from None
    return {"exam": doc}


@app.put("/api/exams/{exam_path:path}")
def exams_put(exam_path: str, body: ExamSaveDraftBody) -> dict[str, Any]:
    root = _require_root()
    items = [s.model_dump(mode="json", exclude_none=True) for s in body.selected_items]
    try:
        doc = save_exam_workspace(
            root,
            exam_id=exam_path,
            name=body.name,
            subject=body.subject,
            export_label=body.export_label,
            template_ref=body.template_ref,
            template_path=body.template_path,
            selected_items=items,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="考试工作区不存在") from None
    return {"ok": True, "exam": doc}


@app.delete("/api/exams/{exam_path:path}")
def exams_delete(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    if not exam_yaml_path(root, exam_path).is_file():
        raise HTTPException(status_code=404, detail="考试工作区不存在")
    delete_exam_workspace(root, exam_path)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Result / Score Analysis
# ---------------------------------------------------------------------------


