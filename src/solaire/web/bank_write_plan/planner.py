"""Unified plan construction for single-question mutations, bulk imports, and ZIP packages."""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any
import zipfile

import yaml

from solaire.exam_compiler.facade import (
    question_group_to_author_dict,
    question_item_to_author_dict,
)
from solaire.exam_compiler.models import (
    BankRecord,
    QuestionGroupRecord,
    QuestionItem,
    parse_bank_root,
)
from solaire.web.bank_storage import (
    BankDocument,
    parse_bank_document,
    replace_record_data,
)
from solaire.web.bank_write_plan.plan import WritePlan
from solaire.web.bank_write_plan.snapshot import LibrarySnapshot
from solaire.web.bank_write_plan.archive_source import (
    ArchiveSource,
    DirectArchiveSource,
    ExtractedArchiveSource,
    RequiresExtractedArchive,
)
from solaire.web.security import assert_within_project

_ALLOWED_BANK_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_MAX_BANK_IMAGE_BYTES = 5 * 1024 * 1024
_EMBED_IMG_RE = re.compile(r":::EMBED_IMG:([^:]+):::")


def _rel_to_resource(project_root: Path, path: Path) -> str:
    res = (project_root / "resource").resolve()
    return path.resolve().relative_to(res).as_posix()


def _safe_filename_id(qid: str) -> str:
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", qid.strip())
    return s or "question"


def _dump_record_yaml(rec: BankRecord) -> dict[str, Any]:
    if isinstance(rec, QuestionGroupRecord):
        return question_group_to_author_dict(rec)
    return question_item_to_author_dict(rec)


def _collect_embed_rels_from_text(text: str) -> list[str]:
    if not text or ":::EMBED_IMG:" not in text:
        return []
    return list(dict.fromkeys(m.group(1).strip() for m in _EMBED_IMG_RE.finditer(text)))


def _collect_embed_rels_from_value(value: Any) -> list[str]:
    if isinstance(value, str):
        return _collect_embed_rels_from_text(value)
    if isinstance(value, dict):
        return [rel for child in value.values() for rel in _collect_embed_rels_from_value(child)]
    if isinstance(value, list):
        return [rel for child in value for rel in _collect_embed_rels_from_value(child)]
    return []


def _rewrite_embeds_when_mapped(text: str, mapping: dict[str, str]) -> str:
    def repl(m: re.Match[str]) -> str:
        rel = m.group(1).strip()
        if rel in mapping:
            return f":::EMBED_IMG:{mapping[rel]}:::"
        return m.group(0)

    return _EMBED_IMG_RE.sub(repl, text)


def _rewrite_embeds_in_value(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, str):
        return _rewrite_embeds_when_mapped(value, mapping)
    if isinstance(value, dict):
        return {key: _rewrite_embeds_in_value(child, mapping) for key, child in value.items()}
    if isinstance(value, list):
        return [_rewrite_embeds_in_value(child, mapping) for child in value]
    return value


def _normalize_bank_yaml_text(text: str) -> str:
    document = parse_bank_document(Path("bank-exchange.yaml"), text)
    if not document.records:
        return ""
    raw = document.raw
    for index, record in enumerate(document.records):
        author_data = (
            question_group_to_author_dict(record)
            if getattr(record, "type", None) == "group"
            else question_item_to_author_dict(record)
        )
        current = BankDocument(document.path, document.text, raw, document.records)
        raw = replace_record_data(current, index, author_data)
    return yaml.safe_dump(raw, allow_unicode=True, sort_keys=False)


