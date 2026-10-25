"""routers bank."""

from __future__ import annotations

from typing import Any
from fastapi import File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from solaire.exam_compiler.facade import QuestionGroupRecord, QuestionItem, load_all_questions, strip_hydrate_fields
from solaire.web.auth_api import extract_session_token, require_platform_root
from solaire.web.auth_service import get_session_user
from solaire.web.bank_exchange import export_bank_exchange_zip, import_bank_exchange_zip
from solaire.web.bank_service import collections_list, create_question_selection_export, delete_question, delete_question_collection, expand_question_for_web, get_question_detail, import_merged_yaml, list_bank_entries, list_subjects, question_exists, question_selection_export_path, rename_question_collection, save_bank_record, upload_bank_image
from solaire.web.library_discovery import discover_question_library_refs
from solaire.web.exam_service import ensure_probe_list_yaml
from solaire.web.security import assert_within_project, content_disposition_attachment, safe_filename_component
from fastapi import APIRouter
from solaire.web.request_context import _require_root
from solaire.web.schemas.bank import BankCollectionDeleteBody, BankCollectionRenameBody, BankCreateBody, BankExportBundleBody, BankFolderActionBody, BankImportBody, BankRawFileBody, BankRecordBody, BankSelectionExportBody, BankShareBody

router = APIRouter()


@router.get("/api/resource/{rel_path:path}")
def serve_resource_file(rel_path: str, request: Request) -> FileResponse:
    """Serve files under project resource/ (e.g. PrimeBrush SVG under …/image/)."""
    root = _require_root()
    resource = (root / "resource").resolve()
    rel = rel_path.strip().replace("\\", "/").lstrip("/")
    if not rel.startswith('__teachers/'):
        from solaire.web.teacher_bank import bank_resource_root
        resource = bank_resource_root(root)
    target = (resource / rel).resolve()
    try:
        target.relative_to(resource)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Path must stay under resource/") from e
    assert_within_project(root, target)
    user = getattr(request.state, 'platform_user', None)
    if user and user.get('role') == 'student':
        from solaire.web.student_service import ensure_student_resource_access
        from solaire.web.platform_db import default_platform_root
        try:
            ensure_student_resource_access(default_platform_root(), root, user, target)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    is_svg = target.suffix.lower() == ".svg"
    mt = "image/svg+xml" if is_svg else None
    headers = {"X-Content-Type-Options": "nosniff"}
    if is_svg:
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
    return FileResponse(target, media_type=mt, headers=headers)


def _subject_collection_from_qualified_id(qid: str) -> tuple[str, str, str]:
    """Returns (subject, collection_name, full_namespace)."""
    parts = qid.split("/")
    if len(parts) >= 3:
        return parts[0], parts[1], "/".join(parts[:-1])
    if len(parts) == 2 and parts[0] == "main":
        return "main", "main", "main"
    if len(parts) == 2:
        return parts[0], "", parts[0]
    return (parts[0] if parts else "", "", parts[0] if parts else "")


