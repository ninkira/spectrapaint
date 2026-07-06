from datetime import datetime

from pydantic import BaseModel
from typing import Literal


class DatasetMeta(BaseModel):
    id: str
    name: str
    type: Literal["hsi", "tiff", "png", "jpg"]
    path: str
    width: int
    height: int
    wavelengths_nm: list[float] | None = None


class HsiCubeMeta(BaseModel):
    """Full ENVI hyperspectral-cube metadata for the dataset-info modal.

    Mirrors the HsiCube data-model entity: identity/provenance fields plus the ENVI header. All
    fields the header may legitimately omit are optional and returned as None when absent.
    """

    # identity / provenance
    cube_id: str
    data_ref: str
    created_at: datetime | None = None
    checksum: str | None = None

    # ENVI dimensions
    samples: int          # width
    lines: int            # height
    number_of_bands: int

    # spectral
    wavelengths: list[float]
    wavelength_units: str
    fwhm: list[float] | None = None
    spectral_range_min: float | None = None
    spectral_range_max: float | None = None

    # ENVI format
    interleave: str | None = None          # BSQ | BIL | BIP
    data_type: int | None = None
    default_bands: list[int] | None = None
    pixel_size: float | None = None
    sensor_type: str | None = None
    description: str | None = None
    file_type: str | None = None
    header_offset: int | None = None
