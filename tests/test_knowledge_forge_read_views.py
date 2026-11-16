from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

import yaml

from solaire.knowledge_forge import migration
from solaire.knowledge_forge.bindings import list_nodes_for_question, list_questions_for_node
from solaire.knowledge_forge.models import (
    ConceptNode,
    GraphMeta,
    GraphNodeNote,
    GraphState,
    GraphTaxonomy,
    NodeFileLink,
    NodeRelation,
    QuestionBinding,
    SubjectMeta,
)
from solaire.knowledge_forge.node_index import _collect_node_ids_and_kinds, _find_node_slug
from solaire.knowledge_forge.nodes import count_nodes_by_kind, get_concept_node, list_concept_nodes
from solaire.knowledge_forge.migration import _partition_legacy_graph_state
from solaire.knowledge_forge.paths import _safe_slug
from solaire.knowledge_forge.relations import _deduplicate_relations, _is_equivalent_relation, list_node_relations
from solaire.knowledge_forge.resources import list_file_links_for_node
from solaire.knowledge_forge.storage import _save_meta, _save_subject_state
from solaire.knowledge_forge.subjects import export_graph, get_taxonomy, list_graphs


def _node(node_id: str, name: str, kind: str = "concept") -> ConceptNode:
    return ConceptNode(
        id=node_id,
        canonical_name=name,
        node_kind=kind,
        aliases=[name.lower()],
        tags=[kind],
        notes=[GraphNodeNote(id=f"note-{name}", body=f"note for {name}")],
    )


def _seed_project(root: Path) -> None:
    _save_meta(
        root,
        GraphMeta(subjects=[
            SubjectMeta(slug="first", display_name="First"),
            SubjectMeta(slug="second", display_name="Second"),
        ]),
    )
    _save_subject_state(
        root,
        "first",
        GraphState(
            taxonomy=GraphTaxonomy(subjects=["First taxonomy"], levels=["Level 1"]),
            nodes=[_node("shared", "first-match"), _node("shared", "last-first", "skill"), _node("alpha", "Alpha")],
            relations=[
                NodeRelation(id="duplicate-rel", from_node_id="shared", to_node_id="alpha", relation_type="related"),
                NodeRelation(id="duplicate-rel", from_node_id="alpha", to_node_id="shared", relation_type="causal"),
                NodeRelation(id="first-rel", from_node_id="alpha", to_node_id="shared", relation_type="part_of"),
            ],
            file_links=[
                NodeFileLink(id="first-link-1", node_id="shared", relative_path="first/a.md"),
                NodeFileLink(id="first-link-2", node_id="shared", relative_path="first/b.md"),
            ],
            bindings=[
                QuestionBinding(question_qualified_id="bank/q1", node_id="shared"),
                QuestionBinding(question_qualified_id="bank/q2", node_id="shared"),
                QuestionBinding(question_qualified_id="bank/q1", node_id="shared"),
                QuestionBinding(question_qualified_id="bank/q1", node_id="alpha"),
            ],
        ),
    )
    _save_subject_state(
        root,
        "second",
        GraphState(
            nodes=[_node("shared", "second-match", "causal"), _node("beta", "Beta")],
            relations=[
                NodeRelation(id="duplicate-rel", from_node_id="beta", to_node_id="shared", relation_type="prerequisite"),
            ],
            file_links=[NodeFileLink(id="second-link", node_id="shared", relative_path="second/c.md")],
            bindings=[
                QuestionBinding(question_qualified_id="bank/q1", node_id="shared"),
                QuestionBinding(question_qualified_id="bank/q1", node_id="beta"),
            ],
        ),
    )


