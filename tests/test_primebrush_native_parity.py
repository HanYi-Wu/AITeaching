from __future__ import annotations

import math
import sys
from types import SimpleNamespace

import numpy as np
import pytest

try:
    import primebrush_rs
except ImportError:
    primebrush_rs = None

_NATIVE_AVAILABLE = primebrush_rs is not None and callable(
    getattr(primebrush_rs, "plot2d_path", None)
)
_NATIVE_BATCH_AVAILABLE = primebrush_rs is not None and callable(
    getattr(primebrush_rs, "plot2d_paths_batch", None)
)
pytestmark = pytest.mark.skipif(
    not _NATIVE_AVAILABLE,
    reason="optional primebrush_rs plot2d path helper is unavailable",
)

from solaire.primebrush import api
from solaire.primebrush.plots import plot2d


def _python_path(
    xs: np.ndarray,
    ys: np.ndarray,
    *,
    x_min: float = 0.0,
    x_span: float = 1.0,
    y_max: float = 0.0,
    y_span: float = 1.0,
    plot_w: float = 1.0,
    plot_h: float = -1.0,
    margin_l: float = 0.0,
    margin_t: float = 0.0,
) -> str:
    pts = [
        f"{margin_l + (float(xs[i]) - x_min) / x_span * plot_w:.2f},"
        f"{margin_t + (y_max - float(ys[i])) / y_span * plot_h:.2f}"
        for i in range(len(xs))
    ]
    return "M " + " L ".join(pts)


def test_native_path_matches_python_fixed_point_formatting() -> None:
    values = np.asarray(
        [
            0.0,
            -0.0,
            1.005,
            2.675,
            1.125,
            2.5,
            -0.005,
            -1.005,
            1e308,
            -1e308,
            math.inf,
            -math.inf,
            math.nan,
            -math.nan,
        ],
        dtype=np.float64,
    )
    xs = values
    ys = values[::-1]

    expected = _python_path(xs, ys)
    actual = primebrush_rs.plot2d_path(
        xs, ys, 0.0, 1.0, 0.0, 1.0, 1.0, -1.0, 0.0, 0.0
    )
    assert actual == expected

    # Exercise arithmetic overflow as well as non-finite formatting.
    overflow_xs = np.asarray([-1e308, 1e308], dtype=np.float64)
    overflow_ys = np.asarray([0.0, 1.0], dtype=np.float64)
    overflow_expected = _python_path(
        overflow_xs,
        overflow_ys,
        x_min=-1e308,
        x_span=1.0,
        plot_w=2.0,
    )
    overflow_actual = primebrush_rs.plot2d_path(
        overflow_xs,
        overflow_ys,
        -1e308,
        1.0,
        0.0,
        1.0,
        2.0,
        -1.0,
        0.0,
        0.0,
    )
    assert overflow_actual == overflow_expected


@pytest.mark.skipif(not _NATIVE_BATCH_AVAILABLE, reason="optional native plot2d batch helper is unavailable")
def test_native_batch_path_uses_contiguous_buffers_and_validates_layout() -> None:
    xs = np.asarray([0.0, -0.0, 1.005, math.inf, -math.inf, math.nan], dtype=np.float64)
    ys = np.asarray([0.0, 1.0, 0.5, math.inf, -math.inf, math.nan], dtype=np.float64)
    offsets = np.asarray([0, 2, 6], dtype=np.int64)
    transform = (0.0, 1.0, 0.0, 1.0, 1.0, -1.0, 0.0, 0.0)

    actual = primebrush_rs.plot2d_paths_batch(xs, ys, offsets, *transform)
    expected = [
        primebrush_rs.plot2d_path(xs[:2], ys[:2], *transform),
        primebrush_rs.plot2d_path(xs[2:], ys[2:], *transform),
    ]
    assert actual == expected
    assert actual[0].endswith("0.00,1.00")
    assert "inf" in actual[1]
    assert "nan" in actual[1]

    # Memoryviews over packed bytes expose the same float64 data without boxing
    # or copying the coordinate samples.
    xs_bytes = memoryview(xs.tobytes()).cast("d")
    ys_bytes = memoryview(ys.tobytes()).cast("d")
    assert primebrush_rs.plot2d_paths_batch(xs_bytes, ys_bytes, offsets, *transform) == expected

    with pytest.raises((BufferError, TypeError)):
        primebrush_rs.plot2d_paths_batch(xs.astype(np.float32), ys, offsets, *transform)
    with pytest.raises(ValueError, match="one-dimensional"):
        primebrush_rs.plot2d_paths_batch(xs.reshape(2, 3), ys, offsets, *transform)
    with pytest.raises(ValueError, match="same length"):
        primebrush_rs.plot2d_paths_batch(xs, ys[:-1], offsets, *transform)
    with pytest.raises(ValueError, match="offsets"):
        primebrush_rs.plot2d_paths_batch(xs, ys, np.asarray([0, 5, 4], dtype=np.int64), *transform)

    assert primebrush_rs.MAX_PLOT2D_BATCH_POINTS == 262_144
    assert primebrush_rs.MAX_PLOT2D_BATCH_PATHS == 4_096


