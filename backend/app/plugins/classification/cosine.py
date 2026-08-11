"""Cosine distance — 1 minus the cosine similarity between two spectra."""
from __future__ import annotations

import numpy as np

from ...core.registry import CLASSIFIERS
from ._metrics import DistanceMetrics, tile_query

_metrics = DistanceMetrics()


@CLASSIFIERS.register("cosine_matrix", "Cosine distance (matrix)", higher_is_better=False)
def cosine_matrix(query: np.ndarray, library: np.ndarray) -> np.ndarray:
    return _metrics.matrix_cosine_distance(tile_query(query, library), library)
