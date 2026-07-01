from typing import Literal

import numpy as np
from fastapi import HTTPException


def clamp_bbox(x0: int, y0: int, x1: int, y1: int, width: int, height: int) -> tuple[int, int, int, int]:
    x_min = max(0, min(x0, x1))
    x_max = min(width - 1, max(x0, x1))
    y_min = max(0, min(y0, y1))
    y_max = min(height - 1, max(y0, y1))

    if x_min > x_max or y_min > y_max:
        raise HTTPException(400, "Empty region")
    return x_min, y_min, x_max, y_max


def extract_region_signals(
    cube: np.ndarray,
    shape: Literal["rect", "ellipse"],
    x0: int,
    y0: int,
    x1: int,
    y1: int,
) -> list[dict]:
    h, w, _ = cube.shape
    x_min, y_min, x_max, y_max = clamp_bbox(x0, y0, x1, y1, w, h)

    # Extract the bounding-box patch in one vectorized slice (H_p, W_p, B)
    patch = cube[y_min:y_max + 1, x_min:x_max + 1, :].astype(np.float32)
    pH, pW, _ = patch.shape

    # Local (patch) coordinate grids
    ys_local, xs_local = np.mgrid[0:pH, 0:pW]

    if shape == "ellipse":
        cx = (x_min + x_max) / 2.0
        cy = (y_min + y_max) / 2.0
        rx = (x_max - x_min) / 2.0 or 1.0
        ry = (y_max - y_min) / 2.0 or 1.0
        dx = (xs_local + x_min - cx) / rx
        dy = (ys_local + y_min - cy) / ry
        mask = (dx * dx + dy * dy) <= 1.0
        sel_ys = ys_local[mask]
        sel_xs = xs_local[mask]
        values_arr = patch[mask]          # (N, B) via boolean fancy indexing
    else:
        sel_ys = ys_local.ravel()
        sel_xs = xs_local.ravel()
        values_arr = patch.reshape(-1, patch.shape[2])   # (N, B)

    if len(sel_ys) == 0:
        raise HTTPException(400, "Empty region after shape mask")

    # Single bulk tolist() call — far cheaper than N individual calls
    values_list = values_arr.tolist()
    global_xs = (sel_xs + x_min).tolist()
    global_ys = (sel_ys + y_min).tolist()

    spectra_out = [
        {"x": int(global_xs[i]), "y": int(global_ys[i]), "values": values_list[i]}
        for i in range(len(global_ys))
    ]

    return spectra_out


def compute_region_stats(spectra_out: list[dict]) -> dict:
    values_matrix = np.asarray([s["values"] for s in spectra_out], dtype=np.float64)
    n = int(values_matrix.shape[0])
    return {
        "n_pixels": n,
        "mean": values_matrix.mean(axis=0).tolist(),
        "std": values_matrix.std(axis=0, ddof=1 if n > 1 else 0).tolist(),
    }
