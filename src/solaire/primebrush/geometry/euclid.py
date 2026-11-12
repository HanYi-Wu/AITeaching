"""Plane Euclidean primitives for ruler-and-compass constructions."""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def as_vec(p: tuple[float, float] | np.ndarray) -> np.ndarray:
    if isinstance(p, np.ndarray):
        return p.astype(np.float64)
    return np.array([float(p[0]), float(p[1])], dtype=np.float64)


def intersect_lines_infinite(
    a: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    d: np.ndarray,
) -> np.ndarray | None:
    """Intersection of infinite lines AB and CD. None if parallel."""
    if (
        type(a) is np.ndarray
        and type(b) is np.ndarray
        and type(c) is np.ndarray
        and type(d) is np.ndarray
        and a.shape == b.shape == c.shape == d.shape == (2,)
        and a.dtype == b.dtype == c.dtype == d.dtype == np.dtype(np.float64)
    ):
        ab_x, ab_y = b[0] - a[0], b[1] - a[1]
        cd_x, cd_y = d[0] - c[0], d[1] - c[1]
        det = float(ab_x * cd_y - ab_y * cd_x)
        if abs(det) < 1e-12:
            return None
        ac_x, ac_y = c[0] - a[0], c[1] - a[1]
        t = float((ac_x * cd_y - ac_y * cd_x) / det)
        return np.array(
            [a[0] + t * ab_x, a[1] + t * ab_y], dtype=np.float64
        )

    ab = b - a
    cd = d - c
    det = float(ab[0] * cd[1] - ab[1] * cd[0])
    if abs(det) < 1e-12:
        return None
    ac = c - a
    t = float((ac[0] * cd[1] - ac[1] * cd[0]) / det)
    return a + t * ab


def foot_on_line(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Orthogonal projection of P onto line AB (infinite)."""
    if (
        type(p) is np.ndarray
        and type(a) is np.ndarray
        and type(b) is np.ndarray
        and p.shape == a.shape == b.shape == (2,)
        and p.dtype == a.dtype == b.dtype == np.dtype(np.float64)
    ):
        dx, dy = b[0] - a[0], b[1] - a[1]
        denom = float(dx * dx + dy * dy)
        if denom < 1e-18:
            return a.copy()
        px, py = p[0] - a[0], p[1] - a[1]
        t = float((px * dx + py * dy) / denom)
        return np.array(
            [a[0] + t * dx, a[1] + t * dy], dtype=np.float64
        )

    ab = b - a
    denom = float(np.dot(ab, ab))
    if denom < 1e-18:
        return a.copy()
    t = float(np.dot(p - a, ab) / denom)
    return a + t * ab


def line_circle_intersections(
    a: np.ndarray,
    b: np.ndarray,
    o: np.ndarray,
    r: float,
) -> list[np.ndarray]:
    """Intersection of infinite line AB with circle (O, r). 0, 1, or 2 points."""
    if r <= 0:
        return []
    d = b - a
    lf = float(np.linalg.norm(d))
    if lf < 1e-15:
        return []
    u = d / lf
    # Closest point on line to O
    t0 = float(np.dot(o - a, u))
    closest = a + t0 * u
    dist = float(np.linalg.norm(o - closest))
    if dist > r + 1e-6:
        return []
    if dist < 1e-6:
        dist = 0.0
    if abs(dist - r) < 1e-6:
        return [closest]
    dt = math.sqrt(max(0.0, r * r - dist * dist))
    p1 = closest - dt * u
    p2 = closest + dt * u
    # Order by parameter along line from A toward B: t such that a + t*u = point
    def t_param(pt: np.ndarray) -> float:
        return float(np.dot(pt - a, u))

    pts = sorted([p1, p2], key=t_param)
    return pts


def circle_circle_intersections(
    o1: np.ndarray,
    r1: float,
    o2: np.ndarray,
    r2: float,
) -> list[np.ndarray]:
    """0, 1, or 2 intersection points of two circles."""
    if r1 <= 0 or r2 <= 0:
        return []
    d = float(np.linalg.norm(o2 - o1))
    if d < 1e-12:
        return []  # concentric: no proper intersection handling
    if d > r1 + r2 + 1e-6 or d < abs(r1 - r2) - 1e-6:
        return []
    # Distance from o1 along o1->o2 to radical line intersection
    a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    h_sq = r1 * r1 - a * a
    if h_sq < -1e-6:
        return []
    if h_sq < 0:
        h_sq = 0.0
    h = math.sqrt(h_sq)
    mid = o1 + (a / d) * (o2 - o1)
    if h < 1e-9:
        return [mid]
    perp = np.array([-(o2 - o1)[1], (o2 - o1)[0]], dtype=np.float64)
    perp = perp / float(np.linalg.norm(perp))
    p1 = mid + h * perp
    p2 = mid - h * perp
    return [p1, p2]


def resolve_circle_radius(
    item: dict[str, Any],
    points: dict[str, tuple[float, float]],
) -> float:
    """Radius from circle spec: radius | through | radius_from."""
    cname = str(item["center"])
    c = as_vec(points[cname])
    if "through" in item:
        t = as_vec(points[str(item["through"])])
        return float(np.linalg.norm(t - c))
    if "radius_from" in item:
        rf = item["radius_from"]
        if not isinstance(rf, (list, tuple)) or len(rf) != 2:
            raise ValueError("radius_from must be [A, B]")
        p1 = as_vec(points[str(rf[0])])
        p2 = as_vec(points[str(rf[1])])
        return float(np.linalg.norm(p2 - p1))
    r = float(item.get("radius", 0))
    if r <= 0:
        raise ValueError("circle needs positive radius, through, or radius_from")
    return r
