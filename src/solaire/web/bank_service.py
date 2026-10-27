"""Question bank CRUD and import — files under project resource/."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

import yaml

from solaire.common.atomic_files import write_text_atomic
from solaire.exam_compiler.facade import (
    BankRecord,
    QuestionGroupRecord,
    QuestionItem,
    expand_diagram_fences_in_text,
    iter_question_files,
    parse_bank_root,
    question_group_to_author_dict,
    question_item_to_author_dict,
    strip_hydrate_fields,
    strip_primebrush_fences_for_preview,
)

from solaire.web.exam_service import ensure_probe_list_yaml
from solaire.web.library_discovery import discover_question_library_refs, library_root_for_namespace, split_qualified_id
from solaire.web.security import assert_within_project, safe_filename_component
from solaire.web.teacher_bank import bank_resource_root, bank_export_root
from solaire.web.bank_storage import (
    BankDocument,
    BankVersionConflict,
    apply_bank_import,
    bank_record_version,
    bank_write_lock,
    find_bank_record,
    read_bank_library,
    read_bank_document,
    replace_record_data,
    validate_bank_import,
)


def _rel_to_resource(project_root: Path, path: Path) -> str:
    resource = (project_root / "resource").resolve()
    return path.resolve().relative_to(resource).as_posix()


def _preview(content: str, n: int = 200) -> str:
    t = strip_primebrush_fences_for_preview(content or "", max_len=10_000)
    t = t.replace("\n", " ")
    return t if len(t) <= n else t[: n - 3] + "..."


def _subject_collection_from_namespace(ns: str) -> tuple[str, str]:
    if ns == "main":
        return ("main", "main")
    parts = ns.split("/", 1)
    if len(parts) == 2:
        return (parts[0], parts[1])
    return (parts[0], "")


def bank_catalog(project_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Return readable entries and per-file diagnostics from one scan per library."""
    out: list[dict[str, Any]] = []
    diagnostics: list[dict[str, str]] = []
    for ref in discover_question_library_refs(project_root):
        ns = ref["namespace"]
        subj, coll = _subject_collection_from_namespace(ns)
        lib = library_root_for_namespace(project_root, ns)
        if not lib.is_dir():
            continue
        index = read_bank_library(project_root, lib)
        diagnostics.extend(index.diagnostics)
        for document in index.documents:
            ypath = document.path
            rel = _rel_to_resource(project_root, ypath)
            for rec in document.records:
                answer_relation_needs_review = False
                if isinstance(rec, QuestionItem):
                    q = strip_hydrate_fields(rec)
                    preview = _preview(q.content)
                    typ = q.type
                    meta = dict(q.metadata) if q.metadata else {}
                    answer_relation_needs_review = not q.answer.startswith(':::ANSWER_LOGIC:') and bool(re.search(r'或者|而且|或|且|和', q.answer))
                else:
                    assert isinstance(rec, QuestionGroupRecord)
                    preview = _preview(rec.material)
                    u = rec.unified
                    typ = u if isinstance(u, str) else "group"
                    meta = {}
                out.append(
                    {
                        "qualified_id": f"{ns}/{rec.id}",
                        "collection": ns,
                        "namespace": ns,
                        "subject": subj,
                        "collection_name": coll,
                        "id": rec.id,
                        "type": typ,
                        "content_preview": preview,
                        "answer_relation_needs_review": answer_relation_needs_review,
                        "metadata": meta,
                        "storage_path": rel,
                        "storage_kind": "single",
                        "group_id": None,
                        "group_member_qualified_ids": [],
                        "group_material": rec.material if isinstance(rec, QuestionGroupRecord) else None,
                    }
                )
    out.sort(key=lambda x: x["qualified_id"])
    diagnostics.sort(key=lambda item: (item["storage_path"], item["code"]))
    return out, diagnostics


def list_bank_entries(project_root: Path) -> list[dict[str, Any]]:
    return bank_catalog(project_root)[0]


