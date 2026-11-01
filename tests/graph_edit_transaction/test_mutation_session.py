from __future__ import annotations

from pathlib import Path

import pytest

from solaire.knowledge_forge import (
    attach_file_to_node,
    bind_question_nodes_batch,
    bind_question_to_node,
    bind_questions_batch,
    create_concept_node,
    create_concept_nodes_batch,
    create_graph,
    create_node_relation,
    create_node_relations_batch,
    delete_concept_node,
    delete_node_relation,
    detach_file_link,
    get_concept_node,
    list_file_links_for_node,
    list_node_relations,
    list_questions_for_node,
    unbind_question_from_node,
    unbind_questions_batch,
    update_concept_node,
    update_node_relation,
)
from solaire.knowledge_forge import cache, storage
from solaire.knowledge_forge.models import ConceptNode, GraphNodeNote, GraphState
from solaire.knowledge_forge.paths import _subject_state_path


def test_public_load_save_and_mutation_snapshots_are_isolated(tmp_path: Path) -> None:
    slug = create_graph(tmp_path, "数学", "math")
    source_note = GraphNodeNote(id="note-1", body="source")
    source_payload = {
        "id": "math/n1",
        "canonical_name": "Original",
        "aliases": ["alias"],
        "tags": ["base tag"],
        "source": "curriculum/source.yaml",
        "notes": [source_note],
    }
    create_concept_node(tmp_path, source_payload, graph=slug)
    create_concept_node(tmp_path, {"id": "math/n2", "canonical_name": "Untouched"}, graph=slug)

    # Mutating caller-owned inputs after a write cannot alter the cached snapshot.
    source_payload["aliases"].append("caller mutation")
    source_payload["tags"].append("caller mutation")
    source_payload["source"] = "caller mutation"
    source_note.body = "caller mutation"
    before = storage._load_subject_state_snapshot(tmp_path, slug)
    public_before = storage._load_subject_state(tmp_path, slug)
    original_node = before.nodes[0]
    untouched_node = before.nodes[1]
    assert original_node.aliases == ["alias"]
    assert original_node.tags == ["base tag"]
    assert original_node.source == "curriculum/source.yaml"
    assert original_node.notes[0].body == "source"

    replacement_note = GraphNodeNote(id="note-2", body="replacement")
    update_payload = {
        "canonical_name": "Updated",
        "aliases": ["replacement alias"],
        "tags": ["updated tag"],
        "source": "updated/source.yaml",
        "notes": [replacement_note],
    }
    update_concept_node(tmp_path, "math/n1", update_payload, graph=slug)
    update_payload["aliases"].append("caller mutation after update")
    update_payload["tags"].append("caller mutation after update")
    update_payload["source"] = "caller mutation after update"
    replacement_note.body = "caller mutation after update"

    after = storage._load_subject_state_snapshot(tmp_path, slug)
    assert public_before.nodes[0].canonical_name == "Original"
    assert before.nodes[0] is original_node
    assert original_node.canonical_name == "Original"
    assert after.nodes[0] is not original_node
    assert after.nodes[1] is untouched_node
    assert after.nodes[0].aliases == ["replacement alias"]
    assert after.nodes[0].tags == ["updated tag"]
    assert after.nodes[0].source == "updated/source.yaml"
    assert after.nodes[0].notes[0].body == "replacement"

    # The established public loader still returns a deep, caller-isolated copy.
    public_state = storage._load_subject_state(tmp_path, slug)
    public_state.nodes[0].aliases.append("read mutation")
    public_state.nodes[0].tags.append("read mutation")
    public_state.nodes[0].source = "read mutation"
    public_state.nodes[0].notes[0].body = "read mutation"
    reread = storage._load_subject_state(tmp_path, slug)
    assert reread.nodes[0].aliases == ["replacement alias"]
    assert reread.nodes[0].tags == ["updated tag"]
    assert reread.nodes[0].source == "updated/source.yaml"
    assert reread.nodes[0].notes[0].body == "replacement"

    # The generic save entry keeps its original caller-isolation contract.
    generic = GraphState(nodes=[ConceptNode(id="generic/n1", canonical_name="Saved", aliases=["saved"])])
    storage._save_subject_state(tmp_path, "generic", generic)
    generic.nodes[0].aliases.append("later mutation")
    assert storage._load_subject_state(tmp_path, "generic").nodes[0].aliases == ["saved"]

    # Identical slugs in different projects never share cached graph state.
    other_root = tmp_path / "other-project"
    create_graph(other_root, "数学", "math")
    create_concept_node(other_root, {"id": "math/n1", "canonical_name": "Other project"}, graph="math")
    update_concept_node(tmp_path, "math/n1", {"canonical_name": "First project"}, graph=slug)
    assert get_concept_node(other_root, "math/n1", graph="math")["canonical_name"] == "Other project"


