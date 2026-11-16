from __future__ import annotations

import importlib.util

import numpy as np
import pytest

from solaire.primebrush.geometry import euclid
from solaire.primebrush.plots.expr import (
    _eval_node,
    _normalize_expr,
    _parse_expr,
    eval_expr,
)
from solaire.primebrush.plugins import chemistry_molecule_plugin as chemistry


@pytest.mark.parametrize("dtype", [np.float64, np.float32, np.int32])
@pytest.mark.parametrize(
    "expr",
    [
        "x",
        "1",
        "pi",
        "e",
        "x^2 + 1",
        "sin(x)",
        "sin(x)^2 + cos(x)^2",
        "exp(-abs(x)) / (1 + x^2)",
        "sqrt(abs(x) + 1) + log(abs(x) + 1)",
        "(-1)^0.5 + x",
    ],
)
def test_compiled_expression_matches_safe_interpreter(expr: str, dtype: type) -> None:
    x = np.linspace(-4.0, 4.0, 201, dtype=dtype)
    normalized = _normalize_expr(expr)
    with np.errstate(all="ignore"):
        expected = _eval_node(_parse_expr(normalized), x)
        actual = eval_expr(expr, x)

    np.testing.assert_allclose(actual, expected, rtol=1e-10, atol=1e-10, equal_nan=True)
    assert actual.shape == expected.shape
    assert actual.dtype == expected.dtype


@pytest.mark.parametrize(
    ("expr", "message"),
    [
        ("unknown(x)", "call not allowed: unknown"),
        ("unknown", "unknown name: unknown"),
        ("sin(x, x)", "only single-arg calls"),
        ("x.__class__", "unsupported expression node: Attribute"),
        ("x[0]", "unsupported expression node: Subscript"),
        ("[x for x in x]", "unsupported expression node: ListComp"),
        ("lambda: 1", "unsupported expression node: Lambda"),
        ("(x := 1)", "unsupported expression node: NamedExpr"),
        ("sin(*x)", "unsupported expression node: Starred"),
        ("'text'", "only numeric constants allowed"),
    ],
)
def test_unsupported_expression_keeps_interpreter_error(expr: str, message: str) -> None:
    with pytest.raises(Exception) as caught:
        eval_expr(expr, np.arange(3, dtype=np.float64))
    assert message in str(caught.value)


def test_expression_keywords_keep_existing_interpreter_behavior() -> None:
    x = np.linspace(-2.0, 2.0, 33)
    np.testing.assert_array_equal(eval_expr("sin(x, y=1)", x), np.sin(x))


def test_expression_unary_plus_preserves_array_identity() -> None:
    x = np.linspace(-2.0, 2.0, 33)
    assert eval_expr("+x", x) is x


def test_expression_subclasses_use_original_interpreter_dispatch() -> None:
    class ArrayProbe(np.ndarray):
        def __pos__(self):
            raise AssertionError("unary plus must return the input directly")

        def __pow__(self, other):
            raise AssertionError("power must use numpy.power")

    x = np.arange(5.0).view(ArrayProbe)
    assert eval_expr("+x", x) is x
    expected = np.power(x, np.full_like(x, 2.0, dtype=np.float64))
    np.testing.assert_array_equal(eval_expr("x^2", x), expected)


def test_expression_lowering_failure_keeps_left_to_right_error_order() -> None:
    oversized_integer = "9" * 400
    with pytest.raises(ValueError, match="unknown name: missing"):
        eval_expr(f"missing + {oversized_integer}", np.arange(3, dtype=np.float64))


@pytest.mark.parametrize(
    "expr",
    [
        "1",
        "pi",
        "sin(pi)",
        "sin(x)^2 + cos(x)^2",
        "sqrt(abs(x) + 1) + log(abs(x) + 1)",
        "(-1)^0.5 + x",
        "1/0 + x",
        "0/0 + x",
    ],
)
def test_scalar_constant_expression_path_matches_array_interpreter(expr: str) -> None:
    x = np.asarray([-np.inf, -2.0, -0.0, 0.0, 1.0, np.inf, np.nan], dtype=np.float64)
    with np.errstate(all="ignore"):
        expected = _eval_node(_parse_expr(_normalize_expr(expr)), x)
        actual = eval_expr(expr, x)

    np.testing.assert_array_equal(actual, expected)
    assert actual.dtype == expected.dtype == np.dtype(np.float64)


def test_scalar_constant_expression_path_avoids_constant_arrays(monkeypatch: pytest.MonkeyPatch) -> None:
    x = np.linspace(-4.0, 4.0, 201, dtype=np.float64)

    def unexpected_full_like(*args, **kwargs):
        pytest.fail("float64 AST constants should broadcast as scalars")

    monkeypatch.setattr(np, "full_like", unexpected_full_like)
    actual = eval_expr("sin(x)^2 + cos(x)^2 + x^2/3", x)
    assert actual.shape == x.shape
    assert actual.dtype == np.dtype(np.float64)


