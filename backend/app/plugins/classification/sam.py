"""Spectral Angle Mapper — the angle between two spectra, so brightness-invariant."""
from __future__ import annotations

import numpy as np

from ...core.registry import CLASSIFIERS
from ._metrics import DistanceMetrics, tile_query

_metrics = DistanceMetrics()


@CLASSIFIERS.register("sam_matrix", "SAM (matrix)", higher_is_better=False)
def sam_matrix(query: np.ndarray, library: np.ndarray) -> np.ndarray:
    return _metrics.matrix_spectral_angle_mapper(tile_query(query, library), library)