def _safe_extract_zip(zf: zipfile.ZipFile, dest: Path) -> None:
    dest = dest.resolve()
    seen_targets: set[str] = set()
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = info.filename
        if name.startswith("/") or ".." in Path(name).parts:
            raise ValueError(f"非法的 zip 路径: {name}")
        target = (dest / name).resolve()
        try:
            target.relative_to(dest)
        except ValueError as e:
            raise ValueError(f"zip 路径越界: {name}") from e
        target_key = os.path.normcase(str(target)).casefold()
        if target_key in seen_targets:
            raise ValueError(f"ZIP 内存在重复目标路径: {name}")
        seen_targets.add(target_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, target.open("wb") as out:
            shutil.copyfileobj(src, out)


def _has_simple_root_yaml_tree_hint(zf: zipfile.ZipFile) -> bool:
    """Avoid a full archive index pass when ordinary names cannot contain yaml/."""
    has_yaml_tree = False
    for info in zf.infolist():
        if info.is_dir():
            continue
        parts = DirectArchiveSource._portable_parts(info.filename)
        if parts is None:
            return False
        if parts[0].casefold() == "yaml" and parts[0] != "yaml":
            # Case behavior differs by filesystem; let the legacy extractor decide.
            return False
        if len(parts) > 1 and parts[0] == "yaml":
            has_yaml_tree = True
    return has_yaml_tree


def plan_merged_import(
    snapshot: LibrarySnapshot,
    yaml_text: str,
    extra_files: dict[Path, bytes] | None = None,
) -> WritePlan:
    """Build write plan for legacy merged YAML import."""
    project_root = snapshot.project_root
    target = snapshot.library

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

    extra_files = extra_files or {}
    for path in extra_files:
        assert_within_project(project_root, path)
        try:
            path.resolve().relative_to((project_root / "resource").resolve())
        except ValueError as exc:
            raise ValueError("导入资源必须位于项目 resource 目录中") from exc

    existing_documents = {doc.path.resolve(): doc for doc in snapshot.documents}
    existing_ids: dict[str, tuple[Path, int]] = {}
    for doc in snapshot.documents:
        path = doc.path
        resolved_path = doc.path.resolve()
        for idx, existing_record in enumerate(doc.records):
            if existing_record.id in existing_ids:
                other_path, _ = existing_ids[existing_record.id]
                raise ValueError(
                    f"题集中存在重复题目编号: {existing_record.id} ({other_path.name}, {path.name})"
                )
            existing_ids[existing_record.id] = (resolved_path, idx)

    written = 0
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
        snapshot.require_identity_complete(qid)
        prior_claim = path_claims.get(path)
        if prior_claim is not None and prior_claim != qid:
            raise ValueError(f"导入题目文件名冲突: {prior_claim} 与 {qid}")
        if path in updated_raw:
            raise ValueError(f"导入题目路径与已有题目更新冲突: {path.name}")
        path_claims[path] = qid
        planned_by_path[path] = yaml.safe_dump(record_data, allow_unicode=True, sort_keys=False)
        written += 1

    plan = WritePlan(project_root=project_root, target_library=target)
    for path, text in planned_by_path.items():
        plan.yaml_writes[path] = text
    for path, data in updated_raw.items():
        plan.yaml_writes[path] = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)

    for path, data in extra_files.items():
        plan.extra_writes[path.resolve()] = data

    plan.written_count = written
    return plan


