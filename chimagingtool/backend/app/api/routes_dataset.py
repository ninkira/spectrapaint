from fastapi import APIRouter, HTTPException, Query, Response
from ..services.cube_loader import open_envi, read_metadata, load_cube, extract_rgb, downsample2
from ..services.image_ops import percent_stretch, png_bytes
from ..models.dataset_meta import DatasetMeta
import json, os, numpy as np
from pathlib import Path
import json
from typing import List, Literal, Optional
from pydantic import BaseModel

from typing import Literal

router = APIRouter()

# compute absolute path dynamically
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REGISTRY_FILE = DATA_DIR / "registry.json"

def registry():
    with open(REGISTRY_FILE, "r") as f:
        return json.load(f)


@router.get("/datasets", response_model=list[DatasetMeta])
def list_datasets():
    out = []
    for id_, rec in registry().items():
        hdr = rec["envi_hdr"]
        if not os.path.exists(hdr): continue
        img = open_envi(hdr)
        md = read_metadata(img)
        out.append(DatasetMeta(id=id_, name=rec.get("name", id_), width=md["width"],
                               height=md["height"], wavelengths_nm=md["wavelengths_nm"]))
    return out

@router.get("/datasets/{id}/thumbnail")
def thumbnail(id: str, scale: int = Query(8, ge=1)):
    rec = registry().get(id);
    if not rec: raise HTTPException(404, "Unknown dataset")
    img = open_envi(rec["envi_hdr"]); md = read_metadata(img)
    cube = load_cube(img); wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, 650, 550, 450)
    rgb = downsample2(rgb, scale)
    return Response(content=png_bytes(percent_stretch(rgb)), media_type="image/png")

@router.get("/datasets/{id}/rgb")
def rgb(id: str, r: float = 650, g: float = 550, b: float = 450, stretch: str = "percent_2"):
    rec = registry().get(id)
    if not rec: raise HTTPException(404, "Unknown dataset")
    img = open_envi(rec["envi_hdr"]); md = read_metadata(img)
    cube = load_cube(img); wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, r, g, b)
    rgb8 = percent_stretch(rgb) if stretch.startswith("percent") else rgb.astype("uint8")
    return Response(content=png_bytes(rgb8), media_type="image/png")


@router.get("/datasets/{id}/spectra")
def spectra_at_pixel(id: str, x: int, y: int):
    """
    Return the full spectrum for a single pixel (x, y) in dataset `id`.
    x = column index, y = row index, both in *RGB image / cube coordinates*.
    """
    rec = registry().get(id)
    if not rec:
        raise HTTPException(404, "Unknown dataset")

    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)  # (H, W, B)
    H, W, _ = cube.shape

    if not (0 <= x < W and 0 <= y < H):
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
    """
    Return spectra for a region in dataset `id`.

    Query params:
      - shape = 'rect' or 'ellipse'
      - (x0, y0), (x1, y1) define the bounding box in *image coordinates*
    """
    rec = registry().get(id)
    if not rec:
        raise HTTPException(404, "Unknown dataset")

    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)  # (H, W, B)
    H, W, _ = cube.shape

    # normalize coords
    x_min = max(0, min(x0, x1))
    x_max = min(W - 1, max(x0, x1))
    y_min = max(0, min(y0, y1))
    y_max = min(H - 1, max(y0, y1))

    if x_min > x_max or y_min > y_max:
        raise HTTPException(400, "Empty region")

    wl = md["wavelengths_nm"]
    spectra_out = []

    if shape == "ellipse":
        cx = (x_min + x_max) / 2.0
        cy = (y_min + y_max) / 2.0
        rx = (x_max - x_min) / 2.0 or 1.0
        ry = (y_max - y_min) / 2.0 or 1.0

    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            if shape == "ellipse":
                dx = (x - cx) / rx
                dy = (y - cy) / ry
                if dx * dx + dy * dy > 1.0:
                    continue

            spec = cube[y, x, :].astype(float)

            spectra_out.append(
                {
                    "x": x,
                    "y": y,
                    "wavelengths_nm": wl,
                    "values": spec.tolist(),
                }
            )

    return {"spectra": spectra_out}


def bresenham(x0: int, y0: int, x1: int, y1: int):
    """Yield integer points on a line from (x0,y0) to (x1,y1)."""
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
    """
    Return spectra sampled along a line segment in dataset `id`.

    Query params (image coordinates):
      - x0,y0 start pixel
      - x1,y1 end pixel
      - step: keep every Nth pixel (default 1 = all)
    """
    rec = registry().get(id)
    if not rec:
        raise HTTPException(404, "Unknown dataset")

    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)  # (H, W, B)
    H, W, _ = cube.shape

    # clamp endpoints to image bounds
    x0c = max(0, min(W - 1, x0))
    x1c = max(0, min(W - 1, x1))
    y0c = max(0, min(H - 1, y0))
    y1c = max(0, min(H - 1, y1))

    wl = md["wavelengths_nm"]
    spectra_out = []

    i = 0
    for x, y in bresenham(x0c, y0c, x1c, y1c):
        if step > 1 and (i % step) != 0:
            i += 1
            continue
        i += 1

        spec = cube[y, x, :].astype(float)
        spectra_out.append(
            {
                "x": x,
                "y": y,
                "wavelengths_nm": wl,
                "values": spec.tolist(),
            }
        )

    return {"spectra": spectra_out}
class Point(BaseModel):
    x: int
    y: int

class PolygonRequest(BaseModel):
    vertices: List[Point]
    # optional guardrail you may want even now:
    max_points: Optional[int] = None


def point_in_poly(x: int, y: int, verts: List[Point]) -> bool:
    """Ray casting algorithm; returns True if point is inside polygon."""
    inside = False
    n = len(verts)
    j = n - 1
    for i in range(n):
        xi, yi = verts[i].x, verts[i].y
        xj, yj = verts[j].x, verts[j].y
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside

@router.post("/datasets/{id}/spectra-polygon")
def spectra_polygon(id: str, req: PolygonRequest):
    """
    Return spectra for all pixels inside a polygon.

    Body:
      { "vertices": [{"x":..,"y":..}, ...], "max_points": optional }
    """
    rec = registry().get(id)
    if not rec:
        raise HTTPException(404, "Unknown dataset")

    if not req.vertices or len(req.vertices) < 3:
        raise HTTPException(400, "Polygon needs at least 3 vertices")

    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)  # (H, W, B)
    H, W, _ = cube.shape

    # clamp vertices to image bounds
    verts = [
        Point(
            x=max(0, min(W - 1, v.x)),
            y=max(0, min(H - 1, v.y)),
        )
        for v in req.vertices
    ]

    # polygon bounding box (limits work)
    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    x_min = max(0, min(xs))
    x_max = min(W - 1, max(xs))
    y_min = max(0, min(ys))
    y_max = min(H - 1, max(ys))

    wl = md["wavelengths_nm"]
    spectra_out = []

    count = 0
    max_points = req.max_points

    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            if not point_in_poly(x, y, verts):
                continue

            spec = cube[y, x, :].astype(float)
            spectra_out.append(
                {
                    "x": x,
                    "y": y,
                    "wavelengths_nm": wl,
                    "values": spec.tolist(),
                }
            )

            count += 1
            if max_points is not None and count >= max_points:
                return {"spectra": spectra_out, "truncated": True, "count": count}

    return {"spectra": spectra_out, "truncated": False, "count": count}
