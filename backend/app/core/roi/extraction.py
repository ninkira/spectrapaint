"""Spectral extraction — the first Transform step of the ETL pipeline.

Defining an ROI on a hyperspectral cube triggers extraction of the mean reflectance, standard
deviation and pixel count for that region, persisted as a `prov:Entity` derived from the parent
cube. It is what a classification later consumes, so it has to be a stored product rather than
something the browser recomputes each time.

External inputs are deliberately skipped: XRF and RGB rasters enter the pipeline for cross-modal
annotation only and carry no spectra to extract.
"""
from __future__ import annotations

import logging
import uuid

import numpy as np
from sqlalchemy.orm import Session

from ...db.ids import stable_id
from ...db.models import HsiCube, RoiAnnotation, SpectralExtraction
from ...paths import storage
from ...services.cube_loader import get_cube_for_path
from ...services.spectra_region import region_stats
from .geometry import EmptyRegionError, roi_pixel_mask

logger = logging.getLogger(__name__)


def extraction_id_for(roi_id: uuid.UUID | str) -> uuid.UUID:
    return stable_id("extraction", str(roi_id))


def _wavelength_range(wavelengths: list[float] | None) -> str | None:
    if not wavelengths:
        return None
    return f"{min(wavelengths):.1f}-{max(wavelengths):.1f} nm"


def ensure_extraction(
    db: Session,
    roi: RoiAnnotation,
    cube: HsiCube | None,
    *,
    recompute: bool = False,
) -> SpectralExtraction | None:
    """Persist the spectral statistics for `roi`, or return the existing row.

    Recomputes only when asked to — an unchanged ROI keeps the extraction it already has, so
    saving a dataset with thirty annotations does not re-read the cube thirty times.

    Never raises: a malformed geometry or an unreadable cube must not stop the user from saving
    an annotation. Failures are logged and leave the extraction absent.
    """
    if cube is None:
        return None  # external input — nothing spectral to extract

    extraction_id = extraction_id_for(roi.roi_id)
    existing = db.get(SpectralExtraction, extraction_id)
    # `pixel_count == 0` marks a placeholder written by a classification run on an ROI that was
    # never measured — it carries a client-supplied mean and no statistics. Treat that as absent
    # so the first real save fills it in, rather than preserving it forever.
    if existing is not None and existing.pixel_count and not recompute:
        return existing

    try:
        data, _md = get_cube_for_path(str(storage.resolve(cube.data_ref)))
        height, width, _bands = data.shape
        ys, xs = roi_pixel_mask(roi.data or {}, width, height)
        if len(ys) == 0:
            raise EmptyRegionError("ROI covers no pixels")
        values = data[ys, xs, :].astype(np.float64)
    except EmptyRegionError as exc:
        logger.info("No spectral extraction for ROI %s: %s", roi.roi_id, exc)
        return None
    except Exception:
        logger.exception("Failed to extract spectra for ROI %s", roi.roi_id)
        return None

    stats = region_stats(values)
    return db.merge(SpectralExtraction(
        extraction_id=extraction_id,
        roi_id=roi.roi_id,
        # library_id stays NULL: an extraction is derived from its cube, and only a later
        # classification associates it with a reference library.
        mean_spectrum=stats["mean"],
        std_spectrum=stats["std"],
        min_spectrum=stats["min"],
        max_spectrum=stats["max"],
        pixel_count=stats["n_pixels"],
        wavelength_range=_wavelength_range(cube.wavelengths),
    ))
