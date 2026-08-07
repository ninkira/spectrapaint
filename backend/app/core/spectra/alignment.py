"""Putting a query spectrum and a reference library on the same wavelength grid.

Comparing spectra band-index to band-index only works if both were sampled by the same sensor.
The pipeline used to truncate both to their shorter band count, so a 400-1000 nm cube and a
1000-2500 nm library were compared as though band 0 of one meant band 0 of the other — returning
confident, meaningless rankings.

Resampling is `np.interp` and nothing more: scipy is in the dev requirements but deliberately not
in requirements-runtime.txt, which is what CI installs and PyInstaller bundles, and one linear
interpolation does not justify adding it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# An overlap this small means the two instruments barely saw the same light; ranking across it
# would be arithmetic rather than measurement.
MIN_OVERLAP_BANDS = 2
MIN_OVERLAP_FRACTION = 0.2

_MICRON_UNITS = {"um", "µm", "micrometer", "micrometers", "micrometre", "micrometres", "micron", "microns"}
_NANO_UNITS = {"nm", "nanometer", "nanometers", "nanometre", "nanometres"}


class AlignmentError(ValueError):
    """The two wavelength grids cannot be meaningfully compared."""


@dataclass
class Alignment:
    """What was done to make the two grids comparable, recorded as provenance."""

    mode: str                       # "resample" | "truncate"
    n_bands: int
    overlap_nm: tuple[float, float] | None = None
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "mode": self.mode,
            "n_bands": self.n_bands,
            "overlap_nm": list(self.overlap_nm) if self.overlap_nm else None,
            "warnings": self.warnings,
        }


def to_nanometres(wavelengths: list[float] | None, units: str | None = None) -> list[float]:
    """Normalise a wavelength list to nm.

    ENVI headers record micrometres about as often as nanometres, and frequently omit the unit
    entirely — hence the magnitude fallback, since no reflectance instrument in this domain
    samples below 100 nm.
    """
    if not wavelengths:
        return []
    values = [float(w) for w in wavelengths]
    unit = (units or "").strip().lower()
    if unit in _MICRON_UNITS:
        factor = 1000.0
    elif unit in _NANO_UNITS:
        factor = 1.0
    else:
        factor = 1000.0 if max(values) < 100 else 1.0
    return [w * factor for w in values]


def truncate(query: np.ndarray, library: np.ndarray) -> tuple[np.ndarray, np.ndarray, Alignment]:
    """The historical behaviour: clip both to their shorter band count.

    Only correct when the two grids are already the same. Kept as an explicit, recorded fallback
    for libraries whose header carries no wavelengths at all.
    """
    n = min(query.shape[0], library.shape[1])
    if n <= 0:
        raise AlignmentError("No overlapping bands for classification")
    return (
        query[:n],
        library[:, :n],
        Alignment(
            mode="truncate",
            n_bands=n,
            warnings=[
                "Compared band-by-band without wavelength information. Results are only "
                "meaningful if the query and the library share a sampling grid."
            ],
        ),
    )


def resample(
    query: np.ndarray,
    query_nm: list[float],
    library: np.ndarray,
    library_nm: list[float],
) -> tuple[np.ndarray, np.ndarray, Alignment]:
    """Interpolate the library onto the part of the query grid the two share.

    The query is never resampled — it is the measurement — so the result stays on the cube's own
    grid, restricted to the overlap. Interpolation never extrapolates beyond the library's range.
    """
    low = max(min(query_nm), min(library_nm))
    high = min(max(query_nm), max(library_nm))
    if high <= low:
        raise AlignmentError(
            f"No spectral overlap: the query covers {min(query_nm):.1f}-{max(query_nm):.1f} nm "
            f"and the library covers {min(library_nm):.1f}-{max(library_nm):.1f} nm"
        )

    keep = [i for i, w in enumerate(query_nm) if low <= w <= high]
    grid = [query_nm[i] for i in keep]
    if len(grid) < MIN_OVERLAP_BANDS or len(grid) < MIN_OVERLAP_FRACTION * len(query_nm):
        raise AlignmentError(
            f"Spectral overlap is too small to classify: {len(grid)} of {len(query_nm)} query "
            f"bands fall within {low:.1f}-{high:.1f} nm"
        )

    # np.interp requires an increasing x; ENVI libraries are not guaranteed to be sorted.
    order = np.argsort(library_nm)
    xp = np.asarray(library_nm, dtype=float)[order]
    resampled = np.vstack([np.interp(grid, xp, row[order]) for row in library])

    warnings: list[str] = []
    if len(grid) < len(query_nm):
        warnings.append(
            f"{len(query_nm) - len(grid)} query band(s) fall outside the library's range and "
            "were excluded."
        )
    return (
        query[keep],
        resampled,
        Alignment(mode="resample", n_bands=len(grid), overlap_nm=(low, high), warnings=warnings),
    )


def align(
    query: np.ndarray,
    query_nm: list[float],
    library: np.ndarray,
    library_nm: list[float],
    mode: str = "resample",
) -> tuple[np.ndarray, np.ndarray, Alignment]:
    """Align by wavelength when both grids are known, otherwise fall back to truncation."""
    if mode == "truncate":
        return truncate(query, library)
    if not query_nm or not library_nm:
        # A library header with no wavelengths is not a reason to refuse outright — plenty of
        # existing ones are like that — but the fallback has to be recorded, not silent.
        _q, _lib, alignment = truncate(query, library)
        alignment.warnings.insert(
            0,
            "Wavelengths are missing from the "
            + ("query" if not query_nm else "library")
            + "; fell back to band-by-band truncation.",
        )
        return _q, _lib, alignment
    return resample(query, query_nm, library, library_nm)
