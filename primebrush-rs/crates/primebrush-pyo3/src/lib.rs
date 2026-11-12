//! Python 模块 `primebrush_rs`：由 maturin 构建后可供 `solaire.primebrush.api.render` 优先调用。
//! 当前占位：导入失败时 Python 使用纯 Python 插件渲染。

use primebrush_core::{
    format_plot2d_path as format_core_plot2d_path, format_plot2d_paths_by,
    render_chart_bars as render_core_chart_bars, ChartBarError, Plot2dPathError,
    Plot2dTransform, MAX_CHART_BAR_COUNT, MAX_PLOT2D_BATCH_PATHS, MAX_PLOT2D_BATCH_POINTS,
};
use pyo3::buffer::PyBuffer;
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

#[pyfunction]
#[pyo3(signature = (doc, seed=None))]
fn render(doc: Bound<'_, PyDict>, seed: Option<u64>) -> PyResult<String> {
    let _ = (doc, seed);
    Err(PyErr::new::<pyo3::exceptions::PyNotImplementedError, _>(
        "primebrush_rs: Rust renderer not wired yet; use Python implementation",
    ))
}

/// Build the 2D curve path using the same arithmetic order and fixed-point
/// precision as plot2d.py. Expression parsing/evaluation remains in Python.
#[pyfunction]
#[pyo3(signature = (xs, ys, x_min, x_span, y_max, y_span, plot_w, plot_h, margin_l, margin_t))]
fn plot2d_path(
    xs: Vec<f64>,
    ys: Vec<f64>,
    x_min: f64,
    x_span: f64,
    y_max: f64,
    y_span: f64,
    plot_w: f64,
    plot_h: f64,
    margin_l: f64,
    margin_t: f64,
) -> PyResult<String> {
    format_core_plot2d_path(
        &xs,
        &ys,
        Plot2dTransform {
            x_min,
            x_span,
            y_max,
            y_span,
            plot_w,
            plot_h,
            margin_l,
            margin_t,
        },
    )
    .map_err(map_plot2d_error)
}

#[pyfunction]
#[pyo3(signature = (xs, ys, offsets, x_min, x_span, y_max, y_span, plot_w, plot_h, margin_l, margin_t))]
fn plot2d_paths_batch(
    py: Python<'_>,
    xs: PyBuffer<f64>,
    ys: PyBuffer<f64>,
    offsets: PyBuffer<i64>,
    x_min: f64,
    x_span: f64,
    y_max: f64,
    y_span: f64,
    plot_w: f64,
    plot_h: f64,
    margin_l: f64,
    margin_t: f64,
) -> PyResult<Vec<String>> {
    check_f64_buffer(&xs, "xs")?;
    check_f64_buffer(&ys, "ys")?;
    check_i64_buffer(&offsets, "offsets")?;

    let xs_slice = xs.as_slice(py).ok_or_else(|| {
        PyValueError::new_err("xs must be a contiguous one-dimensional float64 buffer")
    })?;
    let ys_slice = ys.as_slice(py).ok_or_else(|| {
        PyValueError::new_err("ys must be a contiguous one-dimensional float64 buffer")
    })?;
    let offsets_slice = offsets.as_slice(py).ok_or_else(|| {
        PyValueError::new_err("offsets must be a contiguous one-dimensional int64 buffer")
    })?;

    format_plot2d_paths_by(
        xs.item_count(),
        ys.item_count(),
        offsets.item_count(),
        |i| offsets_slice[i].get(),
        Plot2dTransform {
            x_min,
            x_span,
            y_max,
            y_span,
            plot_w,
            plot_h,
            margin_l,
            margin_t,
        },
        |i| xs_slice[i].get(),
        |i| ys_slice[i].get(),
    )
    .map_err(map_plot2d_error)
}

