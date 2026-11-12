from __future__ import annotations

from functools import cache
import math
from typing import Any

import numpy as np

from solaire.primebrush.common.style import merge_style
from solaire.primebrush.common.svg_util import escape_text, svg_root
from solaire.primebrush.common.models import ChartModel


_RUST_BAR_MIN_COUNT = 128
_BAR_FILLS = ("#333", "#666", "#999", "#444", "#777")


@cache
def _get_rust_chart_bar_svg() -> Any:
    """Resolve the optional continuous-buffer bar chart serializer."""
    try:
        from primebrush_rs import chart_bar_svg  # type: ignore[import-not-found]
    except (ImportError, NotImplementedError):
        return None
    return chart_bar_svg


def _bar_columns(
    data: list[dict[str, Any]],
) -> tuple[list[str], list[float], list[float | None]]:
    """Extract columns in the renderer's historical conversion order."""
    labels = [str(row.get("label", "")) for row in data]
    values = [float(row.get("value", 0.0)) for row in data]
    errors = [float(row["error"]) if row.get("error") is not None else None for row in data]
    return labels, values, errors


def _bar_y_range(
    opts: dict[str, Any], values: list[float], errors: list[float | None]
) -> tuple[float, float]:
    y_rng = opts.get("y_range")
    if y_rng and len(y_rng) == 2:
        return float(y_rng[0]), float(y_rng[1])
    vmax = max(values) if values else 1.0
    emax = max((error for error in errors if error is not None), default=0.0)
    return 0.0, max(vmax + emax, 1.0) * 1.1


def _bar_native_options(opts: dict[str, Any]) -> tuple[float, bool, bool, str, str]:
    bar_width_fraction = float(opts.get("bar_width", 0.6))
    show_error = bool(opts.get("show_error"))
    show_value = bool(opts.get("show_value"))
    xl = opts.get("x_label") or ""
    yl = opts.get("y_label") or ""
    x_label = str(xl) if xl else ""
    y_label = str(yl) if yl else ""
    return bar_width_fraction, show_error, show_value, x_label, y_label


def _render_large_bar_native(
    renderer: Any,
    labels: list[str],
    values: list[float],
    errors: list[float | None],
    y_range: tuple[float, float],
    options: tuple[float, bool, bool, str, str],
    width: float,
    height: float,
    font_size: float,
    font_family: str,
    stroke_width: float,
) -> str | None:
    y_min, y_max = y_range
    if y_max == y_min:
        return None

    bar_width_fraction, show_error, show_value, x_label, y_label = options
    try:
        label_offsets = np.empty(len(labels) + 1, dtype=np.int64)
        label_offsets[0] = 0
        label_parts: list[bytes] = []
        label_size = 0
        for i, label in enumerate(labels, start=1):
            encoded = label.encode("utf-8")
            label_parts.append(encoded)
            label_size += len(encoded)
            label_offsets[i] = label_size
        label_bytes = b"".join(label_parts)
        # Native buffers require UTF-8. Lone surrogate text remains supported
        # by the legacy Python renderer, so leave that uncommon input there.
        font_family.encode("utf-8")
        x_label.encode("utf-8")
        y_label.encode("utf-8")
    except UnicodeEncodeError:
        return None

    values_buffer = np.asarray(values, dtype=np.float64)
    errors_buffer = np.asarray(
        [math.nan if error is None else error for error in errors],
        dtype=np.float64,
    )
    try:
        return renderer(
            label_bytes,
            label_offsets,
            values_buffer,
            errors_buffer,
            width,
            height,
            font_size,
            font_family,
            stroke_width,
            y_min,
            y_max,
            bar_width_fraction,
            show_error,
            show_value,
            x_label,
            y_label,
        )
    except (BufferError, TypeError, ValueError):
        return None


