//! PrimeBrush Rust 核心：与 Python `PrimeBrushPlugin` 对齐的迁移骨架。
//!
//! 完整渲染管线尚未接入；后续可将几何/绘图热路径迁入此 crate 并编译为 WASM。

use serde_json::Value;

/// 与 Python 侧 `parse_primebrush` / `render` 契约对齐：可 JSON 序列化的文档载荷。
pub type DiagramPayload = Value;

/// Maximum number of coordinates accepted by a single batched 2D path call.
/// This keeps malformed direct extension calls from requesting unbounded output.
pub const MAX_PLOT2D_BATCH_POINTS: usize = 262_144;
/// Maximum number of paths accepted by one batched 2D path call.
pub const MAX_PLOT2D_BATCH_PATHS: usize = 4_096;
/// Maximum number of bars accepted by one native chart call.
pub const MAX_CHART_BAR_COUNT: usize = 65_536;
/// Maximum UTF-8 label bytes accepted by one native chart call.
pub const MAX_CHART_LABEL_BYTES: usize = 16 * 1024 * 1024;
/// Affine mapping from mathematical coordinates to SVG plot coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plot2dTransform {
    pub x_min: f64,
    pub x_span: f64,
    pub y_max: f64,
    pub y_span: f64,
    pub plot_w: f64,
    pub plot_h: f64,
    pub margin_l: f64,
    pub margin_t: f64,
}

/// Validation errors shared by the single-path and bounded batch APIs.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum Plot2dPathError {
    #[error("xs and ys must have the same length")]
    LengthMismatch,
    #[error("offsets must contain the start and end of every path")]
    InvalidOffsets,
    #[error("plot2d batch exceeds the {MAX_PLOT2D_BATCH_POINTS} point limit")]
    TooManyPoints,
    #[error("plot2d batch exceeds the {MAX_PLOT2D_BATCH_PATHS} path limit")]
    TooManyPaths,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ChartBarError {
    #[error("chart batch exceeds its bar or label limit")]
    TooLarge,
    #[error("chart labels, values, and errors must have matching lengths")]
    LengthMismatch,
    #[error("chart label offsets are malformed")]
    InvalidOffsets,
    #[error("chart label is not valid UTF-8")]
    InvalidUtf8,
    #[error("chart y range must have a nonzero span")]
    DegenerateRange,
}