def _legacy_partition_reference(state: GraphState):
    """Original subject-by-subject filters, kept here as a parity oracle."""
    groups: dict[str, list[str]] = {}
    for node in state.nodes:
        subject = (node.subject or "").strip() or "_default"
        slug = _safe_slug(subject)
        groups.setdefault(slug, [])
        if node.id not in groups[slug]:
            groups[slug].append(node.id)

    nodes_by_slug = {}
    relations_by_slug = {}
    bindings_by_slug = {}
    file_links_by_slug = {}
    for slug, node_ids in groups.items():
        ids = set(node_ids)
        nodes_by_slug[slug] = [node for node in state.nodes if node.id in ids]
        relations_by_slug[slug] = [
            relation for relation in state.relations
            if relation.from_node_id in ids or relation.to_node_id in ids
        ]
        bindings_by_slug[slug] = [binding for binding in state.bindings if binding.node_id in ids]
        file_links_by_slug[slug] = [link for link in state.file_links if link.node_id in ids]
    return groups, nodes_by_slug, relations_by_slug, bindings_by_slug, file_links_by_slug


def _relation_dedup_reference(relations: list[dict]):
    result = []
    by_id: dict[str, list[dict]] = {}
    for item in relations:
        rel_id = item.get("id")
        if not rel_id or not isinstance(rel_id, str):
            result.append(dict(item))
            continue
        if rel_id not in by_id:
            entry = dict(item)
            by_id[rel_id] = [entry]
            result.append(entry)
            continue
        existing_entries = by_id[rel_id]
        if any(_is_equivalent_relation(existing, item) for existing in existing_entries):
            continue
        entry = dict(item)
        entry["conflict"] = True
        entry["conflict_reason"] = "duplicate_id_conflicting_payload"
        for existing in existing_entries:
            existing["conflict"] = True
            existing["conflict_reason"] = "duplicate_id_conflicting_payload"
        existing_entries.append(entry)
        result.append(entry)
    return result


