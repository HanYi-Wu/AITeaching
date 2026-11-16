from __future__ import annotations

import math
from dataclasses import dataclass, field
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


def _cached_projection(
    previous: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None,
    point: np.ndarray,
    a: np.ndarray,
    b: np.ndarray,
) -> tuple[np.ndarray, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]]:
    if (
        previous is not None
        and previous[0] is point
        and previous[1] is a
        and previous[2] is b
    ):
        return previous[3], previous
    foot = euclid.foot_on_line(point, a, b)
    return foot, (point, a, b, foot)


@dataclass
class _GeometryBuilder:
    """Mutable per-solve state and operation-specific construction handlers."""

    width: float
    height: float
    rng: np.random.Generator
    points: dict[str, np.ndarray] = field(default_factory=dict)
    drawables: list[dict[str, Any]] = field(default_factory=list)

    def apply(self, item: dict[str, Any]) -> None:
        op = item.get("op")
        handler = _OPERATION_HANDLERS.get(op) if isinstance(op, str) else None
        if handler is None:
            raise ValueError(f"unknown construction op: {op!r}")
        handler(self, item)

    def result(self) -> GeometrySolveResult:
        resolved_points = {
            name: (float(point[0]), float(point[1]))
            for name, point in self.points.items()
        }
        return GeometrySolveResult(points=resolved_points, drawables=self.drawables)

    def _triangle(self, item: dict[str, Any]) -> None:
        nodes = item["nodes"]
        attr = item.get("attr") or {}
        triangle_type = (attr.get("type") or "random").lower()
        min_angle = float(attr.get("min_angle", 25))
        if triangle_type == "random":
            a, b, c = _random_triangle(
                self.width, self.height, self.rng, min_angle
            )
        else:
            raise ValueError(f"unknown triangle attr.type: {triangle_type!r}")
        if len(nodes) != 3:
            raise ValueError("triangle requires exactly 3 nodes")
        points = self.points
        for name, point in zip(nodes, (a, b, c), strict=True):
            points[str(name)] = point

    def _line(self, item: dict[str, Any]) -> None:
        for name in item["source"]:
            if str(name) not in self.points:
                raise ValueError(f"line references unknown point {name!r}")

    def _draw_through_line(self, item: dict[str, Any], *, perpendicular: bool) -> None:
        point = _as_vec(self.points, str(item["through"]))
        a = _as_vec(self.points, item["to"][0])
        b = _as_vec(self.points, item["to"][1])
        dx, dy = float(b[0]) - float(a[0]), float(b[1]) - float(a[1])
        direction_norm = math.sqrt(dx * dx + dy * dy)
        if direction_norm < 1e-9:
            message = (
                "perpendicular: degenerate line"
                if perpendicular
                else "parallel: degenerate direction"
            )
            raise ValueError(message)
        direction = (-dy, dx) if perpendicular else (dx, dy)
        p1, p2 = _segment_far(
            point, direction, self.width, self.height, direction_norm=direction_norm
        )
        _append_segment_drawable(self.drawables, p1, p2, item)

    def _perpendicular(self, item: dict[str, Any]) -> None:
        self._draw_through_line(item, perpendicular=True)

    def _parallel(self, item: dict[str, Any]) -> None:
        self._draw_through_line(item, perpendicular=False)

    def _intersection_lines(self, item: dict[str, Any]) -> None:
        pid = str(item["id"])
        line1 = item["line1"]
        line2 = item["line2"]
        a, b = _as_vec(self.points, line1[0]), _as_vec(self.points, line1[1])
        c, d = _as_vec(self.points, line2[0]), _as_vec(self.points, line2[1])
        intersection = euclid.intersect_lines_infinite(a, b, c, d)
        if intersection is None:
            raise ValueError("intersection_lines: parallel lines")
        self.points[pid] = intersection

    def _intersection_line_circle(self, item: dict[str, Any]) -> None:
        pid = str(item["id"])
        line_a = _as_vec(self.points, item["line"][0])
        line_b = _as_vec(self.points, item["line"][1])
        spec = {
            key: item[key]
            for key in ("center", "radius", "through", "radius_from")
            if key in item
        }
        if "center" not in spec:
            raise ValueError(
                "intersection_line_circle needs circle center (and radius / through / radius_from)"
            )
        center, radius = _circle_spec_radius(spec, self.points)
        intersections = euclid.line_circle_intersections(
            line_a, line_b, center, radius
        )
        if not intersections:
            raise ValueError("intersection_line_circle: no intersection")
        which = int(item.get("which", 0))
        if which < 0 or which >= len(intersections):
            raise ValueError(
                f"intersection_line_circle: which={which} but got {len(intersections)} point(s)"
            )
        self.points[pid] = intersections[which]

    def _intersection_circles(self, item: dict[str, Any]) -> None:
        circle1 = item["circle1"]
        circle2 = item["circle2"]
        o1, r1 = _circle_spec_radius(circle1, self.points)
        o2, r2 = _circle_spec_radius(circle2, self.points)
        intersections = euclid.circle_circle_intersections(o1, r1, o2, r2)
        if not intersections:
            raise ValueError(
                "intersection_circles: no intersection (check radii and centers)"
            )
        ids = item.get("ids")
        if not ids:
            raise ValueError("intersection_circles requires ids: [P, Q] or [P]")
        ids = [str(value) for value in ids]
        if len(intersections) == 1:
            if len(ids) != 1:
                raise ValueError(
                    "intersection_circles: tangent case yields one point; use ids with one name"
                )
            self.points[ids[0]] = intersections[0]
        else:
            if len(ids) != 2:
                raise ValueError(
                    "intersection_circles: two intersections require ids: [P, Q]"
                )
            self.points[ids[0]] = intersections[0]
            self.points[ids[1]] = intersections[1]

    def _perpendicular_bisector(self, item: dict[str, Any]) -> None:
        src = item["source"]
        if len(src) != 2:
            raise ValueError("perpendicular_bisector requires source: [A, B]")
        a = _as_vec(self.points, src[0])
        b = _as_vec(self.points, src[1])
        ax, ay = float(a[0]), float(a[1])
        bx, by = float(b[0]), float(b[1])
        midpoint = np.array(
            [(ax + bx) / 2.0, (ay + by) / 2.0], dtype=np.float64
        )
        dx, dy = bx - ax, by - ay
        direction_norm = math.sqrt(dx * dx + dy * dy)
        if direction_norm < 1e-9:
            raise ValueError("perpendicular_bisector: segment has zero length")
        p1, p2 = _segment_far(
            midpoint,
            (-dy, dx),
            self.width,
            self.height,
            direction_norm=direction_norm,
        )
        _append_segment_drawable(self.drawables, p1, p2, item)

    def _angle_bisector(self, item: dict[str, Any]) -> None:
        src = item.get("source") or {}
        vertex = str(src.get("vertex"))
        arms = src.get("arms")
        if not arms or len(arms) != 2:
            raise ValueError(
                "angle_bisector requires source: { vertex: B, arms: [A, C] }"
            )
        pa = _as_vec(self.points, arms[0])
        pb = _as_vec(self.points, vertex)
        pc = _as_vec(self.points, arms[1])
        bax, bay = float(pa[0]) - float(pb[0]), float(pa[1]) - float(pb[1])
        bcx, bcy = float(pc[0]) - float(pb[0]), float(pc[1]) - float(pb[1])
        n1 = math.sqrt(bax * bax + bay * bay)
        n2 = math.sqrt(bcx * bcx + bcy * bcy)
        if n1 < 1e-9 or n2 < 1e-9:
            raise ValueError("angle_bisector: degenerate arm")
        u1x, u1y = bax / n1, bay / n1
        u2x, u2y = bcx / n2, bcy / n2
        dx, dy = u1x + u2x, u1y + u2y
        norm = math.sqrt(dx * dx + dy * dy)
        if norm < 1e-9:
            dx, dy = -u1y, u1x
        else:
            dx, dy = dx / norm, dy / norm
        direction_norm = math.sqrt(dx * dx + dy * dy)
        p1, p2 = _segment_far(
            pb, (dx, dy), self.width, self.height, direction_norm=direction_norm
        )
        _append_segment_drawable(self.drawables, p1, p2, item)

    def _circle(self, item: dict[str, Any]) -> None:
        center = str(item["center"])
        if center not in self.points:
            raise ValueError(f"circle: unknown center {center!r}")
        point = _as_vec(self.points, center)
        radius = euclid.resolve_circle_radius(item, self.points)
        self.drawables.append(
            {
                "kind": "circle",
                "cx": float(point[0]),
                "cy": float(point[1]),
                "r": radius,
                "style": (item.get("style") or "solid").lower(),
                "id": item.get("id"),
                "fill": item.get("fill"),
            }
        )

    def _ellipse(self, item: dict[str, Any]) -> None:
        center = str(item["center"])
        if center not in self.points:
            raise ValueError(f"ellipse: unknown center {center!r}")
        point = _as_vec(self.points, center)
        rx = float(item.get("rx", 0))
        ry = float(item.get("ry", 0))
        if rx <= 0 or ry <= 0:
            raise ValueError("ellipse: rx and ry must be positive")
        rotation = float(item.get("rotation_deg", item.get("rotate_deg", 0)))
        self.drawables.append(
            {
                "kind": "ellipse",
                "cx": float(point[0]),
                "cy": float(point[1]),
                "rx": rx,
                "ry": ry,
                "rotation_deg": rotation,
                "style": (item.get("style") or "solid").lower(),
                "id": item.get("id"),
                "fill": item.get("fill"),
            }
        )