/// Render a bar chart from continuous typed data buffers. Labels remain raw
/// UTF-8 until this function escapes them, and the layout arithmetic and
/// fixed-point precision match `charts/render.py`.
#[allow(clippy::too_many_arguments)]
pub fn render_chart_bars(
    labels: &[u8],
    label_offsets: &[i64],
    values: &[f64],
    errors: &[f64],
    width: f64,
    height: f64,
    font_size: f64,
    font_family: &str,
    stroke_width: f64,
    y_min: f64,
    y_max: f64,
    bar_width_fraction: f64,
    show_error: bool,
    show_value: bool,
    x_label: &str,
    y_label: &str,
) -> Result<String, ChartBarError> {
    let bar_count = values.len();
    if bar_count > MAX_CHART_BAR_COUNT || labels.len() > MAX_CHART_LABEL_BYTES {
        return Err(ChartBarError::TooLarge);
    }
    if errors.len() != bar_count || label_offsets.len() != bar_count + 1 {
        return Err(ChartBarError::LengthMismatch);
    }
    validate_chart_offsets(labels.len(), label_offsets)?;
    if y_max == y_min {
        return Err(ChartBarError::DegenerateRange);
    }

    let margin_l = 52.0;
    let margin_r = 20.0;
    let margin_t = 28.0;
    let margin_b = 52.0;
    let plot_w = width - margin_l - margin_r;
    let plot_h = height - margin_t - margin_b;
    let n = bar_count.max(1);
    let gap = plot_w / n as f64;
    let bar_w = gap * bar_width_fraction;
    let fills = ["#333", "#666", "#999", "#444", "#777"];
    let font_family = escape_chart_text(font_family);
    let x_label = if x_label.is_empty() {
        String::new()
    } else {
        escape_chart_text(x_label)
    };
    let y_label = if y_label.is_empty() {
        String::new()
    } else {
        escape_chart_text(y_label)
    };
    let value_font_size = format_python_fixed_1(font_size * 0.85);
    let label_font_size = format_python_fixed_1(font_size);

    let mut output = String::with_capacity(
        labels
            .len()
            .saturating_add(bar_count.saturating_mul(500))
            .saturating_add(1_024),
    );

    for k in 0..5 {
        let gy = y_min + (y_max - y_min) * k as f64 / 4.0;
        let ypx = chart_y_to_px(gy, y_min, y_max, margin_t, plot_h);
        push_chart_line(
            &mut output,
            margin_l,
            ypx,
            width - margin_r,
            ypx,
            " stroke=\"#ccc\" stroke-width=\"0.5\"/>",
        );
    }

    push_chart_axis(
        &mut output,
        margin_l,
        chart_y_to_px(y_min, y_min, y_max, margin_t, plot_h),
        margin_l,
        chart_y_to_px(y_max, y_min, y_max, margin_t, plot_h),
        stroke_width,
    );
    push_chart_axis(
        &mut output,
        margin_l,
        chart_y_to_px(y_min, y_min, y_max, margin_t, plot_h),
        width - margin_r,
        chart_y_to_px(y_min, y_min, y_max, margin_t, plot_h),
        stroke_width,
    );

    for i in 0..bar_count {
        let cx = margin_l + gap * i as f64 + (gap - bar_w) / 2.0;
        let x1 = cx;
        let x2 = cx + bar_w;
        let yb = chart_y_to_px(y_min, y_min, y_max, margin_t, plot_h);
        let yt = chart_y_to_px(values[i], y_min, y_max, margin_t, plot_h);
        push_chart_separator(&mut output);
        output.push_str("<rect x=\"");
        write_python_fixed_2(&mut output, x1);
        output.push_str("\" y=\"");
        write_python_fixed_2(&mut output, yt);
        output.push_str("\" width=\"");
        write_python_fixed_2(&mut output, bar_w);
        output.push_str("\" height=\"");
        write_python_fixed_2(&mut output, yb - yt);
        output.push_str("\" fill=\"");
        output.push_str(fills[i % fills.len()]);
        output.push_str("\" stroke=\"#111\" stroke-width=\"0.5\"/>");

        let error = errors[i];
        if show_error && !error.is_nan() && error > 0.0 {
            let ym = chart_y_to_px(values[i] + error, y_min, y_max, margin_t, plot_h);
            let xm = (x1 + x2) / 2.0;
            push_chart_line(
                &mut output,
                xm,
                yt,
                xm,
                ym,
                " stroke=\"#111\" stroke-width=\"1.2\"/>",
            );
            push_chart_line(
                &mut output,
                xm - 4.0,
                ym,
                xm + 4.0,
                ym,
                " stroke=\"#111\" stroke-width=\"1.2\"/>",
            );
        }

        if show_value {
            let value_x = (x1 + x2) / 2.0;
            let value_y = yt - 4.0;
            push_chart_separator(&mut output);
            output.push_str("<text x=\"");
            write_python_fixed_2(&mut output, value_x);
            output.push_str("\" y=\"");
            write_python_fixed_2(&mut output, value_y);
            output.push_str("\" font-size=\"");
            output.push_str(&value_font_size);
            output.push_str("\" font-family=\"");
            output.push_str(&font_family);
            output.push_str("\" text-anchor=\"middle\" fill=\"#111\">");
            write_python_fixed_0_into(&mut output, values[i]);
            output.push_str("</text>");
        }

        let label_y = height - margin_b + 16.0;
        push_chart_separator(&mut output);
        output.push_str("<text x=\"");
        write_python_fixed_2(&mut output, (x1 + x2) / 2.0);
        output.push_str("\" y=\"");
        write_python_fixed_2(&mut output, label_y);
        output.push_str("\" font-size=\"");
        output.push_str(&value_font_size);
        output.push_str("\" font-family=\"");
        output.push_str(&font_family);
        output.push_str("\" text-anchor=\"middle\" fill=\"#111\">");
        let start = usize::try_from(label_offsets[i]).map_err(|_| ChartBarError::InvalidOffsets)?;
        let end = usize::try_from(label_offsets[i + 1]).map_err(|_| ChartBarError::InvalidOffsets)?;
        let label = std::str::from_utf8(&labels[start..end]).map_err(|_| ChartBarError::InvalidUtf8)?;
        escape_chart_text_into(&mut output, label);
        output.push_str("</text>");
    }

    if !x_label.is_empty() {
        push_chart_separator(&mut output);
        output.push_str("<text x=\"");
        write_python_fixed_2(&mut output, width / 2.0);
        output.push_str("\" y=\"");
        write_python_fixed_2(&mut output, height - 10.0);
        output.push_str("\" font-size=\"");
        output.push_str(&label_font_size);
        output.push_str("\" font-family=\"");
        output.push_str(&font_family);
        output.push_str("\" text-anchor=\"middle\" fill=\"#111\">");
        output.push_str(&x_label);
        output.push_str("</text>");
    }
    if !y_label.is_empty() {
        let middle = (margin_t + height - margin_b) / 2.0;
        push_chart_separator(&mut output);
        output.push_str("<text x=\"14\" y=\"");
        write_python_fixed_2(&mut output, middle);
        output.push_str("\" font-size=\"");
        output.push_str(&label_font_size);
        output.push_str("\" font-family=\"");
        output.push_str(&font_family);
        output.push_str("\" text-anchor=\"middle\" fill=\"#111\" transform=\"rotate(-90 14 ");
        write_python_fixed_2(&mut output, middle);
        output.push_str(")\">");
        output.push_str(&y_label);
        output.push_str("</text>");
    }
    Ok(output)
}

