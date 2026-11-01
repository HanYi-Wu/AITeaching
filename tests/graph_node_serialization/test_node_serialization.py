from __future__ import annotations

import gc
import os
from pathlib import Path
import weakref

import pytest

from solaire.knowledge_forge import create_concept_nodes_batch, create_graph, update_concept_node
from solaire.knowledge_forge import cache, node_serialization as fragments
from solaire.knowledge_forge import storage
from solaire.knowledge_forge.models import ConceptNode, GraphState
from solaire.knowledge_forge.paths import _subject_state_path
from solaire.knowledge_forge.snapshot_commands.yaml_codec import safe_yaml_dump


def _seed_graph(root: Path, count: int) -> str:
    slug = create_graph(root, "数学", "math")
    create_concept_nodes_batch(
        root,
        [
            {
                "id": f"math/n{index}",
                "canonical_name": f"Node {index}",
                "aliases": [f"alias {index}", "second alias"],
                "tags": ["algebra", "graph"],
                "source": f"source/{index}.yaml",
                "notes": [
                    {"id": f"note-{index}", "body": f"line 1\nline 2: {index}"},
                ],
            }
            for index in range(count)
        ],
    )
    return slug


def _assert_native_file(root: Path, slug: str) -> None:
    state = storage._load_subject_state_snapshot(root, slug)
    expected = safe_yaml_dump(state.model_dump(mode="json")).encode("utf-8")
    assert _subject_state_path(root, slug).read_bytes() == expected


def test_public_updates_reuse_one_fragment_and_match_native_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fragments.invalidate_node_yaml_cache(tmp_path)
    slug = _seed_graph(tmp_path, 5)
    observed = []
    original = storage.serialize_single_node_update

    def capture(*args, **kwargs):
        result = original(*args, **kwargs)
        observed.append(result)
        return result

    monkeypatch.setattr(storage, "serialize_single_node_update", capture)
    update_concept_node(tmp_path, "math/n1", {"canonical_name": "Changed once", "aliases": ["one"]}, graph=slug)
    assert observed[-1].cache_hit is False
    assert observed[-1].serialized_nodes == 5
    assert observed[-1].index_ns == 0
    assert observed[-1].fallback_reason == "index deferred"
    _assert_native_file(tmp_path, slug)

    update_concept_node(
        tmp_path,
        "math/n3",
        {
            "canonical_name": "Changed twice",
            "aliases": ["a", "b"],
            "tags": ["x", "y"],
            "source": "replacement/source.yaml",
            "notes": [{"id": "long-note", "body": "first line\nsecond line: 'quoted'\nthird line"}],
        },
        graph=slug,
    )
    assert observed[-1].cache_hit is True
    assert observed[-1].index_ns > 0
    assert observed[-1].reused_nodes == 4
    assert observed[-1].serialized_nodes == 1
    _assert_native_file(tmp_path, slug)

    update_concept_node(tmp_path, "math/n4", {"canonical_name": "Changed third"}, graph=slug)
    assert observed[-1].cache_hit is True
    assert observed[-1].index_ns == 0
    assert observed[-1].reused_nodes == 4
    _assert_native_file(tmp_path, slug)

    # Public reads stay deeply isolated from the cache-owned COW snapshot.
    public_state = storage._load_subject_state(tmp_path, slug)
    public_state.nodes[3].aliases.append("caller mutation")
    public_state.nodes[3].notes[0].body = "caller mutation"
    _assert_native_file(tmp_path, slug)


def test_external_same_stat_edit_forces_full_dump_and_generic_save_invalidates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fragments.invalidate_node_yaml_cache(tmp_path)
    slug = _seed_graph(tmp_path, 3)
    observed = []
    original = storage.serialize_single_node_update

    def capture(*args, **kwargs):
        result = original(*args, **kwargs)
        observed.append(result)
        return result

    monkeypatch.setattr(storage, "serialize_single_node_update", capture)
    update_concept_node(tmp_path, "math/n0", {"canonical_name": "Node A"}, graph=slug)
    path = _subject_state_path(tmp_path, slug)
    before = path.stat()
    content = path.read_bytes()
    assert b"canonical_name: Node A" in content
    path.write_bytes(content.replace(b"canonical_name: Node A", b"canonical_name: Node B", 1))
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    assert path.stat().st_size == before.st_size
    assert path.stat().st_mtime_ns == before.st_mtime_ns

    update_concept_node(tmp_path, "math/n1", {"canonical_name": "Node C"}, graph=slug)
    assert observed[-1].cache_hit is False
    assert observed[-1].fallback_reason == "file content changed"
    _assert_native_file(tmp_path, slug)

    before = path.stat()
    content = path.read_bytes()
    assert b"canonical_name: Node 2" in content
    path.write_bytes(content.replace(b"canonical_name: Node 2", b"canonical_name: Externally edited", 1))
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
    assert path.stat().st_mtime != before.st_mtime
    update_concept_node(tmp_path, "math/n1", {"canonical_name": "Node D"}, graph=slug)
    assert observed[-1].cache_hit is False
    assert observed[-1].fallback_reason == "file revision changed"
    assert storage._load_subject_state_snapshot(tmp_path, slug).nodes[2].canonical_name == "Externally edited"
    _assert_native_file(tmp_path, slug)

    state = storage._load_subject_state_snapshot(tmp_path, slug).model_copy(deep=True)
    state.nodes[0].canonical_name = "Generic save"
    storage._save_subject_state(tmp_path, slug, state)
    assert fragments._key(tmp_path, slug) not in fragments._CACHE


