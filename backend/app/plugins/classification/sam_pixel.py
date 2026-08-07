"""Row-at-a-time Spectral Angle Mapper.

Mathematically identical to the vectorised `sam_matrix`, and kept as a separate method because
it is the straightforward implementation the fast one is checked against.
"""
from __future__ import annotations

import numpy as np

from ...core.registry import CLASSIFIERS
from ._metrics import DistanceMetrics

_metrics = DistanceMetrics()


@CLASSIFIERS.register("sam_pixel", "SAM (pixel)", higher_is_better=False)
def sam_pixel(query: np.ndarray, library: np.ndarray) -> np.ndarray:
    return np.asarray(
        [_metrics.pixel_spectral_angle_mapper(query, row) for row in library], dtype=float
    )
