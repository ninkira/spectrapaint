from typing import Literal

import numpy as np

from ..core.roi.geometry import clamp_bbox, ellipse_mask, rect_mask  # noqa: F401  (re-export)


def region_stats(values: np.ndarray) -> dict:
    """Descriptive statistics over an (N, B) block of spectra.

    `ddof=1` matches the sample standard deviation the UI reports, but is only meaningful with
    more than one pixel — a single-pixel ROI would otherwise divide by zero and return NaN.
    """
    n = int(values.shape[0])
    return {
        "n_pixels": n,
        "mean": values.mean(axis=0).tolist(),
        "std": values.std(axis=0, ddof=1 if n > 1 else 0).tolist(),
        "min": values.min(axis=0).tolist(),
        "max": values.max(axis=0).tolist(),
    }


def extract_region_signals(
    cube: np.ndarray,
    shape: Literal["rect", "ellipse"],
    x0: int,
    y0: int,
    x1: int,
    y1: int,
) -> list[dict]:
    h, w, _ = cube.shape
    mask = ellipse_mask if shape == "ellipse" else rect_mask
    ys, xs = mask(x0, y0, x1, y1, w, h)

    values = cube[ys, xs, :].astype(np.float32)
    # One bulk tolist() — far cheaper than N individual calls.
    values_list = values.tolist()
    xs_list = xs.tolist()
    ys_list = ys.tolist()
    return [
        {"x": int(xs_list[i]), "y": int(ys_list[i]), "values": values_list[i]}
        for i in range(len(ys_list))
    ]


def compute_region_stats(spectra_out: list[dict]) -> dict:
    return region_stats(np.asarray([s["values"] for s in spectra_out], dtype=np.float64))
