"""Graph batches preserve subject identity and stop safely on persistence failures."""
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest
from solaire.knowledge_forge import (
    create_graph, create_concept_node, create_concept_nodes_batch,
    bind_question_nodes_batch, list_questions_for_node, list_concept_nodes,
    create_node_relations_batch, list_node_relations,
)
from solaire.knowledge_forge import storage
from solaire.knowledge_forge.concurrency import graph_lock


def setup_graphs(root):
    for slug in ("math", "physics"):
        create_graph(root, slug, slug)
        create_concept_node(root, {"id": slug, "canonical_name": slug}, graph=slug)


def test_binding_rejects_wrong_subject_before_any_write(tmp_path):
    setup_graphs(tmp_path)
    with pytest.raises(ValueError, match="指定图谱"):
        bind_question_nodes_batch(tmp_path, [
            {"question_qualified_id": "bank/q1", "node_id": "math"},
            {"question_qualified_id": "bank/q2", "node_id": "physics"},
        ], graph="math")
    assert list_questions_for_node(tmp_path, "math") == []
    assert list_questions_for_node(tmp_path, "physics") == []


def test_multi_subject_binding_rolls_back_handled_write_failure(tmp_path, monkeypatch):
    setup_graphs(tmp_path)
    original = storage.write_text_atomic
    calls = []

    def fail_second(path, content):
        calls.append(path)
        if len(calls) == 2:
            raise OSError("disk unavailable")
        return original(path, content)

    monkeypatch.setattr(storage, "write_text_atomic", fail_second)
    with pytest.raises(OSError):
        bind_question_nodes_batch(tmp_path, [
            {"question_qualified_id": "bank/q1", "node_id": "math"},
            {"question_qualified_id": "bank/q2", "node_id": "physics"},
        ])
    assert len(calls) == 3  # two attempted writes and restoration of the first
    assert list_questions_for_node(tmp_path, "math") == []
    assert list_questions_for_node(tmp_path, "physics") == []


def test_global_ids_are_serialized_across_subjects(tmp_path):
    setup_graphs(tmp_path)

    def write(slug):
        try:
            return create_concept_node(tmp_path, {"id": "shared", "canonical_name": slug}, graph=slug)
        except ValueError:
            return None

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(write, ["math", "physics"]))
    assert results.count("shared") == 1
    assert len([n for n in list_concept_nodes(tmp_path) if n["id"] == "shared"]) == 1


def test_batch_preserves_subjects_and_relation_result_order(tmp_path):
    setup_graphs(tmp_path)
    create_concept_nodes_batch(tmp_path, [
        {"id": "m1", "canonical_name": "M", "subject": "math"},
        {"id": "p1", "canonical_name": "P", "subject": "physics"},
    ])
    assert {n["id"] for n in list_concept_nodes(tmp_path, graph="physics")} == {"physics", "p1"}
    pairs = [("m1", "math"), ("p1", "physics"), ("math", "m1")]
    ids = create_node_relations_batch(tmp_path, [
        {"from_node_id": a, "to_node_id": b, "relation_type": "related"} for a, b in pairs
    ])
    by_id = {r["id"]: r for r in list_node_relations(tmp_path)}
    assert [(by_id[r]["from_node_id"], by_id[r]["to_node_id"]) for r in ids] == pairs


def test_graph_os_lock_timeout_never_proceeds_unlocked(tmp_path):
    path = tmp_path / "resource" / "graph" / ".write.lock"
    program = "from pathlib import Path; import sys; from solaire.web.export_lock import FileLease\nwith FileLease(Path(sys.argv[1])):\n print('locked', flush=True)\n sys.stdin.readline()"
    process = subprocess.Popen([sys.executable, "-c", program, str(path)],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == "locked"
        with pytest.raises(TimeoutError):
            with graph_lock(tmp_path, timeout=0.04):
                pytest.fail("contended lock must not enter the mutation")
    finally:
        process.communicate("release\n", timeout=10)
