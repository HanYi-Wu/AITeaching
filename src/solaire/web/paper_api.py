"""FastAPI routes for paper management and online publishing."""

from __future__ import annotations

import sqlite3
import logging
import hashlib
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from solaire.web import state
from solaire.web.content_organizer import (
    all_item_tags, analyze_paper_folder, assign_folder_item, assign_paper_folder, create_folder, item_tags, list_folder_items, list_folders, list_tags,
    save_tag, set_item_tags, update_folder, delete_folder,
)
from solaire.web.analysis_report_service import (
    analysis_report_filename,
    build_paper_analysis_pdf,
    build_paper_analysis_workbook,
)
from solaire.web.adaptive_practice_service import (
    list_practice_history,
    publish_reinforcement_practice,
    publish_wrong_question_practice,
)
from solaire.web.auth_api import current_platform_user, require_platform_root
from solaire.web.paper_service import (
    analyze_paper,
    get_attempt_scan_image,
    get_teacher_student_profile,
    complete_paper_attempt_grading,
    grade_paper_answer,
    ingest_offline_submission,
    list_paper_publications,
    list_paper_submissions,
    list_teacher_class_students,
    list_teacher_classes,
    publish_online_paper,
    query_papers,
    revoke_paper_publication,
    suggest_ai_grades_for_attempt,
    sync_paper_for_exam,
    update_paper_publication,
    update_paper_delivery_mode,
)
from solaire.web.project_layout import ensure_project_layout

router = APIRouter()
logger = logging.getLogger(__name__)

OFFLINE_SCAN_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
OFFLINE_SCAN_MAX_FILES = 20
OFFLINE_SCAN_MAX_FILE_BYTES = 15 * 1024 * 1024
OFFLINE_SCAN_MAX_TOTAL_BYTES = 100 * 1024 * 1024
OFFLINE_UPLOADER_EXE = Path(__file__).resolve().parent / "assets" / "tools" / "EducationHelper-Offline-Answer-Uploader.exe"


def _normalize_offline_scan(name: str, content: bytes) -> tuple[str, str, bytes]:
    extension = Path(name).suffix.lower()
    try:
        if extension in {".heic", ".heif"}:
            from pillow_heif import register_heif_opener

            register_heif_opener()
        with Image.open(BytesIO(content)) as opened:
            if opened.width * opened.height > 50_000_000:
                raise ValueError("图片像素超过 5000 万")
            opened.load()
            image = ImageOps.exif_transpose(opened)
            output = BytesIO()
            if extension in {".jpg", ".jpeg"}:
                if image.mode not in {"RGB", "L"}:
                    image = image.convert("RGB")
                image.save(output, format="JPEG", quality=92, optimize=True)
                return f"{Path(name).stem}.jpg", "image/jpeg", output.getvalue()
            if image.mode not in {"RGB", "RGBA", "L"}:
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            image.save(output, format="PNG", optimize=True)
            return f"{Path(name).stem}.png", "image/png", output.getvalue()
    except (ImportError, OSError, UnidentifiedImageError, Image.DecompressionBombError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"文件 {name} 不是可读取的答卷图片：{exc}") from exc


class PaperUpdateBody(BaseModel):
    delivery_mode: Literal["offline", "online"]


class PaperFromExamBody(BaseModel):
    exam_id: str = Field(..., min_length=1)


class PaperPublishBody(BaseModel):
    class_ids: list[str] = Field(default_factory=list)
    student_ids: list[str] = Field(default_factory=list)
    folder_id: str | None = None
    title: str | None = None
    description: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    show_results_immediately: bool = False
    randomize_questions: bool = False
    randomize_answers: bool = False
    submission_mode: Literal["online", "image_manual", "image_ai"] = "online"
    max_screen_switches: int = Field(default=0, ge=0, le=999)
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)
    subject: str | None = Field(default=None, max_length=100)


class PaperPublicationUpdateBody(BaseModel):
    title: str | None = None
    description: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)
    show_results_immediately: bool | None = None
    status: str | None = None


class FolderCreateBody(BaseModel):
    scope: Literal["template", "compose", "paper"]
    name: str = Field(..., min_length=1, max_length=60)
    parent_id: str | None = None
    kind: Literal["category", "paper"] = "category"


class FolderUpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    parent_id: str | None = None
    move: bool = False
    kind: Literal["category", "paper"] | None = None


class TagBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=5)
    color: Literal["slate", "blue", "green", "amber", "rose", "violet"] = "slate"


class TagLinksBody(BaseModel):
    tag_ids: list[str] = Field(default_factory=list, max_length=20)


class FolderItemBody(BaseModel):
    scope: Literal["template", "compose"]
    item_id: str = Field(..., min_length=1)
    folder_id: str | None = None


class PaperAiGradeBody(BaseModel):
    question_ids: list[str] | None = None


class PaperAnswerGradeBody(BaseModel):
    score: float = Field(..., ge=0)
    feedback: str | None = None
    is_correct: bool | None = None


class PracticePublishBase(BaseModel):
    class_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1, max_length=200)
    start_at: str | None = None
    end_at: str | None = None
    show_results_immediately: bool = False
    submission_mode: Literal["online", "image_manual", "image_ai"] = "online"
    max_screen_switches: int = Field(default=0, ge=0, le=999)
    time_limit_minutes: int | None = Field(default=None, ge=0, le=1440)


class WrongQuestionPracticeBody(PracticePublishBase):
    source_publication_id: str = Field(..., min_length=1)
    max_questions_per_student: int = Field(default=20, ge=1, le=100)


