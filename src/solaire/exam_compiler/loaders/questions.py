"""Load per-file question YAML from each library; index by qualified id (namespace/root_id)."""

from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass, field
from io import StringIO
from pathlib import Path
import stat
import sys
from threading import RLock
from typing import Iterator

import yaml

from solaire.common.yaml_utils import safe_load_yaml
from solaire.exam_compiler.models import BankRecord, parse_bank_root


@dataclass
class LoadedQuestions:
    """qualified_id -> standalone question or whole group record; namespace -> library root for assets."""

    by_qualified: dict[str, BankRecord] = field(default_factory=dict)
    library_roots: dict[str, Path] = field(default_factory=dict)


@dataclass(frozen=True)
class _ParsedQuestionFile:
    records: list[BankRecord]
    record_ids: tuple[str, ...]


class _QuestionParseCache:
    """Small process-local cache keyed by the exact decoded source text.

    The caller still reads the file for every load, so even same-size edits with
    restored timestamps are visible. Cached models are private snapshots: each
    caller receives its own mutable Pydantic object graph.
    """

    MAX_ENTRIES = 4096
    MAX_FILE_BYTES = 64 * 1024
    MAX_WEIGHT_BYTES = 24 * 1024 * 1024

    def __init__(self) -> None:
        self._lock = RLock()
        self._items: OrderedDict[
            tuple[str, str], tuple[list[BankRecord], tuple[str, ...], int]
        ] = OrderedDict()
        self._misses: OrderedDict[tuple[str, int, int], int] = OrderedDict()
        self._weight = 0

    @staticmethod
    def _deep_size(value: object) -> int:
        """Estimate retained Python object size without counting shared objects twice."""
        total = 0
        pending = [value]
        seen: set[int] = set()
        while pending:
            current = pending.pop()
            identity = id(current)
            if identity in seen:
                continue
            seen.add(identity)
            total += sys.getsizeof(current)
            if isinstance(current, dict):
                pending.extend(current.keys())
                pending.extend(current.values())
            elif isinstance(current, (list, tuple, set, frozenset)):
                pending.extend(current)
            elif hasattr(current, "__dict__"):
                pending.append(vars(current))
        return total

    def get(
        self,
        namespace: str,
        text: str,
        selected_qualified_ids: set[str] | None = None,
    ) -> _ParsedQuestionFile | None:
        key = (namespace, text)
        with self._lock:
            entry = self._items.get(key)
            if entry is None:
                self._remember_miss(namespace, text)
                return None
            self._items.move_to_end(key)
            snapshot, record_ids, _weight = entry
        # The cache never mutates snapshots. Copy after releasing the lock so a
        # large group doesn't serialize unrelated concurrent library loads.
        selected = (
            snapshot
            if selected_qualified_ids is None
            else [
                record
                for record in snapshot
                if f"{namespace}/{record.id}" in selected_qualified_ids
            ]
        )
        return _ParsedQuestionFile(deepcopy(selected), record_ids)

    def put(self, namespace: str, text: str, records: list[BankRecord]) -> bool:
        text_size = len(text.encode("utf-8"))
        if text_size > self.MAX_FILE_BYTES:
            return False
        key = (namespace, text)
        miss_key = (namespace, hash(text), len(text))
        with self._lock:
            if key in self._items:
                return False
            if self._misses.get(miss_key, 0) < 2:
                return False
            self._misses.pop(miss_key, None)

        # Parsed records are fresh and still privately owned here. Once stored,
        # callers receive copies below rather than references to this snapshot.
        snapshot = records
        record_ids = tuple(record.id for record in snapshot)
        weight = text_size + self._deep_size(snapshot) + 128
        if weight > self.MAX_WEIGHT_BYTES:
            return False
        with self._lock:
            # A concurrent parse may have populated the same exact source while
            # this caller was taking its private snapshot.
            if key in self._items:
                return False
            self._items[key] = (snapshot, record_ids, weight)
            self._weight += weight
            while (
                len(self._items) > self.MAX_ENTRIES
                or self._weight > self.MAX_WEIGHT_BYTES
            ):
                _, (_records, _record_ids, removed_weight) = self._items.popitem(last=False)
                self._weight -= removed_weight
        return True

    def _remember_miss(self, namespace: str, text: str) -> None:
        if len(text) > self.MAX_FILE_BYTES:
            return
        key = (namespace, hash(text), len(text))
        count = min(2, self._misses.get(key, 0) + 1)
        self._misses[key] = count
        self._misses.move_to_end(key)
        while len(self._misses) > self.MAX_ENTRIES:
            self._misses.popitem(last=False)


_QUESTION_PARSE_CACHE = _QuestionParseCache()