fn validate_chart_offsets(labels_len: usize, offsets: &[i64]) -> Result<(), ChartBarError> {
    if offsets.first() != Some(&0) || offsets.last().copied() != Some(labels_len as i64) {
        return Err(ChartBarError::InvalidOffsets);
    }
    let mut previous = 0usize;
    for &raw_offset in offsets.iter().skip(1) {
        let offset = usize::try_from(raw_offset).map_err(|_| ChartBarError::InvalidOffsets)?;
        if offset < previous || offset > labels_len {
            return Err(ChartBarError::InvalidOffsets);
        }
        previous = offset;
    }
    Ok(())
}

fn chart_y_to_px(value: f64, y_min: f64, y_max: f64, margin_t: f64, plot_h: f64) -> f64 {
    margin_t + (y_max - value) / (y_max - y_min) * plot_h
}

fn push_chart_line(output: &mut String, x1: f64, y1: f64, x2: f64, y2: f64, suffix: &str) {
    push_chart_separator(output);
    output.push_str("<line x1=\"");
    write_python_fixed_2(output, x1);
    output.push_str("\" y1=\"");
    write_python_fixed_2(output, y1);
    output.push_str("\" x2=\"");
    write_python_fixed_2(output, x2);
    output.push_str("\" y2=\"");
    write_python_fixed_2(output, y2);
    output.push('\"');
    output.push_str(suffix);
}

fn push_chart_axis(output: &mut String, x1: f64, y1: f64, x2: f64, y2: f64, stroke_width: f64) {
    push_chart_separator(output);
    output.push_str("<line x1=\"");
    write_python_fixed_2(output, x1);
    output.push_str("\" y1=\"");
    write_python_fixed_2(output, y1);
    output.push_str("\" x2=\"");
    write_python_fixed_2(output, x2);
    output.push_str("\" y2=\"");
    write_python_fixed_2(output, y2);
    output.push_str("\" stroke=\"#222\" stroke-width=\"");
    write_python_fixed_2(output, stroke_width);
    output.push_str("\"/>");
}