def test_ordered_partition_matches_original_filters_for_many_duplicate_ids() -> None:
    subject_names = ["Math", "Physics", "Chemistry", "Biology", ""]
    state = GraphState(
        nodes=[
            ConceptNode(
                id=f"node-{index % 137}",
                canonical_name=f"node-row-{index}",
                subject=subject_names[(index * 7 + index // 137) % len(subject_names)],
            )
            for index in range(420)
        ],
        relations=[
            NodeRelation(
                id=f"edge-{index % 93}",
                from_node_id=f"node-{index % 179}",
                to_node_id=f"node-{(index * 17 + 9) % 183}",
                relation_type=("related", "part_of", "causal")[index % 3],
            )
            for index in range(650)
        ],
        bindings=[
            QuestionBinding(question_qualified_id=f"bank/q{index}", node_id=f"node-{index % 173}")
            for index in range(510)
        ],
        file_links=[
            NodeFileLink(id=f"file-{index}", node_id=f"node-{index % 181}", relative_path=f"{index}.md")
            for index in range(390)
        ],
    )

    expected = _legacy_partition_reference(state)
    actual = _partition_legacy_graph_state(state)
    assert list(actual[0]) == list(expected[0])
    for slug, ids in expected[0].items():
        assert actual[0][slug] == set(ids)
        assert actual[1][slug] == expected[1][slug]
        assert actual[2][slug] == expected[2][slug]
        assert actual[3][slug] == expected[3][slug]
        assert actual[4][slug] == expected[4][slug]


def test_relation_deduplication_indexes_fixed_payloads_and_keeps_extension_equality() -> None:
    conflicting = [
        {
            "id": "repeated",
            "from_node_id": f"from-{index}",
            "to_node_id": "target",
            "relation_type": "related",
        }
        for index in range(512)
    ]
    rows = [conflicting[0], dict(conflicting[0]), *conflicting[1:]]
    result = _deduplicate_relations(rows)
    assert result == _relation_dedup_reference(rows)
    assert len(result) == len(conflicting)
    assert all(row["conflict"] is True for row in result)
    assert [row["from_node_id"] for row in result] == [f"from-{index}" for index in range(512)]

    extended = [
        {"id": "extended", "from_node_id": "a", "to_node_id": "b", "relation_type": "related", "extra": {"v": [1]}},
        {"id": "extended", "from_node_id": "a", "to_node_id": "b", "relation_type": "related", "extra": {"v": [1]}},
        {"id": "extended", "from_node_id": "a", "to_node_id": "b", "relation_type": "related", "extra": {"v": [2]}},
    ]
    extended_result = _deduplicate_relations(extended)
    assert extended_result == _relation_dedup_reference(extended)
    assert len(extended_result) == 2
    assert all(row["conflict"] is True for row in extended_result)


def test_read_views_preserve_order_duplicate_id_and_detached_return_contracts(tmp_path: Path) -> None:
    _seed_project(tmp_path)

    assert _find_node_slug(tmp_path, "shared") == "first"
    ids, kinds = _collect_node_ids_and_kinds(tmp_path)
    assert ids == {"shared", "alpha", "beta"}
    assert kinds == {"shared": "causal", "alpha": "concept", "beta": "concept"}
    assert get_concept_node(tmp_path, "shared")["canonical_name"] == "first-match"
    assert get_concept_node(tmp_path, "shared", graph="first")["canonical_name"] == "first-match"
    assert [node["canonical_name"] for node in list_concept_nodes(tmp_path)] == [
        "first-match", "last-first", "Alpha", "second-match", "Beta",
    ]
    assert [(node["canonical_name"], node["file_link_count"]) for node in list_concept_nodes(tmp_path, node_kind="skill")] == [
        ("last-first", 3),
    ]
    assert [node["file_link_count"] for node in list_concept_nodes(tmp_path) if node["id"] == "shared"] == [3, 3, 3]
    assert count_nodes_by_kind(tmp_path) == {"causal": 1, "concept": 3, "skill": 1}
    assert list_graphs(tmp_path) == [
        {"slug": "first", "display_name": "First", "node_count": 3},
        {"slug": "second", "display_name": "Second", "node_count": 2},
    ]

    all_relations = list_node_relations(tmp_path)
    assert [relation["id"] for relation in all_relations] == [
        "duplicate-rel", "duplicate-rel", "first-rel", "duplicate-rel",
    ]
    assert all(relation.get("conflict") is True for relation in (all_relations[0], all_relations[1], all_relations[3]))
    assert [link["id"] for link in list_file_links_for_node(tmp_path, "shared")] == [
        "first-link-1", "first-link-2",
    ]
    assert [link["id"] for link in list_file_links_for_node(tmp_path, "shared", graph="second")] == [
        "second-link",
    ]
    assert list_questions_for_node(tmp_path, "shared") == ["bank/q1", "bank/q2"]
    selected = list_nodes_for_question(tmp_path, "bank/q1")
    assert [(node.id, node.canonical_name) for node in selected] == [
        ("alpha", "Alpha"), ("shared", "last-first"), ("beta", "Beta"),
    ]
    assert get_taxonomy(tmp_path) == {"subjects": ["First taxonomy"], "levels": ["Level 1"]}

    # Returned dictionaries, lists, and selected Pydantic nodes stay detached
    # from the cache-owned snapshots used by subsequent reads.
    rows = list_concept_nodes(tmp_path, graph="first")
    rows[0]["aliases"].append("caller mutation")
    rows[0]["notes"][0]["body"] = "caller mutation"
    node = get_concept_node(tmp_path, "shared")
    node["tags"].append("caller mutation")
    selected[-1].aliases.append("caller mutation")
    taxonomy = get_taxonomy(tmp_path)
    taxonomy["subjects"].append("caller mutation")
    bundle = export_graph(tmp_path, "first")
    bundle["state"]["nodes"][0]["notes"][0]["body"] = "caller mutation"

    assert "caller mutation" not in list_concept_nodes(tmp_path, graph="first")[0]["aliases"]
    assert list_concept_nodes(tmp_path, graph="first")[0]["notes"][0]["body"] == "note for first-match"
    assert "caller mutation" not in get_concept_node(tmp_path, "shared")["tags"]
    assert "caller mutation" not in list_nodes_for_question(tmp_path, "bank/q1")[-1].aliases
    assert get_taxonomy(tmp_path)["subjects"] == ["First taxonomy"]
    assert export_graph(tmp_path, "first")["state"]["nodes"][0]["notes"][0]["body"] == "note for first-match"


def test_legacy_migration_runs_once_for_concurrent_readers(tmp_path: Path, monkeypatch) -> None:
    from solaire.knowledge_forge.paths import _legacy_state_path, _meta_path

    legacy = _legacy_state_path(tmp_path)
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(
        yaml.safe_dump({
            "nodes": [{"id": "legacy-node", "canonical_name": "Legacy", "subject": "Math"}],
            "relations": [],
        }),
        encoding="utf-8",
    )

    migration_count = 0
    count_lock = Lock()
    original_migrate = migration._migrate_legacy_to_multi

    def counted_migration(root: Path) -> None:
        nonlocal migration_count
        with count_lock:
            migration_count += 1
        original_migrate(root)

    monkeypatch.setattr(migration, "_migrate_legacy_to_multi", counted_migration)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: migration.ensure_graph_layout(tmp_path), range(8)))

    assert migration_count == 1
    assert _meta_path(tmp_path).is_file()
    assert legacy.with_name("state.yaml.bak").is_file()


