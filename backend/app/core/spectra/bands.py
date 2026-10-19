"""The band range a cube's spectra may be compared over, and dropping the rest.

A VNIR scanner is blind at both ends of its nominal range: the lamp's output and the silicon
detector's quantum efficiency collapse together, so the flat-field denominator approaches zero
and the correction divides noise by noise. The result reads 1.15 at 400 nm and 2.0 at 1000 nm on
a real Specim FX10 capture — reflectance above 1.0 is impossible for a diffuse surface, so those
are artefacts, not measurements.

They matter out of proportion to their number. Every metric this app ranks pigments with (SAM,
cosine, KLPD) is driven by the largest components of the vector, and an inflated edge is the
largest component there is: two dead bands at 2.0 decide the ranking over a hundred sound ones
carrying the absorption features that actually identify a pigment. So the exclusion is applied
wherever a spectrum is *compared*, before any distance is computed.

It is deliberately not applied where a spectrum is *displayed*. The plot draws the dead edges and
shades them, because a researcher should be able to see that the data exists and is being
ignored — rather than find their wavelength axis mysteriously shortened. For the same reason the
range is stored per cube and editable: a cube imported already-corrected has no reference
captures to derive one from, so the only way it ever gets a range is by hand.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass(frozen=True)
class BandRange:
    """An inclusive range of band indices — what HsiCube.valid_band_min/max store."""

    first: int
    last: int

    @property
    def n_bands(self) -> int:
        return self.last - self.first + 1

    def as_tuple(self) -> tuple[int, int]:
        return (self.first, self.last)

    def nm(self, wavelengths: Sequence[float]) -> tuple[float, float] | None:
        """The range in nanometres, for a message or a label. None if it does not fit the grid."""
        if self.last >= len(wavelengths):
            return None
        return (float(wavelengths[self.first]), float(wavelengths[self.last]))


def band_range(first: int | None, last: int | None, n_bands: int) -> BandRange | None:
    """A stored range checked against a real band count, or None when there is nothing to apply.

    Either bound may be absent: a user who has only seen the blue end misbehave can set the lower
    bound and leave the upper one open, and half a range is still worth honouring.

    Out-of-range bounds are clipped rather than refused. A range is a property of the detector, so
    it gets copied onto sibling captures that may differ by a band or two, and rejecting it there
    would quietly reinstate the dead edges — the exact failure this module exists to prevent.

    A range that leaves every band in place comes back as None, so that callers have one
    "nothing to exclude" path instead of two.
    """
    if n_bands <= 0 or (first is None and last is None):
        return None
    low = 0 if first is None else max(0, int(first))
    high = n_bands - 1 if last is None else min(n_bands - 1, int(last))
    if low > high:
        # A range that excludes everything is a mistake, not an instruction: honouring it would
        # leave no spectrum to classify at all.
        return None
    if low == 0 and high == n_bands - 1:
        return None
    return BandRange(low, high)


def restrict(values: np.ndarray, rng: BandRange | None) -> np.ndarray:
    """Drop the excluded bands from the last axis of `values` (a spectrum, or (pixels, bands))."""
    if rng is None:
        return values
    return values[..., rng.first : rng.last + 1]


def restrict_wavelengths(wavelengths: Sequence[float], rng: BandRange | None) -> list[float]:
    """The wavelengths that survive `rng`, kept in step with `restrict`."""
    if rng is None:
        return [float(w) for w in wavelengths]
    return [float(w) for w in wavelengths[rng.first : rng.last + 1]]


def excluded_spans_nm(
    wavelengths: Sequence[float], rng: BandRange | None
) -> list[tuple[float, float]]:
    """The wavelength spans `rng` excludes — what the plot shades and a message can quote.

    Up to two spans, one per dead edge, each covering the full width of the bands it excludes so
    that the shading meets the surviving trace rather than leaving a gap beside it.
    """
    if rng is None or not wavelengths or rng.last >= len(wavelengths):
        return []
    spans: list[tuple[float, float]] = []
    if rng.first > 0:
        spans.append((float(wavelengths[0]), float(wavelengths[rng.first])))
    if rng.last < len(wavelengths) - 1:
        spans.append((float(wavelengths[rng.last]), float(wavelengths[-1])))
    return spans
