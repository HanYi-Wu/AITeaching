"""Private exact-YAML fragment reuse for one-node COW saves."""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, replace
import hashlib
import os
from pathlib import Path
import re
import sys
import threading
import time
from typing import Any
import weakref

from solaire.knowledge_forge.models import (
    ConceptNode,
    GraphNodeNote,
    GraphState,
    GraphTaxonomy,
    NodeFileLink,
    NodeRelation,
    QuestionBinding,
)
from solaire.knowledge_forge.snapshot_commands.yaml_codec import safe_yaml_dump

_MAX_CACHE_BYTES = 4 * 1024 * 1024
_MAX_CACHE_ENTRIES = 4
_BOUNDARY_RE = re.compile(
    r"(?m)^(?:(?P<root>[A-Za-z_][A-Za-z0-9_-]*):[^\r\n]*"
    r"|-[ \t]+id: (?P<node_id>[A-Za-z0-9/_-]+)[ \t]*"
    r"|-(?![ \t]+id:)[ \t]+[^\r\n]*)$"
)
_ANCHOR_OR_ALIAS_RE = re.compile(
    r"(?m)(?:^|:[ \t]*|-[ \t]+|,[ \t]*|\[[ \t]*)[&*][A-Za-z0-9_-]+"
    r"(?=[ \t\r\n,\]\}]|$)"
)
_NODE_ID_RE = re.compile(r"[A-Za-z0-9/_-]+")

_StateRef = weakref.ReferenceType[GraphState]
_NodeRef = weakref.ReferenceType[ConceptNode]
_CacheKey = tuple[str, str]
_FileSignature = tuple[int, int, int]
_FileDigest = bytes


@dataclass(frozen=True, slots=True)
class _CacheSnapshot:
    state_ref: _StateRef
    node_refs: tuple[_NodeRef, ...]
    text: str | None
    fragments: tuple[str, ...] | None
    prefix: str | None
    suffix: str | None
    signature: _FileSignature | None
    digest: _FileDigest | None
    estimated_bytes: int


@dataclass(frozen=True, slots=True)
class NodeYamlSerialization:
    """Prepared bytes plus a cache candidate, published only after atomic success."""

    content: str
    snapshot: _CacheSnapshot | None
    cache_hit: bool
    reused_nodes: int
    serialized_nodes: int
    index_ns: int
    row_serialize_ns: int
    fallback_reason: str | None


_CACHE: OrderedDict[_CacheKey, _CacheSnapshot] = OrderedDict()
_CACHE_BYTES = 0
_CACHE_LOCK = threading.RLock()


def _key(project_root: Path, slug: str) -> _CacheKey:
    root = os.path.normcase(str(project_root.resolve()))
    return root, slug


def _signature(path: Path) -> _FileSignature:
    stat = path.stat()
    return stat.st_mtime_ns, stat.st_size, getattr(stat, "st_ino", 0)


def _digest(path: Path) -> _FileDigest:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "blake2b").digest()


def _digest_text(text: str) -> _FileDigest:
    return hashlib.blake2b(text.encode("utf-8")).digest()


def _supported_state(state: GraphState) -> bool:
    if type(state) is not GraphState or state.__pydantic_extra__:
        return False
    if list(GraphState.model_fields) != ["version", "taxonomy", "nodes", "relations", "bindings", "file_links"]:
        return False
    if type(state.taxonomy) is not GraphTaxonomy or state.taxonomy.__pydantic_extra__ or not state.nodes:
        return False
    if len({node.id for node in state.nodes}) != len(state.nodes):
        return False
    for node in state.nodes:
        if type(node) is not ConceptNode or node.__pydantic_extra__:
            return False
        for note in node.notes:
            if type(note) is not GraphNodeNote or note.__pydantic_extra__:
                return False
    for collection, model_type in (
        (state.relations, NodeRelation),
        (state.bindings, QuestionBinding),
        (state.file_links, NodeFileLink),
    ):
        if any(type(item) is not model_type or item.__pydantic_extra__ for item in collection):
            return False
    return True


def _estimate_bytes(prefix: str, suffix: str, refs: tuple[_NodeRef, ...], fragments: tuple[str, ...]) -> int:
    # Count actual Python string/reference containers plus a conservative per-slot allowance.
    estimate = (
        sys.getsizeof(prefix)
        + sys.getsizeof(suffix)
        + sys.getsizeof(refs)
        + sys.getsizeof(fragments)
        + 640
    )
    for ref, fragment in zip(refs, fragments):
        estimate += sys.getsizeof(ref) + sys.getsizeof(fragment) + 192
    return estimate


def _fragment_budget_allows(text: str) -> bool:
    # The native text alone is a strict lower bound on any retained snapshot.
    # Reject that definite over-budget case before creating regex matches or slices;
    # candidates that pass still get the exact fragment estimate after indexing.
    return sys.getsizeof(text) <= _MAX_CACHE_BYTES


