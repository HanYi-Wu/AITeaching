"""Tests for graph snapshot serialization and mutation core."""

import pytest
import yaml
from pathlib import Path
from solaire.knowledge_forge.snapshot_commands.yaml_codec import safe_yaml_dump, safe_yaml_load
from solaire.knowledge_forge.subjects import create_graph
from solaire.knowledge_forge.models import ConceptNode, NodeRelation, QuestionBinding, GraphState
from solaire.knowledge_forge.storage import _load_subject_state, _save_subject_state
from solaire.knowledge_forge.nodes import (
    list_concept_nodes,
    get_concept_node,
    create_concept_node,
    update_concept_node,
    delete_concept_node,
)
from solaire.knowledge_forge.bindings import (
    bind_question_to_node,
    unbind_question_from_node,
    list_questions_for_node,
)


def test_yaml_codec_roundtrip_equivalence():
    payload = {
        "nodes": [
            {
                "id": "slug/node_1",
                "canonical_name": "Test Node 1",
                "aliases": ["t1", "test"],
                "node_kind": "concept",
                "subject": "math",
                "level": "L1",
                "description": "Desc with unicode: 知识图谱",
                "tags": ["alpha", "beta"],
                "primary_parent_id": None,
                "layout_x": 100.5,
                "layout_y": 200.0,
                "notes": [{"id": "n1", "body": "Note body 笔记"}],
            }
        ],
        "relations": [
            {
                "id": "rel_1",
                "from_node_id": "slug/node_1",
                "to_node_id": "slug/node_root",
                "relation_type": "part_of",
            }
        ],
        "bindings": [
            {
                "question_qualified_id": "bank/math/q1",
                "node_id": "slug/node_1",
            }
        ],
    }

    dumped = safe_yaml_dump(payload)
    assert isinstance(dumped, str)

    loaded = safe_yaml_load(dumped)
    assert loaded == payload

    # Ensure compatibility with standard PyYAML safe_load
    standard_loaded = yaml.safe_load(dumped)
    assert standard_loaded == payload


def test_single_node_mutation_preserves_unrelated_nodes(tmp_path: Path):
    slug = create_graph(tmp_path, "Mutation Test")
    state = GraphState(
        nodes=[
            ConceptNode(id=f"{slug}/n{i}", canonical_name=f"Node {i}", description=f"Desc {i}")
            for i in range(10)
        ],
        relations=[
            NodeRelation(id=f"r{i}", from_node_id=f"{slug}/n{i}", to_node_id=f"{slug}/n0", relation_type="related")
            for i in range(1, 10)
        ],
        bindings=[
            QuestionBinding(question_qualified_id=f"bank/q{i}", node_id=f"{slug}/n{i}")
            for i in range(10)
        ],
    )
    _save_subject_state(tmp_path, slug, state)

    # Update node 5
    update_concept_node(
        tmp_path,
        f"{slug}/n5",
        {"canonical_name": "Renamed Node 5", "description": "New Desc 5"},
        graph=slug,
    )

    reloaded = _load_subject_state(tmp_path, slug)
    assert len(reloaded.nodes) == 10
    assert len(reloaded.relations) == 9
    assert len(reloaded.bindings) == 10

    # Verify updated node
    n5 = next(n for n in reloaded.nodes if n.id == f"{slug}/n5")
    assert n5.canonical_name == "Renamed Node 5"
    assert n5.description == "New Desc 5"

    # Verify untouched nodes remain intact
    n4 = next(n for n in reloaded.nodes if n.id == f"{slug}/n4")
    assert n4.canonical_name == "Node 4"
    assert n4.description == "Desc 4"


def test_question_binding_lifecycle(tmp_path: Path):
    slug = create_graph(tmp_path, "Binding Test")
    node_id = f"{slug}/target_node"
    state = GraphState(
        nodes=[ConceptNode(id=node_id, canonical_name="Target Node")],
    )
    _save_subject_state(tmp_path, slug, state)

    bind_question_to_node(
        tmp_path,
        {"question_qualified_id": "bank/math/q_bind_1", "node_id": node_id},
        graph=slug,
    )
    qs = list_questions_for_node(tmp_path, node_id, graph=slug)
    assert qs == ["bank/math/q_bind_1"]

    # Idempotent bind
    bind_question_to_node(
        tmp_path,
        {"question_qualified_id": "bank/math/q_bind_1", "node_id": node_id},
        graph=slug,
    )
    qs_idempotent = list_questions_for_node(tmp_path, node_id, graph=slug)
    assert qs_idempotent == ["bank/math/q_bind_1"]

    # Unbind
    unbind_question_from_node(
        tmp_path,
        {"question_qualified_id": "bank/math/q_bind_1", "node_id": node_id},
        graph=slug,
    )
    qs_unbound = list_questions_for_node(tmp_path, node_id, graph=slug)
    assert qs_unbound == []
