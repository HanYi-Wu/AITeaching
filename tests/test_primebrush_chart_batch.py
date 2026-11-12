from __future__ import annotations

import math
import sys
from types import SimpleNamespace
from typing import Any

import pytest
import numpy as np

try:
    import primebrush_rs
except ImportError:
    primebrush_rs = None

_NATIVE_CHART_AVAILABLE = primebrush_rs is not None and callable(
    getattr(primebrush_rs, "chart_bar_svg", None)
)

from solaire.primebrush import api
from solaire.primebrush.charts import render as chart_render
from solaire.primebrush.common.models import ChartModel


def _chart(count: int = 140) -> ChartModel:
    data: list[dict[str, Any]] = []
    labels = ["重复 & <组>", "中文‘标签’", 'quotes " and \'', "A > B"]
    for index in range(count):
        data.append(
            {
                "label": labels[index % len(labels)],
                "value": float((index % 71) - 20),
                "error": (None, 0.0, 0.75, math.nan)[index % 4],
            }
        )
    return ChartModel(
        canvas={"width": 640, "height": 480, "unit": "px"},
        style={"font_size": 11, "font_family": "Arial & 字体 <Sans>", "stroke_width": 1.2},
        kind="bar",
        options={
            "show_error": True,
            "show_value": True,
            "y_range": [-25, 55],
            "bar_width": 0.63,
            "x_label": "组别 & <x>",
            "y_label": "数量 > 0",
        },
        data=data,
    )


def _render(doc: ChartModel, seed: int = 42) -> str:
    return api.render(doc, seed=seed)


def test_native_large_chart_matches_python_svg_and_special_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if not _NATIVE_CHART_AVAILABLE:
        pytest.skip("optional native chart buffer helper is unavailable")

    doc = _chart()
    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: None)
    expected = _render(doc)

    monkeypatch.setattr(
        chart_render,
        "_get_rust_chart_bar_svg",
        lambda: primebrush_rs.chart_bar_svg,
    )
    actual = _render(doc)
    assert actual.encode("utf-8") == expected.encode("utf-8")
    assert "Arial &amp; 字体 &lt;Sans&gt;" in actual
    assert "重复 &amp; &lt;组&gt;" in actual
    assert "quotes \" and '" in actual
    assert "stroke-width=\"1.2\"" in actual


def test_native_chart_fixed_point_matches_python_for_special_floats(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if not _NATIVE_CHART_AVAILABLE:
        pytest.skip("optional native chart buffer helper is unavailable")

    doc = _chart(140)
    edge_values = [0.0, -0.0, 1.005, 2.675, -0.005, math.inf, -math.inf, math.nan]
    for index, row in enumerate(doc.data):
        row["value"] = edge_values[index % len(edge_values)]
        row["error"] = edge_values[(index + 3) % len(edge_values)]

    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: None)
    expected = _render(doc)
    monkeypatch.setattr(
        chart_render,
        "_get_rust_chart_bar_svg",
        lambda: primebrush_rs.chart_bar_svg,
    )
    actual = _render(doc)
    assert actual.encode("utf-8") == expected.encode("utf-8")


def test_python_bar_chart_escapes_shared_font_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    original_escape = chart_render.escape_text

    def recording_escape(value: str) -> str:
        calls.append(value)
        return original_escape(value)

    monkeypatch.setattr(chart_render, "escape_text", recording_escape)
    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: None)
    _render(_chart(140))
    assert calls.count("Arial & 字体 <Sans>") == 1


def test_native_chart_buffer_signature_checks_layout_and_precision() -> None:
    if not _NATIVE_CHART_AVAILABLE:
        pytest.skip("optional native chart buffer helper is unavailable")

    labels = np.frombuffer("组".encode("utf-8"), dtype=np.uint8)
    offsets = np.asarray([0, len(labels)], dtype=np.int64)
    values = np.asarray([-1.25], dtype=np.float64)
    errors = np.asarray([math.nan], dtype=np.float64)
    render = primebrush_rs.chart_bar_svg
    args = (640.0, 480.0, 11.0, "sans-serif", 1.0, -2.0, 2.0, 0.6, True, False, "", "")

    assert "组" in render(labels, offsets, values, errors, *args)
    with pytest.raises(ValueError, match="matching lengths"):
        render(labels, offsets, values, np.empty(0, dtype=np.float64), *args)
    with pytest.raises(ValueError, match="offsets"):
        render(labels, np.asarray([0, len(labels) - 1], dtype=np.int64), values, errors, *args)
    with pytest.raises((BufferError, TypeError)):
        render(labels, offsets, values.astype(np.float32), errors, *args)
    with pytest.raises(ValueError, match="one-dimensional"):
        render(labels, offsets, values.reshape(1, 1), errors, *args)
    with pytest.raises(ValueError, match="C-contiguous"):
        render(
            labels,
            offsets,
            np.asarray([1.0, 99.0, 2.0, 99.0], dtype=np.float64)[::2],
            errors,
            *args,
        )


def test_large_chart_threshold_and_old_extension_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolve_native = chart_render._get_rust_chart_bar_svg
    calls: list[int] = []

    def fake_native(labels: Any, offsets: Any, values: Any, errors: Any, *args: Any) -> str:
        calls.append(len(values))
        return "native chart body"

    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: fake_native)
    small = _render(_chart(127))
    assert calls == []
    assert "native chart body" not in small

    large = _render(_chart(128))
    assert calls == [128]
    assert "native chart body" in large

    old_extension = SimpleNamespace(plot2d_path=lambda *args: "old")
    monkeypatch.setitem(sys.modules, "primebrush_rs", old_extension)
    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", resolve_native)
    resolve_native.cache_clear()
    try:
        old_fallback = _render(_chart(140))
    finally:
        resolve_native.cache_clear()
    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: None)
    expected = _render(_chart(140))
    assert old_fallback.encode("utf-8") == expected.encode("utf-8")


def test_native_fallback_preserves_surrogates_and_degenerate_range(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doc = _chart(140)
    doc.data[0]["label"] = "lone surrogate \ud800"
    calls = 0

    def should_not_run(*args: Any) -> str:
        nonlocal calls
        calls += 1
        return "unexpected"

    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: should_not_run)
    actual = _render(doc)
    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: None)
    expected = _render(doc)
    assert actual == expected
    assert calls == 0

    degenerate = _chart(140)
    degenerate.options["y_range"] = [2, 2]
    with pytest.raises(ZeroDivisionError):
        _render(degenerate)
    assert calls == 0


def test_chart_conversion_error_order_matches_python_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doc = _chart(140)
    doc.data[0]["value"] = "bad value"
    doc.data[0]["error"] = "bad error"
    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: None)
    with pytest.raises(ValueError, match="could not convert string to float"):
        _render(doc)

    def never_called(*args: Any) -> str:
        pytest.fail("chart renderer should preserve the data conversion error order")

    monkeypatch.setattr(chart_render, "_get_rust_chart_bar_svg", lambda: never_called)
    with pytest.raises(ValueError, match="could not convert string to float"):
        _render(doc)
