"""Library-scoped read/modify/write support for existing question YAML files."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import threading
from typing import Any

import yaml

from solaire.common.atomic_files import write_bytes_atomic, write_text_atomic
from solaire.common.yaml_utils import safe_load_yaml
from solaire.exam_compiler.models import BankRecord, QuestionGroupRecord, QuestionItem, parse_bank_root
from solaire.exam_compiler.loaders.questions import iter_question_files
from solaire.web.security import assert_within_project

_LOCKS: dict[str, threading.RLock] = {}
_LOCK_GUARD = threading.Lock()


class BankVersionConflict(ValueError):
    def __init__(self, current_version: str | None):
        super().__init__("该题目已被更新或移动，本地编辑已保留；请查看最新内容并核对后再保存")
        self.current_version = current_version


@contextmanager
def bank_write_lock(library: Path):
    """Serialize mutations of one library in the application process."""
    key = os.path.normcase(str(library.resolve()))
    with _LOCK_GUARD:
        lock = _LOCKS.setdefault(key, threading.RLock())
    with lock:
        yield


@dataclass
class BankDocument:
    path: Path
    text: str
    raw: Any
    records: list[BankRecord]

    def record_data(self, index: int) -> dict[str, Any]:
        return self.raw[index] if isinstance(self.raw, list) else self.raw


@dataclass
class BankLibraryIndex:
    """One request's parsed view of a library; never retained across requests."""

    library: Path
    documents: list[BankDocument]
    by_id: dict[str, tuple[BankDocument, int]]
    duplicates: dict[str, list[tuple[BankDocument, int]]]
    diagnostics: list[dict[str, str]]

    def find(self, qid: str) -> tuple[BankDocument, int] | None:
        matches = self.duplicates.get(qid)
        if matches:
            paths = ", ".join(dict.fromkeys(document.path.name for document, _ in matches))
            raise ValueError(f"题集中存在重复题目编号，请先修正 YAML: {qid} ({paths})")
        return self.by_id.get(qid)

    def require_unique_ids(self) -> None:
        if self.duplicates:
            qid = sorted(self.duplicates)[0]
            self.find(qid)

    def require_identity_complete(self, qid: str) -> None:
        if self.diagnostics:
            paths = ", ".join(item["storage_path"] for item in self.diagnostics)
            raise ValueError(f"存在无法读取的题目文件，无法确认新题号 {qid} 是否已存在: {paths}")


def _diagnostic_path(project_root: Path, path: Path) -> str:
    resource = (project_root / "resource").resolve()
    try:
        return path.resolve().relative_to(resource).as_posix()
    except ValueError:
        return path.name


def _diagnostic_message(path: Path, error: Exception) -> str:
    message = str(error).replace(str(path), path.name).replace(str(path.resolve()), path.name)
    first_line = next((line.strip() for line in message.splitlines() if line.strip()), type(error).__name__)
    return f"{type(error).__name__}: {first_line}"[:300]


def read_bank_library(project_root: Path, library: Path) -> BankLibraryIndex:
    """Read each YAML file once, keeping healthy records usable beside damaged files."""
    documents: list[BankDocument] = []
    by_id: dict[str, tuple[BankDocument, int]] = {}
    duplicates: dict[str, list[tuple[BankDocument, int]]] = {}
    diagnostics: list[dict[str, str]] = []
    for path in iter_question_files(library):
        assert_within_project(project_root, path)
        try:
            document = read_bank_document(path)
        except (OSError, UnicodeError, yaml.YAMLError, ValueError) as error:
            diagnostics.append({
                "storage_path": _diagnostic_path(project_root, path),
                "code": "invalid_question_file",
                "message": _diagnostic_message(path, error),
            })
            continue
        documents.append(document)
        for index, record in enumerate(document.records):
            location = (document, index)
            if record.id in by_id:
                duplicates.setdefault(record.id, [by_id[record.id]]).append(location)
            else:
                by_id[record.id] = location
    return BankLibraryIndex(library, documents, by_id, duplicates, diagnostics)


def read_bank_document(path: Path) -> BankDocument:
    text = path.read_text(encoding="utf-8")
    return parse_bank_document(path, text)


def parse_bank_document(path: Path, text: str) -> BankDocument:
    raw = safe_load_yaml(text)
    if raw is None:
        roots = []
    elif isinstance(raw, list):
        roots = raw
    elif isinstance(raw, dict) and not ("questions" in raw or "groups" in raw):
        roots = [raw]
    else:
        raise ValueError(f"Invalid question YAML root in {path}")
    if any(not isinstance(root, dict) for root in roots):
        raise ValueError(f"Invalid question record in {path}")
    return BankDocument(path, text, raw, [parse_bank_root(root) for root in roots])


def bank_record_version(project_root: Path, document: BankDocument, index: int) -> str:
    state = {"project": os.path.normcase(str(project_root.resolve())),
             "path": document.path.resolve().relative_to(project_root.resolve()).as_posix(),
             "record": document.record_data(index)}
    canonical = json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return "b1:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def find_bank_record(project_root: Path, library: Path, qid: str) -> tuple[BankDocument, int] | None:
    return read_bank_library(project_root, library).find(qid)


def replace_record_data(document: BankDocument, index: int, replacement: dict[str, Any]) -> Any:
    """Keep adjacent records and extension fields outside the authoring schema."""
    previous = document.record_data(index)
    model = QuestionGroupRecord if previous.get("type") == "group" else QuestionItem
    known = set(model.model_fields)
    updated = {key: value for key, value in previous.items() if key not in known}
    updated.update(replacement)
    if previous.get("type") == updated.get("type") == "group":
        item_fields = {"type", "content", "options", "answer", "analysis", "metadata"}
        old_items = previous.get("items") or []
        updated["items"] = [
            {**({key: value for key, value in old_items[i].items() if key not in item_fields}
                if i < len(old_items) and isinstance(old_items[i], dict) else {}), **item}
            for i, item in enumerate(updated["items"])
        ]
    if isinstance(document.raw, list):
        roots = list(document.raw)
        roots[index] = updated
        return roots
    return updated


def validate_bank_import(project_root: Path, library: Path, files: dict[Path, str]) -> None:
    """Check the resulting library before replacing any of its documents."""
    from solaire.web.bank_write_plan import WritePlan, capture_library_snapshot, validate_write_plan

    snapshot = capture_library_snapshot(project_root, library)
    plan = WritePlan(
        project_root=project_root,
        target_library=library,
        yaml_writes={path.resolve(): t for path, t in files.items()},
    )
    validate_write_plan(snapshot, plan)


def apply_bank_import(project_root: Path, files: dict[Path, str | bytes]) -> None:
    """Restore applied files if a replacement fails; no crash-wide transaction is implied."""
    from solaire.web.bank_write_plan import WritePlan, apply_write_plan

    yaml_writes: dict[Path, str] = {}
    extra_writes: dict[Path, bytes] = {}
    for path, content in files.items():
        if isinstance(content, str):
            yaml_writes[path] = content
        else:
            extra_writes[path] = content
    plan = WritePlan(
        project_root=project_root,
        target_library=project_root,
        yaml_writes=yaml_writes,
        extra_writes=extra_writes,
    )
    apply_write_plan(project_root, plan)
