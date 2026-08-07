"""Putting a query spectrum and a reference library on the same wavelength grid."""
from __future__ import annotations

import numpy as np
import pytest

from app.core.spectra.alignment import (
    AlignmentError,
    align,
    resample,
    to_nanometres,
    truncate,
)


# --- unit normalisation ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("wavelengths", "units", "expected"),
    [
        ([400.0, 700.0], "nm", [400.0, 700.0]),
        ([0.4, 0.7], "um", [400.0, 700.0]),
        ([0.4, 0.7], "Micrometers", [400.0, 700.0]),
        ([400.0, 700.0], None, [400.0, 700.0]),   # magnitude fallback: already nm
        ([0.4, 0.7], None, [400.0, 700.0]),       # magnitude fallback: micrometres
        ([], "nm", []),
    ],
)
def test_to_nanometres(wavelengths, units, expected):
    assert to_nanometres(wavelengths, units) == expected


# --- resampling ------------------------------------------------------------------------------


def test_identical_grids_pass_through_unchanged():
    grid = [400.0, 500.0, 600.0]
    query = np.array([1.0, 2.0, 3.0])
    library = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])

    q, lib, alignment = resample(query, grid, library, grid)

    assert np.allclose(q, query)
    assert np.allclose(lib, library)
    assert alignment.mode == "resample"
    assert alignment.n_bands == 3
    assert alignment.warnings == []


def test_library_is_interpolated_onto_the_query_grid():
    """The query is the measurement, so it is the library that moves."""
    query = np.array([1.0, 1.0, 1.0])
    # Library sampled every 100 nm; the query wants 450 and 550, which fall between its points.
    q, lib, alignment = resample(
        query, [400.0, 450.0, 550.0],
        np.array([[0.0, 10.0, 20.0]]), [400.0, 500.0, 600.0],
    )
    assert alignment.n_bands == 3
    assert np.allclose(lib[0], [0.0, 5.0, 15.0])  # linear between the bracketing samples
    assert np.allclose(q, query)


def test_query_bands_outside_the_library_range_are_dropped():
    query = np.array([1.0, 2.0, 3.0, 4.0])
    q, lib, alignment = resample(
        query, [300.0, 400.0, 500.0, 900.0],
        np.array([[1.0, 2.0]]), [400.0, 500.0],
    )
    # 300 and 900 lie outside 400-500, so only two bands survive — and nothing is extrapolated.
    assert alignment.n_bands == 2
    assert np.allclose(q, [2.0, 3.0])
    assert alignment.overlap_nm == (400.0, 500.0)
    assert any("outside the library" in w for w in alignment.warnings)


def test_unsorted_library_wavelengths_are_handled():
    """np.interp needs an increasing grid; ENVI headers do not guarantee one."""
    query = np.array([1.0, 1.0])
    _q, lib, _a = resample(
        query, [400.0, 500.0],
        np.array([[20.0, 0.0, 10.0]]), [600.0, 400.0, 500.0],
    )
    assert np.allclose(lib[0], [0.0, 10.0])


def test_disjoint_ranges_are_refused():
    """The bug this exists to prevent: 400-600 nm compared against 1000-2500 nm."""
    with pytest.raises(AlignmentError, match="No spectral overlap"):
        resample(
            np.array([1.0, 2.0]), [400.0, 600.0],
            np.array([[1.0, 2.0]]), [1000.0, 2500.0],
        )


def test_a_sliver_of_overlap_is_refused():
    query_grid = [float(400 + 10 * i) for i in range(20)]  # 400-590
    with pytest.raises(AlignmentError, match="too small"):
        resample(
            np.ones(20), query_grid,
            np.array([[1.0, 2.0]]), [580.0, 900.0],  # only 580 and 590 overlap: 2 of 20
        )


# --- truncation fallback -----------------------------------------------------------------------


def test_truncate_clips_both_to_the_shorter_band_count():
    q, lib, alignment = truncate(np.array([1.0, 2.0, 3.0]), np.array([[1.0, 2.0]]))
    assert len(q) == 2
    assert lib.shape == (1, 2)
    assert alignment.mode == "truncate"
    assert alignment.warnings  # never silent


def test_align_falls_back_to_truncation_without_library_wavelengths():
    """Plenty of existing ENVI libraries carry no wavelengths; that must not be fatal."""
    _q, _lib, alignment = align(
        np.array([1.0, 2.0]), [400.0, 500.0], np.array([[1.0, 2.0]]), []
    )
    assert alignment.mode == "truncate"
    assert any("Wavelengths are missing" in w for w in alignment.warnings)


def test_align_honours_an_explicit_truncate_request():
    _q, _lib, alignment = align(
        np.array([1.0, 2.0]), [400.0, 500.0],
        np.array([[1.0, 2.0]]), [1000.0, 2000.0],  # would otherwise be refused
        mode="truncate",
    )
    assert alignment.mode == "truncate"


def test_alignment_serialises_for_provenance():
    _q, _lib, alignment = resample(
        np.array([1.0, 2.0]), [400.0, 500.0], np.array([[1.0, 2.0]]), [400.0, 500.0]
    )
    assert alignment.as_dict() == {
        "mode": "resample",
        "n_bands": 2,
        "overlap_nm": [400.0, 500.0],
        "warnings": [],
    }