def list_question_rows_for_web(project_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Build the compose picker from one request-local scan per library."""
    items: list[dict[str, Any]] = []
    diagnostics: list[dict[str, str]] = []
    for ref in discover_question_library_refs(project_root):
        namespace = ref["namespace"]
        library = library_root_for_namespace(project_root, namespace)
        if not library.is_dir():
            continue
        index = read_bank_library(project_root, library)
        diagnostics.extend(index.diagnostics)
        index.require_unique_ids()
        subj, coll_name = _subject_collection_from_namespace(namespace)
        for document in index.documents:
            for record in document.records:
                qualified_id = f"{namespace}/{record.id}"
                if isinstance(record, QuestionItem):
                    question = strip_hydrate_fields(record)
                    try:
                        displayed = expand_question_for_web(project_root, namespace, question)
                    except Exception:
                        displayed = question
                    content = displayed.content or ""
                    preview = content if len(content) <= 240 else content[:237] + "..."
                    items.append({
                        "id": question.id,
                        "qualified_id": qualified_id,
                        "namespace": namespace,
                        "collection": namespace,
                        "subject": subj,
                        "collection_name": coll_name,
                        "type": question.type,
                        "content": content,
                        "content_preview": preview,
                        "answer": displayed.answer,
                        "analysis": displayed.analysis,
                        "metadata": dict(question.metadata) if question.metadata else {},
                        "group_id": None,
                        "group_member_qualified_ids": [],
                        "group_material": None,
                    })
                else:
                    content = record.material or ""
                    preview = content if len(content) <= 240 else content[:237] + "..."
                    display_type = record.unified if isinstance(record.unified, str) else "group"
                    items.append({
                        "id": record.id,
                        "qualified_id": qualified_id,
                        "namespace": namespace,
                        "collection": namespace,
                        "subject": subj,
                        "collection_name": coll_name,
                        "type": display_type,
                        "content": content,
                        "content_preview": preview,
                        "answer": "",
                        "analysis": "",
                        "metadata": {},
                        "group_id": record.id,
                        "group_member_qualified_ids": [],
                        "group_material": record.material,
                    })
    items.sort(key=lambda item: item["qualified_id"])
    diagnostics.sort(key=lambda item: (item["storage_path"], item["code"]))
    return items, diagnostics


def create_question_selection_export(
    project_root: Path,
    qualified_ids: list[str],
    *,
    title: str | None = None,
) -> dict[str, Any]:
    """Create an organized, partial YAML export and return a guarded artifact."""
    clean_ids = list(dict.fromkeys(str(item).strip() for item in qualified_ids if str(item).strip()))
    if not clean_ids:
        raise ValueError("请至少选择一道题目")
    if len(clean_ids) > 300:
        raise ValueError("单次最多导出 300 道题目")
    questions: list[dict[str, Any]] = []
    indexes = {}
    for qualified_id in clean_ids:
        namespace, qid = split_qualified_id(qualified_id)
        index = indexes.get(namespace)
        if index is None:
            library = library_root_for_namespace(project_root, namespace)
            if not library.is_dir():
                raise FileNotFoundError(f"Library not found: {namespace}")
            index = read_bank_library(project_root, library)
            indexes[namespace] = index
        found = index.find(qid)
        if found is None:
            index.require_identity_complete(qid)
            raise FileNotFoundError(f"Question not found: {qualified_id}")
        document, record_index = found
        parsed = document.records[record_index]
        if isinstance(parsed, QuestionItem):
            record = strip_hydrate_fields(parsed).model_dump(mode="json")
        else:
            record = parsed.model_dump(mode="json")
        questions.append({"qualified_id": qualified_id, **record})
    if not questions:
        raise ValueError("所选题目无法导出")
    questions.sort(key=lambda item: (str(item.get("type") or ""), str(item.get("qualified_id") or "")))
    payload = {
        "format": "EducationHelper-question-selection-v1",
        "title": str(title or "我的题目导出").strip() or "我的题目导出",
        "question_count": len(questions),
        "questions": questions,
    }
    export_dir = bank_export_root(project_root).resolve()
    export_dir.mkdir(parents=True, exist_ok=True)
    filename = f"EH-questions-{uuid.uuid4().hex[:12]}.yaml"
    target = export_dir / filename
    target.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    manifest = export_dir / f"{filename}.json"
    manifest.write_text(json.dumps({"filename": filename, "question_count": len(questions)}, ensure_ascii=False), encoding="utf-8")
    return {"filename": filename, "question_count": len(questions), "download_url": f"/api/bank/exports/{filename}"}


def question_selection_export_path(project_root: Path, filename: str) -> Path:
    safe = safe_filename_component(str(filename or ""))
    if safe != filename or not safe.endswith(".yaml"):
        raise FileNotFoundError("导出文件不存在")
    target = (bank_export_root(project_root) / safe).resolve()
    assert_within_project(project_root, target)
    if not target.is_file():
        raise FileNotFoundError("导出文件不存在或已清理")
    return target


def _expand_group_record_for_web(project_root: Path, namespace: str, group: QuestionGroupRecord) -> dict[str, Any]:
    lib = library_root_for_namespace(project_root, namespace)
    image_dir = lib / "image"
    pi, mi = 0, 0
    mat, pi, mi = expand_diagram_fences_in_text(
        group.material or "", image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
    )
    items_out: list[dict[str, Any]] = []
    if group.unified is False:
        for row in group.items:
            d = row.model_dump(mode="json")
            c, pi, mi = expand_diagram_fences_in_text(
                d["content"], image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
            )
            ans, pi, mi = expand_diagram_fences_in_text(
                d["answer"], image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
            )
            ana, pi, mi = expand_diagram_fences_in_text(
                d.get("analysis") or "", image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
            )
            opts_out: dict[str, str] | None = None
            if d.get("options"):
                opts_out = {}
                for ok, ov in d["options"].items():
                    ev, pi, mi = expand_diagram_fences_in_text(
                        ov, image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
                    )
                    opts_out[ok] = ev
            items_out.append(
                {
                    "type": d["type"],
                    "content": c,
                    "options": opts_out,
                    "answer": ans,
                    "analysis": ana,
                    "metadata": d.get("metadata") or {},
                }
            )
    else:
        for body in group.items:
            d = body.model_dump(mode="json")
            c, pi, mi = expand_diagram_fences_in_text(
                d["content"], image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
            )
            ans, pi, mi = expand_diagram_fences_in_text(
                d["answer"], image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
            )
            ana, pi, mi = expand_diagram_fences_in_text(
                d.get("analysis") or "", image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
            )
            opts_out: dict[str, str] | None = None
            if d.get("options"):
                opts_out = {}
                for ok, ov in d["options"].items():
                    ev, pi, mi = expand_diagram_fences_in_text(
                        ov, image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
                    )
                    opts_out[ok] = ev
            items_out.append(
                {
                    "content": c,
                    "options": opts_out,
                    "answer": ans,
                    "analysis": ana,
                    "metadata": d.get("metadata") or {},
                }
            )
    return {"material": mat, "items": items_out, "unified": group.unified}


def get_question_detail(project_root: Path, qualified_id: str) -> dict[str, Any]:
    ns, qid = split_qualified_id(qualified_id)
    subj, coll = _subject_collection_from_namespace(ns)
    lib = library_root_for_namespace(project_root, ns)
    if not lib.is_dir():
        raise FileNotFoundError(f"Library not found: {ns}")
    library_index = read_bank_library(project_root, lib)
    found = library_index.find(qid)
    if found is None:
        library_index.require_identity_complete(qid)
        raise FileNotFoundError(f"Question not found: {qualified_id}")
    document, index = found
    rec = document.records[index]
    common = {
        "qualified_id": qualified_id,
        "collection": ns,
        "namespace": ns,
        "subject": subj,
        "collection_name": coll,
        "storage_path": _rel_to_resource(project_root, document.path),
        "storage_kind": "single",
        "file_yaml": document.text,
        "record_yaml": yaml.safe_dump(document.record_data(index), allow_unicode=True, sort_keys=False),
        "version": bank_record_version(project_root, document, index),
    }
    if isinstance(rec, QuestionItem):
        q = strip_hydrate_fields(rec)
        return {
            **common,
            "question": q.model_dump(mode="json"),
            "question_display": expand_question_for_web(project_root, ns, q).model_dump(mode="json"),
            "question_group": None,
            "question_group_preview": None,
        }
    return {
        **common,
        "question": None,
        "question_display": None,
        "question_group": rec.model_dump(mode="json"),
        "question_group_preview": _expand_group_record_for_web(project_root, ns, rec),
    }


def _text_has_diagram_fence(text: str | None) -> bool:
    if not text:
        return False
    return "```primebrush" in text or "```mermaid" in text


def _question_has_diagram_fence(q: QuestionItem) -> bool:
    if _text_has_diagram_fence(q.content) or _text_has_diagram_fence(q.analysis) or _text_has_diagram_fence(q.answer):
        return True
    if q.options:
        for v in q.options.values():
            if _text_has_diagram_fence(v):
                return True
    return False


def expand_question_for_web(project_root: Path, namespace: str, q: QuestionItem) -> QuestionItem:
    """Replace ```primebrush``` / ```mermaid``` with Web markers; ensure files under library image/."""
    if not _question_has_diagram_fence(q):
        return q
    lib = library_root_for_namespace(project_root, namespace)
    image_dir = lib / "image"
    pi, mi = 0, 0
    content, pi, mi = expand_diagram_fences_in_text(
        q.content, image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
    )
    answer, pi, mi = expand_diagram_fences_in_text(
        q.answer or "", image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
    )
    analysis, pi, mi = expand_diagram_fences_in_text(
        q.analysis or "", image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
    )
    update: dict[str, Any] = {"content": content, "answer": answer, "analysis": analysis}
    if q.options is not None:
        opts_out: dict[str, str] = {}
        for ok, ov in q.options.items():
            ev, pi, mi = expand_diagram_fences_in_text(
                ov, image_dir=image_dir, mode="web", project_root=project_root, primebrush_start=pi, mermaid_start=mi
            )
            opts_out[ok] = ev
        update["options"] = opts_out
    return q.model_copy(update=update)


def question_exists(project_root: Path, qualified_id: str) -> bool:
    namespace, qid = split_qualified_id(qualified_id)
    library = library_root_for_namespace(project_root, namespace)
    if not library.is_dir():
        return False
    try:
        return read_bank_library(project_root, library).find(qid) is not None
    except ValueError:
        # A known duplicate must be treated as occupied so create requests cannot overwrite it.
        return True


_ALLOWED_BANK_IMAGE_EXT = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
_MAX_BANK_IMAGE_BYTES = 5 * 1024 * 1024


def upload_bank_image(
    project_root: Path,
    qualified_id: str,
    file_bytes: bytes,
    original_filename: str,
    *,
    expected_version: str | None = None,
) -> dict[str, str]:
    """Save image under library ``image/``; return resource-relative path and text marker."""
    ns, qid = split_qualified_id(qualified_id)
    lib = library_root_for_namespace(project_root, ns)
    if not lib.is_dir():
        raise FileNotFoundError(f"Library not found: {ns}")
    image_dir = lib / "image"
    assert_within_project(project_root, image_dir)
    if len(file_bytes) > _MAX_BANK_IMAGE_BYTES:
        raise ValueError("图片超过 5MB 限制")
    suf = Path(original_filename or "image.png").suffix.lower()
    if not suf:
        suf = ".png"
    if suf not in _ALLOWED_BANK_IMAGE_EXT:
        raise ValueError(f"不支持的图片格式: {suf}")
    digest = hashlib.sha256(file_bytes).hexdigest()[:16]
    dest = image_dir / f"{digest}{suf}"
    assert_within_project(project_root, dest)
    from solaire.common.atomic_files import write_bytes_atomic
    with bank_write_lock(lib):
        if expected_version is not None:
            found = find_bank_record(project_root, lib, qid)
            current = bank_record_version(project_root, *found) if found else None
            if expected_version.strip().strip('"') != current:
                raise BankVersionConflict(current)
        write_bytes_atomic(dest, file_bytes)
    rel = _rel_to_resource(project_root, dest)
    marker = f":::EMBED_IMG:{rel}:::\n"
    return {"resource_rel": rel, "marker": marker}


def _safe_filename_id(qid: str) -> str:
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", qid.strip())
    return s or "question"


def _dump_record_yaml(rec: BankRecord) -> dict[str, Any]:
    if isinstance(rec, QuestionGroupRecord):
        return question_group_to_author_dict(rec)
    return question_item_to_author_dict(rec)


def save_bank_record(project_root: Path, qualified_id: str, body: BankRecord, *, create_only: bool = False,
                     expected_version: str | None = None) -> dict[str, str]:
    from solaire.common.answer_logic import PREFIX, decode
    answers = [body.answer] if isinstance(body, QuestionItem) else [str(getattr(item, 'answer', '') if not isinstance(item, dict) else item.get('answer', '')) for item in body.items]
    for answer in answers:
        if answer.startswith(PREFIX):
            decode(answer)
    ns, qid = split_qualified_id(qualified_id)
    if body.id != qid:
        raise ValueError("题目编号与保存路径不一致；请刷新题目后重试，不能直接修改已有题目的编号")
    lib = library_root_for_namespace(project_root, ns)
    with bank_write_lock(lib):
        library_index = read_bank_library(project_root, lib)
        found = library_index.find(qid)
        if expected_version is not None:
            current = bank_record_version(project_root, *found) if found is not None else None
            if expected_version.strip().strip('"') != current:
                raise BankVersionConflict(current)
        data = _dump_record_yaml(body)
        if found is not None:
            if create_only:
                raise FileExistsError(qualified_id)
            document, index = found
            path = document.path
            data = replace_record_data(document, index, data)
        else:
            path = lib / f"{_safe_filename_id(qid)}.yaml"
            if path.exists():
                raise FileExistsError(str(path))
            library_index.require_identity_complete(qid)
        text = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
        write_text_atomic(path, text)
        saved_index = index if found is not None else 0
        saved = BankDocument(path, text, data, [])
        return {"storage_path": _rel_to_resource(project_root, path),
                "version": bank_record_version(project_root, saved, saved_index)}


def save_question(project_root: Path, qualified_id: str, item: QuestionItem, *, create_only: bool = False) -> dict[str, str]:
    return save_bank_record(project_root, qualified_id, strip_hydrate_fields(item), create_only=create_only)


def delete_question(project_root: Path, qualified_id: str, storage_path: str | None = None) -> None:
    """删除题目。若提供 ``storage_path``（列表/详情中的 resource 相对路径），只删该文件，避免仅靠题号在过大目录下误删。"""
    ns, qid = split_qualified_id(qualified_id)
    lib = library_root_for_namespace(project_root, ns)
    with bank_write_lock(lib):
        if storage_path:
            resource = (project_root / "resource").resolve()
            rel = storage_path.strip().replace("\\", "/").lstrip("/")
            ypath = (resource / rel).resolve()
            assert_within_project(project_root, ypath)
            try:
                ypath.relative_to(lib.resolve())
            except ValueError as e:
                raise ValueError("题目路径与当前题集不一致，已拒绝删除") from e
            if not ypath.is_file():
                raise FileNotFoundError(qualified_id)
            document = read_bank_document(ypath)
            if not any(rec.id == qid for rec in document.records):
                raise FileNotFoundError(qualified_id)
        else:
            found = find_bank_record(project_root, lib, qid)
            if found is None:
                raise FileNotFoundError(qualified_id)
            document, _index = found
        if len(document.records) != 1:
            raise ValueError("无法删除：文件含多条记录时请手动编辑 YAML")
        document.path.unlink()


def import_merged_yaml(
    project_root: Path,
    yaml_text: str,
    target_subject: str,
    target_collection: str,
    *,
    extra_files: dict[Path, bytes] | None = None,
) -> dict[str, Any]:
    """Validate a legacy merged package, then update stable IDs and apply all planned files."""
    ts = target_subject.strip()
    tc = target_collection.strip()
    if not ts or not tc:
        raise ValueError("必须提供 target_subject 与 target_collection")
    ns = f"{ts}/{tc}"
    raw = yaml.safe_load(yaml_text)
    if raw is None:
        raise ValueError("Empty YAML")
    if not isinstance(raw, dict):
        raise ValueError("Merged import expects a mapping with optional questions: and groups:")
    questions = raw.get("questions") or []
    groups = raw.get("groups") or []
    if not isinstance(questions, list) or not isinstance(groups, list):
        raise ValueError("Merged import questions and groups must be lists")

    records: list[tuple[str, BankRecord, dict[str, Any]]] = []
    seen_ids: set[str] = set()
    for question in questions:
        if not isinstance(question, dict):
            raise ValueError("Merged import question must be a mapping")
        source_meta = question.get("metadata") or {}
        if not isinstance(source_meta, dict):
            raise ValueError("Question metadata must be a mapping")
        metadata = dict(source_meta)
        metadata.setdefault("source", "人工导入")
        record = QuestionItem.model_validate({**question, "metadata": metadata})
        if record.id in seen_ids:
            raise ValueError(f"题集中存在重复题目编号: {record.id}")
        seen_ids.add(record.id)
        records.append((record.id, record, _dump_record_yaml(record)))

    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("Merged import group must be a mapping")
        group_id = str(group.get("group_id") or "").strip()
        if not group_id:
            raise ValueError("group without group_id")
        inner_type = group.get("type")
        if inner_type not in (
            "choice",
            "single_choice",
            "multiple_choice",
            "fill",
            "judge",
            "short_answer",
            "reasoning",
            "essay",
        ):
            raise ValueError(f"invalid group inner type: {inner_type!r}")
        items = group.get("items") or []
        if not isinstance(items, list):
            raise ValueError("Group items must be a list")
        record = QuestionGroupRecord(
            id=group_id,
            type="group",
            material=str(group.get("material") or ""),
            unified=inner_type,
            items=items,
        )
        if record.id in seen_ids:
            raise ValueError(f"题集中存在重复题目编号: {record.id}")
        seen_ids.add(record.id)
        records.append((record.id, record, _dump_record_yaml(record)))

    target = library_root_for_namespace(project_root, ns)
    assert_within_project(project_root, target)
    extra_files = extra_files or {}
    for path in extra_files:
        assert_within_project(project_root, path)
        try:
            path.resolve().relative_to((project_root / "resource").resolve())
        except ValueError as exc:
            raise ValueError("导入资源必须位于项目 resource 目录中") from exc

    written = 0
    with bank_write_lock(target):
        library_index = read_bank_library(project_root, target)
        existing_documents = {document.path.resolve(): document for document in library_index.documents}
        existing_ids: dict[str, tuple[Path, int]] = {}
        for document in library_index.documents:
            path = document.path
            resolved_path = document.path.resolve()
            for index, existing_record in enumerate(document.records):
                if existing_record.id in existing_ids:
                    other_path, _ = existing_ids[existing_record.id]
                    raise ValueError(
                        f"题集中存在重复题目编号: {existing_record.id} ({other_path.name}, {path.name})"
                    )
                existing_ids[existing_record.id] = (resolved_path, index)

        planned_by_path: dict[Path, str] = {}
        path_claims: dict[Path, str] = {}
        updated_raw: dict[Path, Any] = {}
        for qid, _record, record_data in records:
            location = existing_ids.get(qid)
            if location is not None:
                path, index = location
                if path in planned_by_path:
                    raise ValueError(f"导入题目路径与其他题目写入冲突: {path.name}")
                document = existing_documents[path]
                working_document = BankDocument(
                    document.path,
                    document.text,
                    updated_raw.get(path, document.raw),
                    document.records,
                )
                updated_raw[path] = replace_record_data(working_document, index, record_data)
                written += 1
                continue

            path = (target / f"{_safe_filename_id(qid)}.yaml").resolve()
            assert_within_project(project_root, path)
            if path.exists():
                raise ValueError(f"导入题目目标文件已存在，不能覆盖未匹配的稳定题号: {path.name}")
            library_index.require_identity_complete(qid)
            prior_claim = path_claims.get(path)
            if prior_claim is not None and prior_claim != qid:
                raise ValueError(f"导入题目文件名冲突: {prior_claim} 与 {qid}")
            if path in updated_raw:
                raise ValueError(f"导入题目路径与已有题目更新冲突: {path.name}")
            path_claims[path] = qid
            planned_by_path[path] = yaml.safe_dump(record_data, allow_unicode=True, sort_keys=False)
            written += 1

        yaml_files = dict(planned_by_path)
        yaml_files.update(
            {
                path: yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
                for path, data in updated_raw.items()
            }
        )
        validate_bank_import(project_root, target, yaml_files)

        files_to_apply: dict[Path, str | bytes] = dict(yaml_files)
        for path, data in extra_files.items():
            if path.resolve() in files_to_apply:
                raise ValueError(f"导入资源路径冲突: {path.name}")
            files_to_apply[path] = data
        apply_bank_import(project_root, files_to_apply)

    return {"written": written, "namespace": ns, "subject": ts, "collection": tc}


def collections_list(project_root: Path) -> list[dict[str, str]]:
    """题集 list for UI（含科目、题集拆分）。"""
    out: list[dict[str, str]] = []
    for ref in discover_question_library_refs(project_root):
        ns = ref["namespace"]
        subj, coll = _subject_collection_from_namespace(ns)
        if ns == "main":
            label = "main（resource 根）"
        else:
            label = f"{subj} · {coll}"
        out.append(
            {
                "id": ns,
                "namespace": ns,
                "subject": subj,
                "collection": coll,
                "label": label,
            }
        )
    return out


def rename_question_collection(
    project_root: Path,
    *,
    namespace: str,
    new_subject: str,
    new_collection: str,
) -> dict[str, str]:
    """将 ``resource/<科目>/<题集>/`` 目录重命名或移动到新科目+题集目录名（磁盘目录名）。"""
    ns = namespace.strip()
    if ns == "main":
        raise ValueError("不能重命名默认题库根目录")
    old_root = library_root_for_namespace(project_root, ns)
    assert_within_project(project_root, old_root)
    subj = safe_filename_component(new_subject)
    coll = safe_filename_component(new_collection)
    if not subj.strip() or not coll.strip():
        raise ValueError("科目与题集名称不能为空")
    new_root = library_root_for_namespace(project_root, f'{subj}/{coll}')
    assert_within_project(project_root, new_root)
    if new_root == old_root:
        with bank_write_lock(old_root):
            if not old_root.is_dir():
                raise FileNotFoundError(f"题集不存在: {ns}")
            return {"namespace": ns, "changed": False}
    first, second = sorted((old_root, new_root), key=lambda path: str(path).casefold())
    with bank_write_lock(first), bank_write_lock(second):
        if not old_root.is_dir():
            raise FileNotFoundError(f"题集不存在: {ns}")
        if new_root.exists():
            raise ValueError("目标位置已存在同名题集")
        new_root.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_root), str(new_root))
    ensure_probe_list_yaml(project_root)
    new_ns = f"{subj}/{coll}"
    return {"namespace": new_ns, "changed": True}


def delete_question_collection(project_root: Path, namespace: str) -> None:
    """删除整个题集目录（``resource/<科目>/<题集>/``）。"""
    ns = namespace.strip()
    if ns == "main":
        raise ValueError("不能删除默认题库根目录")
    root = library_root_for_namespace(project_root, ns)
    assert_within_project(project_root, root)
    with bank_write_lock(root):
        if not root.is_dir():
            raise FileNotFoundError(f"题集不存在: {ns}")
        shutil.rmtree(root)
    ensure_probe_list_yaml(project_root)


def list_subjects(project_root: Path) -> list[str]:
    """resource 下含 YAML 题集的科目目录名。"""
    resource = bank_resource_root(project_root)
    if not resource.is_dir():
        return []
    subs: set[str] = set()
    for subject_dir in sorted(resource.iterdir()):
        if not subject_dir.is_dir():
            continue
        for coll_dir in subject_dir.iterdir():
            if coll_dir.is_dir() and any(coll_dir.rglob("*.yaml")):
                subs.add(subject_dir.name)
                break
    return sorted(subs)