def test_failed_atomic_write_keeps_old_file_state_and_fragment_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fragments.invalidate_node_yaml_cache(tmp_path)
    slug = _seed_graph(tmp_path, 4)
    update_concept_node(tmp_path, "math/n0", {"canonical_name": "Saved"}, graph=slug)
    path = _subject_state_path(tmp_path, slug)
    old_file = path.read_bytes()
    old_state = storage._load_subject_state_snapshot(tmp_path, slug)
    old_info = fragments.node_yaml_cache_info()
    original = storage.write_text_atomic
    observed = []
    serializer = storage.serialize_single_node_update

    def capture(*args, **kwargs):
        result = serializer(*args, **kwargs)
        observed.append(result)
        return result

    monkeypatch.setattr(storage, "serialize_single_node_update", capture)

    def fail_write(target: Path, content: str) -> None:
        if target == path:
            raise OSError("injected atomic replacement failure")
        original(target, content)

    monkeypatch.setattr(storage, "write_text_atomic", fail_write)
    with pytest.raises(OSError, match="injected atomic replacement failure"):
        update_concept_node(tmp_path, "math/n1", {"canonical_name": "Not persisted"}, graph=slug)
    assert path.read_bytes() == old_file
    assert observed[-1].cache_hit is True
    assert storage._load_subject_state_snapshot(tmp_path, slug) is old_state
    assert fragments.node_yaml_cache_info() == old_info

    monkeypatch.setattr(storage, "write_text_atomic", original)
    update_concept_node(tmp_path, "math/n2", {"canonical_name": "Recovered"}, graph=slug)
    assert observed[-1].cache_hit is True
    _assert_native_file(tmp_path, slug)


def test_unsupported_or_oversize_index_falls_back_without_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fragments.invalidate_node_yaml_cache(tmp_path)
    state = GraphState(nodes=[ConceptNode(id="math/n1", canonical_name="One")])
    native = safe_yaml_dump(state.model_dump(mode="json"))
    assert fragments._index_full_dump(native.replace("nodes:\n", "nodes: &shared\n"), state) is None
    assert fragments._index_full_dump(native.replace("nodes:\n", "extension: true\nnodes:\n"), state) is None

    monkeypatch.setattr(fragments, "_MAX_CACHE_BYTES", 1)

    class NoScan:
        def finditer(self, _text: str):
            raise AssertionError("over-budget source must return before boundary scanning")

    monkeypatch.setattr(fragments, "_BOUNDARY_RE", NoScan())
    assert fragments._index_full_dump(native, state) is None
    slug = _seed_graph(tmp_path, 2)
    update_concept_node(tmp_path, "math/n0", {"canonical_name": "Cold fallback"}, graph=slug)
    assert fragments._key(tmp_path, slug) not in fragments._CACHE
    _assert_native_file(tmp_path, slug)


def test_same_slug_in_two_projects_keeps_snapshots_isolated(tmp_path: Path) -> None:
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first_slug = _seed_graph(first_root, 2)
    second_slug = _seed_graph(second_root, 2)
    assert first_slug == second_slug == "math"

    update_concept_node(first_root, "math/n0", {"canonical_name": "First cold"}, graph="math")
    update_concept_node(second_root, "math/n0", {"canonical_name": "Second cold"}, graph="math")
    first_key = fragments._key(first_root, "math")
    second_key = fragments._key(second_root, "math")
    assert first_key != second_key
    assert first_key in fragments._CACHE
    assert second_key in fragments._CACHE
    update_concept_node(first_root, "math/n1", {"canonical_name": "First warm"}, graph="math")
    update_concept_node(second_root, "math/n1", {"canonical_name": "Second warm"}, graph="math")

    first = storage._load_subject_state_snapshot(first_root, "math")
    second = storage._load_subject_state_snapshot(second_root, "math")
    assert [node.canonical_name for node in first.nodes] == ["First cold", "First warm"]
    assert [node.canonical_name for node in second.nodes] == ["Second cold", "Second warm"]
    _assert_native_file(first_root, "math")
    _assert_native_file(second_root, "math")


def test_fragment_cache_does_not_keep_state_alive_and_quoted_ids_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fragments.invalidate_node_yaml_cache(tmp_path)
    slug = _seed_graph(tmp_path, 2)
    update_concept_node(tmp_path, "math/n0", {"canonical_name": "Primed"}, graph=slug)
    old_state_ref = weakref.ref(storage._load_subject_state_snapshot(tmp_path, slug))
    key = fragments._key(tmp_path, slug)
    assert key in fragments._CACHE
    cache._state_cache.pop((cache._graph_root_key(tmp_path), slug), None)
    gc.collect()
    assert old_state_ref() is None
    assert fragments._CACHE[key].state_ref() is None

    _assert_native_file(tmp_path, slug)
    state = GraphState(nodes=[ConceptNode(id="math/node: 1", canonical_name="Quoted ID")])
    storage._save_subject_state(tmp_path, "quoted", state)
    observed = []
    original = storage.serialize_single_node_update

    def capture(*args, **kwargs):
        result = original(*args, **kwargs)
        observed.append(result)
        return result

    monkeypatch.setattr(storage, "serialize_single_node_update", capture)
    update_concept_node(
        tmp_path,
        "math/node: 1",
        {"canonical_name": "Quoted ID updated"},
        graph="quoted",
    )
    assert observed[-1].cache_hit is False
    assert observed[-1].fallback_reason == "native output outside exact safe subset"
    quoted_state = storage._load_subject_state_snapshot(tmp_path, "quoted")
    assert quoted_state.nodes[0].id == "math/node: 1"
    _assert_native_file(tmp_path, "quoted")