def render_chart_svg(
    model: ChartModel,
    width: float,
    height: float,
    _rng: np.random.Generator,
) -> str:
    style = merge_style(model.style)
    fs = style.font_size or 11.0
    ff = style.font_family or "sans-serif"
    sw = style.stroke_width or 1.0
    ff_svg = escape_text(ff)

    kind = (model.kind or "bar").lower()
    opts = model.options or {}
    data = model.data or []

    margin_l, margin_r = 52.0, 20.0
    margin_t, margin_b = 28.0, 52.0
    plot_w = width - margin_l - margin_r
    plot_h = height - margin_t - margin_b

    parts: list[str] = []

    if kind == "bar":
        native_renderer = None
        if len(data) >= _RUST_BAR_MIN_COUNT:
            native_renderer = _get_rust_chart_bar_svg()
        labels, values, errors = _bar_columns(data)
        y_min, y_max = _bar_y_range(opts, values, errors)

        native_options = None
        if native_renderer is not None and y_max != y_min:
            native_options = _bar_native_options(opts)
            native_inner = _render_large_bar_native(
                native_renderer,
                labels,
                values,
                errors,
                (y_min, y_max),
                native_options,
                width,
                height,
                fs,
                ff,
                sw,
            )
            if native_inner is not None:
                return svg_root(width, height, native_inner)

        n = max(len(labels), 1)
        bar_w_frac = (
            native_options[0]
            if native_options is not None
            else float(opts.get("bar_width", 0.6))
        )
        gap = plot_w / n
        bar_w = gap * bar_w_frac

        def y_to_px(yv: float) -> float:
            return margin_t + (y_max - yv) / (y_max - y_min) * plot_h

        x1_svg = f'{margin_l:.2f}'
        x2_svg = f'{width - margin_r:.2f}'
        stroke_svg = f'{sw:.2f}'

        # Grid
        for k in range(5):
            gy = y_min + (y_max - y_min) * k / 4
            ypx = y_to_px(gy)
            parts.append(
                f'<line x1="{x1_svg}" y1="{ypx:.2f}" x2="{x2_svg}" y2="{ypx:.2f}" stroke="#ccc" stroke-width="0.5"/>'
            )

        y_bottom = y_to_px(y_min)
        y_top = y_to_px(y_max)
        y_bottom_svg = f'{y_bottom:.2f}'
        parts.append(
            f'<line x1="{x1_svg}" y1="{y_bottom_svg}" x2="{x1_svg}" y2="{y_top:.2f}" stroke="#222" stroke-width="{stroke_svg}"/>'
        )
        parts.append(
            f'<line x1="{x1_svg}" y1="{y_bottom_svg}" x2="{x2_svg}" y2="{y_bottom_svg}" stroke="#222" stroke-width="{stroke_svg}"/>'
        )

        if native_options is None:
            show_error = bool(opts.get("show_error"))
            show_value = bool(opts.get("show_value"))
        else:
            _, show_error, show_value, _, _ = native_options

        bar_width_svg = f'{bar_w:.2f}'
        bar_label_font_svg = f'{fs * 0.85:.1f}'
        bar_label_y = f'{height - margin_b + 16:.2f}'
        bar_label_attrs = (
            f'font-size="{bar_label_font_svg}" font-family="{ff_svg}" '
            'text-anchor="middle" fill="#111"'
        )
        for i, (lab, val, err) in enumerate(zip(labels, values, errors, strict=True)):
            cx = margin_l + gap * i + (gap - bar_w) / 2
            x1, x2 = cx, cx + bar_w
            x_center = (x1 + x2) / 2
            x_center_svg = f'{x_center:.2f}'
            yt = y_to_px(val)
            fill = _BAR_FILLS[i % len(_BAR_FILLS)]
            parts.append(
                f'<rect x="{x1:.2f}" y="{yt:.2f}" width="{bar_width_svg}" height="{y_bottom - yt:.2f}" fill="{fill}" stroke="#111" stroke-width="0.5"/>'
            )
            if show_error and err is not None and err > 0:
                ym = y_to_px(val + err)
                parts.append(
                    f'<line x1="{x_center_svg}" y1="{yt:.2f}" x2="{x_center_svg}" y2="{ym:.2f}" stroke="#111" stroke-width="1.2"/>'
                )
                parts.append(
                    f'<line x1="{x_center - 4:.2f}" y1="{ym:.2f}" x2="{x_center + 4:.2f}" y2="{ym:.2f}" stroke="#111" stroke-width="1.2"/>'
                )
            if show_value:
                parts.append(
                    f'<text x="{x_center_svg}" y="{yt - 4:.2f}" {bar_label_attrs}>{val:.0f}</text>'
                )
            parts.append(
                f'<text x="{x_center_svg}" y="{bar_label_y}" {bar_label_attrs}>{escape_text(lab)}</text>'
            )

        if native_options is None:
            xl = opts.get("x_label") or ""
            yl = opts.get("y_label") or ""
            x_label = str(xl) if xl else ""
            y_label = str(yl) if yl else ""
        else:
            _, _, _, x_label, y_label = native_options
        if x_label:
            parts.append(
                f'<text x="{width / 2:.2f}" y="{height - 10:.2f}" font-size="{fs:.1f}" font-family="{ff_svg}" text-anchor="middle" fill="#111">{escape_text(x_label)}</text>'
            )
        if y_label:
            y_label_center = (margin_t + height - margin_b) / 2
            parts.append(
                f'<text x="14" y="{y_label_center:.2f}" font-size="{fs:.1f}" font-family="{ff_svg}" '
                f'text-anchor="middle" fill="#111" transform="rotate(-90 14 {y_label_center:.2f})">{escape_text(y_label)}</text>'
            )

    elif kind == "line":
        labels = [str(row.get("label", "")) for row in data]
        values = [float(row.get("value", 0.0)) for row in data]
        n = len(labels)
        y_rng = opts.get("y_range")
        if y_rng and len(y_rng) == 2:
            y_min, y_max = float(y_rng[0]), float(y_rng[1])
        else:
            y_min, y_max = 0.0, max(values) * 1.1 if values else 1.0

        def y_to_px2(yv: float) -> float:
            return margin_t + (y_max - yv) / (y_max - y_min) * plot_h

        x_denominator = max(n - 1, 1)
        x_coords = [
            f"{margin_l + (i / x_denominator) * plot_w:.2f}"
            for i in range(n)
        ]
        pts = [f"{x_coords[i]},{y_to_px2(v):.2f}" for i, v in enumerate(values)]
        if len(pts) >= 2:
            path_d = "M " + " L ".join(pts)
            parts.append(f'<path d="{path_d}" fill="none" stroke="#333" stroke-width="2"/>')
        line_label_y = f'{height - 18:.2f}'
        line_label_attrs = (
            f'y="{line_label_y}" font-size="{fs * 0.8:.1f}" font-family="{ff_svg}" '
            'text-anchor="middle" fill="#111"'
        )
        for i, lab in enumerate(labels):
            parts.append(
                f'<text x="{x_coords[i]}" {line_label_attrs}>{escape_text(lab)}</text>'
            )
    else:
        parts.append(
            f'<text x="{width / 2:.2f}" y="{height / 2:.2f}" font-size="{fs:.1f}" text-anchor="middle" fill="#888">kind {escape_text(kind)} not implemented</text>'
        )

    inner = "\n".join(parts)
    return svg_root(width, height, inner)