def test_plot2d_native_and_python_render_svg_bytes_match(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = '''
primebrush:
  type: plot_2D
  canvas: {width: 640, height: 480}
  style: {stroke_width: 1.3, font_size: 13}
  axes:
    grid: true
    x: {range: [-5, 5], ticks: 1, label: "x axis"}
    y: {range: [-2, 3], ticks: 0.5, label: "y axis"}
  elements:
    - {f: "sin(x)", domain: [-5, 5], color: "#1a5fb4", width: 2, style: solid}
    - {f: "x^2 - 1", domain: [-3, 3], color: "#c01c28", width: 1.5, style: dotted}
'''
    doc = api.parse_primebrush(raw)

    monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_paths_batch", lambda: None)
    svg_python = api.render(doc, seed=42)
    if _NATIVE_BATCH_AVAILABLE:
        monkeypatch.setattr(
            plot2d,
            "_get_rust_plot2d_paths_batch",
            lambda: primebrush_rs.plot2d_paths_batch,
        )
    else:
        monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: primebrush_rs.plot2d_path)
    svg_native = api.render(doc, seed=42)
    assert svg_native.encode("utf-8") == svg_python.encode("utf-8")
    assert primebrush_rs.HAS_FULL_RENDER is False


@pytest.mark.skipif(not _NATIVE_BATCH_AVAILABLE, reason="optional native plot2d batch helper is unavailable")
def test_plot2d_batch_render_matches_python_svg_across_chunk_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    elements = [
        f'    - {{f: "sin(x*{1 + i / 100}) + x^2/100", domain: [-5, 5], width: 1.5}}'
        for i in range(33)
    ]
    raw = "\n".join(
        [
            "primebrush:",
            "  type: plot_2D",
            "  canvas: {width: 640, height: 480}",
            "  axes: {x: {range: [-5, 5]}, y: {range: [-2, 3]}}",
            "  elements:",
            *elements,
            '    - {op: point_on_f, f_id: 0, x: 0, label: "origin"}',
        ]
    )
    doc = api.parse_primebrush(raw)

    monkeypatch.setattr(plot2d, "_get_rust_plot2d_paths_batch", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: None)
    svg_python = api.render(doc, seed=7)

    monkeypatch.setattr(
        plot2d, "_get_rust_plot2d_paths_batch", lambda: primebrush_rs.plot2d_paths_batch
    )
    svg_batch = api.render(doc, seed=7)
    assert svg_batch.encode("utf-8") == svg_python.encode("utf-8")


def test_plot2d_batch_keeps_curve_error_order(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = '''
primebrush:
  type: plot_2D
  elements:
    - {f: "x", width: invalid}
    - {f: "x + y"}
'''
    doc = api.parse_primebrush(raw)

    for batch_helper in (
        lambda: None,
        lambda: primebrush_rs.plot2d_paths_batch if _NATIVE_BATCH_AVAILABLE else None,
    ):
        monkeypatch.setattr(plot2d, "_get_rust_plot2d_paths_batch", batch_helper)
        monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: None)
        with pytest.raises(ValueError, match="could not convert string to float"):
            api.render(doc, seed=1)


def test_older_extension_without_batch_keeps_single_path_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []

    def old_path(xs: np.ndarray, ys: np.ndarray, *args: float) -> str:
        calls.append(len(xs))
        return _python_path(xs, ys, plot_w=args[4], plot_h=args[5], x_min=args[0], x_span=args[1], y_max=args[2], y_span=args[3], margin_l=args[6], margin_t=args[7])

    old_extension = SimpleNamespace(plot2d_path=old_path)
    monkeypatch.setitem(sys.modules, "primebrush_rs", old_extension)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_paths_batch", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: old_path)
    raw = '''
primebrush:
  type: plot_2D
  elements:
    - {f: "x", domain: [-1, 1]}
    - {f: "x^2", domain: [-1, 1]}
'''
    api.render(api.parse_primebrush(raw), seed=3)
    assert calls == [200, 200]


def test_legacy_extension_without_capability_marker_keeps_render(monkeypatch: pytest.MonkeyPatch) -> None:
    legacy = SimpleNamespace(render=lambda doc, seed=None: "legacy")
    monkeypatch.setitem(sys.modules, "primebrush_rs", legacy)
    api._get_rust_render.cache_clear()
    try:
        assert api._get_rust_render() is legacy.render
    finally:
        api._get_rust_render.cache_clear()