fn push_chart_separator(output: &mut String) {
    if !output.is_empty() {
        output.push('\n');
    }
}

fn escape_chart_text(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    escape_chart_text_into(&mut escaped, text);
    escaped
}

fn escape_chart_text_into(output: &mut String, text: &str) {
    for ch in text.chars() {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            _ => output.push(ch),
        }
    }
}

fn write_python_fixed_0_into(output: &mut String, value: f64) {
    use std::fmt::Write as FmtWrite;
    if value.is_nan() {
        output.push_str("nan");
    } else if value == f64::INFINITY {
        output.push_str("inf");
    } else if value == f64::NEG_INFINITY {
        output.push_str("-inf");
    } else {
        let _ = write!(output, "{value:.0}");
    }
}

fn format_python_fixed_1(value: f64) -> String {
    let mut output = String::with_capacity(16);
    write_python_fixed_1_into(&mut output, value);
    output
}

fn write_python_fixed_1_into(output: &mut String, value: f64) {
    use std::fmt::Write as FmtWrite;
    if value.is_nan() {
        output.push_str("nan");
    } else if value == f64::INFINITY {
        output.push_str("inf");
    } else if value == f64::NEG_INFINITY {
        output.push_str("-inf");
    } else {
        let _ = write!(output, "{value:.1}");
    }
}

/// Format one SVG path using Python's two-decimal fixed-point spelling.
/// Arithmetic is deliberately kept in the same order as the Python renderer.
pub fn format_plot2d_path(
    xs: &[f64],
    ys: &[f64],
    transform: Plot2dTransform,
) -> Result<String, Plot2dPathError> {
    if xs.len() != ys.len() {
        return Err(Plot2dPathError::LengthMismatch);
    }

    Ok(format_path(xs.len(), transform, |i| xs[i], |i| ys[i]))
}

/// Format a bounded batch without copying coordinate buffers. Accessors allow
/// callers such as the Python binding to read contiguous buffers in place.
/// `offset_at` returns signed offsets so invalid negative values can be
/// rejected before any coordinates are read.
pub fn format_plot2d_paths_by<FX, FY, FO>(
    xs_len: usize,
    ys_len: usize,
    offsets_len: usize,
    mut offset_at: FO,
    transform: Plot2dTransform,
    mut x_at: FX,
    mut y_at: FY,
) -> Result<Vec<String>, Plot2dPathError>
where
    FX: FnMut(usize) -> f64,
    FY: FnMut(usize) -> f64,
    FO: FnMut(usize) -> i64,
{
    if xs_len != ys_len {
        return Err(Plot2dPathError::LengthMismatch);
    }
    if xs_len > MAX_PLOT2D_BATCH_POINTS {
        return Err(Plot2dPathError::TooManyPoints);
    }
    if offsets_len == 0 {
        return Err(Plot2dPathError::InvalidOffsets);
    }
    let path_count = offsets_len - 1;
    if path_count > MAX_PLOT2D_BATCH_PATHS {
        return Err(Plot2dPathError::TooManyPaths);
    }

    let mut offsets = Vec::with_capacity(offsets_len);
    for i in 0..offsets_len {
        let offset = offset_at(i);
        let Ok(offset) = usize::try_from(offset) else {
            return Err(Plot2dPathError::InvalidOffsets);
        };
        if offset > xs_len || offsets.last().is_some_and(|&previous| previous > offset) {
            return Err(Plot2dPathError::InvalidOffsets);
        }
        offsets.push(offset);
    }
    if offsets.first() != Some(&0) || offsets.last() != Some(&xs_len) {
        return Err(Plot2dPathError::InvalidOffsets);
    }

    let mut paths = Vec::with_capacity(path_count);
    for pair in offsets.windows(2) {
        let start = pair[0];
        let end = pair[1];
        paths.push(format_path(end - start, transform, |i| x_at(start + i), |i| y_at(start + i)));
    }
    Ok(paths)
}

