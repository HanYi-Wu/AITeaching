from __future__ import annotations

import ast
from functools import lru_cache
import math
import operator as op

import numpy as np

_ALLOWED_NAMES = {
    "sin": np.sin,
    "cos": np.cos,
    "tan": np.tan,
    "exp": np.exp,
    "sqrt": np.sqrt,
    "log": np.log,
    "abs": np.abs,
    "pi": np.pi,
    "e": np.e,
}


def _eval_node(
    node: ast.AST, x: np.ndarray, *, scalar_constants: bool = False
) -> np.ndarray | np.generic | float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            value = float(node.value)
            if scalar_constants:
                return value
            return np.full_like(x, value, dtype=np.float64)
        raise ValueError("only numeric constants allowed")
    if isinstance(node, ast.Name):
        if node.id == "x":
            return x
        if node.id in _ALLOWED_NAMES:
            v = _ALLOWED_NAMES[node.id]
            if scalar_constants:
                return float(v)
            return np.full_like(x, float(v), dtype=np.float64)
        raise ValueError(f"unknown name: {node.id}")
    if isinstance(node, ast.UnaryOp):
        operand = _eval_node(node.operand, x, scalar_constants=scalar_constants)
        if isinstance(node.op, ast.USub):
            if scalar_constants and not isinstance(operand, np.ndarray):
                return np.negative(operand)
            return -operand
        if isinstance(node.op, ast.UAdd):
            return operand
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, x, scalar_constants=scalar_constants)
        right = _eval_node(node.right, x, scalar_constants=scalar_constants)
        scalar_pair = scalar_constants and not isinstance(left, np.ndarray) and not isinstance(
            right, np.ndarray
        )
        if isinstance(node.op, ast.Add):
            if scalar_pair:
                return np.add(left, right)
            return left + right
        if isinstance(node.op, ast.Sub):
            if scalar_pair:
                return np.subtract(left, right)
            return left - right
        if isinstance(node.op, ast.Mult):
            if scalar_pair:
                return np.multiply(left, right)
            return left * right
        if isinstance(node.op, ast.Div):
            if scalar_pair:
                return np.divide(left, right)
            return left / right
        if isinstance(node.op, ast.Pow):
            return np.power(left, right)
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ValueError("only simple calls allowed")
        fn = _ALLOWED_NAMES.get(node.func.id)
        if fn is None or not callable(fn):
            raise ValueError(f"call not allowed: {getattr(node.func, 'id', '?')}")
        if len(node.args) != 1:
            raise ValueError("only single-arg calls")
        arg = _eval_node(node.args[0], x, scalar_constants=scalar_constants)
        return fn(arg)
    raise ValueError(f"unsupported expression node: {type(node).__name__}")


def _normalize_expr(expr: str) -> str:
    """Allow `^` for exponentiation (common in school math)."""
    return expr.strip().replace("^", "**")


@lru_cache(maxsize=256)
def _parse_expr(expr: str) -> ast.AST:
    tree = ast.parse(expr, mode="eval")
    if not isinstance(tree, ast.Expression):
        raise ValueError("expected expression")
    return tree.body


def eval_expr(expr: str, x: np.ndarray) -> np.ndarray:
    """Evaluate expression in variable x (numpy array), safe subset."""
    node = _parse_expr(_normalize_expr(expr))
    scalar_constants = (
        type(x) is np.ndarray
        and x.ndim == 1
        and x.size > 0
        and x.dtype == np.dtype(np.float64)
    )
    value = _eval_node(node, x, scalar_constants=scalar_constants)
    if scalar_constants and not isinstance(value, np.ndarray):
        return np.full_like(x, value, dtype=np.float64)
    return value


def eval_expr_scalar(expr: str, x0: float) -> float:
    y = eval_expr(expr, np.array([x0], dtype=np.float64))
    return float(y[0])