def _index_full_dump(text: str, state: GraphState) -> tuple[str, str, tuple[str, ...]] | None:
    """Index a full native dump with one compiled C-regex scan; never parse YAML rows."""
    if not _supported_state(state):
        return None
    # Even before slicing, a snapshot must duplicate row strings plus refs/tuples.
    # This intentionally overestimates retained bytes so obviously oversized dumps
    # fall back before allocating the root/match/fragment lists.
    if not _fragment_budget_allows(text):
        return None
    if _ANCHOR_OR_ALIAS_RE.search(text):
        return None
    roots: list[re.Match[str]] = []
    matches: list[re.Match[str]] = []
    for match in _BOUNDARY_RE.finditer(text):
        if match.group("root") is not None:
            roots.append(match)
        else:
            matches.append(match)
    root_keys = [match.group("root") for match in roots]
    if root_keys != list(GraphState.model_fields):
        return None
    nodes_index = root_keys.index("nodes")
    section_start = roots[nodes_index].end()
    section_end = roots[nodes_index + 1].start() if nodes_index + 1 < len(roots) else len(text)
    node_matches = [match for match in matches if section_start <= match.start() < section_end]
    node_ids = [match.group("node_id") for match in node_matches]
    expected_ids = [node.id for node in state.nodes]
    if node_ids != expected_ids or len(node_matches) != len(state.nodes):
        return None
    starts = [match.start() for match in node_matches]
    fragments = tuple(
        text[start:(starts[i + 1] if i + 1 < len(starts) else section_end)]
        for i, start in enumerate(starts)
    )
    prefix = text[:starts[0]]
    suffix = text[section_end:]
    if prefix + "".join(fragments) + suffix != text:
        return None
    return prefix, suffix, fragments


def _snapshot(
    state: GraphState,
    content: str,
    prefix: str,
    suffix: str,
    fragments: tuple[str, ...],
) -> _CacheSnapshot | None:
    refs = tuple(weakref.ref(node) for node in state.nodes)
    size = _estimate_bytes(prefix, suffix, refs, fragments)
    if size > _MAX_CACHE_BYTES:
        return None
    return _CacheSnapshot(
        weakref.ref(state), refs, None, fragments, prefix, suffix, None, _digest_text(content), size
    )


def _pending_snapshot(state: GraphState, content: str) -> _CacheSnapshot | None:
    if not _supported_state(state) or not _fragment_budget_allows(content):
        return None
    if _ANCHOR_OR_ALIAS_RE.search(content):
        return None
    if any("/" not in node.id or _NODE_ID_RE.fullmatch(node.id) is None for node in state.nodes):
        return None
    ref_size = sys.getsizeof(weakref.ref(state.nodes[0]))
    rough_size = sys.getsizeof(content) + 640 + len(state.nodes) * (ref_size + 200)
    if rough_size > _MAX_CACHE_BYTES:
        return None
    refs = tuple(weakref.ref(node) for node in state.nodes)
    size = sys.getsizeof(content) + sys.getsizeof(refs) + 640
    size += sum(sys.getsizeof(ref) + 192 for ref in refs)
    if size > _MAX_CACHE_BYTES:
        return None
    return _CacheSnapshot(
        weakref.ref(state), refs, content, None, None, None, None, _digest_text(content), size
    )


def _lookup(key: _CacheKey) -> _CacheSnapshot | None:
    with _CACHE_LOCK:
        snapshot = _CACHE.get(key)
        if snapshot is not None:
            _CACHE.move_to_end(key)
        return snapshot


def _publish(key: _CacheKey, snapshot: _CacheSnapshot | None, path: Path) -> bool:
    global _CACHE_BYTES
    signature: _FileSignature | None = None
    if snapshot is not None:
        try:
            signature = _signature(path)
        except OSError:
            snapshot = None
    with _CACHE_LOCK:
        old = _CACHE.pop(key, None)
        if old is not None:
            _CACHE_BYTES -= old.estimated_bytes
        if snapshot is None:
            return False
        if snapshot.estimated_bytes > _MAX_CACHE_BYTES:
            return False
        if signature is None or snapshot.digest is None:
            return False
        published = replace(snapshot, signature=signature)
        while _CACHE and (
            len(_CACHE) >= _MAX_CACHE_ENTRIES
            or _CACHE_BYTES + published.estimated_bytes > _MAX_CACHE_BYTES
        ):
            _, evicted = _CACHE.popitem(last=False)
            _CACHE_BYTES -= evicted.estimated_bytes
        if _CACHE_BYTES + published.estimated_bytes > _MAX_CACHE_BYTES:
            return False
        _CACHE[key] = published
        _CACHE_BYTES += published.estimated_bytes
        return True