#[pyfunction]
#[pyo3(signature = (labels, label_offsets, values, errors, width, height, font_size, font_family, stroke_width, y_min, y_max, bar_width_fraction, show_error, show_value, x_label, y_label))]
fn chart_bar_svg(
    py: Python<'_>,
    labels: PyBuffer<u8>,
    label_offsets: PyBuffer<i64>,
    values: PyBuffer<f64>,
    errors: PyBuffer<f64>,
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
) -> PyResult<String> {
    check_u8_buffer(&labels, "labels")?;
    check_i64_buffer(&label_offsets, "label_offsets")?;
    check_f64_buffer(&values, "values")?;
    check_f64_buffer(&errors, "errors")?;
    let labels = u8_slice(&labels, py, "labels")?;
    let label_offsets = i64_slice(&label_offsets, py, "label_offsets")?;
    let values = f64_slice(&values, py, "values")?;
    let errors = f64_slice(&errors, py, "errors")?;

    render_core_chart_bars(
        labels,
        label_offsets,
        values,
        errors,
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
    .map_err(map_chart_error)
}

fn check_f64_buffer(buffer: &PyBuffer<f64>, name: &str) -> PyResult<()> {
    if buffer.dimensions() != 1 {
        return Err(PyValueError::new_err(format!(
            "{name} must be a one-dimensional float64 buffer"
        )));
    }
    if !buffer.is_c_contiguous() {
        return Err(PyValueError::new_err(format!(
            "{name} must be C-contiguous"
        )));
    }
    Ok(())
}

fn check_i64_buffer(buffer: &PyBuffer<i64>, name: &str) -> PyResult<()> {
    if buffer.dimensions() != 1 {
        return Err(PyValueError::new_err(format!(
            "{name} must be a one-dimensional int64 buffer"
        )));
    }
    if !buffer.is_c_contiguous() {
        return Err(PyValueError::new_err(format!(
            "{name} must be C-contiguous"
        )));
    }
    Ok(())
}

fn check_u8_buffer(buffer: &PyBuffer<u8>, name: &str) -> PyResult<()> {
    if buffer.dimensions() != 1 {
        return Err(PyValueError::new_err(format!(
            "{name} must be a one-dimensional uint8 buffer"
        )));
    }
    if !buffer.is_c_contiguous() {
        return Err(PyValueError::new_err(format!("{name} must be C-contiguous")));
    }
    Ok(())
}

fn f64_slice<'a>(buffer: &'a PyBuffer<f64>, py: Python<'a>, name: &str) -> PyResult<&'a [f64]> {
    let cells = buffer.as_slice(py).ok_or_else(|| {
        PyValueError::new_err(format!("{name} must be a contiguous one-dimensional float64 buffer"))
    })?;
    // PyO3's ReadOnlyCell is repr(transparent) over T. This read-only view is
    // C-contiguous and remains borrowed with the GIL held for the whole call.
    Ok(unsafe { std::slice::from_raw_parts(cells.as_ptr().cast::<f64>(), cells.len()) })
}

fn i64_slice<'a>(buffer: &'a PyBuffer<i64>, py: Python<'a>, name: &str) -> PyResult<&'a [i64]> {
    let cells = buffer.as_slice(py).ok_or_else(|| {
        PyValueError::new_err(format!("{name} must be a contiguous one-dimensional int64 buffer"))
    })?;
    Ok(unsafe { std::slice::from_raw_parts(cells.as_ptr().cast::<i64>(), cells.len()) })
}

fn u8_slice<'a>(buffer: &'a PyBuffer<u8>, py: Python<'a>, name: &str) -> PyResult<&'a [u8]> {
    let cells = buffer.as_slice(py).ok_or_else(|| {
        PyValueError::new_err(format!("{name} must be a contiguous one-dimensional uint8 buffer"))
    })?;
    Ok(unsafe { std::slice::from_raw_parts(cells.as_ptr().cast::<u8>(), cells.len()) })
}

fn map_plot2d_error(error: Plot2dPathError) -> PyErr {
    PyValueError::new_err(error.to_string())
}

fn map_chart_error(error: ChartBarError) -> PyErr {
    PyValueError::new_err(error.to_string())
}

#[pymodule]
fn primebrush_rs(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(render, m)?)?;
    m.add_function(wrap_pyfunction!(plot2d_path, m)?)?;
    m.add_function(wrap_pyfunction!(plot2d_paths_batch, m)?)?;
    m.add_function(wrap_pyfunction!(chart_bar_svg, m)?)?;
    m.add("MAX_PLOT2D_BATCH_POINTS", MAX_PLOT2D_BATCH_POINTS)?;
    m.add("MAX_PLOT2D_BATCH_PATHS", MAX_PLOT2D_BATCH_PATHS)?;
    m.add("MAX_CHART_BAR_COUNT", MAX_CHART_BAR_COUNT)?;
    // This extension only accelerates a Python-owned hot path. Older external
    // render extensions without this marker retain the legacy render contract.
    m.add("HAS_FULL_RENDER", false)?;
    Ok(())
}
