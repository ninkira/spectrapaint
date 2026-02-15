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

    spectra_out: list[dict] = []

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

            spectra_out.append(
                {
                    "x": x,
                    "y": y,
                    "values": cube[y, x, :].astype(float).tolist(),
                }
            )

    if not spectra_out:
        raise HTTPException(400, "Empty region after shape mask")

    return spectra_out


def compute_region_stats(spectra_out: list[dict]) -> dict:
    values_matrix = np.asarray([s["values"] for s in spectra_out], dtype=np.float64)
    n = int(values_matrix.shape[0])
    return {
        "n_pixels": n,
        "mean": values_matrix.mean(axis=0).tolist(),
        "std": values_matrix.std(axis=0, ddof=1 if n > 1 else 0).tolist(),
    }
