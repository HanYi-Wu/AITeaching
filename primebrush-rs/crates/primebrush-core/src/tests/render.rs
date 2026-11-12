use super::*;

fn identity_transform() -> Plot2dTransform {
    Plot2dTransform {
        x_min: 0.0,
        x_span: 1.0,
        y_max: 0.0,
        y_span: 1.0,
        plot_w: 1.0,
        plot_h: 1.0,
        margin_l: 0.0,
        margin_t: 0.0,
    }
}

#[test]
fn plot2d_path_keeps_python_fixed_point_and_special_float_spelling() {
    let xs = [0.0, -0.0, 1.005, f64::INFINITY, f64::NEG_INFINITY, f64::NAN];
    let ys = [0.0; 6];

    assert_eq!(
        format_plot2d_path(&xs, &ys, identity_transform()).unwrap(),
        "M 0.00,0.00 L 0.00,0.00 L 1.00,0.00 L inf,0.00 L -inf,0.00 L nan,0.00"
    );
}

#[test]
fn batched_paths_match_individual_formatting_and_keep_empty_segments() {
    let xs = [0.0, 1.0, -0.0, 1.005];
    let ys = [0.0, 1.0, 0.5, f64::NAN];
    let offsets = [0, 2, 2, 4];
    let transform = identity_transform();

    let actual = format_plot2d_paths(&xs, &ys, &offsets, transform).unwrap();
    assert_eq!(actual.len(), 3);
    assert_eq!(actual[0], format_plot2d_path(&xs[0..2], &ys[0..2], transform).unwrap());
    assert_eq!(actual[1], "");
    assert_eq!(actual[2], format_plot2d_path(&xs[2..4], &ys[2..4], transform).unwrap());
}

#[test]
fn batched_paths_reject_bad_lengths_offsets_and_unbounded_requests() {
    let transform = identity_transform();
    assert_eq!(
        format_plot2d_paths(&[0.0], &[], &[0, 0], transform),
        Err(Plot2dPathError::LengthMismatch)
    );
    assert_eq!(
        format_plot2d_paths(&[0.0], &[0.0], &[], transform),
        Err(Plot2dPathError::InvalidOffsets)
    );
    assert_eq!(
        format_plot2d_paths(&[0.0], &[0.0], &[-1, 1], transform),
        Err(Plot2dPathError::InvalidOffsets)
    );
    assert_eq!(
        format_plot2d_paths(&[0.0], &[0.0], &[0, 2, 1], transform),
        Err(Plot2dPathError::InvalidOffsets)
    );
    assert_eq!(
        format_plot2d_paths(&[0.0], &[0.0], &[0, 0], transform),
        Err(Plot2dPathError::InvalidOffsets)
    );
    assert_eq!(
        format_plot2d_paths_by(
            MAX_PLOT2D_BATCH_POINTS + 1,
            MAX_PLOT2D_BATCH_POINTS + 1,
            1,
            |_| 0,
            transform,
            |_| panic!("coordinates must not be read after the size check"),
            |_| panic!("coordinates must not be read after the size check"),
        ),
        Err(Plot2dPathError::TooManyPoints)
    );
    assert_eq!(
        format_plot2d_paths_by(
            0,
            0,
            MAX_PLOT2D_BATCH_PATHS + 2,
            |_| 0,
            transform,
            |_| panic!("offsets must be validated before coordinates are read"),
            |_| panic!("offsets must be validated before coordinates are read"),
        ),
        Err(Plot2dPathError::TooManyPaths)
    );
}

