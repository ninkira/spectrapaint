from functools import lru_cache

from spectral import io as spyio
import numpy as np
from typing import Dict, Any, Tuple

def open_envi(hdr_path: str):
    return spyio.envi.open(hdr_path)

def read_metadata(img) -> Dict[str, Any]:
    md = img.metadata.copy()
    wl = md.get("wavelength", [])
    if isinstance(wl, str):
        wl = [float(x) for x in wl.strip("{}").split(",")]
    else:
        wl = [float(x) for x in wl]
    return {"width": img.ncols, "height": img.nrows, "bands": img.nbands, "wavelengths_nm": wl}

def load_cube(img):
    return np.asarray(img.load())   # (H, W, B) memmap-like


@lru_cache(maxsize=4)
def get_cube(hdr_path: str) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Open ENVI, read metadata, load cube — cached by HDR path."""
    img = open_envi(hdr_path)
    md = read_metadata(img)
    cube = np.asarray(img.load())
    return cube, md

def nearest_band_idx(wl, nm): return int(np.abs(wl - nm).argmin())

def extract_rgb(cube, wl, r, g, b):
    wl = np.asarray(wl, dtype=np.float32)
    return np.stack([cube[..., nearest_band_idx(wl, r)],
                     cube[..., nearest_band_idx(wl, g)],
                     cube[..., nearest_band_idx(wl, b)]], axis=-1)

def downsample2(arr, factor=4): return arr[::factor, ::factor, ...] if factor > 1 else arr
