"""Shared PDF and Word export orchestration, independent of API routes."""

from __future__ import annotations

from solaire.web.export_policy import (
    assert_destination_owner as _assert_export_destination_owner,
    resolve_overwrite_target as _assert_overwrite_target,
)

import logging
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException
from solaire.web.export_cleanup import cleanup_revision
from solaire.exam_compiler.facade import SelectedSection, load_template
from solaire.web.schemas.exams import ExamDraftBody, ExamExportBody
from solaire.web.exam_service import (
    discard_build_yaml_backup,
    exam_export_error_detail_short,
    export_docx,
    export_pdfs,
    prepare_export_exam as run_validate,
    restore_build_yaml_from_backup,
    snapshot_build_yaml_before_export,
    write_build_exam_yaml,
)
from solaire.web.exam_workspace_service import (
    delete_exam_workspace,
    exam_id_from_labels,
    exam_yaml_path,
    mark_exported,
    resolve_template_under_project,
    save_exam_workspace_after_export_failure,
)
from solaire.web.security import assert_within_project
from solaire.web.export_lock import ExportBusyError, project_export_lock

ExportFormat = Literal["pdf", "docx"]


def _export_destination(root: Path, body: ExamExportBody) -> Path:
    if body.overwrite_existing:
        return _assert_overwrite_target(
            root, body.overwrite_existing, body.export_label, body.subject
        )
    exam_id = str(body.exam_workspace_id or "").strip()
    if not exam_id:
        exam_id = exam_id_from_labels(body.export_label, body.subject)
    return exam_yaml_path(root, exam_id).parent.resolve()


def _completion_plan(
    root: Path,
    body: ExamExportBody,
    destination: Path,
    teacher_id: str | None,
) -> tuple[str, dict[str, str]]:
    """Authorize status updates and cleanup before compiler/workspace writes."""
    candidates = {}
    workspace_id = str(body.exam_workspace_id or "").strip()
    mark_id = workspace_id or exam_id_from_labels(body.export_label, body.subject)
    mark_path = exam_yaml_path(root, mark_id)
    if mark_path.parent.resolve() != destination:
        _assert_export_destination_owner(root, mark_path.parent, teacher_id)
    for raw_id in body.exam_ids_to_delete_on_success or []:
        exam_id = str(raw_id).strip()
        if not exam_id or exam_id == workspace_id or exam_id in candidates:
            continue
        path = exam_yaml_path(root, exam_id)
        if path.parent.resolve() == destination:
            continue
        _assert_export_destination_owner(root, path.parent, teacher_id)
        revision = cleanup_revision(root, exam_id)
        if revision is not None:
            candidates[exam_id] = revision
    return mark_id, candidates


def _complete_export(
    root: Path,
    mark_id: str,
    cleanup_ids: dict[str, str],
    teacher_id: str | None,
) -> list[str]:
    log = logging.getLogger(__name__)
    deleted_ids = []
    if mark_id:
        try:
            _assert_export_destination_owner(
                root, exam_yaml_path(root, mark_id).parent, teacher_id
            )
            mark_exported(root, mark_id)
        except Exception:
            log.warning(
                "mark exam workspace exported failed: %s", mark_id, exc_info=True
            )
    for exam_id, revision in cleanup_ids.items():
        try:
            path = exam_yaml_path(root, exam_id)
            if path.is_file():
                # A long-running compiler must not grant stale cleanup permission.
                _assert_export_destination_owner(root, path.parent, teacher_id)
                if cleanup_revision(root, exam_id) == revision:
                    delete_exam_workspace(root, exam_id)
                    deleted_ids.append(exam_id)
        except Exception:
            log.warning(
                "delete exam workspace after export success failed: %s",
                exam_id,
                exc_info=True,
            )
    return deleted_ids


def export_exam(
    root: Path, body: ExamExportBody, *, format: ExportFormat
) -> dict[str, Any]:
    """Run one format through the same permission, recovery and cleanup boundary."""
    try:
        with project_export_lock(root):
            return _export_locked(root, body, format=format)
    except ExportBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _export_locked(
    root: Path, body: ExamExportBody, *, format: ExportFormat
) -> dict[str, Any]:
    if format not in {"pdf", "docx"}:
        raise ValueError("Unsupported export format")
    root = root.resolve()
    template_path, template_relative = resolve_template_under_project(
        root, body.template_path, body.template_ref
    )
    assert_within_project(root, template_path)
    if not template_path.is_file():
        raise HTTPException(
            status_code=400, detail=f"Template file not found: {body.template_path}"
        )
    from solaire.common.actor_context import actor

    user = actor.get()
    teacher_id = str(user["id"]) if user and user.get("role") == "teacher" else None
    try:
        destination = _export_destination(root, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Permissions are checked before writing the shared build configuration.
    _assert_export_destination_owner(root, destination, teacher_id)
    try:
        mark_id, cleanup_ids = _completion_plan(root, body, destination, teacher_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    metadata = {
        "title": body.metadata_title or body.export_label,
        "subject": body.subject,
        "export_label": body.export_label,
    }
    if teacher_id:
        metadata["owner_teacher_id"] = teacher_id
    backup = snapshot_build_yaml_before_export(root)
    try:
        exam_yaml = write_build_exam_yaml(
            root,
            exam_id="web_export",
            template_ref=body.template_ref,
            template_relative=template_relative,
            metadata=metadata,
            selected_items=_draft_to_sections(body),
        )
        prepared = run_validate(root, exam_yaml)
        builder = export_pdfs if format == "pdf" else export_docx
        result_dir, student_name, teacher_name = builder(
            root,
            exam_yaml=exam_yaml,
            export_label=body.export_label,
            subject=body.subject,
            template=prepared.template if prepared is not None else load_template(template_path),
            dest_dir=destination,
            **({"prepared": prepared} if prepared is not None else {}),
        )
    except HTTPException:
        restore_build_yaml_from_backup(root, backup)
        raise
    except Exception as exc:
        restore_build_yaml_from_backup(root, backup)
        status = 400 if isinstance(exc, (ValueError, FileNotFoundError)) else 500
        logging.getLogger(__name__).warning("%s export failed", format, exc_info=True)
        raise HTTPException(
            status_code=status, detail=_exam_export_failure_detail(root, body, exc)
        ) from exc
    else:
        discard_build_yaml_backup(backup)
    deleted_ids = _complete_export(root, mark_id, cleanup_ids, teacher_id)
    return {
        "ok": True,
        "exam_dir": result_dir.relative_to(root).as_posix(),
        f"student_{format}": student_name,
        f"teacher_{format}": teacher_name,
        "deleted_exam_ids": deleted_ids,
    }


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


def _exam_export_failure_detail(
    root: Path, body: ExamExportBody, exc: BaseException
) -> dict[str, Any]:
    """Structured HTTP detail: message + optional exam_saved after restore."""
    log = logging.getLogger(__name__)
    doc: dict[str, Any] | None = None
    try:
        items = [
            s.model_dump(mode="json", exclude_none=True) for s in body.selected_items
        ]
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

    msg = (
        exam_export_error_detail_short(exc)
        if isinstance(exc, Exception)
        else str(exc).strip()
    )
    if not msg:
        msg = "导出失败，请查看运行日志。"
    detail: dict[str, Any] = {"message": msg}
    if doc:
        detail["exam_saved"] = {
            "exam_id": str(doc.get("exam_id") or ""),
            "name": str(doc.get("name") or ""),
        }
    return detail