def plan_zip_import(
    snapshot: LibrarySnapshot,
    zip_bytes: bytes,
    target_subject: str,
    target_collection: str,
) -> WritePlan:
    """Build write plan for ZIP package import with unified resource indexing."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            source = (
                DirectArchiveSource.try_create(zf, tmp_path)
                if _has_simple_root_yaml_tree_hint(zf)
                else None
            )
            if source is None:
                _safe_extract_zip(zf, tmp_path)
                source = ExtractedArchiveSource(tmp_path)
            elif not source.has_yaml_directory():
                # Keep merged legacy packages on the single-read extraction path.
                _safe_extract_zip(zf, tmp_path)
                source = ExtractedArchiveSource(tmp_path)
            else:
                # Every ordinary member is streamed to EOF in archive order.
                source.validate_members()
            try:
                return _plan_zip_source(snapshot, source, target_subject, target_collection)
            except RequiresExtractedArchive:
                if not isinstance(source, DirectArchiveSource):
                    raise
                # A reference can use a filesystem alias (for example an 8.3 name)
                # that cannot be inferred from the archive member index.
                _safe_extract_zip(zf, tmp_path)
                extracted_source = ExtractedArchiveSource(tmp_path)
                return _plan_zip_source(snapshot, extracted_source, target_subject, target_collection)


def _plan_zip_source(
    snapshot: LibrarySnapshot,
    source: ArchiveSource,
    target_subject: str,
    target_collection: str,
) -> WritePlan:
    project_root = snapshot.project_root
    target_lib = snapshot.library
    image_dir = target_lib / "image"
    warnings: list[str] = []

    if source.has_yaml_directory():
        imported_yaml: list[tuple[Path, Any]] = []
        all_rels: list[str] = []
        yaml_root = source.root / "yaml"
        for member in source.yaml_members():
            document = parse_bank_document(member.path, source.read_text(member))
            all_rels.extend(_collect_embed_rels_from_value(document.raw))
            imported_yaml.append((member.path.relative_to(yaml_root), document.raw))

        unique_rels = list(dict.fromkeys(all_rels))
        pkg_to_resource: dict[str, str] = {}
        image_files: dict[Path, bytes] = {}
        for rel in unique_rels:
            member = source.resolve_embed(rel)
            if member is None:
                warnings.append(f"未找到图片文件，保留占位符: {rel}")
                continue
            if source.file_size(member) > _MAX_BANK_IMAGE_BYTES:
                warnings.append(f"跳过大文件: {rel}")
                continue
            ext = member.path.suffix.lower() or ".png"
            if ext not in _ALLOWED_BANK_IMAGE_EXT:
                warnings.append(f"跳过不支持的格式: {rel}")
                continue
            data = source.read_bytes(member)
            digest = hashlib.sha256(data).hexdigest()[:16]
            dest = image_dir / f"{digest}{ext}"
            assert_within_project(project_root, dest)
            image_files[dest.resolve()] = data
            pkg_to_resource[rel] = _rel_to_resource(project_root, dest)

        yaml_files: dict[Path, str] = {}
        for rel, raw in imported_yaml:
            dest = (target_lib / rel).resolve()
            assert_within_project(project_root, dest)
            if dest in yaml_files:
                raise ValueError(f"ZIP 内存在重复题目目标路径: {rel.as_posix()}")
            rewritten = _rewrite_embeds_in_value(raw, pkg_to_resource)
            text = "" if rewritten is None else yaml.safe_dump(rewritten, allow_unicode=True, sort_keys=False)
            yaml_files[dest] = _normalize_bank_yaml_text(text) if text else ""

        plan = WritePlan(project_root=project_root, target_library=target_lib)
        plan.yaml_writes = yaml_files
        plan.extra_writes = image_files
        plan.written_count = len(yaml_files)
        plan.warnings = warnings
        return plan

    qyaml = source.questions_yaml()
    if qyaml is None:
        raise FileNotFoundError("ZIP 内未找到 yaml/ 目录或 questions.yaml")
    raw = yaml.safe_load(source.read_text(qyaml))
    if raw is None:
        raise ValueError("questions.yaml 为空")

    unique_rels = list(dict.fromkeys(_collect_embed_rels_from_value(raw)))
    pkg_to_resource: dict[str, str] = {}
    image_files: dict[Path, bytes] = {}
    for rel in unique_rels:
        member = source.resolve_embed(rel)
        if member is None:
            warnings.append(f"未找到图片文件，保留占位符: {rel}")
            continue
        if source.file_size(member) > _MAX_BANK_IMAGE_BYTES:
            warnings.append(f"跳过大文件: {rel}")
            continue
        ext = member.path.suffix.lower() or ".png"
        if ext not in _ALLOWED_BANK_IMAGE_EXT:
            warnings.append(f"跳过不支持的格式: {rel}")
            continue
        data = source.read_bytes(member)
        digest = hashlib.sha256(data).hexdigest()[:16]
        dest = image_dir / f"{digest}{ext}"
        assert_within_project(project_root, dest)
        image_files[dest.resolve()] = data
        pkg_to_resource[rel] = _rel_to_resource(project_root, dest)

    rewritten_raw = _rewrite_embeds_in_value(raw, pkg_to_resource)
    merged_yaml = yaml.safe_dump(rewritten_raw, allow_unicode=True, sort_keys=False)
    plan = plan_merged_import(snapshot, merged_yaml, extra_files=image_files)
    plan.warnings = warnings
    return plan