def test_all_edit_command_families_commit_one_private_state(tmp_path: Path) -> None:
    create_graph(tmp_path, "数学", "math")
    create_graph(tmp_path, "物理", "physics")
    create_concept_node(tmp_path, {"id": "math/root", "canonical_name": "Math root"}, graph="math")
    create_concept_node(tmp_path, {"id": "physics/root", "canonical_name": "Physics root"}, graph="physics")

    child_note = GraphNodeNote(id="child-note", body="batch input")
    child_payload = {
        "id": "math/child", "canonical_name": "Child", "subject": "数学",
        "parent_node_id": "math/root", "aliases": ["child alias"], "tags": ["child tag"],
        "source": "batch/source.yaml", "notes": [child_note],
    }
    created = create_concept_nodes_batch(tmp_path, [child_payload])
    assert created == ["math/child"]
    child_payload["aliases"].append("batch caller mutation")
    child_payload["tags"].append("batch caller mutation")
    child_payload["source"] = "batch caller mutation"
    child_note.body = "batch caller mutation"
    inserted = get_concept_node(tmp_path, "math/child", graph="math")
    assert inserted["aliases"] == ["child alias"]
    assert inserted["tags"] == ["child tag"]
    assert inserted["source"] == "batch/source.yaml"
    assert inserted["notes"][0]["body"] == "batch input"
    parent_relation = next(
        relation["id"] for relation in list_node_relations(tmp_path, graph="math")
        if relation["from_node_id"] == "math/child" and relation["to_node_id"] == "math/root"
    )
    update_note = GraphNodeNote(id="updated-note", body="update input")
    update_payload = {
        "canonical_name": "Updated child", "aliases": ["updated alias"],
        "tags": ["updated tag"], "source": "update/source.yaml", "notes": [update_note],
    }
    update_concept_node(tmp_path, "math/child", update_payload, graph="math")
    update_payload["aliases"].append("update caller mutation")
    update_payload["tags"].append("update caller mutation")
    update_payload["source"] = "update caller mutation"
    update_note.body = "update caller mutation"

    first_relation = create_node_relation(
        tmp_path,
        {"from_node_id": "math/root", "to_node_id": "math/child", "relation_type": "prerequisite"},
        graph="math",
    )
    batch_relations = create_node_relations_batch(tmp_path, [
        {"from_node_id": "physics/root", "to_node_id": "math/child", "relation_type": "related"}
    ])
    update_node_relation(tmp_path, first_relation, relation_type="related", reverse=True, graph="math")
    delete_node_relation(tmp_path, batch_relations[0])
    cascade_relation = create_node_relation(
        tmp_path,
        {"from_node_id": "math/child", "to_node_id": "physics/root", "relation_type": "related"},
        graph="math",
    )

    bind_question_to_node(tmp_path, {"question_qualified_id": "bank/q1", "node_id": "math/child"}, graph="math")
    assert bind_questions_batch(
        tmp_path, node_id="math/child", qualified_ids=["bank/q2", "bank/q2", ""], graph="math"
    ) == {"added": 1, "skipped": 2}
    assert bind_question_nodes_batch(tmp_path, [
        {"question_qualified_id": "bank/q3", "node_id": "math/child"},
        {"question_qualified_id": "bank/q4", "node_id": "physics/root"},
    ]) == {"added": 2, "skipped": 0, "total": 2}
    assert unbind_questions_batch(
        tmp_path, node_id="math/child", qualified_ids=["bank/q2"], graph="math"
    ) == {"removed": 1}
    unbind_question_from_node(
        tmp_path, {"question_qualified_id": "bank/q1", "node_id": "math/child"}, graph="math"
    )

    resource = tmp_path / "resource" / "notes" / "source.txt"
    resource.parent.mkdir(parents=True)
    resource.write_text("graph resource", encoding="utf-8")
    detached = attach_file_to_node(tmp_path, "math/child", "notes/source.txt", graph="math")
    assert [link["id"] for link in list_file_links_for_node(tmp_path, "math/child", graph="math")] == [detached]
    detach_file_link(tmp_path, detached, graph="math")
    assert list_file_links_for_node(tmp_path, "math/child", graph="math") == []

    attach_file_to_node(tmp_path, "math/child", "notes/source.txt", graph="math")
    bind_question_to_node(tmp_path, {"question_qualified_id": "bank/q5", "node_id": "math/child"}, graph="math")
    receipt = delete_concept_node(tmp_path, "math/child", graph="math")
    assert receipt["deleted_node"]["canonical_name"] == "Updated child"
    assert receipt["deleted_node"]["aliases"] == ["updated alias"]
    assert receipt["deleted_node"]["tags"] == ["updated tag"]
    assert receipt["deleted_node"]["source"] == "update/source.yaml"
    assert receipt["deleted_node"]["notes"][0]["body"] == "update input"
    assert {relation["id"] for relation in receipt["deleted_relations"]} == {
        parent_relation, first_relation, cascade_relation
    }
    receipt["deleted_node"]["aliases"].append("receipt mutation")
    receipt["deleted_relations"][0]["relation_type"] = "receipt mutation"
    assert list_questions_for_node(tmp_path, "math/child", graph="math") == []
    assert list_file_links_for_node(tmp_path, "math/child", graph="math") == []
    assert all(
        relation["from_node_id"] != "math/child" and relation["to_node_id"] != "math/child"
        for relation in list_node_relations(tmp_path)
    )


