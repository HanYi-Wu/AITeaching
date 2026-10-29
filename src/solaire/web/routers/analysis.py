"""routers analysis."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from typing import Annotated
from fastapi import Depends, HTTPException, Query
from solaire.edu_analysis.core import delete_script_api, get_job, get_script_api, invoke_tool, list_jobs_api, list_scripts_api, list_tools, run_builtin, run_script_with_request_id, save_script_doc
from solaire.edu_analysis.diagnosis import class_heatmap_v1, knowledge_diagnosis_v1, student_knowledge_diagnosis_v1, teaching_suggestions_v1
from solaire.web.analysis_folders import AnalysisFoldersCorruptError, mutate as mutate_analysis_folders, read as read_analysis_folders, visible_item_ids as visible_analysis_item_ids
from solaire.web.auth_api import require_platform_root
from solaire.web.export_lock import ExportBusyError
from solaire.web.security import assert_within_project
from solaire.web.remediation_service import create_remediation_draft, plan_remediation_draft
from solaire.web.papers.api_support import current_organizer_teacher, require_content_project_root
from fastapi import APIRouter
from solaire.web.request_context import _require_root
from solaire.web.schemas.analysis import AnalysisRemediationDraftBody, AnalysisRunBuiltinBody, AnalysisRunFolderScriptBody, AnalysisRunScriptBody, AnalysisScriptBody, AnalysisToolInvokeBody
from solaire.web.schemas.analysis_folders import AnalysisFolderMutationBody

router = APIRouter()


@router.get("/api/analysis/folders")
def analysis_folders_list(
    user: Annotated[dict[str, Any], Depends(current_organizer_teacher)],
) -> dict[str, Any]:
    project_root = require_content_project_root()
    try:
        return read_analysis_folders(project_root, owner_id=str(user["id"]))
    except ExportBusyError as exc:
        raise HTTPException(status_code=503, detail="分析文件夹正在更新，请稍后重试") from exc
    except AnalysisFoldersCorruptError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, PermissionError) else 400, detail=str(exc)) from exc


@router.post("/api/analysis/folders")
def analysis_folders_mutate(
    body: AnalysisFolderMutationBody,
    user: Annotated[dict[str, Any], Depends(current_organizer_teacher)],
) -> dict[str, Any]:
    project_root = require_content_project_root()
    owner_id = str(user["id"])
    try:
        visible_ids = (
            visible_analysis_item_ids(project_root, require_platform_root(), owner_id=owner_id)
            if body.action in {"assign", "move"}
            else set()
        )
        return mutate_analysis_folders(
            project_root,
            owner_id=owner_id,
            action=body.action,
            folder_id=body.folder_id,
            name=body.name,
            ids=body.ids,
            visible_item_ids=visible_ids,
        )
    except ExportBusyError as exc:
        raise HTTPException(status_code=503, detail="分析文件夹正在更新，请稍后重试") from exc
    except AnalysisFoldersCorruptError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, PermissionError) else 400, detail=str(exc)) from exc


def _resolve_under_analysis(root: Path, rel: str) -> Path:
    analysis_root = (root / "analysis").resolve()
    analysis_root.mkdir(parents=True, exist_ok=True)
    normalized = rel.strip().replace("\\", "/").lstrip("/")
    target = (analysis_root / normalized).resolve()
    try:
        target.relative_to(analysis_root)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="script_path must stay under analysis/") from e
    assert_within_project(root, target)
    return target


@router.get("/api/analysis/diagnosis/knowledge")
def analysis_diagnosis_knowledge(
    exam_id: str = Query(..., min_length=1),
    batch_id: str = Query(..., min_length=1),
) -> dict[str, Any]:
    root = _require_root()
    try:
        return knowledge_diagnosis_v1(root, exam_id, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/analysis/diagnosis/student")
def analysis_diagnosis_student(
    exam_id: str = Query(..., min_length=1),
    batch_id: str = Query(..., min_length=1),
    student_id: str | None = Query(None, description="学号；不传则返回全班"),
) -> dict[str, Any]:
    root = _require_root()
    try:
        return student_knowledge_diagnosis_v1(root, exam_id, batch_id, student_id=student_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/analysis/diagnosis/class-heatmap")
def analysis_diagnosis_class_heatmap(
    exam_id: str = Query(..., min_length=1),
    batch_id: str = Query(..., min_length=1),
) -> dict[str, Any]:
    root = _require_root()
    try:
        return class_heatmap_v1(root, exam_id, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/analysis/diagnosis/suggestions")
def analysis_diagnosis_suggestions(
    exam_id: str = Query(..., min_length=1),
    batch_id: str = Query(..., min_length=1),
) -> dict[str, Any]:
    root = _require_root()
    try:
        return teaching_suggestions_v1(root, exam_id, batch_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/analysis/remediation-draft-preview")
def analysis_remediation_draft_preview(
    exam_id: str = Query(..., min_length=1),
    batch_id: str = Query(..., min_length=1),
    weak_limit: int = Query(default=5, ge=1, le=20),
    practice_per_node: int = Query(default=4, ge=1, le=50),
    exclude_source_exam_questions: bool = Query(default=True),
    source_batch_id: str | None = Query(None),
) -> dict[str, Any]:
    root = _require_root()
    try:
        return plan_remediation_draft(
            root,
            exam_id=exam_id,
            batch_id=batch_id,
            weak_limit=weak_limit,
            practice_per_node=practice_per_node,
            exclude_source_exam_questions=exclude_source_exam_questions,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/analysis/remediation-drafts")
def analysis_remediation_drafts_create(body: AnalysisRemediationDraftBody) -> dict[str, Any]:
    root = _require_root()
    try:
        return create_remediation_draft(
            root,
            exam_id=body.exam_id,
            batch_id=body.batch_id,
            weak_limit=body.weak_limit,
            practice_per_node=body.practice_per_node,
            exclude_source_exam_questions=body.exclude_source_exam_questions,
            template_ref=body.template_ref,
            template_path=body.template_path,
            export_label=body.export_label,
            source_batch_id=body.source_batch_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/analysis/tools")
def analysis_tools_list() -> dict[str, Any]:
    _require_root()
    return {"tools": list_tools()}


@router.post("/api/analysis/tools/{tool_name:path}")
def analysis_tool_invoke(tool_name: str, body: AnalysisToolInvokeBody) -> dict[str, Any]:
    root = _require_root()
    try:
        return invoke_tool(root, tool_name, body.arguments)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/analysis/scripts")
def analysis_scripts_list() -> dict[str, Any]:
    root = _require_root()
    return list_scripts_api(root)


@router.post("/api/analysis/scripts")
def analysis_scripts_save(body: AnalysisScriptBody) -> dict[str, Any]:
    root = _require_root()
    try:
        return save_script_doc(
            root,
            script_id=body.script_id,
            name=body.name,
            language=body.language,
            code=body.code,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/api/analysis/scripts/{script_id}")
def analysis_script_get(script_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return get_script_api(root, script_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.delete("/api/analysis/scripts/{script_id}")
def analysis_script_delete(script_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return delete_script_api(root, script_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/api/analysis/jobs/builtin")
def analysis_job_run_builtin(body: AnalysisRunBuiltinBody) -> dict[str, Any]:
    root = _require_root()
    try:
        return run_builtin(
            root,
            builtin_id=body.builtin_id,
            exam_id=body.exam_id,
            batch_id=body.batch_id,
            recompute=body.recompute,
            request_id=body.request_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/analysis/jobs/script")
def analysis_job_run_script(body: AnalysisRunScriptBody) -> dict[str, Any]:
    root = _require_root()
    try:
        return run_script_with_request_id(
            root,
            script_id=body.script_id,
            exam_id=body.exam_id,
            batch_id=body.batch_id,
            request_id=body.request_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/api/analysis/folder-scripts")
def analysis_folder_scripts_list() -> dict[str, Any]:
    root = _require_root()
    analysis_root = (root / "analysis").resolve()
    analysis_root.mkdir(parents=True, exist_ok=True)
    scripts: list[dict[str, Any]] = []
    for p in sorted(analysis_root.rglob("*.py"), key=lambda x: x.stat().st_mtime, reverse=True):
        rel = p.relative_to(analysis_root).as_posix()
        scripts.append(
            {
                "path": rel,
                "name": p.name,
                "updated_at": p.stat().st_mtime,
            }
        )
    return {"scripts": scripts}


@router.post("/api/analysis/jobs/script-from-folder")
def analysis_job_run_script_from_folder(body: AnalysisRunFolderScriptBody) -> dict[str, Any]:
    root = _require_root()
    target = _resolve_under_analysis(root, body.script_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"Script not found in analysis/: {body.script_path}")
    code = target.read_text(encoding="utf-8")
    saved = save_script_doc(root, name=f"folder:{target.name}", language="python", code=code)
    script_id = str(saved["script"]["script_id"])
    return run_script_with_request_id(
        root,
        script_id=script_id,
        exam_id=body.exam_id,
        batch_id=body.batch_id,
        request_id=body.request_id,
    )


@router.get("/api/analysis/jobs")
def analysis_jobs_list(limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    root = _require_root()
    return list_jobs_api(root, limit=limit)


@router.get("/api/analysis/jobs/{job_id}")
def analysis_job_get(job_id: str, include_output: bool = Query(True)) -> dict[str, Any]:
    root = _require_root()
    try:
        return get_job(root, job_id=job_id, include_output=include_output)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