class ReinforcementPracticeBody(PracticePublishBase):
    source_publication_ids: list[str] = Field(..., min_length=1)
    questions_per_student: int = Field(default=5, ge=1, le=20)


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, PermissionError):
        logger.warning("paper api permission denied: %s", exc, exc_info=True)
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, FileNotFoundError):
        logger.warning("paper api missing resource: %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if isinstance(exc, (ValueError, sqlite3.IntegrityError)):
        logger.warning("paper api invalid request: %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def require_content_project_root():
    root = state.get_content_root()
    ensure_project_layout(root)
    return root


def current_organizer_teacher(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    if user.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="此操作仅限教师")
    return user


@router.get("/tools/offline-answer-uploader.exe")
def download_offline_answer_uploader(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> FileResponse:
    if user.get("role") not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="仅教师或管理员可以下载线下答卷采集器")
    if not OFFLINE_UPLOADER_EXE.is_file():
        raise HTTPException(status_code=503, detail="线下答卷采集器尚未包含在当前构建中，请联系管理员重新生成发布包")
    checksum = hashlib.sha256(OFFLINE_UPLOADER_EXE.read_bytes()).hexdigest()
    return FileResponse(
        OFFLINE_UPLOADER_EXE,
        media_type="application/vnd.microsoft.portable-executable",
        filename="EducationHelper-Offline-Answer-Uploader.exe",
        headers={
            "X-EH-SHA256": checksum,
            "X-EH-Code-Signed": "false",
            # Legacy collector clients may still read the previous header names.
            "X-SolEdu-SHA256": checksum,
            "X-SolEdu-Code-Signed": "false",
        },
    )


@router.get("/papers")
def papers_list(
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    q: str | None = None,
    delivery_mode: str | None = None,
    status: str | None = None,
    subject: str | None = None,
    folder_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    platform_root = require_platform_root()
    project_root = require_content_project_root()
    try:
        result = query_papers(
            project_root,
            platform_root,
            user,
            q=q,
            delivery_mode=delivery_mode,
            status=status,
            subject=subject,
            folder_id=folder_id,
            page=page,
            page_size=page_size,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return result


@router.post("/papers/from-exam")
def papers_from_exam(
    body: PaperFromExamBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    platform_root = require_platform_root()
    project_root = require_content_project_root()
    try:
        paper = sync_paper_for_exam(project_root, platform_root, user, exam_id=body.exam_id)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"paper": paper}


@router.patch("/papers/{paper_id}")
def papers_update(
    paper_id: str,
    body: PaperUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        paper = update_paper_delivery_mode(root, paper_id, body.delivery_mode, user)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"paper": paper}


@router.get("/papers/{paper_id}/analysis")
def papers_analysis(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    publication_id: str | None = None,
    class_id: str | None = None,
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        analysis = analyze_paper(root, paper_id=paper_id, user=user, project_root=project_root, publication_id=publication_id, class_id=class_id)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"analysis": analysis}


@router.get("/papers/{paper_id}/analysis.xlsx")
def papers_analysis_xlsx(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    publication_id: str | None = None,
    class_id: str | None = None,
) -> StreamingResponse:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        analysis = analyze_paper(root, paper_id=paper_id, user=user, project_root=project_root, publication_id=publication_id, class_id=class_id)
        data = build_paper_analysis_workbook(analysis)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    filename = analysis_report_filename(analysis, "xlsx")
    return StreamingResponse(
        BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/papers/{paper_id}/analysis.pdf")
def papers_analysis_pdf(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    publication_id: str | None = None,
    class_id: str | None = None,
) -> StreamingResponse:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        analysis = analyze_paper(root, paper_id=paper_id, user=user, project_root=project_root, publication_id=publication_id, class_id=class_id)
        data = build_paper_analysis_pdf(analysis)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    filename = analysis_report_filename(analysis, "pdf")
    return StreamingResponse(
        BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/papers/{paper_id}/publications")
def papers_publications(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        publications = list_paper_publications(root, paper_id=paper_id, user=user)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publications": publications}


@router.get("/papers/{paper_id}/submissions")
def papers_submissions(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        submissions = list_paper_submissions(root, project_root, paper_id=paper_id, user=user)
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"submissions": submissions}


@router.post("/papers/{paper_id}/offline-submissions")
async def papers_offline_submission_upload(
    paper_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    class_id: Annotated[str, Form(...)],
    student_id: Annotated[str, Form(...)],
    files: Annotated[list[UploadFile], File(...)],
) -> dict[str, Any]:
    if not files or len(files) > OFFLINE_SCAN_MAX_FILES:
        raise HTTPException(status_code=400, detail=f"每名学生需上传 1-{OFFLINE_SCAN_MAX_FILES} 张答卷照片")
    payloads: list[dict[str, Any]] = []
    total_raw_size = 0
    total_size = 0
    for upload in files:
        name = Path(upload.filename or "").name
        extension = Path(name).suffix.lower()
        if extension not in OFFLINE_SCAN_EXTENSIONS:
            supported = "、".join(sorted(OFFLINE_SCAN_EXTENSIONS))
            raise HTTPException(status_code=400, detail=f"不支持文件 {name}；支持的答卷照片格式：{supported}")
        content = await upload.read(OFFLINE_SCAN_MAX_FILE_BYTES + 1)
        if not content:
            raise HTTPException(status_code=400, detail=f"文件 {name} 为空")
        if len(content) > OFFLINE_SCAN_MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"文件 {name} 超过 15MB")
        total_raw_size += len(content)
        if total_raw_size > OFFLINE_SCAN_MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="单份答卷原始照片总大小不能超过 100MB")
        normalized_name, normalized_mime, normalized_content = await run_in_threadpool(
            _normalize_offline_scan,
            name,
            content,
        )
        if len(normalized_content) > OFFLINE_SCAN_MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"文件 {name} 转换后超过 15MB，请降低照片分辨率")
        total_size += len(normalized_content)
        if total_size > OFFLINE_SCAN_MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="单份答卷照片总大小不能超过 100MB")
        payloads.append(
            {
                "name": normalized_name,
                "mime_type": normalized_mime,
                "content": normalized_content,
            }
        )
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        attempt = await run_in_threadpool(
            ingest_offline_submission,
            root,
            project_root,
            paper_id=paper_id,
            class_id=class_id,
            student_id=student_id,
            files=payloads,
            user=user,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"attempt": attempt}


@router.get("/papers/{paper_id}/attempts/{attempt_id}/scan-images/{page_index}")
def papers_attempt_scan_image(
    paper_id: str,
    attempt_id: str,
    page_index: int,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> StreamingResponse:
    root = require_platform_root()
    try:
        image = get_attempt_scan_image(
            root,
            paper_id=paper_id,
            attempt_id=attempt_id,
            page_index=page_index,
            user=user,
        )
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return StreamingResponse(
        BytesIO(image["content"]),
        media_type=str(image["mime_type"]),
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(str(image['name']))}"},
    )


@router.post("/papers/{paper_id}/attempts/{attempt_id}/ai-grade")
def papers_attempt_ai_grade(
    paper_id: str,
    attempt_id: str,
    body: PaperAiGradeBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        suggestions = suggest_ai_grades_for_attempt(
            root,
            project_root,
            paper_id=paper_id,
            attempt_id=attempt_id,
            user=user,
            question_ids=body.question_ids,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"suggestions": suggestions}


@router.patch("/papers/{paper_id}/attempts/{attempt_id}/answers/{question_id:path}/grade")
def papers_attempt_answer_grade(
    paper_id: str,
    attempt_id: str,
    question_id: str,
    body: PaperAnswerGradeBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        answer = grade_paper_answer(
            root,
            project_root,
            paper_id=paper_id,
            attempt_id=attempt_id,
            question_id=question_id,
            user=user,
            score=body.score,
            feedback=body.feedback,
            is_correct=body.is_correct,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"answer": answer}


@router.post("/papers/{paper_id}/attempts/{attempt_id}/complete-grading")
def papers_attempt_complete_grading(
    paper_id: str,
    attempt_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        attempt = complete_paper_attempt_grading(
            root,
            project_root,
            paper_id=paper_id,
            attempt_id=attempt_id,
            user=user,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"attempt": attempt}


@router.patch("/papers/{paper_id}/publications/{publication_id}")
def papers_publications_update(
    paper_id: str,
    publication_id: str,
    body: PaperPublicationUpdateBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        publication = update_paper_publication(
            root,
            paper_id=paper_id,
            publication_id=publication_id,
            user=user,
            title=body.title,
            description=body.description,
            start_at=body.start_at,
            end_at=body.end_at,
            time_limit_minutes=body.time_limit_minutes,
            show_results_immediately=body.show_results_immediately,
            status=body.status,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publication": publication}


@router.delete("/papers/{paper_id}/publications/{publication_id}")
def papers_publications_revoke(
    paper_id: str,
    publication_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        publication = revoke_paper_publication(root, paper_id=paper_id, publication_id=publication_id, user=user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publication": publication}


@router.get("/teacher/classes")
def teacher_classes_list(user: Annotated[dict[str, Any], Depends(current_platform_user)]) -> dict[str, Any]:
    root = require_platform_root()
    try:
        classes = list_teacher_classes(root, user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"classes": classes}


@router.get("/teacher/classes/{class_id}/students")
def teacher_class_students_list(
    class_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        students = list_teacher_class_students(root, class_id=class_id, user=user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"students": students}


@router.get("/teacher/classes/{class_id}/students/{student_id}/profile")
def teacher_student_profile(
    class_id: str,
    student_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        profile = get_teacher_student_profile(
            root,
            class_id=class_id,
            student_id=student_id,
            user=user,
            date_from=date_from,
            date_to=date_to,
        )
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"profile": profile}


@router.get("/teacher/classes/{class_id}/practice-history")
def teacher_class_practice_history(
    class_id: str,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    try:
        return list_practice_history(root, class_id=class_id, user=user)
    except (ValueError, PermissionError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    raise RuntimeError("unreachable")


@router.post("/teacher/practice-publications/wrong-questions")
def teacher_publish_wrong_question_practice(
    body: WrongQuestionPracticeBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        return publish_wrong_question_practice(
            root,
            project_root,
            user=user,
            **body.model_dump(mode="json"),
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    raise RuntimeError("unreachable")


@router.post("/teacher/practice-publications/reinforcement")
async def teacher_publish_reinforcement_practice(
    body: ReinforcementPracticeBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        return await publish_reinforcement_practice(
            root,
            project_root,
            user=user,
            **body.model_dump(mode="json"),
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    raise RuntimeError("unreachable")


@router.get("/organizer/folders")
def organizer_folders(scope: Literal["template", "compose", "paper"], user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    return {"folders": list_folders(require_platform_root(), user, scope)}


@router.get("/organizer/folder-items")
def organizer_folder_items(scope: Literal["template", "compose"], user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    return {"items": list_folder_items(require_platform_root(), user, scope)}


@router.put("/organizer/folder-items")
def organizer_folder_item_update(body: FolderItemBody, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        assign_folder_item(require_platform_root(), user, **body.model_dump())
        return {"ok": True}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.post("/organizer/folders")
def organizer_folder_create(body: FolderCreateBody, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        return {"folder": create_folder(require_platform_root(), user, **body.model_dump())}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.patch("/organizer/folders/{folder_id}")
def organizer_folder_update(folder_id: str, body: FolderUpdateBody, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        return {"folder": update_folder(require_platform_root(), user, folder_id, **body.model_dump())}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.delete("/organizer/folders/{folder_id}")
def organizer_folder_delete(folder_id: str, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        root = require_platform_root()
        result = delete_folder(root, user, folder_id)
        scope = result["scope"]
        return {"parent_id": result["parent_id"], "folders": list_folders(root, user, scope),
                "items": list_folder_items(root, user, scope) if scope != "paper" else {}}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.post("/organizer/papers/{paper_id}/folder")
def organizer_paper_folder(paper_id: str, body: dict[str, str], user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        assign_paper_folder(require_platform_root(), user, paper_id, str(body.get("folder_id") or ""))
        return {"ok": True}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.get("/organizer/folders/{folder_id}/analysis")
def organizer_folder_analysis(folder_id: str, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        return analyze_paper_folder(require_platform_root(), user, folder_id)
    except (ValueError, PermissionError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.get("/organizer/tags")
def organizer_tags(user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    return {"tags": list_tags(require_platform_root(), user)}


@router.get("/organizer/tagged-items")
def organizer_tagged_items(scope: Literal["bank", "template", "compose", "paper"], user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    return {"items": all_item_tags(require_platform_root(), user, scope)}


@router.post("/organizer/tags")
def organizer_tag_create(body: TagBody, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        return {"tag": save_tag(require_platform_root(), user, **body.model_dump())}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.patch("/organizer/tags/{tag_id}")
def organizer_tag_update(tag_id: str, body: TagBody, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        return {"tag": save_tag(require_platform_root(), user, tag_id=tag_id, **body.model_dump())}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.get("/organizer/tags/{scope}/{item_id:path}")
def organizer_item_tags(scope: Literal["bank", "template", "compose", "paper"], item_id: str, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    return {"tags": item_tags(require_platform_root(), user, scope, item_id)}


@router.put("/organizer/tags/{scope}/{item_id:path}")
def organizer_item_tags_update(scope: Literal["bank", "template", "compose", "paper"], item_id: str, body: TagLinksBody, user: Annotated[dict[str, Any], Depends(current_organizer_teacher)]) -> dict[str, Any]:
    try:
        return {"tag_ids": set_item_tags(require_platform_root(), user, scope=scope, item_id=item_id, tag_ids=body.tag_ids)}
    except (ValueError, PermissionError, sqlite3.IntegrityError) as exc:
        _raise_api_error(exc)
    raise RuntimeError("unreachable")


@router.post("/papers/{paper_id}/publish")
def papers_publish(
    paper_id: str,
    body: PaperPublishBody,
    user: Annotated[dict[str, Any], Depends(current_platform_user)],
) -> dict[str, Any]:
    root = require_platform_root()
    project_root = require_content_project_root()
    try:
        publication = publish_online_paper(
            root,
            paper_id=paper_id,
            user=user,
            class_ids=body.class_ids,
            student_ids=body.student_ids,
            folder_id=body.folder_id,
            project_root=project_root,
            title=body.title,
            description=body.description,
            start_at=body.start_at,
            end_at=body.end_at,
            show_results_immediately=body.show_results_immediately,
            randomize_questions=body.randomize_questions,
            randomize_answers=body.randomize_answers,
            submission_mode=body.submission_mode,
            max_screen_switches=body.max_screen_switches,
            time_limit_minutes=body.time_limit_minutes,
            subject=body.subject,
        )
    except (ValueError, PermissionError, FileNotFoundError, sqlite3.IntegrityError) as e:
        _raise_api_error(e)
    return {"publication": publication}
