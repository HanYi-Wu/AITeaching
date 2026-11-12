"""Actor-scoped question catalog and historical exam reads for auto composition."""

from __future__ import annotations

from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass, field, replace
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import unicodedata
from typing import Any, Iterable

import yaml

from solaire.common.actor_context import actor
from solaire.common.security import assert_within_project
from solaire.common.yaml_utils import safe_load_yaml
from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.web.bank_storage import read_bank_library
from solaire.web.library_discovery import discover_question_library_refs, library_root_for_namespace
from solaire.web.platform_db import connect, default_platform_root, platform_db_path


@dataclass
class Candidate:
    """One selectable question or question group.

    Numeric difficulty metadata uses the convention that larger means harder:
    [0, 1/3] -> easy, (1/3, 2/3] -> medium, and (2/3, 1] -> hard.
    Unknown values remain ``unknown`` and are never presented as medium.
    """

    qid: str
    subject: str
    namespace: str
    type: str
    difficulty: str
    knowledge: frozenset[str]
    content: str
    options: dict[str, str]
    fingerprint: str
    text: str
    exam_id: str | None = None
    exam_title: str | None = None
    knowledge_names: dict[str, str] = field(default_factory=dict)


_DIFFICULTY_RANK = {"easy": 0, "medium": 1, "hard": 2}
_KNOWLEDGE_SPLIT_RE = re.compile(r"[,，、;；\n]+")


