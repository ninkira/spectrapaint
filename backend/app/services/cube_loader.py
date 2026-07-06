import os
from functools import lru_cache
from pathlib import Path

from spectral import io as spyio
import numpy as np
from typing import Dict, Any, Tuple


def _find_envi_data_file(hdr_path: str) -> str | None:
    """Locate the binary that belongs to an ENVI header (a sibling file sharing its stem).

    SpectralPython normally finds the cube itself, but uploaded files may use a data-file
    extension it does not probe by default. This lets us pass the data path explicitly.
    """
    p = Path(hdr_path)
    for cand in sorted(p.parent.glob(p.stem + ".*")):
        if cand.is_file() and cand.suffix.lower() != ".hdr":
            return str(cand)
    return None


def open_envi(hdr_path: str):
    try:
        return spyio.envi.open(hdr_path)
    except Exception:
        data = _find_envi_data_file(hdr_path)
        if data is None:
            raise
        return spyio.envi.open(hdr_path, data)

def read_metadata(img) -> Dict[str, Any]:
    md = img.metadata.copy()
    wl = md.get("wavelength", [])
    if isinstance(wl, str):
        wl = [float(x) for x in wl.strip("{}").split(",")]
    else:
        wl = [float(x) for x in wl]
    return {"width": img.ncols, "height": img.nrows, "bands": img.nbands, "wavelengths_nm": wl}


def _clean_str(v: Any) -> str | None:
    """Trim ENVI brace/whitespace noise; return None for empty values."""
    if v is None:
        return None
    s = str(v).strip().strip("{}").strip()
    return s or None


def _parse_int(v: Any) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _parse_float_list(v: Any) -> list[float] | None:
    """Parse an ENVI list value (either "{a, b, c}" or a real list) into floats."""
    if v is None:
        return None
    if isinstance(v, str):
        parts = [p.strip() for p in v.strip().strip("{}").split(",") if p.strip()]
    elif isinstance(v, (list, tuple)):
        parts = list(v)
    else:
        return None
    try:
        out = [float(p) for p in parts]
    except (TypeError, ValueError):
        return None
    return out or None


def _parse_int_list(v: Any) -> list[int] | None:
    fl = _parse_float_list(v)
    return [int(round(x)) for x in fl] if fl is not None else None


def _parse_first_float(v: Any) -> float | None:
    """ENVI "pixel size" is "{x, y, units=...}"; take the leading numeric value."""
    fl = _parse_float_list(v)
    return fl[0] if fl else None


def read_full_metadata(img) -> Dict[str, Any]:
    """Read the complete ENVI header, normalized for the dataset-info modal / JSON.

    read_metadata() returns only what the viewer needs (size + wavelengths); this returns every
    field shown in the dataset-info modal. Optional header fields missing from the file come back
    as None so the UI can render them as "—".
    """
    md = {str(k).lower(): v for k, v in img.metadata.items()}
    wl = _parse_float_list(md.get("wavelength")) or []
    return {
        "samples": int(img.ncols),
        "lines": int(img.nrows),
        "number_of_bands": int(img.nbands),
        "wavelengths": wl,
        "wavelength_units": str(md.get("wavelength units", "nm") or "nm"),
        "fwhm": _parse_float_list(md.get("fwhm")),
        "interleave": (str(md["interleave"]).upper() if md.get("interleave") else None),
        "data_type": _parse_int(md.get("data type")),
        "default_bands": _parse_int_list(md.get("default bands")),
        "pixel_size": _parse_first_float(md.get("pixel size")),
        "sensor_type": _clean_str(md.get("sensor type")),
        "description": _clean_str(md.get("description")),
        "file_type": _clean_str(md.get("file type")),
        "header_offset": _parse_int(md.get("header offset")),
        "spectral_range_min": (min(wl) if wl else None),
        "spectral_range_max": (max(wl) if wl else None),
    }

def load_cube(img):
    return np.asarray(img.load(), dtype=np.float32)   # (H, W, B)


@lru_cache(maxsize=2)
def get_cube(hdr_path: str, _mtime_ns: int = 0) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Open ENVI, read metadata, load cube — cached by HDR path + mtime."""
    img = open_envi(hdr_path)
    md = read_metadata(img)
    cube = np.asarray(img.load(), dtype=np.float32)
    return cube, md


def get_cube_for_path(hdr_path: str) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Load cube with automatic mtime-based cache invalidation."""
    return get_cube(hdr_path, os.stat(hdr_path).st_mtime_ns)

def nearest_band_idx(wl, nm): return int(np.abs(wl - nm).argmin())

def extract_rgb(cube, wl, r, g, b):
    wl = np.asarray(wl, dtype=np.float32)
    return np.stack([cube[..., nearest_band_idx(wl, r)],
                     cube[..., nearest_band_idx(wl, g)],
                     cube[..., nearest_band_idx(wl, b)]], axis=-1)

def downsample2(arr, factor=4): return arr[::factor, ::factor, ...] if factor > 1 else arr