def test_legacy_migration_distributes_rows_in_original_order_for_duplicate_node_ids(tmp_path: Path) -> None:
    from solaire.knowledge_forge.paths import _legacy_state_path, _meta_path
    from solaire.knowledge_forge.storage import _load_meta, _load_subject_state

    legacy = _legacy_state_path(tmp_path)
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(
        yaml.safe_dump({
            "taxonomy": {"subjects": ["Math", "Physics"], "levels": ["Level 1"]},
            "nodes": [
                {"id": "x", "canonical_name": "x-math-first", "subject": "Math"},
                {"id": "y", "canonical_name": "y-physics", "subject": "Physics"},
                {"id": "x", "canonical_name": "x-physics", "subject": "Physics"},
                {"id": "x", "canonical_name": "x-math-last", "subject": "Math"},
                {"id": "z", "canonical_name": "z-default"},
            ],
            "relations": [
                {"id": "edge-a", "from_node_id": "x", "to_node_id": "y", "relation_type": "uses_skill"},
                {"id": "edge-a", "from_node_id": "x", "to_node_id": "y", "relation_type": "related"},
                {"id": "edge-a", "from_node_id": "x", "to_node_id": "z", "relation_type": "causal"},
                {"id": "edge-self", "from_node_id": "x", "to_node_id": "x", "relation_type": "part_of"},
                {"id": "edge-default", "from_node_id": "z", "to_node_id": "missing", "relation_type": "related"},
            ],
            "bindings": [
                {"question_qualified_id": "bank/qx", "node_id": "x"},
                {"question_qualified_id": "bank/qy", "node_id": "y"},
                {"question_qualified_id": "bank/qz", "node_id": "z"},
            ],
            "file_links": [
                {"id": "file-x", "node_id": "x", "relative_path": "x.md"},
                {"id": "file-z", "node_id": "z", "relative_path": "z.md"},
            ],
        }),
        encoding="utf-8",
    )

    migration.ensure_graph_layout(tmp_path)

    meta = _load_meta(tmp_path)
    assert [subject.slug for subject in meta.subjects] == ["math", "physics", "default"]
    assert [subject.display_name for subject in meta.subjects] == ["Math", "Math", "default"]
    math = _load_subject_state(tmp_path, "math")
    physics = _load_subject_state(tmp_path, "physics")
    default = _load_subject_state(tmp_path, "default")
    assert [node.canonical_name for node in math.nodes] == ["x-math-first", "x-physics", "x-math-last"]
    assert [node.canonical_name for node in physics.nodes] == [
        "x-math-first", "y-physics", "x-physics", "x-math-last",
    ]
    assert [node.canonical_name for node in default.nodes] == ["z-default"]
    assert [relation.id for relation in math.relations] == ["edge-a", "edge-a", "edge-self"]
    assert [relation.relation_type for relation in math.relations] == ["related", "causal", "part_of"]
    assert [relation.id for relation in physics.relations] == ["edge-a", "edge-a", "edge-self"]
    assert [relation.id for relation in default.relations] == ["edge-a", "edge-default"]
    assert [binding.question_qualified_id for binding in physics.bindings] == ["bank/qx", "bank/qy"]
    assert [link.id for link in math.file_links] == ["file-x"]
    assert [link.id for link in default.file_links] == ["file-z"]
    assert _meta_path(tmp_path).is_file()
    assert legacy.with_name("state.yaml.bak").is_file()