def invalidate_node_yaml_cache(project_root: Path, slug: str | None = None) -> None:
    """Drop fragment entries after any other successful save to the same graph path."""
    global _CACHE_BYTES
    root = os.path.normcase(str(project_root.resolve()))
    with _CACHE_LOCK:
        for key in list(_CACHE):
            if key[0] == root and (slug is None or key[1] == slug):
                _CACHE_BYTES -= _CACHE.pop(key).estimated_bytes


def node_yaml_cache_info() -> dict[str, int]:
    """Small internal read-only counter used by focused regression/benchmark tooling."""
    with _CACHE_LOCK:
        return {
            "entries": len(_CACHE),
            "estimated_bytes": _CACHE_BYTES,
            "max_entries": _MAX_CACHE_ENTRIES,
            "max_bytes": _MAX_CACHE_BYTES,
        }


def _try_warm_reuse(
    key: _CacheKey,
    path: Path,
    state: GraphState,
    changed_node_id: str,
) -> NodeYamlSerialization | None:
    cached = _lookup(key)
    if cached is None:
        return None
    try:
        current_signature = _signature(path)
    except OSError:
        return None
    if cached.signature != current_signature:
        return None
    try:
        if cached.digest is None or cached.digest != _digest(path):
            return None
    except OSError:
        return None
    old_state = cached.state_ref()
    if old_state is None or not _supported_state(state):
        return None
    if state.version != old_state.version:
        return None
    if state.taxonomy.model_dump(mode="json") != old_state.taxonomy.model_dump(mode="json"):
        return None
    for attr in ("relations", "bindings", "file_links"):
        before = getattr(old_state, attr)
        after = getattr(state, attr)
        if len(before) != len(after) or any(left is not right for left, right in zip(before, after)):
            return None
    if len(state.nodes) != len(cached.node_refs):
        return None
    changed_positions = []
    for index, (node_ref, node) in enumerate(zip(cached.node_refs, state.nodes)):
        before = node_ref()
        if before is None:
            return None
        if before is not node:
            changed_positions.append(index)
    if len(changed_positions) != 1:
        return None
    changed_index = changed_positions[0]
    if state.nodes[changed_index].id != changed_node_id:
        return None
    if cached.fragments is None:
        if cached.text is None:
            return None
        started = time.perf_counter_ns()
        indexed = _index_full_dump(cached.text, old_state)
        index_ns = time.perf_counter_ns() - started
        if indexed is None:
            return None
        prefix, suffix, base_fragments = indexed
    else:
        if cached.prefix is None or cached.suffix is None:
            return None
        prefix, suffix, base_fragments = cached.prefix, cached.suffix, cached.fragments
        index_ns = 0
    fragments = list(base_fragments)
    started = time.perf_counter_ns()
    row = safe_yaml_dump([state.nodes[changed_index].model_dump(mode="json")])
    row_serialize_ns = time.perf_counter_ns() - started
    if not row.startswith(f"- id: {changed_node_id}\n") or _ANCHOR_OR_ALIAS_RE.search(row):
        return None
    fragments[changed_index] = row
    fragment_tuple = tuple(fragments)
    content = prefix + "".join(fragment_tuple) + suffix
    candidate = _snapshot(state, content, prefix, suffix, fragment_tuple)
    if candidate is None:
        return None
    return NodeYamlSerialization(
        content, candidate, True, len(state.nodes) - 1, 1, index_ns, row_serialize_ns, None
    )


def serialize_single_node_update(
    project_root: Path,
    slug: str,
    path: Path,
    state: GraphState,
    changed_node_id: str,
) -> NodeYamlSerialization:
    """Serialize the explicit private one-node replacement path, with safe full-dump fallback."""
    key = _key(project_root, slug)
    warm = _try_warm_reuse(key, path, state, changed_node_id)
    if warm is not None:
        return warm
    reason = "no matching private snapshot"
    cached = _lookup(key)
    if cached is not None:
        try:
            if cached.signature != _signature(path):
                reason = "file revision changed"
            elif cached.digest is not None and cached.digest != _digest(path):
                reason = "file content changed"
            elif cached.state_ref() is None:
                reason = "base snapshot released"
            else:
                reason = "COW shape changed"
        except OSError:
            reason = "file stat failed"
    data = state.model_dump(mode="json")
    content = safe_yaml_dump(data)
    candidate = _pending_snapshot(state, content)
    if candidate is not None and cached is None:
        reason = "index deferred"
    elif candidate is None:
        reason = "native output outside exact safe subset"
    return NodeYamlSerialization(content, candidate, False, 0, len(state.nodes), 0, 0, reason)


def publish_node_yaml_snapshot(
    project_root: Path,
    slug: str,
    path: Path,
    snapshot: _CacheSnapshot | None,
) -> bool:
    """Publish the staged weak-reference snapshot after the state file was replaced."""
    return _publish(_key(project_root, slug), snapshot, path)
