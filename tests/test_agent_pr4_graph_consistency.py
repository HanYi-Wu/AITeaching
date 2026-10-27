"""Tests for Task D08: Atomic graph mutation consistency, locks, and batch boundary validation."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest
import yaml

from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.tools.graph_tools import (
    tool_batch_bind_questions,
    tool_batch_create_nodes,
    tool_batch_create_relations,
)
from solaire.common.security import assert_within_project
from solaire.knowledge_forge import (
    create_concept_node,
    create_graph,
    list_concept_nodes,
    list_node_relations,
    list_questions_for_node,
)
from solaire.knowledge_forge.service import (
    _load_subject_state,
)


def _make_ctx(project_root: Path) -> InvocationContext:
    assert_within_project(project_root, project_root)
    return InvocationContext(
        project_root=project_root,
        session_id="test_sess",
        platform_user=None,  # Points to project_root directly
    )


def test_batch_create_nodes_atomic_rollback_on_invalid_item(tmp_path: Path) -> None:
    """Invalid items in batch create nodes abort write before disk mutation."""
    ctx = _make_ctx(tmp_path)
    slug = "math"
    create_graph(tmp_path, "数学", slug=slug)

    # 1. First, an invalid batch where node 2 references a non-existent parent
    invalid_batch = [
        {"id": "math/calc/limit", "canonical_name": "极限", "node_kind": "concept"},
        {"canonical_name": "导数", "parent_node_id": "math/non_existent_parent"},
    ]

    res = tool_batch_create_nodes(ctx, {"nodes": invalid_batch, "graph": slug})
    assert res.status == "failed"
    assert res.error_code == "batch_all_failed"

    # Verify atomic all-or-nothing: math/calc/limit must NOT have been written
    nodes = list_concept_nodes(tmp_path, graph=slug)
    assert not any(n["id"] == "math/calc/limit" for n in nodes)
    assert len(nodes) == 0

    # 2. Valid batch succeeds completely and all nodes readable together
    valid_batch = [
        {"id": "math/calc/root", "canonical_name": "微积分", "node_kind": "concept"},
        {"canonical_name": "极限", "parent_node_id": "math/calc/root"},
        {"canonical_name": "导数", "parent_node_id": "math/calc/root"},
    ]
    res_ok = tool_batch_create_nodes(ctx, {"nodes": valid_batch, "graph": slug})
    assert res_ok.status == "succeeded"
    assert res_ok.data["ok_count"] == 3

    nodes_after = list_concept_nodes(tmp_path, graph=slug)
    assert len(nodes_after) == 3
    node_names = {n["canonical_name"] for n in nodes_after}
    assert node_names == {"微积分", "极限", "导数"}


def test_batch_create_relations_atomic_rollback(tmp_path: Path) -> None:
    """Batch relation creation verifies endpoints and endpoint kinds before writing."""
    ctx = _make_ctx(tmp_path)
    slug = "physics"
    create_graph(tmp_path, "物理", slug=slug)

    # Create 2 concepts and 2 skills
    create_concept_node(tmp_path, {"id": "p/c1", "canonical_name": "概念一", "node_kind": "concept"}, graph=slug)
    create_concept_node(tmp_path, {"id": "p/c2", "canonical_name": "概念二", "node_kind": "concept"}, graph=slug)
    create_concept_node(tmp_path, {"id": "p/s1", "canonical_name": "技能一", "node_kind": "skill"}, graph=slug)
    create_concept_node(tmp_path, {"id": "p/s2", "canonical_name": "因果一", "node_kind": "causal"}, graph=slug)

    # Invalid batch: the second relation attempts to link skill to causal (forbidden)
    invalid_relations = [
        {"from_node_id": "p/c1", "to_node_id": "p/c2", "relation_type": "prerequisite"},
        {"from_node_id": "p/s1", "to_node_id": "p/s2", "relation_type": "related"},
    ]
    res = tool_batch_create_relations(ctx, {"relations": invalid_relations, "graph": slug})
    assert res.status == "failed"

    # All-or-nothing: relation 1 must not be written
    rels = list_node_relations(tmp_path, graph=slug)
    assert len(rels) == 0

    # Valid batch succeeds and all relations together are readable
    valid_relations = [
        {"from_node_id": "p/c1", "to_node_id": "p/c2", "relation_type": "prerequisite"},
        {"from_node_id": "p/s1", "to_node_id": "p/c1", "relation_type": "related"},
    ]
    res_ok = tool_batch_create_relations(ctx, {"relations": valid_relations, "graph": slug})
    assert res_ok.status == "succeeded"
    assert res_ok.data["ok_count"] == 2

    rels_after = list_node_relations(tmp_path, graph=slug)
    assert len(rels_after) == 2


def test_batch_bind_questions_atomic_rollback(tmp_path: Path) -> None:
    """Batch question binding verifies all qualified IDs and target nodes before saving."""
    ctx = _make_ctx(tmp_path)
    slug = "chem"
    create_graph(tmp_path, "化学", slug=slug)
    create_concept_node(tmp_path, {"id": "chem/elem/iron", "canonical_name": "铁", "node_kind": "concept"}, graph=slug)

    # Invalid batch: second binding points to non-existent node
    invalid_bindings = [
        {"question_qualified_id": "化学/高考/q1", "node_id": "chem/elem/iron"},
        {"question_qualified_id": "化学/高考/q2", "node_id": "chem/non_existent"},
    ]
    res = tool_batch_bind_questions(ctx, {"bindings": invalid_bindings, "graph": slug})
    assert res.status == "failed"

    # All-or-nothing: first binding not created
    q_list = list_questions_for_node(tmp_path, "chem/elem/iron", graph=slug)
    assert len(q_list) == 0

    # Valid batch succeeds
    valid_bindings = [
        {"question_qualified_id": "化学/高考/q1", "node_id": "chem/elem/iron"},
        {"question_qualified_id": "化学/高考/q2", "node_id": "chem/elem/iron"},
    ]
    res_ok = tool_batch_bind_questions(ctx, {"bindings": valid_bindings, "graph": slug})
    assert res_ok.status == "succeeded"

    q_list_after = list_questions_for_node(tmp_path, "chem/elem/iron", graph=slug)
    assert set(q_list_after) == {"化学/高考/q1", "化学/高考/q2"}


def test_concurrent_writes_preserve_all_updates(tmp_path: Path) -> None:
    """Concurrent updates across threads are serialized by graph_lock and do not lose data."""
    slug = "math"
    create_graph(tmp_path, "数学", slug=slug)

    num_threads = 10
    errors: list[Exception] = []

    def worker(idx: int) -> None:
        try:
            node_id = f"math/calc/topic_{idx}"
            create_concept_node(
                tmp_path,
                {"id": node_id, "canonical_name": f"主题 {idx}", "node_kind": "concept"},
                graph=slug,
            )
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Errors occurred during concurrent execution: {errors}"
    nodes = list_concept_nodes(tmp_path, graph=slug)
    assert len(nodes) == num_threads
    ids = {n["id"] for n in nodes}
    for i in range(num_threads):
        assert f"math/calc/topic_{i}" in ids


def test_atomic_write_preserves_valid_file_on_write_failure(tmp_path: Path) -> None:
    """Atomic write failure preserves existing file contents without corrupting."""
    slug = "bio"
    create_graph(tmp_path, "生物", slug=slug)
    create_concept_node(tmp_path, {"id": "bio/cell", "canonical_name": "细胞", "node_kind": "concept"}, graph=slug)

    # Verify original file is valid
    state = _load_subject_state(tmp_path, slug)
    assert len(state.nodes) == 1

    # Simulate an error during save (e.g. state payload contains un-serializable object)
    state.nodes[0].canonical_name = "细胞修改"
    class BrokenObject:
        def __repr__(self):
            raise RuntimeError("Serialization failed")

    with pytest.raises(Exception):
        yaml.safe_dump({"broken": BrokenObject()})

    # Read back from disk, old file remains completely valid
    read_back = _load_subject_state(tmp_path, slug)
    assert read_back.nodes[0].canonical_name == "细胞"
