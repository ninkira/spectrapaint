from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.cube_loader import load_cube, open_envi, read_metadata
from ..services.dataset_store import get_dataset_record_or_404
from ..services.spectra_region import compute_region_stats, extract_region_signals


router = APIRouter()


@router.get("/datasets/{id}/spectra")
def spectra_at_pixel(id: str, x: int, y: int):
    rec = get_dataset_record_or_404(id)
    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)
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
    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)

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
    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)
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


def point_in_poly(x: int, y: int, verts: List[Point]) -> bool:
    inside = False
    n = len(verts)
    j = n - 1
    for i in range(n):
        xi, yi = verts[i].x, verts[i].y
        xj, yj = verts[j].x, verts[j].y
        intersects = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi)
        if intersects:
            inside = not inside
        j = i
    return inside


@router.post("/datasets/{id}/spectra-polygon")
def spectra_polygon(id: str, req: PolygonRequest):
    rec = get_dataset_record_or_404(id)

    if not req.vertices or len(req.vertices) < 3:
        raise HTTPException(400, "Polygon needs at least 3 vertices")

    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)
    h, w, _ = cube.shape

    verts = [Point(x=max(0, min(w - 1, v.x)), y=max(0, min(h - 1, v.y))) for v in req.vertices]

    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    x_min = max(0, min(xs))
    x_max = min(w - 1, max(xs))
    y_min = max(0, min(ys))
    y_max = min(h - 1, max(ys))

    wl = md["wavelengths_nm"]
    spectra_out = []

    count = 0
    max_points = req.max_points

    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            if not point_in_poly(x, y, verts):
                continue

            spec = cube[y, x, :].astype(float)
            spectra_out.append({"x": x, "y": y, "wavelengths_nm": wl, "values": spec.tolist()})

            count += 1
            if max_points is not None and count >= max_points:
                return {"spectra": spectra_out, "truncated": True, "count": count}

    return {"spectra": spectra_out, "truncated": False, "count": count}