def _iter_question_files(library_root: Path) -> Iterator[Path]:
    """
    Every ``*.yaml`` under the library except ``questions.yaml`` at the library root
    (merged pack is import-only, not part of discovery).
    """
    merged_file = library_root / "questions.yaml"
    merged_exists = merged_file.is_file()
    merged_res = merged_file.resolve() if merged_exists else None
    seen: set[Path] = set()
    resolved_parents: dict[Path, Path] = {}
    for p in sorted(library_root.rglob("*.yaml")):
        try:
            file_stat = p.lstat()
        except (FileNotFoundError, NotADirectoryError):
            # A concurrently removed entry is a normal discovery race.
            continue
        else:
            is_link = stat.S_ISLNK(file_stat.st_mode)
            if not is_link and not stat.S_ISREG(file_stat.st_mode):
                continue
            if is_link:
                try:
                    target_stat = p.stat()
                except (FileNotFoundError, NotADirectoryError):
                    continue
                if not stat.S_ISREG(target_stat.st_mode):
                    continue
        if merged_exists and p == merged_file:
            continue
        # Resolve each parent once rather than walking the full path for every file.
        # This also canonicalizes files reached through a symlinked/junction parent;
        # leaf symlinks still need their own target resolution.
        if is_link:
            rp = p.resolve()
        else:
            resolved_parent = resolved_parents.get(p.parent)
            if resolved_parent is None:
                resolved_parent = p.parent.resolve()
                resolved_parents[p.parent] = resolved_parent
            rp = resolved_parent / p.name
        if merged_exists and rp == merged_res:
            continue
        if rp in seen:
            continue
        seen.add(rp)
        yield p


def iter_question_files(library_root: Path) -> Iterator[Path]:
    """Public iterator over per-file question YAML under a library (see :func:`_iter_question_files`)."""
    yield from _iter_question_files(library_root)


def _load_yaml_text(path: Path, text: str) -> object:
    stream = StringIO(text)
    # PyYAML uses stream.name in diagnostics when available. StringIO permits
    # this attribute, matching the historical file-backed error wording.
    stream.name = str(path)
    try:
        return safe_load_yaml(stream)
    except yaml.YAMLError:
        # Keep the historical parser's acceptance boundaries and diagnostics
        # for syntax that LibYAML handles differently.
        stream.seek(0)
        return yaml.safe_load(stream)


def _parse_question_yaml(
    path: Path,
    namespace: str,
    text: str,
    selected_qualified_ids: set[str] | None = None,
) -> _ParsedQuestionFile:
    cached = _QUESTION_PARSE_CACHE.get(namespace, text, selected_qualified_ids)
    if cached is not None:
        return cached

    raw = _load_yaml_text(path, text)
    if raw is None:
        records: list[BankRecord] = []
    elif isinstance(raw, dict) and ("questions" in raw or "groups" in raw):
        raise ValueError(
            f"Legacy merged format not supported in {path}; use per-question files or the import pipeline."
        )
    elif isinstance(raw, list):
        records = [parse_bank_root(x) for x in raw]
    elif isinstance(raw, dict):
        records = [parse_bank_root(raw)]
    else:
        raise ValueError(f"Invalid YAML root in {path}")

    record_ids = tuple(record.id for record in records)
    cached_snapshot = _QUESTION_PARSE_CACHE.put(namespace, text, records)
    selected = (
        records
        if selected_qualified_ids is None
        else [
            record
            for record in records
            if f"{namespace}/{record.id}" in selected_qualified_ids
        ]
    )
    if cached_snapshot:
        selected = deepcopy(selected)
    return _ParsedQuestionFile(selected, record_ids)


def _load_question_file(
    path: Path,
    namespace: str,
    selected_qualified_ids: set[str] | None = None,
) -> _ParsedQuestionFile:
    text = path.read_text(encoding="utf-8")
    return _parse_question_yaml(path, namespace, text, selected_qualified_ids)


def load_questions_from_yaml_file(path: Path, namespace: str) -> list[BankRecord]:
    """Load one YAML file: single root object or list of roots. Legacy ``{questions,groups}`` is rejected."""
    return _load_question_file(path, namespace).records


def load_all_questions(
    exam_yaml: Path,
    question_libraries: list[tuple[str, str]],
    *,
    selected_qualified_ids: set[str] | None = None,
) -> LoadedQuestions:
    """Load and validate every library; optionally copy only selected root records.

    ``question_libraries`` contains ``(namespace, path_str relative to exam or
    absolute)`` pairs. Qualified ids are ``namespace/root_id``, where
    ``root_id`` is the file's id (standalone or group). A selection limits the
    returned mutable records only; every file and id is still parsed and checked.
    """
    exam_dir = exam_yaml.resolve().parent
    out = LoadedQuestions()
    seen_short: dict[tuple[str, str], Path] = {}
    seen_qualified: set[str] = set()

    for namespace, path_str in question_libraries:
        root = Path(path_str)
        if not root.is_absolute():
            root = (exam_dir / root).resolve()
        if not root.is_dir():
            raise FileNotFoundError(f"Question library not a directory: {root}")
        out.library_roots[namespace] = root

        for qfile in _iter_question_files(root):
            try:
                parsed = _load_question_file(qfile, namespace, selected_qualified_ids)
            except Exception as e:
                raise ValueError(f"Invalid questions file {qfile}: {e}") from e
            for root_id in parsed.record_ids:
                key_ns = (namespace, root_id)
                if key_ns in seen_short:
                    raise ValueError(
                        f"Duplicate question id '{root_id}' in namespace '{namespace}' "
                        f"(files: {seen_short[key_ns]} and {qfile})"
                    )
                seen_short[key_ns] = qfile
                qid = f"{namespace}/{root_id}"
                if qid in seen_qualified:
                    raise ValueError(f"Internal error: duplicate qualified id {qid}")
                seen_qualified.add(qid)
            for rec in parsed.records:
                out.by_qualified[f"{namespace}/{rec.id}"] = rec

    return out
