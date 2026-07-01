from typing import List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from matplotlib.path import Path as MplPath
from pydantic import BaseModel

from ..services.cube_loader import get_cube_for_path
from ..services.dataset_store import get_dataset_record_or_404
from ..services.spectra_region import compute_region_stats, extract_region_signals


router = APIRouter()


@router.get("/datasets/{id}/spectra")
def spectra_at_pixel(id: str, x: int, y: int):
    rec = get_dataset_record_or_404(id)
    cube, md = get_cube_for_path(rec["envi_hdr"])
    h, w, _ = cube.shape

    if not (0 <= x < w and 0 <= y < h):
        raise HTTPException(status_code=400, detail="x/y out of bounds")

    spectrum = cube[y, x, :].astype(float)
    return {
        "x": x,
        "y": y,
        "wavelengths_nm": md["wavelengths_nm"],
        "values": spectrum.tolist(),
    }


@router.get("/datasets/{id}/spectra-region")
def spectra_region(
    id: str,
    shape: Literal["rect", "ellipse"],
    x0: int,
    y0: int,
    x1: int,
    y1: int,
):
    rec = get_dataset_record_or_404(id)
    cube, md = get_cube_for_path(rec["envi_hdr"])

    spectra_out = extract_region_signals(cube, shape, x0, y0, x1, y1)
    stats = compute_region_stats(spectra_out)

    return {
        "region_id": {
            "dataset_id": id,
            "shape": shape,
            "x0": x0,
            "y0": y0,
            "x1": x1,
            "y1": y1,
        },
        "wavelengths_nm": md["wavelengths_nm"],
        "region_stats": stats,
        "region_spectra": spectra_out,
    }


def bresenham(x0: int, y0: int, x1: int, y1: int):
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


@router.get("/datasets/{id}/spectra-line")
def spectra_line(
    id: str,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    step: int = 1,
):
    rec = get_dataset_record_or_404(id)
    cube, md = get_cube_for_path(rec["envi_hdr"])
    h, w, _ = cube.shape

    x0c = max(0, min(w - 1, x0))
    x1c = max(0, min(w - 1, x1))
    y0c = max(0, min(h - 1, y0))
    y1c = max(0, min(h - 1, y1))

    wl = md["wavelengths_nm"]
    spectra_out = []

    i = 0
    for x, y in bresenham(x0c, y0c, x1c, y1c):
        if step > 1 and (i % step) != 0:
            i += 1
            continue
        i += 1
        spec = cube[y, x, :].astype(float)
        spectra_out.append({"x": x, "y": y, "wavelengths_nm": wl, "values": spec.tolist()})

    return {"spectra": spectra_out}


class Point(BaseModel):
    x: int
    y: int


class PolygonRequest(BaseModel):
    vertices: List[Point]
    max_points: Optional[int] = None


@router.post("/datasets/{id}/spectra-polygon")
def spectra_polygon(id: str, req: PolygonRequest):
    rec = get_dataset_record_or_404(id)

    if not req.vertices or len(req.vertices) < 3:
        raise HTTPException(400, "Polygon needs at least 3 vertices")

    cube, md = get_cube_for_path(rec["envi_hdr"])
    h, w, _ = cube.shape

    verts = [Point(x=max(0, min(w - 1, v.x)), y=max(0, min(h - 1, v.y))) for v in req.vertices]

    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    x_min = max(0, min(xs))
    x_max = min(w - 1, max(xs))
    y_min = max(0, min(ys))
    y_max = min(h - 1, max(ys))

    # Vectorized point-in-polygon using matplotlib
    poly_path = MplPath([(v.x, v.y) for v in verts])
    ys_grid, xs_grid = np.mgrid[y_min:y_max + 1, x_min:x_max + 1]
    points = np.column_stack([xs_grid.ravel(), ys_grid.ravel()])
    mask = poly_path.contains_points(points).reshape(ys_grid.shape)

    inside_ys, inside_xs = np.where(mask)
    inside_ys += y_min
    inside_xs += x_min

    wl = md["wavelengths_nm"]
    max_points = req.max_points
    total = len(inside_ys)
    truncated = max_points is not None and total > max_points
    if truncated:
        inside_ys = inside_ys[:max_points]
        inside_xs = inside_xs[:max_points]

    # Fancy indexing: extract all spectra in one NumPy call instead of a Python loop
    spectra_arr = cube[inside_ys, inside_xs, :].astype(np.float32)  # (N, B)
    values_list = spectra_arr.tolist()
    xs_list = inside_xs.tolist()
    ys_list = inside_ys.tolist()

    spectra_out = [
        {"x": xs_list[i], "y": ys_list[i], "values": values_list[i]}
        for i in range(len(xs_list))
    ]

    # wavelengths_nm at top-level — avoids repeating it N times in the payload
    return {"spectra": spectra_out, "wavelengths_nm": wl, "truncated": truncated, "count": len(spectra_out)}
