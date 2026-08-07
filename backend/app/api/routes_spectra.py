from typing import List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.roi.geometry import EmptyRegionError, line_pixels, polygon_mask
from ..services.cube_loader import get_cube_for_path
from ..services.dataset_store import get_dataset_record_or_404
from ..services.spectra_region import compute_region_stats, extract_region_signals


router = APIRouter()


def _bad_region(exc: EmptyRegionError) -> HTTPException:
    """Geometry errors are a domain concern; only the API layer knows they are 400s."""
    return HTTPException(status_code=400, detail=str(exc))


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

    try:
        spectra_out = extract_region_signals(cube, shape, x0, y0, x1, y1)
    except EmptyRegionError as exc:
        raise _bad_region(exc) from exc
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

    try:
        ys, xs = line_pixels([(x0, y0), (x1, y1)], w, h, step=step)
    except EmptyRegionError as exc:
        raise _bad_region(exc) from exc

    wl = md["wavelengths_nm"]
    values = cube[ys, xs, :].astype(float).tolist()
    spectra_out = [
        {"x": int(xs[i]), "y": int(ys[i]), "wavelengths_nm": wl, "values": values[i]}
        for i in range(len(ys))
    ]
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
    cube, md = get_cube_for_path(rec["envi_hdr"])
    h, w, _ = cube.shape

    try:
        inside_ys, inside_xs = polygon_mask([(v.x, v.y) for v in req.vertices], w, h)
    except EmptyRegionError as exc:
        raise _bad_region(exc) from exc

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