/// Format a batch from ordinary slices. This is also the convenient entry
/// point for Rust callers and unit tests; Python uses `format_plot2d_paths_by`
/// so the numeric buffers remain borrowed in place.
pub fn format_plot2d_paths(
    xs: &[f64],
    ys: &[f64],
    offsets: &[i64],
    transform: Plot2dTransform,
) -> Result<Vec<String>, Plot2dPathError> {
    format_plot2d_paths_by(
        xs.len(),
        ys.len(),
        offsets.len(),
        |i| offsets[i],
        transform,
        |i| xs[i],
        |i| ys[i],
    )
}

fn format_path<FX, FY>(
    len: usize,
    transform: Plot2dTransform,
    mut x_at: FX,
    mut y_at: FY,
) -> String
where
    FX: FnMut(usize) -> f64,
    FY: FnMut(usize) -> f64,
{
    let mut path = String::with_capacity(len.saturating_mul(32).saturating_add(2));
    for i in 0..len {
        if i == 0 {
            path.push_str("M ");
        } else {
            path.push_str(" L ");
        }

        // Keep these operations in the same order as the Python expressions.
        let xpx = transform.margin_l
            + (x_at(i) - transform.x_min) / transform.x_span * transform.plot_w;
        let ypx = transform.margin_t
            + (transform.y_max - y_at(i)) / transform.y_span * transform.plot_h;
        write_python_fixed_2(&mut path, xpx);
        path.push(',');
        write_python_fixed_2(&mut path, ypx);
    }
    path
}

/// Python's ``f"{value:.2f}"`` spells non-finite values in lowercase;
/// Rust's numeric formatter uses title case, so normalize those explicitly.
fn write_python_fixed_2(out: &mut String, value: f64) {
    use std::fmt::Write as FmtWrite;

    if value.is_nan() {
        out.push_str("nan");
    } else if value == f64::INFINITY {
        out.push_str("inf");
    } else if value == f64::NEG_INFINITY {
        out.push_str("-inf");
    } else {
        let _ = write!(out, "{value:.2}");
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PrimeBrushError {
    #[error("unknown diagram type: {0}")]
    UnknownType(String),
    #[error("serialization: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Rust 侧插件接口（与 `plugin_base.PrimeBrushPlugin` 对应）。
pub trait PrimeBrushPlugin: Send + Sync {
    fn type_names(&self) -> &'static [&'static str];
    fn render_svg(&self, doc: &DiagramPayload, seed: u64) -> Result<String, PrimeBrushError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct EchoPlugin;

    impl PrimeBrushPlugin for EchoPlugin {
        fn type_names(&self) -> &'static [&'static str] {
            &["test_diagram"]
        }

        fn render_svg(&self, doc: &DiagramPayload, seed: u64) -> Result<String, PrimeBrushError> {
            Ok(format!(
                "<svg data-seed=\"{seed}\"><title>{}</title></svg>",
                doc["title"].as_str().unwrap_or_default()
            ))
        }
    }

    #[test]
    fn plugin_contract_reports_types_and_renders_deterministically() {
        let plugin = EchoPlugin;
        let payload = json!({"title": "triangle"});

        assert_eq!(plugin.type_names(), &["test_diagram"]);
        assert_eq!(
            plugin.render_svg(&payload, 42).unwrap(),
            "<svg data-seed=\"42\"><title>triangle</title></svg>"
        );
    }

    #[test]
    fn errors_have_stable_user_facing_messages() {
        let unknown = PrimeBrushError::UnknownType("unsupported".to_owned());
        assert_eq!(unknown.to_string(), "unknown diagram type: unsupported");

        let serde_error = serde_json::from_str::<DiagramPayload>("{").unwrap_err();
        let wrapped = PrimeBrushError::from(serde_error);
        assert!(wrapped.to_string().starts_with("serialization:"));
    }
}

#[cfg(test)]
#[path = "tests/render.rs"]
mod render_tests;
