"""Private copy-on-write transactions for KnowledgeForge graph mutations."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import uuid

from solaire.knowledge_forge.concurrency import graph_lock
from solaire.knowledge_forge.models import GraphState
from solaire.knowledge_forge.paths import _slugify_name
from solaire.knowledge_forge.storage import (
    _load_meta,
    _load_subject_state_snapshot,
    _save_subject_state_node_update_owned,
    _save_subject_state_owned,
    _save_subject_states_owned,
)


def _fork_graph_state(snapshot: GraphState) -> GraphState:
    """Copy the state shell and mutable containers, sharing untouched records.

    Mutation commands append, replace, or filter collection entries. They do not
    mutate existing node/relation/binding/link records in place. The small taxonomy
    object is copied because it contains mutable lists and is not part of this
    transaction's copy-on-write record set.
    """
    return snapshot.model_copy(
        update={
            "taxonomy": snapshot.taxonomy.model_copy(deep=True),
            "nodes": list(snapshot.nodes),
            "relations": list(snapshot.relations),
            "bindings": list(snapshot.bindings),
            "file_links": list(snapshot.file_links),
        }
    )


class GraphMutationSession:
    """One project-locked unit of graph edits with private COW state snapshots."""

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root
        self._lock_context: Any = None
        self._states: dict[str, GraphState] = {}
        self._dirty: set[str] = set()
        self._generic_dirty: set[str] = set()
        self._node_update_ids: dict[str, str | None] = {}
        self._scanned_node_subjects: set[str] = set()
        self._node_ids: set[str] = set()
        self._node_kinds: dict[str, str] = {}
        self._node_slugs: dict[str, str] = {}

    def __enter__(self) -> GraphMutationSession:
        self._lock_context = graph_lock(self.project_root)
        self._lock_context.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback) -> bool:
        try:
            if exc_type is None:
                self.commit()
        finally:
            self._states.clear()
            self._dirty.clear()
            self._generic_dirty.clear()
            self._node_update_ids.clear()
            self._scanned_node_subjects.clear()
            self._node_ids.clear()
            self._node_kinds.clear()
            self._node_slugs.clear()
            if self._lock_context is not None:
                self._lock_context.__exit__(exc_type, exc, traceback)
                self._lock_context = None
        return False

    def state(self, slug: str) -> GraphState:
        """Return this session's private writable fork for one subject."""
        state = self._states.get(slug)
        if state is None:
            snapshot = _load_subject_state_snapshot(self.project_root, slug)
            state = _fork_graph_state(snapshot)
            self._states[slug] = state
        return state

    def save(self, slug: str) -> None:
        """Mark an already-forked subject dirty for commit on normal exit."""
        if slug not in self._states:
            raise RuntimeError("graph state must be loaded before it is marked dirty")
        self._dirty.add(slug)
        self._generic_dirty.add(slug)
        self._node_update_ids.pop(slug, None)

    def save_node_update(self, slug: str, node_id: str) -> None:
        """Opt in one replacement from update_concept_node to the private fragment path."""
        if slug not in self._states:
            raise RuntimeError("graph state must be loaded before it is marked dirty")
        self._dirty.add(slug)
        if slug in self._generic_dirty:
            self._node_update_ids.pop(slug, None)
            return
        previous = self._node_update_ids.get(slug, node_id)
        self._node_update_ids[slug] = node_id if previous == node_id else None

    def commit(self) -> None:
        if not self._dirty:
            return
        states = {slug: self._states[slug] for slug in self._states if slug in self._dirty}
        if len(states) == 1:
            slug, state = next(iter(states.items()))
            changed_node_id = self._node_update_ids.get(slug)
            if changed_node_id is not None and slug not in self._generic_dirty:
                _save_subject_state_node_update_owned(self.project_root, slug, state, changed_node_id)
            else:
                _save_subject_state_owned(self.project_root, slug, state)
        else:
            _save_subject_states_owned(self.project_root, states)
        self._dirty.clear()
        self._generic_dirty.clear()
        self._node_update_ids.clear()

    def _subjects(self) -> list[str]:
        return [subject.slug for subject in _load_meta(self.project_root).subjects]

    def _scan_nodes(self, slug: str) -> None:
        if slug in self._scanned_node_subjects:
            return
        for node in self.state(slug).nodes:
            self._node_ids.add(node.id)
            self._node_kinds[node.id] = node.node_kind
            self._node_slugs.setdefault(node.id, slug)
        self._scanned_node_subjects.add(slug)

    def node_index(self) -> tuple[set[str], dict[str, str]]:
        """Build/reuse the same global ID and kind index as the legacy helper."""
        for slug in self._subjects():
            self._scan_nodes(slug)
        return set(self._node_ids), dict(self._node_kinds)

    def find_node_slug(self, node_id: str) -> str | None:
        if node_id in self._node_slugs:
            return self._node_slugs[node_id]
        for slug in self._subjects():
            self._scan_nodes(slug)
            if node_id in self._node_slugs:
                return self._node_slugs[node_id]
        return None

    def find_relation_slug(self, relation_id: str) -> str | None:
        for slug in self._subjects():
            if any(relation.id == relation_id for relation in self.state(slug).relations):
                return slug
        return None

    def find_file_link_slug(self, link_id: str) -> str | None:
        for slug in self._subjects():
            if any(link.id == link_id for link in self.state(slug).file_links):
                return slug
        return None

    def generate_unique_node_id(
        self,
        parent_node_id: str,
        canonical_name: str,
        *,
        reserved_ids: set[str] | None = None,
    ) -> str:
        parent = parent_node_id.strip().rstrip("/")
        if not parent:
            raise ValueError("parent_node_id required")
        node_ids, _ = self.node_index()
        if reserved_ids:
            node_ids.update(reserved_ids)
        base = f"{parent}/{_slugify_name(canonical_name)}"
        if base not in node_ids:
            return base
        for _ in range(24):
            candidate = f"{base}-{uuid.uuid4().hex[:6]}"
            if candidate not in node_ids:
                return candidate
        raise ValueError("Could not generate unique node id")
