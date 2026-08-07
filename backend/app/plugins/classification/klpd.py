"""Kullback-Leibler pseudo-divergence.

Splits the difference between two spectra into a shape term and an energy term. The literature
reports better discrimination than SAM in some pigment-mapping contexts, which is why the case
study uses it.
"""
from __future__ import annotations

import numpy as np

from ...core.registry import CLASSIFIERS
from ._metrics import DistanceMetrics, tile_query

_metrics = DistanceMetrics()

# mode=3 sums the shape and energy components into a single score.
_TOTAL = 3


@CLASSIFIERS.register("klpd", "KL pseudo-divergence", higher_is_better=False)
def klpd(query: np.ndarray, library: np.ndarray) -> np.ndarray:
    return np.asarray(
        _metrics.klpd_spectral(tile_query(query, library), library, mode=_TOTAL)
    ).reshape(-1)