def test_scalar_constant_fast_path_skips_empty_and_zero_dimensional_inputs() -> None:
    empty = np.empty(0, dtype=np.float64)
    with np.errstate(divide="raise", invalid="raise"):
        expected_empty = _eval_node(_parse_expr("1 / 0"), empty)
        actual_empty = eval_expr("1 / 0", empty)
    np.testing.assert_array_equal(actual_empty, expected_empty)

    scalar = np.asarray(1.0, dtype=np.float64)
    with np.errstate(divide="raise"):
        with pytest.raises(FloatingPointError):
            _eval_node(_parse_expr("1 / 0"), scalar)
    with np.errstate(divide="raise"):
        with pytest.raises(FloatingPointError):
            eval_expr("1 / 0", scalar)


def _reference_intersection(
    a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray
) -> np.ndarray | None:
    ab = b - a
    cd = d - c
    det = float(ab[0] * cd[1] - ab[1] * cd[0])
    if abs(det) < 1e-12:
        return None
    ac = c - a
    t = float((ac[0] * cd[1] - ac[1] * cd[0]) / det)
    return a + t * ab


def _reference_foot(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    denom = float(np.dot(ab, ab))
    if denom < 1e-18:
        return a.copy()
    t = float(np.dot(p - a, ab) / denom)
    return a + t * ab


def test_scalar_geometry_kernels_match_vector_reference() -> None:
    rng = np.random.default_rng(20261110)
    samples = rng.normal(size=(512, 4, 2))
    for a, b, c, d in samples:
        expected = _reference_intersection(a, b, c, d)
        actual = euclid.intersect_lines_infinite(a, b, c, d)
        if expected is None:
            assert actual is None
        else:
            assert actual is not None
            np.testing.assert_allclose(actual, expected, rtol=1e-10, atol=1e-10)

        expected_foot = _reference_foot(a, b, c)
        actual_foot = euclid.foot_on_line(a, b, c)
        np.testing.assert_allclose(actual_foot, expected_foot, rtol=1e-10, atol=1e-10)


def test_geometry_kernels_keep_degenerate_and_non_float64_fallbacks() -> None:
    anchor = np.asarray([3.0, -4.0], dtype=np.float64)
    same = anchor.copy()
    np.testing.assert_array_equal(euclid.foot_on_line(anchor, same, same), same)

    a = np.asarray([0.0, 0.0], dtype=np.float32)
    b = np.asarray([2.0, 0.0], dtype=np.float32)
    p = np.asarray([1.0, 3.0], dtype=np.float32)
    actual = euclid.foot_on_line(p, a, b)
    assert actual.dtype == np.float32
    np.testing.assert_array_equal(actual, np.asarray([1.0, 0.0], dtype=np.float32))


@pytest.mark.skipif(importlib.util.find_spec("rdkit") is None, reason="RDKit is optional")
def test_rdkit_svg_cache_hits_and_stays_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    chemistry._clear_smiles_svg_cache()
    try:
        cold = chemistry._render_smiles_to_svg_rdkit("CCO", 400, 300)
        first = chemistry._smiles_to_svg_rdkit("CCO", 400, 300)
        second = chemistry._smiles_to_svg_rdkit("CCO", 400, 300)
        assert cold == first == second
        assert len(chemistry._SMILES_SVG_CACHE) == 1

        chemistry._clear_smiles_svg_cache()
        monkeypatch.setattr(
            chemistry,
            "_render_smiles_to_svg_rdkit",
            lambda smiles, width, height: f"{smiles}:{width}:{height}",
        )
        for i in range(chemistry._MAX_CACHED_SVG_ITEMS + 5):
            chemistry._smiles_to_svg_rdkit(f"M{i}", 400, 300)
        assert len(chemistry._SMILES_SVG_CACHE) == chemistry._MAX_CACHED_SVG_ITEMS

        chemistry._clear_smiles_svg_cache()
        chemistry._smiles_to_svg_rdkit(
            "C" * (chemistry._MAX_CACHED_SMILES_LENGTH + 1), 400, 300
        )
        assert not chemistry._SMILES_SVG_CACHE

        monkeypatch.setattr(
            chemistry,
            "_render_smiles_to_svg_rdkit",
            lambda smiles, width, height: "x" * (chemistry._MAX_CACHED_SVG_CHARS + 1),
        )
        chemistry._smiles_to_svg_rdkit("CCO", 400, 300)
        assert not chemistry._SMILES_SVG_CACHE
    finally:
        chemistry._clear_smiles_svg_cache()