#[test]
fn chart_bar_output_preserves_layout_escaping_and_operation_order() {
    let labels = "A &<B>".as_bytes();
    let svg = render_chart_bars(
        labels,
        &[0, labels.len() as i64],
        &[10.0],
        &[2.0],
        100.0,
        100.0,
        10.0,
        "Arial & Sans",
        1.0,
        0.0,
        20.0,
        0.6,
        true,
        true,
        "x & <groups>",
        "y > count",
    )
    .unwrap();

    assert_eq!(
        svg,
        concat!(
            "<line x1=\"52.00\" y1=\"48.00\" x2=\"80.00\" y2=\"48.00\" stroke=\"#ccc\" stroke-width=\"0.5\"/>\n",
            "<line x1=\"52.00\" y1=\"43.00\" x2=\"80.00\" y2=\"43.00\" stroke=\"#ccc\" stroke-width=\"0.5\"/>\n",
            "<line x1=\"52.00\" y1=\"38.00\" x2=\"80.00\" y2=\"38.00\" stroke=\"#ccc\" stroke-width=\"0.5\"/>\n",
            "<line x1=\"52.00\" y1=\"33.00\" x2=\"80.00\" y2=\"33.00\" stroke=\"#ccc\" stroke-width=\"0.5\"/>\n",
            "<line x1=\"52.00\" y1=\"28.00\" x2=\"80.00\" y2=\"28.00\" stroke=\"#ccc\" stroke-width=\"0.5\"/>\n",
            "<line x1=\"52.00\" y1=\"48.00\" x2=\"52.00\" y2=\"28.00\" stroke=\"#222\" stroke-width=\"1.00\"/>\n",
            "<line x1=\"52.00\" y1=\"48.00\" x2=\"80.00\" y2=\"48.00\" stroke=\"#222\" stroke-width=\"1.00\"/>\n",
            "<rect x=\"57.60\" y=\"38.00\" width=\"16.80\" height=\"10.00\" fill=\"#333\" stroke=\"#111\" stroke-width=\"0.5\"/>\n",
            "<line x1=\"66.00\" y1=\"38.00\" x2=\"66.00\" y2=\"36.00\" stroke=\"#111\" stroke-width=\"1.2\"/>\n",
            "<line x1=\"62.00\" y1=\"36.00\" x2=\"70.00\" y2=\"36.00\" stroke=\"#111\" stroke-width=\"1.2\"/>\n",
            "<text x=\"66.00\" y=\"34.00\" font-size=\"8.5\" font-family=\"Arial &amp; Sans\" text-anchor=\"middle\" fill=\"#111\">10</text>\n",
            "<text x=\"66.00\" y=\"64.00\" font-size=\"8.5\" font-family=\"Arial &amp; Sans\" text-anchor=\"middle\" fill=\"#111\">A &amp;&lt;B&gt;</text>\n",
            "<text x=\"50.00\" y=\"90.00\" font-size=\"10.0\" font-family=\"Arial &amp; Sans\" text-anchor=\"middle\" fill=\"#111\">x &amp; &lt;groups&gt;</text>\n",
            "<text x=\"14\" y=\"38.00\" font-size=\"10.0\" font-family=\"Arial &amp; Sans\" text-anchor=\"middle\" fill=\"#111\" transform=\"rotate(-90 14 38.00)\">y &gt; count</text>"
        )
    );
}

#[test]
fn chart_bar_batch_rejects_bad_lengths_offsets_and_utf8() {
    assert_eq!(
        render_chart_bars(
            b"a",
            &[0],
            &[1.0],
            &[f64::NAN],
            640.0,
            480.0,
            11.0,
            "sans-serif",
            1.0,
            0.0,
            2.0,
            0.6,
            false,
            false,
            "",
            "",
        ),
        Err(ChartBarError::LengthMismatch)
    );
    assert_eq!(
        render_chart_bars(
            b"a",
            &[0, 2],
            &[1.0],
            &[f64::NAN],
            640.0,
            480.0,
            11.0,
            "sans-serif",
            1.0,
            0.0,
            2.0,
            0.6,
            false,
            false,
            "",
            "",
        ),
        Err(ChartBarError::InvalidOffsets)
    );
    assert_eq!(
        render_chart_bars(
            &[0xff],
            &[0, 1],
            &[1.0],
            &[f64::NAN],
            640.0,
            480.0,
            11.0,
            "sans-serif",
            1.0,
            0.0,
            2.0,
            0.6,
            false,
            false,
            "",
            "",
        ),
        Err(ChartBarError::InvalidUtf8)
    );
}
