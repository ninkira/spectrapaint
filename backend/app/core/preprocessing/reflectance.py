"""Flat-field correction — radiance (raw sensor counts) to reflectance.

A pushbroom scanner records the illumination spectrum, not the painting: a halogen source
climbs steeply into the NIR, and every detector column has its own gain and dark current. The
correction divides that out using reference captures made in the same session:

    reflectance = (radiance - dark) / (white - white_dark)

Each reference is a short capture (tens of frames) of the same detector columns, so averaging
it over its lines gives one (samples, bands) plane that applies to every line of the sample.
That is what makes this per-column rather than per-band: column-to-column gain differences
cancel along with the illumination.

`white_dark` is the dark recorded alongside the *white* capture. Specim writes it as
WHITEDARKREF_<name> and it is usually taken at a different integration time from the sample's
DARKREF_<name>, so the denominator needs its own dark rather than reusing the sample's.
When a set has no white-dark, `dark` stands in for it.
"""
from __future__ import annotations

import gc
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import Any, Iterator

import numpy as np
from spectral.io import envi

from ...services.cube_loader import open_envi

# Below this, `white - white_dark` is noise rather than signal: a dead column, or a band at the
# edge of the detector's range where the lamp puts out nothing. Dividing there manufactures huge
# values out of sensor noise, so those pixels are zeroed instead.
MIN_DENOMINATOR = 1e-6

# Lines written per block. Big enough that the vectorised divide dominates the loop overhead,
# small enough that a multi-GB cube never has to be resident in full.
ROWS_PER_BLOCK = 128


class ReferenceMismatch(ValueError):
    """A reference capture does not describe the same detector as the sample cube."""


def _release(img: Any) -> None:
    """Close the two handles a SpyFile keeps on its binary: the memory map and `fid`.

    SpectralPython has no close() — it opens `self.fid` in the constructor and closes it only in
    `__del__`, and separately memory-maps the same file. On Windows either one holds a lock, so
    a cube left open cannot afterwards be deleted, replaced, or re-uploaded under the same name.
    Waiting for the garbage collector is not good enough when the very next statement wants to
    unlink the file, so both are closed by hand.
    """
    memmap = getattr(img, "_memmap", None)
    if memmap is not None:
        underlying = getattr(memmap, "_mmap", None)
        if underlying is not None:
            underlying.close()
        try:
            img._memmap = None
        except AttributeError:
            pass
    fid = getattr(img, "fid", None)
    if fid is not None and not getattr(fid, "closed", True):
        fid.close()  # idempotent: SpyFile.__del__ closes it again later
    gc.collect()


@contextmanager
def open_cube(hdr_path: Path) -> Iterator[Any]:
    """Open an ENVI cube for the duration of the block, releasing its mapping afterwards."""
    img = open_envi(str(hdr_path))
    try:
        yield img
    finally:
        _release(img)


def average_reference(img: Any) -> np.ndarray:
    """Collapse a reference capture to a single (samples, bands) plane.

    A reference is tens to hundreds of frames of an unchanging target, so the mean over lines is
    the per-column, per-band response — and averaging is what suppresses the frame-to-frame read
    noise that would otherwise be injected into every line of the corrected cube.
    """
    data = np.asarray(img.load(), dtype=np.float32)  # (lines, samples, bands)
    return data.mean(axis=0)


def _check_shape(name: str, plane: np.ndarray, samples: int, bands: int) -> None:
    if plane.shape != (samples, bands):
        raise ReferenceMismatch(
            f"The {name} reference is {plane.shape[0]}x{plane.shape[1]} "
            f"(samples x bands) but the cube is {samples}x{bands}. "
            "References have to come from the same scanner and the same band configuration."
        )


def correction_planes(
    dark: np.ndarray, white: np.ndarray, white_dark: np.ndarray | None
) -> tuple[np.ndarray, np.ndarray]:
    """The two planes the correction needs: what to subtract, and what to divide by.

    Returns (dark, denominator). The denominator is zeroed where it falls below
    MIN_DENOMINATOR so the divide can be masked rather than producing infinities.
    """
    denominator = white - (dark if white_dark is None else white_dark)
    return dark, np.where(np.abs(denominator) < MIN_DENOMINATOR, 0.0, denominator)


def to_reflectance(radiance: np.ndarray, dark: np.ndarray, denominator: np.ndarray) -> np.ndarray:
    """(radiance - dark) / denominator, broadcasting the planes over the sample's lines.

    Values are left unclipped: specular highlights legitimately exceed 1.0, and clamping would
    hide a reference mismatch that shows up as physically impossible reflectance.
    """
    corrected = (radiance - dark) / np.where(denominator == 0.0, 1.0, denominator)
    return np.where(denominator == 0.0, 0.0, corrected).astype(np.float32)


def write_reflectance_cube(
    *,
    radiance_hdr: Path,
    dark_hdr: Path,
    white_hdr: Path,
    white_dark_hdr: Path | None,
    dest_hdr: Path,
    data_ext: str = ".dat",
) -> dict[str, Any]:
    """Correct the cube at `radiance_hdr` and write it as a float32 ENVI cube at `dest_hdr`.

    Takes paths rather than open images so that every mapping this opens is also released here:
    a caller that forgot would leave the inputs locked on Windows.

    The cube is produced a block of lines at a time. The arithmetic is the plain vectorised
    expression, but a Specim VNIR scan is several gigabytes, and holding the input, the output
    and a float32 copy of both in memory at once is what would otherwise break here.

    Returns the ENVI metadata written, so the caller can register the new cube without
    re-reading the header.
    """
    with ExitStack() as stack:
        radiance = stack.enter_context(open_cube(radiance_hdr))
        samples, bands = int(radiance.ncols), int(radiance.nbands)
        lines = int(radiance.nrows)

        dark = average_reference(stack.enter_context(open_cube(dark_hdr)))
        white = average_reference(stack.enter_context(open_cube(white_hdr)))
        white_dark = (
            average_reference(stack.enter_context(open_cube(white_dark_hdr)))
            if white_dark_hdr is not None
            else None
        )

        _check_shape("dark", dark, samples, bands)
        _check_shape("white", white, samples, bands)
        if white_dark is not None:
            _check_shape("white-dark", white_dark, samples, bands)

        dark_plane, denominator = correction_planes(dark, white, white_dark)

        metadata = {str(k): v for k, v in radiance.metadata.items()}
        metadata["data type"] = 4  # ENVI code for 32-bit float
        metadata["interleave"] = "bsq"
        metadata["description"] = "Reflectance (flat-field corrected from radiance)"

        dest_hdr.parent.mkdir(parents=True, exist_ok=True)
        out = envi.create_image(
            str(dest_hdr), metadata=metadata, dtype=np.float32, force=True,
            ext=data_ext.lstrip("."),
        )
        writer = out.open_memmap(writable=True)
        try:
            for start in range(0, lines, ROWS_PER_BLOCK):
                stop = min(start + ROWS_PER_BLOCK, lines)
                block = np.asarray(
                    radiance.read_subregion((start, stop), (0, samples)), dtype=np.float32
                )
                writer[start:stop, :, :] = to_reflectance(block, dark_plane, denominator)
        finally:
            writer.flush()
            del writer
            _release(out)

    return metadata


def dead_fraction(denominator: np.ndarray) -> float:
    """Share of (column, band) cells the correction had to zero — a reference sanity check.

    A few per mil is normal at the detector's spectral edges. A large fraction means the white
    reference is saturated, empty, or not actually a white capture.
    """
    return float(np.count_nonzero(denominator == 0.0) / denominator.size)
