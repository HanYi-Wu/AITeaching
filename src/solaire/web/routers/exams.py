"""routers exams."""

from __future__ import annotations

from solaire.web.export_workflow import _draft_to_sections, export_exam

import json
import logging
import shutil
import time
import uuid
from pathlib import Path
from threading import Lock
from typing import Any
from fastapi import Body, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from solaire.web.result_service import compute_statistics, delete_score_batch, find_exported_docx_path, find_exported_pdf_path, generate_score_template, get_exam_summary, get_score_analysis, import_scores, list_exam_results, open_docx_with_default_app, open_pdf_with_default_app
from solaire.web.exam_workspace_service import create_workspace_from_exam, delete_exam_workspace, exam_yaml_path, list_exam_workspaces, load_exam_workspace, resolve_template_under_project, save_exam_workspace
from solaire.web.exam_service import VALIDATE_EXAM_NAME, exam_export_error_detail_short, export_preview_pdfs, find_export_conflict, run_validate, write_exam_yaml, write_preview_exam_yaml
from solaire.web.security import assert_within_project, content_disposition_attachment
from fastapi import APIRouter
from solaire.web.request_context import _require_root
from solaire.web.schemas.exams import CopyFromExamBody, ExamDraftBody, ExamExportBody, ExamExportConflictBody, ExamSaveDraftBody, OpenResultPdfBody

router = APIRouter()

_PREVIEW_CACHE_MAX_SEC = 3600
_PREVIEW_CACHE_MAX_DIRS = 48


@router.post("/api/exam/validate")
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


@router.post("/api/exam/export")
def exam_export(body: ExamExportBody) -> dict[str, Any]:
    return export_exam(_require_root(), body, format="pdf")


@router.post("/api/exam/export-word")
def exam_export_word(body: ExamExportBody) -> dict[str, Any]:
    return export_exam(_require_root(), body, format="docx")


@router.post("/api/exam/export/check-conflict")
def exam_export_check_conflict(body: ExamExportConflictBody) -> dict[str, Any]:
    root = _require_root()
    return find_export_conflict(root, body.export_label, body.subject)


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


@router.post("/api/exam/preview-pdf")
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


@router.get("/api/exam/preview-pdf/{preview_id}/file")
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


@router.get("/api/exams")
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


@router.post("/api/exams")
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


@router.get("/api/exams/analysis-list")
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


@router.post("/api/exams/from-exam/{exam_path:path}")
def exams_from_exam(exam_path: str, body: CopyFromExamBody) -> dict[str, Any]:
    root = _require_root()
    try:
        doc = create_workspace_from_exam(root, exam_path, export_label=body.export_label)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "exam": doc}


@router.get("/api/exams/download/{exam_path:path}")
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


@router.get("/api/exams/{exam_path:path}/pdf-file")
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


@router.post("/api/exams/{exam_path:path}/open-pdf")
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


@router.get("/api/exams/{exam_path:path}/docx-file")
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


@router.post("/api/exams/{exam_path:path}/open-docx")
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


@router.get("/api/exams/{exam_path:path}/summary")
def exams_summary(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return get_exam_summary(root, exam_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/api/exams/{exam_path:path}/score-template")
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


@router.post("/api/exams/{exam_path:path}/scores")
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


@router.get("/api/exams/{exam_path:path}/scores")
def exams_scores_list(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    try:
        summary = get_exam_summary(root, exam_path)
        return {"batches": summary.get("score_batches", [])}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/api/exams/{exam_path:path}/scores/{batch_id}")
def exams_score_analysis(exam_path: str, batch_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return get_score_analysis(root, exam_path, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/exams/{exam_path:path}/scores/{batch_id}/recompute")
def exams_score_recompute(exam_path: str, batch_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return compute_statistics(root, exam_path, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/api/exams/{exam_path:path}/scores/{batch_id}")
def exams_score_batch_delete(exam_path: str, batch_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return delete_score_batch(root, exam_path, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/api/exams/{exam_path:path}")
def exams_get(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    try:
        doc = load_exam_workspace(root, exam_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="考试工作区不存在") from None
    return {"exam": doc}


@router.put("/api/exams/{exam_path:path}")
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


@router.delete("/api/exams/{exam_path:path}")
def exams_delete(exam_path: str) -> dict[str, Any]:
    root = _require_root()
    if not exam_yaml_path(root, exam_path).is_file():
        raise HTTPException(status_code=404, detail="考试工作区不存在")
    delete_exam_workspace(root, exam_path)
    return {"ok": True}