def test_failed_multi_subject_write_rolls_back_without_publishing_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for slug in ("math", "physics"):
        create_graph(tmp_path, slug, slug)
        create_concept_node(tmp_path, {"id": slug, "canonical_name": slug}, graph=slug)
        storage._load_subject_state(tmp_path, slug)

    paths = {slug: _subject_state_path(tmp_path, slug) for slug in ("math", "physics")}
    original_bytes = {slug: path.read_bytes() for slug, path in paths.items()}
    original = storage.write_text_atomic
    calls = []

    def fail_second(path: Path, content: str) -> None:
        calls.append(path)
        if len(calls) == 2:
            raise OSError("disk unavailable")
        original(path, content)

    monkeypatch.setattr(storage, "write_text_atomic", fail_second)
    with pytest.raises(OSError, match="disk unavailable"):
        bind_question_nodes_batch(tmp_path, [
            {"question_qualified_id": "bank/q1", "node_id": "math"},
            {"question_qualified_id": "bank/q2", "node_id": "physics"},
        ])

    assert len(calls) == 3
    assert {slug: path.read_bytes() for slug, path in paths.items()} == original_bytes
    root_key = cache._graph_root_key(tmp_path)
    assert not any(key[0] == root_key for key in cache._state_cache)
    assert list_questions_for_node(tmp_path, "math") == []
    assert list_questions_for_node(tmp_path, "physics") == []

    monkeypatch.setattr(storage, "write_text_atomic", original)
    assert bind_question_nodes_batch(tmp_path, [
        {"question_qualified_id": "bank/q1", "node_id": "math"},
        {"question_qualified_id": "bank/q2", "node_id": "physics"},
    ]) == {"added": 2, "skipped": 0, "total": 2}
    assert list_questions_for_node(tmp_path, "math") == ["bank/q1"]
    assert list_questions_for_node(tmp_path, "physics") == ["bank/q2"]