_OPERATION_HANDLERS = {
    "triangle": _GeometryBuilder._triangle,
    "line": _GeometryBuilder._line,
    "perpendicular": _GeometryBuilder._perpendicular,
    "parallel": _GeometryBuilder._parallel,
    "intersection_lines": _GeometryBuilder._intersection_lines,
    "intersection_line_circle": _GeometryBuilder._intersection_line_circle,
    "intersection_circles": _GeometryBuilder._intersection_circles,
    "perpendicular_bisector": _GeometryBuilder._perpendicular_bisector,
    "angle_bisector": _GeometryBuilder._angle_bisector,
    "circle": _GeometryBuilder._circle,
    "ellipse": _GeometryBuilder._ellipse,
}


def solve_geometry(
    constructions: list[dict[str, Any]],
    width: float,
    height: float,
    rng: np.random.Generator,
) -> GeometrySolveResult:
    """Resolve named points and collect drawable primitives in input order."""
    builder = _GeometryBuilder(width=width, height=height, rng=rng)
    triangle = builder._triangle
    apply = builder.apply
    points = builder.points
    last_projection = None
    for item in constructions:
        op = item.get("op")
        if op == "triangle":
            triangle(item)
        elif op == "in_line":
            pid = item["id"]
            src = item["source"]
            params = float(item.get("params", 0.5))
            a = _as_vec(points, src[0])
            b = _as_vec(points, src[1])
            ax, ay = float(a[0]), float(a[1])
            point = np.array(
                [
                    ax + params * (float(b[0]) - ax),
                    ay + params * (float(b[1]) - ay),
                ],
                dtype=np.float64,
            )
            points[str(pid)] = point
        elif op == "foot":
            pid = str(item["id"])
            point = _as_vec(points, str(item["point"]))
            a = _as_vec(points, item["line"][0])
            b = _as_vec(points, item["line"][1])
            foot, last_projection = _cached_projection(
                last_projection, point, a, b
            )
            points[pid] = foot
        elif op == "reflection":
            pid = str(item["id"])
            point = _as_vec(points, str(item["point"]))
            a = _as_vec(points, item["line"][0])
            b = _as_vec(points, item["line"][1])
            foot, last_projection = _cached_projection(
                last_projection, point, a, b
            )
            points[pid] = np.array(
                [
                    2.0 * float(foot[0]) - float(point[0]),
                    2.0 * float(foot[1]) - float(point[1]),
                ],
                dtype=np.float64,
            )
        else:
            apply(item)
    return builder.result()
