from __future__ import annotations

import math
from typing import Any

import numpy as np

from solaire.primebrush.geometry import euclid
from solaire.primebrush.geometry.result import GeometrySolveResult


def _min_angle_degrees(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Minimum angle at the three vertices (degrees)."""
    ab, ac, bc = b - a, c - a, c - b
    n_ab = np.linalg.norm(ab)
    n_ac = np.linalg.norm(ac)
    n_bc = np.linalg.norm(bc)
    if n_ab < 1e-9 or n_ac < 1e-9 or n_bc < 1e-9:
        return 0.0

    ba, ca, cb = a - b, a - c, b - c
    cos_a = float(np.clip(np.dot(ab, ac) / (n_ab * n_ac), -1.0, 1.0))
    cos_b = float(np.clip(np.dot(ba, bc) / (n_ab * n_bc), -1.0, 1.0))
    cos_c = float(np.clip(np.dot(ca, cb) / (n_ac * n_bc), -1.0, 1.0))
    return min(
        math.degrees(math.acos(cos_a)),
        math.degrees(math.acos(cos_b)),
        math.degrees(math.acos(cos_c)),
    )


def _random_triangle(
    w: float,
    h: float,
    rng: np.random.Generator,
    min_angle: float,
    margin: float = 12.0,
    max_tries: int = 5000,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lo_x, hi_x = margin, w - margin
    lo_y, hi_y = margin, h - margin
    for _ in range(max_tries):
        ax, ay = rng.uniform(lo_x, hi_x), rng.uniform(lo_y, hi_y)
        bx, by = rng.uniform(lo_x, hi_x), rng.uniform(lo_y, hi_y)
        cx, cy = rng.uniform(lo_x, hi_x), rng.uniform(lo_y, hi_y)
        a = np.array([ax, ay])
        b = np.array([bx, by])
        c = np.array([cx, cy])
        if _min_angle_degrees(a, b, c) >= min_angle:
            return a, b, c
    raise ValueError("could not sample triangle satisfying min_angle; try different seed or relax min_angle")


def _as_vec(points: dict[str, np.ndarray], name: str) -> np.ndarray:
    """Return the stored coordinate vector without copying it per constraint."""
    return points[str(name)]


def _segment_far(
    origin: np.ndarray,
    direction: np.ndarray | tuple[float, float],
    width: float,
    height: float,
    *,
    direction_norm: float | None = None,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Two endpoints along line origin + t * direction, long enough for the canvas."""
    dx, dy = float(direction[0]), float(direction[1])
    n = direction_norm
    if n is None:
        n = math.sqrt(dx * dx + dy * dy)
    if n < 1e-12:
        raise ValueError("degenerate direction for line")
    ux, uy = dx / n, dy / n
    span = math.hypot(width, height) * 1.2
    sx, sy = span * ux, span * uy
    ox, oy = float(origin[0]), float(origin[1])
    return (ox - sx, oy - sy), (ox + sx, oy + sy)


def _append_segment_drawable(
    drawables: list[dict[str, Any]],
    p1: tuple[float, float],
    p2: tuple[float, float],
    item: dict[str, Any],
    default_style: str = "dashed",
) -> None:
    drawables.append(
        {
            "kind": "segment",
            "x1": float(p1[0]),
            "y1": float(p1[1]),
            "x2": float(p2[0]),
            "y2": float(p2[1]),
            "style": (item.get("style") or default_style).lower(),
            "id": item.get("id"),
            "label": item.get("label"),
        }
    )


def _circle_spec_radius(spec: dict[str, Any], points: dict[str, np.ndarray]) -> tuple[np.ndarray, float]:
    o = _as_vec(points, str(spec["center"]))
    r = euclid.resolve_circle_radius(spec, points)
    return o, r


def solve_geometry(
    constructions: list[dict[str, Any]],
    width: float,
    height: float,
    rng: np.random.Generator,
) -> GeometrySolveResult:
    """Resolve named points and collect drawable primitives."""
    points: dict[str, np.ndarray] = {}
    drawables: list[dict[str, Any]] = []
    foot_cache: dict[
        tuple[int, int, int], tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]
    ] = {}

    for item in constructions:
        op = item.get("op")
        if op == "triangle":
            nodes = item["nodes"]
            attr = item.get("attr") or {}
            t = (attr.get("type") or "random").lower()
            min_angle = float(attr.get("min_angle", 25))
            if t == "random":
                a, b, c = _random_triangle(width, height, rng, min_angle)
            else:
                raise ValueError(f"unknown triangle attr.type: {t!r}")
            if len(nodes) != 3:
                raise ValueError("triangle requires exactly 3 nodes")
            for name, pt in zip(nodes, (a, b, c), strict=True):
                points[str(name)] = pt

        elif op == "in_line":
            pid = item["id"]
            src = item["source"]
            params = float(item.get("params", 0.5))
            a = _as_vec(points, src[0])
            b = _as_vec(points, src[1])
            ax, ay = float(a[0]), float(a[1])
            p = np.array(
                [ax + params * (float(b[0]) - ax), ay + params * (float(b[1]) - ay)],
                dtype=np.float64,
            )
            points[str(pid)] = p

        elif op == "line":
            src = item["source"]
            for n in src:
                if str(n) not in points:
                    raise ValueError(f"line references unknown point {n!r}")

        elif op == "foot":
            pid = str(item["id"])
            p = _as_vec(points, str(item["point"]))
            a = _as_vec(points, item["line"][0])
            b = _as_vec(points, item["line"][1])
            projection_key = (id(p), id(a), id(b))
            cached_projection = foot_cache.get(projection_key)
            if cached_projection is None:
                h = euclid.foot_on_line(p, a, b)
                foot_cache[projection_key] = (p, a, b, h)
            else:
                h = cached_projection[3]
            points[pid] = h

        elif op == "reflection":
            pid = str(item["id"])
            p = _as_vec(points, str(item["point"]))
            a = _as_vec(points, item["line"][0])
            b = _as_vec(points, item["line"][1])
            projection_key = (id(p), id(a), id(b))
            cached_projection = foot_cache.get(projection_key)
            if cached_projection is None:
                h = euclid.foot_on_line(p, a, b)
                foot_cache[projection_key] = (p, a, b, h)
            else:
                h = cached_projection[3]
            rp = np.array(
                [2.0 * float(h[0]) - float(p[0]), 2.0 * float(h[1]) - float(p[1])],
                dtype=np.float64,
            )
            points[pid] = rp

        elif op == "perpendicular":
            p = _as_vec(points, str(item["through"]))
            a = _as_vec(points, item["to"][0])
            b = _as_vec(points, item["to"][1])
            dx, dy = float(b[0]) - float(a[0]), float(b[1]) - float(a[1])
            direction_norm = math.sqrt(dx * dx + dy * dy)
            if direction_norm < 1e-9:
                raise ValueError("perpendicular: degenerate line")
            p1, p2 = _segment_far(
                p, (-dy, dx), width, height, direction_norm=direction_norm
            )
            _append_segment_drawable(drawables, p1, p2, item)

        elif op == "parallel":
            p = _as_vec(points, str(item["through"]))
            a = _as_vec(points, item["to"][0])
            b = _as_vec(points, item["to"][1])
            dx, dy = float(b[0]) - float(a[0]), float(b[1]) - float(a[1])
            direction_norm = math.sqrt(dx * dx + dy * dy)
            if direction_norm < 1e-9:
                raise ValueError("parallel: degenerate direction")
            p1, p2 = _segment_far(
                p, (dx, dy), width, height, direction_norm=direction_norm
            )
            _append_segment_drawable(drawables, p1, p2, item)

        elif op == "intersection_lines":
            pid = str(item["id"])
            l1 = item["line1"]
            l2 = item["line2"]
            a, b = _as_vec(points, l1[0]), _as_vec(points, l1[1])
            c, d = _as_vec(points, l2[0]), _as_vec(points, l2[1])
            inter = euclid.intersect_lines_infinite(a, b, c, d)
            if inter is None:
                raise ValueError("intersection_lines: parallel lines")
            points[pid] = inter

        elif op == "intersection_line_circle":
            pid = str(item["id"])
            la = _as_vec(points, item["line"][0])
            lb = _as_vec(points, item["line"][1])
            spec = {k: item[k] for k in ("center", "radius", "through", "radius_from") if k in item}
            if "center" not in spec:
                raise ValueError("intersection_line_circle needs circle center (and radius / through / radius_from)")
            o, r = _circle_spec_radius(spec, points)
            pts = euclid.line_circle_intersections(la, lb, o, r)
            if not pts:
                raise ValueError("intersection_line_circle: no intersection")
            which = int(item.get("which", 0))
            if which < 0 or which >= len(pts):
                raise ValueError(f"intersection_line_circle: which={which} but got {len(pts)} point(s)")
            pt = pts[which]
            points[pid] = pt

        elif op == "intersection_circles":
            c1 = item["circle1"]
            c2 = item["circle2"]
            o1, r1 = _circle_spec_radius(c1, points)
            o2, r2 = _circle_spec_radius(c2, points)
            pts = euclid.circle_circle_intersections(o1, r1, o2, r2)
            if not pts:
                raise ValueError("intersection_circles: no intersection (check radii and centers)")
            ids = item.get("ids")
            if not ids:
                raise ValueError("intersection_circles requires ids: [P, Q] or [P]")
            ids = [str(x) for x in ids]
            if len(pts) == 1:
                if len(ids) != 1:
                    raise ValueError("intersection_circles: tangent case yields one point; use ids with one name")
                points[ids[0]] = pts[0]
            else:
                if len(ids) != 2:
                    raise ValueError("intersection_circles: two intersections require ids: [P, Q]")
                points[ids[0]] = pts[0]
                points[ids[1]] = pts[1]

        elif op == "perpendicular_bisector":
            src = item["source"]
            if len(src) != 2:
                raise ValueError("perpendicular_bisector requires source: [A, B]")
            a = _as_vec(points, src[0])
            b = _as_vec(points, src[1])
            ax, ay = float(a[0]), float(a[1])
            bx, by = float(b[0]), float(b[1])
            mid = np.array([(ax + bx) / 2.0, (ay + by) / 2.0], dtype=np.float64)
            dx, dy = bx - ax, by - ay
            direction_norm = math.sqrt(dx * dx + dy * dy)
            if direction_norm < 1e-9:
                raise ValueError("perpendicular_bisector: segment has zero length")
            p1, p2 = _segment_far(
                mid, (-dy, dx), width, height, direction_norm=direction_norm
            )
            _append_segment_drawable(drawables, p1, p2, item)

        elif op == "angle_bisector":
            src = item.get("source") or {}
            vertex = str(src.get("vertex"))
            arms = src.get("arms")
            if not arms or len(arms) != 2:
                raise ValueError("angle_bisector requires source: { vertex: B, arms: [A, C] }")
            pa = _as_vec(points, arms[0])
            pb = _as_vec(points, vertex)
            pc = _as_vec(points, arms[1])
            bax, bay = float(pa[0]) - float(pb[0]), float(pa[1]) - float(pb[1])
            bcx, bcy = float(pc[0]) - float(pb[0]), float(pc[1]) - float(pb[1])
            n1 = math.sqrt(bax * bax + bay * bay)
            n2 = math.sqrt(bcx * bcx + bcy * bcy)
            if n1 < 1e-9 or n2 < 1e-9:
                raise ValueError("angle_bisector: degenerate arm")
            u1x, u1y = bax / n1, bay / n1
            u2x, u2y = bcx / n2, bcy / n2
            dx, dy = u1x + u2x, u1y + u2y
            n = math.sqrt(dx * dx + dy * dy)
            if n < 1e-9:
                dx, dy = -u1y, u1x
            else:
                dx, dy = dx / n, dy / n
            direction_norm = math.sqrt(dx * dx + dy * dy)
            p1, p2 = _segment_far(
                pb, (dx, dy), width, height, direction_norm=direction_norm
            )
            _append_segment_drawable(drawables, p1, p2, item)

        elif op == "circle":
            center = str(item["center"])
            if center not in points:
                raise ValueError(f"circle: unknown center {center!r}")
            c = _as_vec(points, center)
            r = euclid.resolve_circle_radius(item, points)
            drawables.append(
                {
                    "kind": "circle",
                    "cx": float(c[0]),
                    "cy": float(c[1]),
                    "r": r,
                    "style": (item.get("style") or "solid").lower(),
                    "id": item.get("id"),
                    "fill": item.get("fill"),
                }
            )

        elif op == "ellipse":
            center = str(item["center"])
            if center not in points:
                raise ValueError(f"ellipse: unknown center {center!r}")
            c = _as_vec(points, center)
            rx = float(item.get("rx", 0))
            ry = float(item.get("ry", 0))
            if rx <= 0 or ry <= 0:
                raise ValueError("ellipse: rx and ry must be positive")
            rot = float(item.get("rotation_deg", item.get("rotate_deg", 0)))
            drawables.append(
                {
                    "kind": "ellipse",
                    "cx": float(c[0]),
                    "cy": float(c[1]),
                    "rx": rx,
                    "ry": ry,
                    "rotation_deg": rot,
                    "style": (item.get("style") or "solid").lower(),
                    "id": item.get("id"),
                    "fill": item.get("fill"),
                }
            )

        else:
            raise ValueError(f"unknown construction op: {op!r}")

    resolved_points = {
        name: (float(point[0]), float(point[1])) for name, point in points.items()
    }
    return GeometrySolveResult(points=resolved_points, drawables=drawables)
