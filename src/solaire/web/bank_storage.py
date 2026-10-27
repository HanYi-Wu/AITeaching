"""Library-scoped read/modify/write support for existing question YAML files."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import threading
from typing import Any

import yaml

from solaire.exam_compiler.models import BankRecord, QuestionGroupRecord, QuestionItem, parse_bank_root
from solaire.exam_compiler.loaders.questions import iter_question_files
from solaire.web.security import assert_within_project

_LOCKS: dict[str, threading.RLock] = {}
_LOCK_GUARD = threading.Lock()


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


def read_bank_document(path: Path) -> BankDocument:
    text = path.read_text(encoding="utf-8")
    raw = yaml.safe_load(text)
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


def find_bank_record(project_root: Path, library: Path, qid: str) -> tuple[BankDocument, int] | None:
    found = None
    for path in iter_question_files(library):
        assert_within_project(project_root, path)
        document = read_bank_document(path)
        for index, record in enumerate(document.records):
            if record.id == qid:
                if found is not None:
                    raise ValueError(f"题集中存在重复题目编号，请先修正 YAML: {qid}")
                found = (document, index)
    return found


def replace_record_data(document: BankDocument, index: int, replacement: dict[str, Any]) -> Any:
    """Keep adjacent records and extension fields outside the authoring schema."""
    previous = document.record_data(index)
    known = set(QuestionItem.model_fields) | set(QuestionGroupRecord.model_fields)
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
