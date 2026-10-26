"""Tests for Task D07: KnowledgeForge modular models, repository, cache and legacy migration."""

from __future__ import annotations

from pathlib import Path

import yaml

from solaire.knowledge_forge import (
    ConceptNode,
    GraphMeta,
    GraphState,
    create_concept_node,
    create_graph,
    ensure_graph_layout,
    get_concept_node,
    list_concept_nodes,
    list_graphs,
    list_node_relations,
    load_graph,
)
from solaire.knowledge_forge.service import (
    _load_meta,
    _load_subject_state,
    _save_meta,
    _save_subject_state,
)


def test_legacy_state_yaml_migration_to_multi_graphs(tmp_path: Path) -> None:
    """Verify legacy state.yaml is automatically migrated on first read/ensure."""
    graph_dir = tmp_path / "resource" / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    legacy_file = graph_dir / "state.yaml"

    legacy_data = {
        "version": 1,
        "taxonomy": {"subjects": ["物理"], "levels": ["高中", "竞赛"]},
        "nodes": [
            {
                "id": "physics/mechanics/kinematics",
                "canonical_name": "运动学",
                "subject": "物理",
                "level": "高中",
                "node_kind": "concept",
            },
            {
                "id": "physics/mechanics/forces",
                "canonical_name": "受力分析",
                "subject": "物理",
                "level": "高中",
                "node_kind": "skill",
            },
        ],
        "relations": [
            {
                "id": "rel-001",
                "from_node_id": "physics/mechanics/forces",
                "to_node_id": "physics/mechanics/kinematics",
                "relation_type": "uses_skill",  # legacy relation type to be migrated
            },
            {
                "id": "rel-002",
                "from_node_id": "physics/mechanics/kinematics",
                "to_node_id": "physics/mechanics/root",
                "relation_type": "part_of",
            },
        ],
        "bindings": [
            {
                "question_qualified_id": "物理/高考真题/q001",
                "node_id": "physics/mechanics/kinematics",
            }
        ],
        "file_links": [],
    }
    legacy_file.write_text(yaml.safe_dump(legacy_data, allow_unicode=True), encoding="utf-8")

    # Trigger layout & migration
    ensure_graph_layout(tmp_path)

    # 1. Legacy state.yaml should be renamed to state.yaml.bak
    assert not legacy_file.exists()
    assert (graph_dir / "state.yaml.bak").is_file()

    # 2. _meta.yaml should exist and register the subject
    meta_file = graph_dir / "_meta.yaml"
    assert meta_file.is_file()
    meta = _load_meta(tmp_path)
    assert any(s.display_name == "物理" for s in meta.subjects)
    assert meta.levels == ["高中", "竞赛"]

    # 3. Subject state file should exist and relation should be migrated
    phys_slug = next(s.slug for s in meta.subjects if s.display_name == "物理")
    phys_state = _load_subject_state(tmp_path, phys_slug)
    assert len(phys_state.nodes) == 2
    assert len(phys_state.bindings) == 1

    # uses_skill -> related migration verification
    rel_map = {r.id: r for r in phys_state.relations}
    assert rel_map["rel-001"].relation_type == "related"

    # primary_parent_id inferred from part_of relation
    node_kin = next(n for n in phys_state.nodes if n.id == "physics/mechanics/kinematics")
    assert node_kin.primary_parent_id == "physics/mechanics/root"


def test_facade_service_re_exports_and_models(tmp_path: Path) -> None:
    """Verify facade service maintains full model validation, caching and exports."""
    # Test model coercion and validation
    node = ConceptNode(id="test/node", canonical_name="测试要点", node_kind="")
    assert node.node_kind == "concept"

    # Round trip with multi-graph
    slug = create_graph(tmp_path, "化学")
    create_concept_node(
        tmp_path,
        {"id": "chem/organic", "canonical_name": "有机化学", "subject": "化学"},
        graph=slug,
    )
    graphs = list_graphs(tmp_path)
    assert any(g["slug"] == slug for g in graphs)

    loaded = get_concept_node(tmp_path, "chem/organic", graph=slug)
    assert loaded["canonical_name"] == "有机化学"
