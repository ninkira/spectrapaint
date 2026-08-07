"""Which pixels are inside an ROI — one definition, used everywhere.

This is the "ROI handling" core responsibility made concrete. The logic previously existed in
four places with four conventions: rect and ellipse in `services/spectra_region.py`, polygon
inline in the spectra-polygon route, line via a `bresenham()` generator local to that same
module, and point nowhere at all. Spectral extraction needs all four, so rather than adding a
fifth copy they live here and the routes consume them.

Every function returns `(ys, xs)` index arrays ready for `cube[ys, xs, :]` fancy indexing, in
row-major order — except `line_pixels`, which is a path and stays in traversal order.
Coordinates are clamped to the image.
"""
from __future__ import annotations

from typing import Iterable, Iterator, Sequence

import numpy as np
from matplotlib.path import Path as MplPath


class EmptyRegionError(ValueError):
    """The selection does not cover a single pixel of the image."""


def _i(value: object) -> int:
    """Geometry arrives from the UI as floats; pixel indices are integers."""
    return int(round(float(value)))  # type: ignore[arg-type]


def _clamp(value: int, limit: int) -> int:
    return max(0, min(limit - 1, value))


def clamp_bbox(x0: int, y0: int, x1: int, y1: int, width: int, height: int) -> tuple[int, int, int, int]:
    x_min = max(0, min(x0, x1))
    x_max = min(width - 1, max(x0, x1))
    y_min = max(0, min(y0, y1))
    y_max = min(height - 1, max(y0, y1))
    if x_min > x_max or y_min > y_max:
        raise EmptyRegionError("Empty region")
    return x_min, y_min, x_max, y_max


def _bbox_grid(x0: int, y0: int, x1: int, y1: int, width: int, height: int):
    x_min, y_min, x_max, y_max = clamp_bbox(x0, y0, x1, y1, width, height)
    ys, xs = np.mgrid[y_min:y_max + 1, x_min:x_max + 1]
    return ys, xs, (x_min, y_min, x_max, y_max)


def rect_mask(x0: int, y0: int, x1: int, y1: int, width: int, height: int):
    ys, xs, _ = _bbox_grid(x0, y0, x1, y1, width, height)
    return ys.ravel(), xs.ravel()


def ellipse_mask(x0: int, y0: int, x1: int, y1: int, width: int, height: int):
    ys, xs, (x_min, y_min, x_max, y_max) = _bbox_grid(x0, y0, x1, y1, width, height)
    cx = (x_min + x_max) / 2.0
    cy = (y_min + y_max) / 2.0
    # A zero-width or zero-height bbox would divide by zero; treat it as one pixel across.
    rx = (x_max - x_min) / 2.0 or 1.0
    ry = (y_max - y_min) / 2.0 or 1.0
    dx = (xs - cx) / rx
    dy = (ys - cy) / ry
    inside = (dx * dx + dy * dy) <= 1.0
    if not inside.any():
        raise EmptyRegionError("Empty region after shape mask")
    return ys[inside], xs[inside]


def polygon_mask(vertices: Sequence[tuple[float, float]], width: int, height: int):
    """Vectorised point-in-polygon over the polygon's bounding box.

    Returns empty arrays rather than raising for a degenerate polygon — the spectra-polygon
    endpoint reports `count: 0` for that case and callers that cannot use an empty selection
    check for themselves.
    """
    if len(vertices) < 3:
        raise EmptyRegionError("Polygon needs at least 3 vertices")

    points = [(_clamp(_i(x), width), _clamp(_i(y), height)) for x, y in vertices]
    xs_v = [p[0] for p in points]
    ys_v = [p[1] for p in points]
    ys, xs, _ = _bbox_grid(min(xs_v), min(ys_v), max(xs_v), max(ys_v), width, height)

    inside = MplPath(points).contains_points(
        np.column_stack([xs.ravel(), ys.ravel()])
    ).reshape(ys.shape)
    return ys[inside], xs[inside]


def bresenham(x0: int, y0: int, x1: int, y1: int) -> Iterator[tuple[int, int]]:
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    x, y = x0, y0
    while True:
        yield x, y
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy


def line_pixels(points: Sequence[tuple[float, float]], width: int, height: int, step: int = 1):
    """Pixels along a polyline, in traversal order, without repeating the shared endpoints.

    A line annotation may carry more than two points — `_geometry_to_svg` renders it as an SVG
    polyline — so every consecutive segment is walked.
    """
    if len(points) < 2:
        raise EmptyRegionError("A line needs at least 2 points")

    clamped = [(_clamp(_i(x), width), _clamp(_i(y), height)) for x, y in points]
    walked: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for (x0, y0), (x1, y1) in zip(clamped, clamped[1:]):
        for pixel in bresenham(x0, y0, x1, y1):
            if pixel not in seen:
                seen.add(pixel)
                walked.append(pixel)

    if step > 1:
        walked = walked[::step]
    xs = np.array([p[0] for p in walked], dtype=int)
    ys = np.array([p[1] for p in walked], dtype=int)
    return ys, xs


def point_pixel(x: float, y: float, width: int, height: int):
    return (
        np.array([_clamp(_i(y), height)], dtype=int),
        np.array([_clamp(_i(x), width)], dtype=int),
    )


def roi_pixel_mask(annotation: dict, width: int, height: int):
    """`(ys, xs)` for an app annotation object, dispatching on its `type`.

    The geometry keys match what `_geometry_to_svg` renders and what the frontend's annotation
    model emits: rect `x/y/w/h`, ellipse `cx/cy/rx/ry`, polygon `vertices`, line `points`,
    point `x/y`.
    """
    geometry = annotation.get("geometry") or {}
    shape = annotation.get("type")

    try:
        if shape == "rect":
            x, y = _i(geometry["x"]), _i(geometry["y"])
            w, h = _i(geometry["w"]), _i(geometry["h"])
            return rect_mask(x, y, x + w - 1, y + h - 1, width, height)
        if shape == "ellipse":
            cx, cy = _i(geometry["cx"]), _i(geometry["cy"])
            rx, ry = _i(geometry["rx"]), _i(geometry["ry"])
            return ellipse_mask(cx - rx, cy - ry, cx + rx, cy + ry, width, height)
        if shape == "polygon":
            return polygon_mask(_as_points(geometry.get("vertices")), width, height)
        if shape == "line":
            return line_pixels(_as_points(geometry.get("points")), width, height)
        if shape == "point":
            return point_pixel(geometry["x"], geometry["y"], width, height)
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, EmptyRegionError):
            raise
        raise EmptyRegionError(f"Malformed {shape!r} geometry: {geometry!r}") from exc

    raise EmptyRegionError(f"Unsupported ROI type: {shape!r}")


def _as_points(raw: Iterable | None) -> list[tuple[float, float]]:
    return [(p["x"], p["y"]) for p in (raw or [])]
