from __future__ import annotations

from pathlib import Path

import numpy as np

from solaire.primebrush import api
from solaire.primebrush.plots import expr, plot2d


def _reject_batch_buffer(*args):
    raise BufferError("unsupported buffer")


def _legacy_plot_path(
    xs: np.ndarray,
    ys: np.ndarray,
    sample_count: int,
    x_min: float,
    x_span: float,
    y_max: float,
    y_span: float,
    plot_w: float,
    plot_h: float,
    margin_l: float,
    margin_t: float,
) -> str:
    points = [
        f"{margin_l + (float(xs[i]) - x_min) / x_span * plot_w:.2f},"
        f"{margin_t + (y_max - float(ys[i])) / y_span * plot_h:.2f}"
        for i in range(sample_count)
    ]
    return "M " + " L ".join(points)


def test_bulk_python_path_formatting_matches_scalar_reference() -> None:
    xs = np.linspace(-5.0, 5.0, 200, dtype=np.float64)
    ys = np.sin(xs)
    ys[0] = np.nan
    ys[1] = np.inf
    ys[2] = -np.inf
    ys[3] = -0.0
    args = (0.0, 2.0, 3.0, 5.0, 336.0, -404.0, 56.0, 24.0)

    actual = plot2d._format_plot2d_path_python(xs, ys, len(xs), *args)
    expected = _legacy_plot_path(xs, ys, len(xs), *args)
    assert actual.encode("utf-8") == expected.encode("utf-8")


def test_plot2d_python_fast_paths_match_legacy_nan_and_infinity_output(
    monkeypatch,
) -> None:
    raw = '''
primebrush:
  type: plot_2D
  canvas: {width: 640, height: 480}
  axes: {x: {range: [-5, 5]}, y: {range: [-3, 3]}}
  elements:
    - {f: "sqrt(x)", domain: [-5, 5]}
    - {f: "1/(x-x)", domain: [-5, 5]}
    - {op: point_on_f, f_id: 0, x: 1, label: "positive"}
'''
    doc = api.parse_primebrush(raw)
    monkeypatch.setattr(api, "_get_rust_render", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_paths_batch", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: None)

    with np.errstate(all="ignore"):
        optimized = api.render(doc, seed=42)
    monkeypatch.setattr(
        plot2d,
        "eval_expr",
        lambda source, xs: expr._eval_node(expr._parse_expr(expr._normalize_expr(source)), xs),
    )
    monkeypatch.setattr(
        expr,
        "eval_expr",
        lambda source, xs: expr._eval_node(expr._parse_expr(expr._normalize_expr(source)), xs),
    )
    with np.errstate(all="ignore"):
        reference = api.render(doc, seed=42)

    assert optimized.encode("utf-8") == reference.encode("utf-8")
    assert "nan" in optimized
    assert "inf" in optimized


def test_failed_optional_batch_uses_the_same_python_path_bytes(monkeypatch) -> None:
    raw = '''
primebrush:
  type: plot_2D
  canvas: {width: 640, height: 480}
  axes: {x: {range: [-5, 5]}, y: {range: [-3, 3]}}
  elements:
    - {f: "sin(x)^2 + cos(x)^2", domain: [-5, 5]}
    - {f: "x^2 - 1", domain: [-3, 3]}
'''
    doc = api.parse_primebrush(raw)
    monkeypatch.setattr(api, "_get_rust_render", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: None)
    monkeypatch.setattr(
        plot2d,
        "_get_rust_plot2d_paths_batch",
        lambda: _reject_batch_buffer,
    )
    failed_batch_output = api.render(doc, seed=42)

    monkeypatch.setattr(plot2d, "_get_rust_plot2d_paths_batch", lambda: None)
    python_output = api.render(doc, seed=42)
    assert failed_batch_output.encode("utf-8") == python_output.encode("utf-8")


def test_plot2d_example_svg_fixture_stays_byte_identical(monkeypatch) -> None:
    project = Path(__file__).resolve().parents[1]
    source = project / "examples" / "primebrush" / "plot_2d" / "sin_and_point.yaml"
    expected_path = project / "examples" / "primebrush" / "plot_2d" / "sin_and_point.expected.svg"
    doc = api.parse_primebrush(source)
    monkeypatch.setattr(api, "_get_rust_render", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_paths_batch", lambda: None)
    monkeypatch.setattr(plot2d, "_get_rust_plot2d_path", lambda: None)

    actual = api.render(doc, seed=42)
    expected = expected_path.read_text(encoding="utf-8").rstrip("\r\n")
    assert actual.encode("utf-8") == expected.encode("utf-8")
