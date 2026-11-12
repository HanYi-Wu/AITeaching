from __future__ import annotations

import hashlib

import numpy as np
import pytest

from solaire.primebrush import api
from solaire.primebrush.common.models import Geometry2DModel
from solaire.primebrush.geometry import euclid
from solaire.primebrush.geometry.solver import solve_geometry


def _geometry_with_scalar_solve_ops() -> Geometry2DModel:
    return Geometry2DModel(
        canvas={"width": 640, "height": 480},
        constructions=[
            {"op": "triangle", "nodes": ["A", "B", "C"], "attr": {"type": "random", "min_angle": 25}},
            {"op": "in_line", "id": "M", "source": ["A", "B"], "params": 0.375},
            {"op": "line", "source": ["A", "B"], "style": "dashed", "id": "AB", "label": {"text": "base", "pos": 0.37}},
            {"op": "foot", "id": "H", "point": "C", "line": ["A", "B"]},
            {"op": "reflection", "id": "R", "point": "C", "line": ["A", "B"]},
            {"op": "perpendicular", "through": "M", "to": ["A", "B"], "style": "dashed", "id": "perp", "label": {"text": "normal", "pos": 0.4}},
            {"op": "parallel", "through": "H", "to": ["A", "C"], "style": "solid"},
            {"op": "perpendicular_bisector", "source": ["A", "C"], "id": "bisect"},
            {"op": "angle_bisector", "source": {"vertex": "B", "arms": ["A", "C"]}, "id": "angle"},
            {"op": "intersection_lines", "id": "I", "line1": ["A", "B"], "line2": ["B", "C"]},
            {"op": "circle", "center": "A", "radius": 45, "id": "c1"},
            {"op": "intersection_line_circle", "id": "LC", "line": ["A", "B"], "center": "A", "radius": 60},
            {"op": "intersection_circles", "circle1": {"center": "A", "radius": 500}, "circle2": {"center": "C", "radius": 500}, "ids": ["X", "Y"]},
            {"op": "ellipse", "center": "C", "rx": 25, "ry": 17, "rotation_deg": 12, "id": "ell"},
        ],
    )


def test_scalar_solver_keeps_fixed_seed_svg_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(api, "_get_rust_render", lambda: None)

    svg = api.render(_geometry_with_scalar_solve_ops(), seed=42)

    assert len(svg.encode("utf-8")) == 3124
    assert hashlib.sha256(svg.encode("utf-8")).hexdigest() == (
        "7f923e07901ed8b24935315f5be84bdbf4635460416eb54460d4864ffc379ad0"
    )


def test_foot_and_reflection_share_the_same_projection(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    original = euclid.foot_on_line

    def counted_foot(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        nonlocal calls
        calls += 1
        return original(p, a, b)

    monkeypatch.setattr(euclid, "foot_on_line", counted_foot)
    result = solve_geometry(
        [
            {"op": "triangle", "nodes": ["A", "B", "C"]},
            {"op": "foot", "id": "H", "point": "C", "line": ["A", "B"]},
            {"op": "reflection", "id": "R", "point": "C", "line": ["A", "B"]},
        ],
        640,
        480,
        np.random.default_rng(42),
    )

    assert calls == 1
    cx, cy = result.points["C"]
    hx, hy = result.points["H"]
    rx, ry = result.points["R"]
    assert (rx, ry) == (2.0 * hx - cx, 2.0 * hy - cy)


@pytest.mark.parametrize(
    ("operation", "message"),
    [
        ({"op": "perpendicular", "through": "A", "to": ["A", "Z"]}, "perpendicular: degenerate line"),
        ({"op": "parallel", "through": "A", "to": ["A", "Z"]}, "parallel: degenerate direction"),
        ({"op": "perpendicular_bisector", "source": ["A", "Z"]}, "perpendicular_bisector: segment has zero length"),
        ({"op": "angle_bisector", "source": {"vertex": "A", "arms": ["A", "B"]}}, "angle_bisector: degenerate arm"),
    ],
)
def test_scalar_solver_preserves_degenerate_errors(
    operation: dict, message: str
) -> None:
    constructions = [
        {"op": "triangle", "nodes": ["A", "B", "C"]},
        {"op": "in_line", "id": "Z", "source": ["A", "A"]},
        operation,
    ]

    with pytest.raises(ValueError, match=message):
        solve_geometry(constructions, 640, 480, np.random.default_rng(42))
