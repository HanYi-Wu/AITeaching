from __future__ import annotations

import pytest
from solaire.edu_analysis.executor import build_graph_slice


def test_build_graph_slice_canonical_top_down():
    rawdata = {
        "node_stats": [
            {"node_id": "math"},
            {"node_id": "math/algebra"},
            {"node_id": "math/algebra/poly"},
        ]
    }
    graph = build_graph_slice(rawdata)
    assert graph["nodes"] == [
        {"id": "math"},
        {"id": "math/algebra"},
        {"id": "math/algebra/poly"},
    ]
    assert len(graph["edges"]) == 2
    assert graph["edges"] == [
        {"from": "math", "to": "math/algebra", "type": "part_of"},
        {"from": "math/algebra", "to": "math/algebra/poly", "type": "part_of"},
    ]


def test_build_graph_slice_bottom_up_order_repaired():
    """Hypothesis 3 test: baseline dropped edges when children appeared before parents.

    Refactored version collects all node_ids first and correctly preserves all edges.
    """
    rawdata_bottom_up = {
        "node_stats": [
            {"node_id": "math/algebra/poly"},
            {"node_id": "math/algebra"},
            {"node_id": "math"},
        ]
    }
    graph = build_graph_slice(rawdata_bottom_up)
    assert graph["nodes"] == [
        {"id": "math"},
        {"id": "math/algebra"},
        {"id": "math/algebra/poly"},
    ]
    # Edges must be found even when child preceded parent
    assert len(graph["edges"]) == 2
    edge_pairs = {(e["from"], e["to"]) for e in graph["edges"]}
    assert edge_pairs == {("math", "math/algebra"), ("math/algebra", "math/algebra/poly")}


def test_build_graph_slice_deduplication_and_invalid_nodes():
    rawdata = {
        "node_stats": [
            {"node_id": "math"},
            {"node_id": "math/algebra"},
            {"node_id": "math/algebra"},  # duplicate
            {"node_id": ""},  # empty
            None,  # non-dict
            123,  # non-dict
            {"node_id": "math/geometry"},
        ]
    }
    graph = build_graph_slice(rawdata)
    assert graph["nodes"] == [
        {"id": "math"},
        {"id": "math/algebra"},
        {"id": "math/geometry"},
    ]
    assert len(graph["edges"]) == 2
    edge_pairs = {(e["from"], e["to"]) for e in graph["edges"]}
    assert edge_pairs == {("math", "math/algebra"), ("math", "math/geometry")}


def test_build_graph_slice_empty_and_malformed():
    assert build_graph_slice({}) == {"nodes": [], "edges": []}
    assert build_graph_slice({"node_stats": None}) == {"nodes": [], "edges": []}
    assert build_graph_slice({"node_stats": "invalid"}) == {"nodes": [], "edges": []}
    assert build_graph_slice({"node_stats": []}) == {"nodes": [], "edges": []}