def _mapping(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _strings(value: object) -> list[str]:
    if isinstance(value, str):
        values: Iterable[object] = _KNOWLEDGE_SPLIT_RE.split(value)
    elif isinstance(value, (list, tuple, set, frozenset)):
        values = value
    else:
        return []
    result: list[str] = []
    for item in values:
        if isinstance(item, str):
            text = item.strip()
            if text:
                result.append(text)
    return result


def _difficulty(metadata: object) -> str:
    raw = _mapping(metadata).get("difficulty")
    if isinstance(raw, bool) or raw is None:
        return "unknown"
    if isinstance(raw, (int, float)):
        number = float(raw)
        if not 0.0 <= number <= 1.0:
            return "unknown"
        if number <= 1.0 / 3.0:
            return "easy"
        if number <= 2.0 / 3.0:
            return "medium"
        return "hard"
    value = unicodedata.normalize("NFKC", str(raw)).strip().casefold()
    labels = {
        "easy": "easy", "low": "easy", "低": "easy", "简单": "easy", "容易": "easy",
        "medium": "medium", "中": "medium", "中等": "medium", "适中": "medium",
        "hard": "hard", "high": "hard", "高": "hard", "难": "hard", "困难": "hard",
    }
    if value in labels:
        return labels[value]
    try:
        number = float(value)
    except ValueError:
        return "unknown"
    if not 0.0 <= number <= 1.0:
        return "unknown"
    if number <= 1.0 / 3.0:
        return "easy"
    if number <= 2.0 / 3.0:
        return "medium"
    return "hard"


def _hardest(values: Iterable[str]) -> str:
    known = [value for value in values if value in _DIFFICULTY_RANK]
    return max(known, key=_DIFFICULTY_RANK.__getitem__) if known else "unknown"


def _option_values(options: object) -> list[str]:
    if not isinstance(options, dict):
        return []
    values = [str(value).strip() for value in options.values() if value is not None and str(value).strip()]
    return sorted(values, key=_exact_normalize)


def _exact_normalize(value: str) -> str:
    """Normalize whitespace and Unicode while preserving digits and operators."""
    # Case may identify different mathematical variables (x and X). Case-folded
    # comparisons belong in the similarity pass, not the exact identity hash.
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(character for character in normalized if not character.isspace())


def _question_text(content: object, options: object = None) -> str:
    parts = [str(content or "").strip()]
    option_values = _option_values(options)
    if option_values:
        parts.append("选项：" + "；".join(option_values))
    return "\n".join(part for part in parts if part)


def _fingerprint(text: str) -> str:
    canonical = _exact_normalize(text)
    return "exact-v1:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _graph_indexes(state: object) -> tuple[dict[str, Any], dict[str, set[str]], dict[str, set[str]]]:
    nodes_by_id: dict[str, Any] = {}
    ids_by_token: dict[str, set[str]] = defaultdict(set)
    bindings_by_qid: dict[str, set[str]] = defaultdict(set)
    for node in getattr(state, "nodes", []) or []:
        node_id = str(getattr(node, "id", "") or "").strip()
        canonical = str(getattr(node, "canonical_name", "") or "").strip()
        if not node_id:
            continue
        nodes_by_id[node_id] = node
        ids_by_token[_token_key(node_id)].add(node_id)
        if canonical:
            ids_by_token[_token_key(canonical)].add(node_id)
        for alias in getattr(node, "aliases", []) or []:
            if str(alias).strip():
                ids_by_token[_token_key(str(alias))].add(node_id)
    for binding in getattr(state, "bindings", []) or []:
        qid = str(getattr(binding, "question_qualified_id", "") or "").strip()
        node_id = str(getattr(binding, "node_id", "") or "").strip()
        if qid and node_id:
            bindings_by_qid[qid].add(node_id)
    return nodes_by_id, ids_by_token, bindings_by_qid


def _token_key(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def _resolve_knowledge(
    qid: str,
    metadata_values: Iterable[object],
    nodes_by_id: dict[str, Any],
    ids_by_token: dict[str, set[str]],
    bindings_by_qid: dict[str, set[str]],
) -> tuple[frozenset[str], dict[str, str]]:
    knowledge: set[str] = set()
    node_ids = set(bindings_by_qid.get(qid, set()))
    for value in metadata_values:
        for token in _strings(value):
            knowledge.add(token)
            node_ids.update(ids_by_token.get(_token_key(token), set()))
    for node_id in node_ids:
        node = nodes_by_id.get(node_id)
        if node is None:
            knowledge.add(node_id)
            continue
        canonical = str(getattr(node, "canonical_name", "") or "").strip()
        knowledge.add(node_id)
        if canonical:
            knowledge.add(canonical)
        for alias in getattr(node, "aliases", []) or []:
            alias = str(alias).strip()
            if alias:
                knowledge.add(alias)
    names = {
        node_id: str(getattr(nodes_by_id[node_id], "canonical_name", "") or node_id)
        for node_id in node_ids if node_id in nodes_by_id
    }
    return frozenset(knowledge), names


def _record_parts(record: QuestionItem | QuestionGroupRecord) -> tuple[str, str, dict[str, str], list[dict[str, Any]], list[object]]:
    if isinstance(record, QuestionItem):
        options = {str(key): str(value) for key, value in (record.options or {}).items()}
        text = _question_text(record.content, record.options)
        metadata = dict(record.metadata or {})
        return record.type, text, options, [metadata], [_difficulty(metadata)]

    unified_type = record.unified if isinstance(record.unified, str) else "group"
    type_name = unified_type
    parts = ["材料：" + str(record.material or "").strip()] if str(record.material or "").strip() else []
    combined_options: dict[str, str] = {}
    metadata_values: list[object] = []
    difficulties: list[str] = []
    for index, item in enumerate(record.items, start=1):
        item_data = item.model_dump(mode="json") if hasattr(item, "model_dump") else _mapping(item)
        content = str(item_data.get("content") or "").strip()
        parts.append(f"小题{index}：{content}" if content else f"小题{index}：")
        options = item_data.get("options")
        option_values = _option_values(options)
        if option_values:
            parts.append("小题选项：" + "；".join(option_values))
        if isinstance(options, dict):
            for key, value in options.items():
                combined_options[f"{index}.{key}"] = str(value)
        metadata = _mapping(item_data.get("metadata"))
        metadata_values.append(metadata)
        difficulties.append(_difficulty(metadata))
    text = "\n".join(parts)
    return type_name, text, combined_options, metadata_values, difficulties


def _candidate_from_record(
    namespace: str,
    record: QuestionItem | QuestionGroupRecord,
    nodes_by_id: dict[str, Any],
    ids_by_token: dict[str, set[str]],
    bindings_by_qid: dict[str, set[str]],
) -> Candidate:
    qid = f"{namespace}/{record.id}"
    qtype, text, options, metadata_values, difficulties = _record_parts(record)
    points = [value for metadata in metadata_values for value in _strings(_mapping(metadata).get("knowledge_points"))]
    knowledge, names = _resolve_knowledge(qid, points, nodes_by_id, ids_by_token, bindings_by_qid)
    subject = namespace.split("/", 1)[0]
    return Candidate(
        qid=qid,
        subject=subject,
        namespace=namespace,
        type=qtype,
        difficulty=_hardest(difficulties),
        knowledge=knowledge,
        content=text,
        options=options,
        fingerprint=_fingerprint(text),
        text=text,
        knowledge_names=names,
    )


def _read_graph(project_root: Path, warnings: list[str]) -> tuple[dict[str, Any], dict[str, set[str]], dict[str, set[str]]]:
    user = actor.get()
    # Match actor_scope.teacher_graph_root without initializing a new workspace
    # during a read. Graph mutations remain the graph service's responsibility.
    graph_root = project_root
    if user and user.get("role") == "teacher":
        from solaire.common.security import safe_filename_component
        graph_root = project_root / ".solaire" / "teacher_graphs" / safe_filename_component(str(user.get("id") or "teacher"))
    graph_dir = graph_root / "resource" / "graph"
    # A catalog read should not create an empty graph or trigger legacy migration.
    if not graph_dir.is_dir():
        return {}, {}, {}
    try:
        assert_within_project(project_root, graph_dir)
        if not any(graph_dir.glob("*.yaml")):
            return {}, {}, {}
        from solaire.knowledge_forge.models import GraphState
        from solaire.knowledge_forge.storage import _load_meta
        from solaire.knowledge_forge.snapshot_commands.yaml_codec import safe_yaml_load
        from solaire.knowledge_forge.paths import _subject_state_path

        # load_graph() is a legacy first-subject read. Inspect all persisted
        # subjects directly, without triggering graph migrations on this route.
        meta = _load_meta(graph_root)
        paths = [_subject_state_path(graph_root, subject.slug) for subject in meta.subjects]
        if not paths and (graph_dir / "state.yaml").is_file():
            paths = [graph_dir / "state.yaml"]
        nodes, tokens, bindings = {}, defaultdict(set), defaultdict(set)
        for path in paths:
            try:
                assert_within_project(project_root, path)
                if not path.is_file():
                    warnings.append("知识图谱中存在缺失的学科数据文件，部分绑定可能未参与覆盖率计算。")
                    continue
                raw = safe_yaml_load(path.read_text(encoding="utf-8"))
                state = GraphState.model_validate(raw or {})
            except (OSError, UnicodeError, ValueError, yaml.YAMLError) as error:
                warnings.append(f"跳过无法读取的知识图谱 {path.name}：{type(error).__name__}，其余图谱继续参与计算。")
                continue
            subject_nodes, subject_tokens, subject_bindings = _graph_indexes(state)
            nodes.update(subject_nodes)
            for key, values in subject_tokens.items():
                tokens[key].update(values)
            for key, values in subject_bindings.items():
                bindings[key].update(values)
        return nodes, dict(tokens), dict(bindings)
    except Exception as error:
        warnings.append(f"知识图谱读取失败，未加载知识点绑定：{type(error).__name__}: {str(error)[:160]}")
        return {}, {}, {}


def load_catalog(root: Path) -> tuple[list[Candidate], list[str]]:
    """Load only the current actor's discoverable question libraries.

    Damaged YAML files and every occurrence of a duplicate local ID are skipped
    with warnings. Other filesystem, permission, and programming errors surface.
    """
    project_root = Path(root).resolve()
    warnings: list[str] = []
    nodes_by_id, ids_by_token, bindings_by_qid = _read_graph(project_root, warnings)
    candidates: list[Candidate] = []
    for ref in discover_question_library_refs(project_root):
        namespace = str(ref["namespace"])
        library = library_root_for_namespace(project_root, namespace)
        assert_within_project(project_root, library)
        index = read_bank_library(project_root, library)
        for diagnostic in index.diagnostics:
            warnings.append(
                f"跳过损坏题库文件 {namespace}/{diagnostic.get('storage_path', '')}："
                f"{diagnostic.get('message', '无法读取')}"
            )
        duplicate_ids = set(index.duplicates)
        for qid in sorted(duplicate_ids):
            warnings.append(f"跳过重复题号 {namespace}/{qid}（该题集内存在多个同号记录）")
        for document in index.documents:
            for record in document.records:
                if record.id in duplicate_ids:
                    continue
                candidate = _candidate_from_record(
                    namespace, record, nodes_by_id, ids_by_token, bindings_by_qid,
                )
                if not candidate.text.strip():
                    warnings.append(f"跳过没有题面的题目 {candidate.qid}，请先补充题目内容。")
                    continue
                candidates.append(candidate)
    return candidates, list(dict.fromkeys(warnings))


def _clean_exam_id(value: object) -> str:
    return str(value or "").strip().replace("\\", "/").strip("/").casefold()


def _owner_claims(raw: object) -> set[str]:
    data = _mapping(raw)
    metadata = _mapping(data.get("metadata"))
    values = (data.get("owner_teacher_id"), metadata.get("owner_teacher_id"))
    return {str(value).strip() for value in values if str(value or "").strip()}


def _database_rows(platform_root: Path) -> tuple[dict[str, dict[str, Any]], list[sqlite3.Row]]:
    """Read existing platform records without initializing the platform database."""
    path = platform_db_path(platform_root)
    if not path.is_file():
        return {}, []
    with closing(connect(platform_root)) as connection:
        paper_rows = connection.execute(
            "SELECT exam_id, owner_teacher_id, title, subject FROM paper_records"
        ).fetchall()
        user = actor.get()
        teacher = str(user.get("id") or "") if user and user.get("role") == "teacher" else None
        scope_sql = ""
        params: tuple[str, ...] = ()
        if teacher is not None:
            scope_sql = " AND (p.owner_teacher_id = ? OR p.owner_teacher_id IS NULL) AND ep.teacher_id = ?"
            params = (teacher, teacher)
        attempt_rows = connection.execute(
            """
            SELECT DISTINCT p.exam_id, p.owner_teacher_id, p.title AS paper_title,
                   p.subject AS paper_subject,
                   ep.title AS publication_title, sa.question_payload_json
            FROM student_attempts sa
            JOIN exam_publications ep ON ep.id = sa.publication_id
            JOIN paper_records p ON p.id = ep.paper_id
            WHERE sa.question_payload_json IS NOT NULL
              AND TRIM(sa.question_payload_json) != ''
            """ + scope_sql,
            params,
        ).fetchall()
    by_exam: dict[str, dict[str, Any]] = {}
    for row in paper_rows:
        exam_id = str(row["exam_id"] or "").strip()
        if not exam_id:
            continue
        key = _clean_exam_id(exam_id)
        entry = by_exam.setdefault(key, {"exam_id": exam_id, "owners": set(), "rows": []})
        owner = str(row["owner_teacher_id"] or "").strip()
        if owner:
            entry["owners"].add(owner)
        entry["rows"].append(row)
    return by_exam, attempt_rows


def _exam_workspace_files(project_root: Path) -> list[tuple[str, Path]]:
    exams_root = project_root / "exams"
    if not exams_root.is_dir():
        return []
    assert_within_project(project_root, exams_root)
    found: list[tuple[str, Path]] = []
    for label_dir in sorted(exams_root.iterdir(), key=lambda item: item.name.casefold()):
        if not label_dir.is_dir():
            continue
        for subject_dir in sorted(label_dir.iterdir(), key=lambda item: item.name.casefold()):
            if not subject_dir.is_dir():
                continue
            path = subject_dir / "exam.yaml"
            if not path.is_file():
                continue
            # An ACL check here would reject the whole scan on the first other
            # teacher's exam. Check containment now; check ACLs after ownership
            # filtering in load_history(), without reading foreign question data.
            if not path.resolve().is_relative_to(project_root.resolve()):
                continue
            found.append((f"{label_dir.name}/{subject_dir.name}", path))
    return found


def _selected_qids(raw_exam: object) -> list[str]:
    data = _mapping(raw_exam)
    sections = data.get("selected_items")
    if not isinstance(sections, list):
        return []
    result: list[str] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        qids = section.get("question_ids")
        if isinstance(qids, list):
            result.extend(str(qid).strip() for qid in qids if str(qid or "").strip())
    return result


def _exam_title(raw_exam: object, db_entry: dict[str, Any] | None, exam_id: str) -> str:
    if db_entry:
        for row in db_entry["rows"]:
            title = str(row["title"] or "").strip()
            if title:
                return title
    data = _mapping(raw_exam)
    metadata = _mapping(data.get("metadata"))
    for key in ("title", "name"):
        value = str(metadata.get(key) or data.get(key) or "").strip()
        if value:
            return value
    return exam_id


def _candidate_from_snapshot(
    question: dict[str, Any],
    *,
    subject: str,
    exam_id: str,
    exam_title: str,
    nodes_by_id: dict[str, Any],
    ids_by_token: dict[str, set[str]],
    bindings_by_qid: dict[str, set[str]],
) -> Candidate | None:
    raw_qid = str(question.get("question_id") or question.get("qid") or question.get("id") or "").strip()
    if not raw_qid:
        return None
    qid = raw_qid
    if "/" in qid:
        namespace = qid.rsplit("/", 1)[0]
        resolved_subject = namespace.split("/", 1)[0]
    else:
        namespace = subject or "unknown"
        resolved_subject = subject or "unknown"
        qid = f"{namespace}/{qid}"
    content = str(question.get("content") or question.get("material") or "").strip()
    options = question.get("options") if isinstance(question.get("options"), dict) else {}
    qtype = str(question.get("type") or "unknown").strip()
    if not content or content == raw_qid or qtype in {"", "unknown"}:
        return None
    if qtype == "choice":
        qtype = "single_choice"
    metadata = _mapping(question.get("metadata"))
    text = _question_text(content, options)
    if qtype == "group" and isinstance(question.get("items"), list):
        parts = ["材料：" + content] if content else []
        flattened_options: dict[str, str] = {}
        all_metadata: list[dict[str, Any]] = []
        for index, item in enumerate(question["items"], start=1):
            if not isinstance(item, dict):
                continue
            item_content = str(item.get("content") or "").strip()
            parts.append(f"小题{index}：{item_content}")
            item_options = item.get("options")
            values = _option_values(item_options)
            if values:
                parts.append("小题选项：" + "；".join(values))
            if isinstance(item_options, dict):
                flattened_options.update({f"{index}.{key}": str(value) for key, value in item_options.items()})
            all_metadata.append(_mapping(item.get("metadata")))
        text = "\n".join(parts)
        options = flattened_options
        metadata_points = [value for item in all_metadata for value in _strings(item.get("knowledge_points"))]
        difficulty = _hardest(_difficulty(item) for item in all_metadata)
        if isinstance(question.get("unified"), str):
            qtype = question["unified"]
    else:
        metadata_points = _strings(metadata.get("knowledge_points"))
        difficulty = _difficulty(metadata)
    knowledge, names = _resolve_knowledge(qid, metadata_points, nodes_by_id, ids_by_token, bindings_by_qid)
    return Candidate(
        qid=qid,
        subject=resolved_subject,
        namespace=namespace,
        type=qtype,
        difficulty=difficulty,
        knowledge=knowledge,
        content=text,
        options={str(key): str(value) for key, value in options.items()},
        fingerprint=_fingerprint(text),
        text=text,
        exam_id=exam_id,
        exam_title=exam_title,
        knowledge_names=names,
    )


def load_history(
    root: Path,
    bank: list[Candidate],
    exclude_exam_id: str | None = None,
) -> tuple[list[Candidate], list[str]]:
    """Load visible exam references and distinct frozen student question snapshots.

    Existing frozen snapshots replace the corresponding current-bank reference for
    that exam/qid. Multiple students with the same frozen source do not multiply
    history entries. An absent platform database is treated as having no platform
    history and is never initialized here.
    """
    project_root = Path(root).resolve()
    current_actor = actor.get()
    teacher_id = str(current_actor.get("id") or "").strip() if current_actor and current_actor.get("role") == "teacher" else None
    restricted_actor = bool(current_actor and current_actor.get("role") not in {"teacher", "admin"})
    warnings: list[str] = []
    if restricted_actor:
        return [], ["当前角色无权读取历史试卷题面。"]
    excluded = _clean_exam_id(exclude_exam_id)
    bank_by_qid: dict[str, Candidate] = {}
    for candidate in bank:
        bank_by_qid.setdefault(candidate.qid, candidate)

    db_by_exam: dict[str, dict[str, Any]] = {}
    attempt_rows: list[sqlite3.Row] = []
    platform = default_platform_root()
    if platform_db_path(platform).is_file():
        try:
            db_by_exam, attempt_rows = _database_rows(platform)
        except sqlite3.Error as error:
            warnings.append(
                f"平台作答冻结题面无法读取，漏查数量未知：{type(error).__name__}: {str(error)[:160]}"
            )

    # Do not load or expose another teacher's exam title or selected question IDs.
    file_history: dict[tuple[str, str], Candidate] = {}
    allowed_exam_raw: dict[str, object] = {}
    allowed_exam_title: dict[str, str] = {}
    rejected_exam_keys: set[str] = set()
    unresolved_refs: set[tuple[str, str]] = set()
    unreadable_owned_exams = 0
    ownership_conflicts = 0
    for exam_id, exam_yaml in _exam_workspace_files(project_root):
        normalized_exam_id = _clean_exam_id(exam_id)
        if excluded and normalized_exam_id == excluded:
            continue
        entry = db_by_exam.get(normalized_exam_id)
        db_owners = set(entry["owners"]) if entry else set()
        if teacher_id and db_owners and (len(db_owners) != 1 or teacher_id not in db_owners):
            if teacher_id in db_owners:
                ownership_conflicts += 1
            continue
        try:
            assert_within_project(project_root, exam_yaml)
            raw_exam = safe_load_yaml(exam_yaml.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError, ValueError, PermissionError):
            if teacher_id and db_owners == {teacher_id}:
                unreadable_owned_exams += 1
            continue
        if not isinstance(raw_exam, dict):
            if teacher_id and db_owners == {teacher_id}:
                unreadable_owned_exams += 1
            continue
        claims = _owner_claims(raw_exam)
        if len(claims) > 1 or (db_owners and claims and next(iter(db_owners)) not in claims):
            if not teacher_id or teacher_id in claims or teacher_id in db_owners:
                ownership_conflicts += 1
            rejected_exam_keys.add(normalized_exam_id)
            continue
        if teacher_id:
            metadata_owner = next(iter(claims), "")
            explicit_db_owner = (db_owners == {teacher_id})
            if not explicit_db_owner and metadata_owner != teacher_id:
                continue
        allowed_exam_raw[normalized_exam_id] = raw_exam
        title = _exam_title(raw_exam, entry, exam_id)
        allowed_exam_title[normalized_exam_id] = title
        for qid in dict.fromkeys(_selected_qids(raw_exam)):
            candidate = bank_by_qid.get(qid)
            if candidate is None:
                unresolved_refs.add((normalized_exam_id, qid))
                continue
            file_history[(normalized_exam_id, qid)] = replace(
                candidate, exam_id=exam_id, exam_title=title,
            )

    nodes_by_id, ids_by_token, bindings_by_qid = _read_graph(project_root, warnings)
    snapshots: dict[tuple[str, str, str], Candidate] = {}
    snapshot_qids: set[tuple[str, str]] = set()
    malformed_snapshots = 0
    partial_groups: set[tuple[str, str]] = set()
    for row in attempt_rows:
        exam_id = str(row["exam_id"] or "").strip()
        normalized_exam_id = _clean_exam_id(exam_id)
        if not exam_id or normalized_exam_id in rejected_exam_keys or (excluded and normalized_exam_id == excluded):
            continue
        entry = db_by_exam.get(normalized_exam_id)
        db_owners = set(entry["owners"]) if entry else set()
        if teacher_id:
            if db_owners and (len(db_owners) != 1 or teacher_id not in db_owners):
                continue
            claims = _owner_claims(allowed_exam_raw.get(normalized_exam_id))
            if db_owners != {teacher_id} and teacher_id not in claims:
                continue
            if len(claims) > 1 or (db_owners and claims and next(iter(db_owners)) not in claims):
                continue
        raw_payload = row["question_payload_json"]
        try:
            payload = json.loads(str(raw_payload))
        except (json.JSONDecodeError, TypeError, ValueError):
            malformed_snapshots += 1
            continue
        if not isinstance(payload, list):
            malformed_snapshots += 1
            continue
        paper_subject = str(row["paper_subject"] or "").strip()
        title = allowed_exam_title.get(normalized_exam_id) or str(row["paper_title"] or row["publication_title"] or exam_id)
        for question in payload:
            if not isinstance(question, dict):
                malformed_snapshots += 1
                continue
            candidate = _candidate_from_snapshot(
                question,
                subject=paper_subject,
                exam_id=exam_id,
                exam_title=title,
                nodes_by_id=nodes_by_id,
                ids_by_token=ids_by_token,
                bindings_by_qid=bindings_by_qid,
            )
            if candidate is None:
                malformed_snapshots += 1
                continue
            key_exam_qid = (normalized_exam_id, candidate.qid)
            key = (normalized_exam_id, candidate.qid, candidate.fingerprint)
            snapshots.setdefault(key, candidate)
            snapshot_qids.add(key_exam_qid)
            if question.get("type") == "group" and not isinstance(question.get("items"), list):
                partial_groups.add(key_exam_qid)

    history = [candidate for (exam_key, qid), candidate in file_history.items()
               if (exam_key, qid) not in snapshot_qids]
    reused_current_count = len(history)
    unresolved_exam_refs = len(unresolved_refs - snapshot_qids)
    history.extend(snapshots.values())
    if reused_current_count:
        warnings.append(
            f"历史试卷有 {reused_current_count} 个题目引用复用了当前题库内容，可能与出卷时版本不同。"
        )
    if unresolved_exam_refs:
        warnings.append(f"历史试卷有 {unresolved_exam_refs} 个题目引用在当前可见题库中已不存在，无法读取原题面。")
    if unreadable_owned_exams:
        warnings.append(f"有 {unreadable_owned_exams} 份当前教师归属的历史试卷无法读取，漏查题面数量未知。")
    if ownership_conflicts:
        warnings.append(f"有 {ownership_conflicts} 份历史试卷归属信息冲突，已拒绝读取其题面。")
    if malformed_snapshots:
        warnings.append(f"平台作答冻结题面有 {malformed_snapshots} 个题目条目无法解析，已跳过。")
    if partial_groups:
        warnings.append(f"有 {len(partial_groups)} 个历史题组的冻结题面仅含材料，未保存的小题内容无法完整比对。")
    history.sort(key=lambda item: (
        _clean_exam_id(item.exam_id), item.qid, item.fingerprint,
    ))
    return history, list(dict.fromkeys(warnings))

