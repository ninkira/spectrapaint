from datetime import datetime

from pydantic import BaseModel, ConfigDict
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


class AcquisitionMeta(BaseModel):
    """DataAcquisition (capture session) fields, read straight from the DB row."""

    model_config = ConfigDict(from_attributes=True)

    capture_modality: str
    captured_at: datetime | None = None
    instrument_id: str | None = None
    instrument_settings: dict | None = None
    illumination_type: str | None = None
    illumination_source: str | None = None
    illumination_notes: str | None = None
    temperature: float | None = None
    distance_to_object: float | None = None
    instrument_position: str | None = None
    scan_duration: float | None = None
    dark_reference: bool = False
    white_reference: bool = False
    calibration_ref: str | None = None
    preprocessing_notes: str | None = None
    software_version: str | None = None
    operator: str | None = None
    exif_available: bool = False
    envi_available: bool = False
    notes: str | None = None


class ExternalInputMeta(BaseModel):
    """ExternalInput (non-HSI import) fields, read straight from the DB row."""

    model_config = ConfigDict(from_attributes=True)

    title: str | None = None
    source_tool: str
    capture_modality: str
    file_format: str
    width: int | None = None
    height_px: int | None = None
    data_ref: str
    capture_date: datetime | None = None
    camera_model: str | None = None
    instrument_id: str | None = None
    operator: str | None = None
    processing_steps: str | None = None
    dc_rights: str | None = None
    created_at: datetime | None = None
    imported_at: datetime
    notes: str | None = None
    linked_dataset_id: str | None = None


class DatasetDbMeta(BaseModel):
    """DB-stored metadata for a dataset — the acquisition session and (for visuals) the import row.

    Powers the extra tabs in the dataset-info modal (the HSI cube's ENVI metadata still comes from
    the header via HsiCubeMeta).
    """

    acquisition: AcquisitionMeta | None = None
    external: ExternalInputMeta | None = None