@router.get("/api/questions")
def list_questions() -> dict[str, Any]:
    root = _require_root()
    probe = ensure_probe_list_yaml(root)
    refs = discover_question_library_refs(root)
    libs = [(r["namespace"], r["path"]) for r in refs]
    try:
        loaded = load_all_questions(probe, libs)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=400,
            detail="题库路径不完整或已被移动，请检查项目下的题库目录后重试。",
        ) from e
    except OSError as e:
        raise HTTPException(
            status_code=400,
            detail="题库路径不完整或已被移动，请检查项目下的题库目录后重试。",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    items: list[dict[str, Any]] = []
    for qid, rec in sorted(loaded.by_qualified.items()):
        subj, coll_name, ns = _subject_collection_from_qualified_id(qid)
        if isinstance(rec, QuestionItem):
            q = strip_hydrate_fields(rec)
            try:
                q_disp = expand_question_for_web(root, ns, q)
            except Exception:
                # 插图展开失败（如 PrimeBrush 渲染异常）不应拖垮整表；列表页回退为未展开题干。
                q_disp = q
            content = q_disp.content or ""
            preview = content if len(content) <= 240 else content[:237] + "..."
            items.append(
                {
                    "id": q.id,
                    "qualified_id": qid,
                    "namespace": ns,
                    "collection": ns,
                    "subject": subj,
                    "collection_name": coll_name,
                    "type": q.type,
                    "content": content,
                    "content_preview": preview,
                    "answer": q_disp.answer,
                    "analysis": q_disp.analysis,
                    "metadata": dict(q.metadata) if q.metadata else {},
                    "group_id": None,
                    "group_member_qualified_ids": [],
                    "group_material": None,
                }
            )
        else:
            assert isinstance(rec, QuestionGroupRecord)
            content = rec.material or ""
            preview = content if len(content) <= 240 else content[:237] + "..."
            u = rec.unified
            display_type = u if isinstance(u, str) else "group"
            items.append(
                {
                    "id": rec.id,
                    "qualified_id": qid,
                    "namespace": ns,
                    "collection": ns,
                    "subject": subj,
                    "collection_name": coll_name,
                    "type": display_type,
                    "content": content,
                    "content_preview": preview,
                    "answer": "",
                    "analysis": "",
                    "metadata": {},
                    "group_id": rec.id,
                    "group_member_qualified_ids": [],
                    "group_material": rec.material,
                }
            )
    return {"questions": items}


@router.get("/api/bank/subjects")
def bank_subjects() -> dict[str, Any]:
    root = _require_root()
    return {"subjects": list_subjects(root)}


@router.get("/api/bank/collections")
def bank_collections() -> dict[str, Any]:
    root = _require_root()
    ensure_probe_list_yaml(root)
    return {"collections": collections_list(root)}


@router.post("/api/bank/rename-collection")
def bank_collection_rename(body: BankCollectionRenameBody) -> dict[str, Any]:
    root = _require_root()
    try:
        r = rename_question_collection(
            root,
            namespace=body.namespace.strip(),
            new_subject=body.new_subject,
            new_collection=body.new_collection,
        )
        return {"ok": True, **r}
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/bank/delete-collection")
def bank_collection_delete(body: BankCollectionDeleteBody) -> dict[str, Any]:
    root = _require_root()
    try:
        delete_question_collection(root, body.namespace.strip())
        return {"ok": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/api/bank/items")
def bank_items() -> dict[str, Any]:
    root = _require_root()
    ensure_probe_list_yaml(root)
    return {"items": list_bank_entries(root)}


def _bank_folder_owner(request: Request) -> str:
    user = getattr(request.state, 'platform_user', None)
    token = extract_session_token(authorization=request.headers.get('authorization'),
                                  x_solaire_session=request.headers.get('x-solaire-session'))
    if user is None and token:
        user = get_session_user(require_platform_root(), token)
    if user and user.get('role') not in {'teacher', 'admin'}:
        raise HTTPException(status_code=403, detail='仅教师或管理员可以整理题库目录')
    return str(user['id']) if user else ''


@router.get("/api/bank/folders")
def bank_folders_get(request: Request) -> dict[str, Any]:
    from solaire.web.bank_folders import read
    return read(_require_root(), owner_id=_bank_folder_owner(request))


@router.post("/api/bank/folders/actions")
def bank_folders_action(body: BankFolderActionBody, request: Request) -> dict[str, Any]:
    from solaire.web.bank_folders import act
    try:
        return act(_require_root(), body.action, path=body.path,
                   target=body.target, qualified_ids=body.qualified_ids, owner_id=_bank_folder_owner(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/api/bank/folders/share')
def bank_folder_share(body: BankShareBody, request: Request) -> dict[str, Any]:
    from solaire.web import bank_sharing
    _bank_folder_owner(request)
    try:
        if body.action == 'create':
            return bank_sharing.create(_require_root(), body.path)
        if body.action == 'revoke':
            return bank_sharing.revoke(body.code)
        return bank_sharing.redeem(_require_root(), body.code)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/bank/items/{qualified_id:path}")
def bank_item_get(qualified_id: str) -> dict[str, Any]:
    root = _require_root()
    try:
        return get_question_detail(root, qualified_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/bank/items/{qualified_id:path}/image")
async def bank_item_upload_image(qualified_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    root = _require_root()
    try:
        body = await file.read()
        r = upload_bank_image(root, qualified_id, body, file.filename or "image.png")
        ensure_probe_list_yaml(root)
        return r
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.put("/api/bank/items/{qualified_id:path}")
def bank_item_put(qualified_id: str, body: BankRecordBody) -> dict[str, Any]:
    root = _require_root()
    try:
        save_bank_record(root, qualified_id, body)
        ensure_probe_list_yaml(root)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/api/bank/items")
def bank_item_create(body: BankCreateBody) -> dict[str, Any]:
    root = _require_root()
    subj = body.subject.strip()
    coll = body.collection.strip()
    qualified_id = f"{subj}/{coll}/{body.question.id}"
    if question_exists(root, qualified_id):
        raise HTTPException(status_code=409, detail=f"题目已存在: {qualified_id}")
    try:
        save_bank_record(root, qualified_id, body.question, create_only=True)
        ensure_probe_list_yaml(root)
        return {"ok": True, "qualified_id": qualified_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.delete("/api/bank/items/{qualified_id:path}")
def bank_item_delete(
    qualified_id: str,
    storage_path: str | None = Query(
        None,
        description="题库列表/详情中的 resource 相对路径；提供时只删除该文件，避免题号在目录解析歧义时误删他处题目。",
    ),
) -> dict[str, Any]:
    root = _require_root()
    try:
        delete_question(root, qualified_id, storage_path)
        ensure_probe_list_yaml(root)
        return {"ok": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/api/bank/raw")
def bank_put_raw_file(body: BankRawFileBody) -> dict[str, Any]:
    """Save merged or any YAML file under resource/ (used when editing whole questions.yaml)."""
    root = _require_root()
    rel = body.path.strip().replace("\\", "/").lstrip("/")
    resource = (root / "resource").resolve()
    if not rel.startswith('__teachers/'):
        from solaire.web.teacher_bank import bank_resource_root
        resource = bank_resource_root(root)
    target = (resource / rel).resolve()
    try:
        target.relative_to(resource)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Path must stay under resource/") from e
    assert_within_project(root, target)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.yaml, encoding="utf-8")
    ensure_probe_list_yaml(root)
    return {"ok": True}


@router.post("/api/bank/import")
def bank_import(body: BankImportBody) -> dict[str, Any]:
    root = _require_root()
    try:
        r = import_merged_yaml(
            root,
            body.yaml,
            body.target_subject.strip(),
            body.target_collection.strip(),
        )
        ensure_probe_list_yaml(root)
        return {"ok": True, **r}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/api/bank/import-bundle")
async def bank_import_bundle(
    file: UploadFile = File(...),
    target_subject: str = Form(...),
    target_collection: str = Form(...),
) -> dict[str, Any]:
    """Loose import: exchange ZIP (questions.yaml + image/ + optional manifest)."""
    root = _require_root()
    body = await file.read()
    try:
        r = import_bank_exchange_zip(root, body, target_subject.strip(), target_collection.strip())
        ensure_probe_list_yaml(root)
        return {"ok": True, **r}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _bank_export_bundle_response(namespace: str) -> Response:
    """Strict export: manifest.json + yaml/*.yaml + image/ (package-relative EMBED)."""
    root = _require_root()
    ns = namespace.strip()
    try:
        data, stem = export_bank_exchange_zip(root, ns)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    fn = f"{safe_filename_component(stem)}.bank.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition_attachment(fn)},
    )


@router.get("/api/bank/export-bundle")
def bank_export_bundle_get(
    namespace: str = Query(..., description="题集 namespace，如 数学/模拟题"),
) -> Response:
    """GET 兼容；含 / 的 namespace 在部分代理上可能异常，请优先使用 POST。"""
    return _bank_export_bundle_response(namespace)


@router.post("/api/bank/export-bundle")
def bank_export_bundle_post(body: BankExportBundleBody) -> Response:
    """推荐：JSON body 传递 namespace，避免查询串编码问题。"""
    return _bank_export_bundle_response(body.namespace)


@router.post("/api/bank/export-selection")
def bank_export_selection(body: BankSelectionExportBody) -> dict[str, Any]:
    try:
        return create_question_selection_export(_require_root(), body.qualified_ids, title=body.title)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/bank/exports/{filename}")
def bank_export_selection_download(filename: str) -> FileResponse:
    try:
        target = question_selection_export_path(_require_root(), filename)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(target, media_type="application/x-yaml", filename=filename)
