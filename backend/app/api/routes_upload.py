"""User-driven dataset upload.

The Data Manager "＋" button posts here. The endpoint:
  1. saves the uploaded bytes into the managed data folder (so the existing file-reading
     endpoints — /rgb, /visual, /metadata — work unchanged),
  2. reads what it can from the file (ENVI header for cubes, width/height for visuals),
  3. writes the DB rows (Project/Object/DataAcquisition + HsiCube or ExternalInput),
  4. invalidates the registry cache so the new dataset appears immediately.

Two shapes of upload:
  * HSI  — an ENVI header (`.hdr`) plus its binary cube (`data`). Goes under old_man/hsi/.
  * visual — a single TIFF/PNG/JPEG. The chosen target modality decides the repository folder
    (HSI→hsi, XRF→xrf, RGB→general, other→other) and is stored as the capture modality.
"""
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.ids import stable_id
from ..core.data.projects import resolve_project_and_object
from ..db.models import DataAcquisition, ExternalInput, HsiCube
from ..models.dataset_meta import DatasetMeta
from ..paths import APP_DATA_DIR, storage
from ..services.cube_loader import open_envi, read_full_metadata
from ..services.dataset_store import (
    PROJECT_ID,
    PROJECT_NAME,
    invalidate_registry_cache,
    registry,
)
from .routes_datasets import build_dataset_meta

router = APIRouter()

PROJECT_DIR = APP_DATA_DIR / PROJECT_ID
FOLDER_BY_MODALITY = {"HSI": "hsi", "XRF": "xrf", "RGB": "general", "other": "other"}
VISUAL_EXTS = {".tif", ".tiff", ".png", ".jpg", ".jpeg"}


class UploadMetadata(BaseModel):
    """Everything the upload form can capture. Only kind + target modality are required."""

    data_kind: Literal["hsi", "visual"]
    target_modality: Literal["HSI", "XRF", "RGB", "other"]
    title: str | None = None  # user-facing display label for the dataset
    # Where this dataset belongs. Both optional: omitting them lands it in the default
    # project, which is what every client did before projects existed.
    project_id: uuid.UUID | None = None
    object_id: uuid.UUID | None = None
    linked_dataset_id: str | None = None  # visual belongs to / derived from this dataset

    # External-input basics (also reused on the acquisition where the columns overlap).
    source_tool: str | None = None
    capture_date: datetime | None = None      # «EXIF»
    camera_model: str | None = None           # «EXIF»
    instrument_id: str | None = None
    operator: str | None = None
    processing_steps: str | None = None
    dc_rights: str | None = None              # «DC»
    created_at: datetime | None = None
    notes: str | None = None

    # Data-acquisition (capture session).
    captured_at: datetime | None = None
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
    exif_available: bool = False
    envi_available: bool = False


def _safe_stem(name: str) -> str:
    stem = Path(name).stem
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("_")
    return cleaned or "dataset"


def _unique_path(folder: Path, stem: str, ext: str) -> Path:
    """A non-colliding <folder>/<stem><ext>, appending _1, _2, … if needed."""
    candidate = folder / f"{stem}{ext}"
    i = 1
    while candidate.exists():
        candidate = folder / f"{stem}_{i}{ext}"
        i += 1
    return candidate


def _dataset_id_for(path: Path, project_dir: Path = PROJECT_DIR) -> str:
    """Same scheme dataset_store uses: project-relative, no suffix, '/'→'__'."""
    try:
        rel = path.resolve().relative_to(project_dir.resolve())
    except ValueError:
        rel = Path(path.name)
    return rel.with_suffix("").as_posix().replace("/", "__")


def _resolve_destination(
    db: Session, meta: "UploadMetadata", now: datetime
) -> tuple[uuid.UUID, uuid.UUID, Path]:
    """The project and object this upload belongs to, and the folder to store it under."""
    try:
        project, obj = resolve_project_and_object(db, meta.project_id, meta.object_id, now)
    except LookupError as exc:
        raise HTTPException(400, str(exc)) from exc
    return project.project_id, obj.object_id, APP_DATA_DIR / project.storage_root


def _make_acquisition(
    meta: UploadMetadata, object_uuid: uuid.UUID, modality: str, envi: bool
) -> DataAcquisition:
    return DataAcquisition(
        acquisition_id=uuid.uuid4(),
        object_id=object_uuid,
        capture_modality=modality,
        captured_at=meta.captured_at,
        instrument_id=meta.instrument_id,
        instrument_settings=meta.instrument_settings,
        illumination_type=meta.illumination_type,
        illumination_source=meta.illumination_source,
        illumination_notes=meta.illumination_notes,
        temperature=meta.temperature,
        distance_to_object=meta.distance_to_object,
        instrument_position=meta.instrument_position,
        scan_duration=meta.scan_duration,
        dark_reference=meta.dark_reference,
        white_reference=meta.white_reference,
        calibration_ref=meta.calibration_ref,
        preprocessing_notes=meta.preprocessing_notes,
        software_version=meta.software_version,
        operator=meta.operator,
        exif_available=meta.exif_available,
        envi_available=envi or meta.envi_available,
        notes=meta.notes,
    )


def _save_upload(upload: UploadFile, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        f.write(upload.file.read())


def _meta_or_400(id_: str) -> DatasetMeta:
    rec = registry().get(id_)
    meta = build_dataset_meta(id_, rec) if rec else None
    if meta is None:
        raise HTTPException(500, "Upload saved but the dataset could not be read back")
    return meta


def _handle_hsi(
    db: Session, meta: UploadMetadata, header: UploadFile, data: UploadFile, now: datetime,
) -> DatasetMeta:
    if data is None:
        raise HTTPException(400, "An ENVI upload needs both the .hdr header and its binary cube")
    _project_uuid, object_uuid, project_dir = _resolve_destination(db, meta, now)
    folder = project_dir / "hsi"
    stem = _safe_stem(header.filename or "cube")
    hdr_path = _unique_path(folder, stem, ".hdr")
    data_ext = Path(data.filename or "").suffix or ".img"
    data_path = hdr_path.with_suffix(data_ext)  # same stem so open_envi() finds it

    _save_upload(header, hdr_path)
    _save_upload(data, data_path)

    try:
        full = read_full_metadata(open_envi(str(hdr_path)))
    except Exception as exc:
        hdr_path.unlink(missing_ok=True)
        data_path.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not read the ENVI header: {exc}") from exc

    acq = _make_acquisition(meta, object_uuid, modality="HSI", envi=True)
    db.add(acq)

    dataset_id = _dataset_id_for(hdr_path, project_dir)
    db.merge(HsiCube(
        cube_id=stable_id("cube", dataset_id),
        acquisition_id=acq.acquisition_id,
        data_ref=storage.relativise(hdr_path),
        dataset_id=dataset_id,
        title=(meta.title.strip() if meta.title and meta.title.strip() else None),
        created_at=now,
        samples=full["samples"],
        lines=full["lines"],
        number_of_bands=full["number_of_bands"],
        wavelengths=full["wavelengths"],
        wavelength_units=full["wavelength_units"],
        fwhm=full["fwhm"],
        interleave=full["interleave"],
        data_type=full["data_type"],
        default_bands=full["default_bands"],
        pixel_size=full["pixel_size"],
        sensor_type=full["sensor_type"],
        description=full["description"],
        file_type=full["file_type"],
        header_offset=full["header_offset"],
        spectral_range_min=full["spectral_range_min"],
        spectral_range_max=full["spectral_range_max"],
    ))
    db.commit()
    invalidate_registry_cache()
    return _meta_or_400(dataset_id)


def _handle_visual(
    db: Session, meta: UploadMetadata, file: UploadFile, now: datetime,
) -> DatasetMeta:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in VISUAL_EXTS:
        raise HTTPException(400, f"Unsupported visual file type: {ext or '(none)'}")

    project_uuid, object_uuid, project_dir = _resolve_destination(db, meta, now)
    folder = project_dir / FOLDER_BY_MODALITY[meta.target_modality]
    stem = _safe_stem(file.filename or "image")
    dest = _unique_path(folder, stem, ext)
    _save_upload(file, dest)

    try:
        with Image.open(dest) as im:
            width, height = im.size
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not open the image: {exc}") from exc

    acq = _make_acquisition(meta, object_uuid, modality=meta.target_modality, envi=False)
    db.add(acq)

    dataset_id = _dataset_id_for(dest, project_dir)
    db.merge(ExternalInput(
        input_id=stable_id("input", dataset_id),
        project_id=project_uuid,
        acquisition_id=acq.acquisition_id,
        dataset_id=dataset_id,
        title=(meta.title.strip() if meta.title and meta.title.strip() else None),
        linked_dataset_id=meta.linked_dataset_id or None,
        source_tool=meta.source_tool or "user upload",
        capture_modality=meta.target_modality,
        file_format=ext.lstrip("."),
        width=width,
        height_px=height,
        data_ref=storage.relativise(dest),
        capture_date=meta.capture_date,
        camera_model=meta.camera_model,
        instrument_id=meta.instrument_id,
        operator=meta.operator,
        processing_steps=meta.processing_steps,
        dc_rights=meta.dc_rights,
        created_at=meta.created_at,
        imported_at=now,
        notes=meta.notes,
    ))
    db.commit()
    invalidate_registry_cache()
    return _meta_or_400(dataset_id)


@router.post("/datasets/upload", response_model=DatasetMeta)
def upload_dataset(
    metadata: str = Form(...),
    file: UploadFile = File(...),
    data: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    """Register a user-uploaded dataset (HSI cube or visual) — file bytes + DB rows."""
    try:
        meta = UploadMetadata.model_validate(json.loads(metadata))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(422, f"Invalid metadata: {exc}") from exc

    now = datetime.now(timezone.utc)
    if meta.data_kind == "hsi":
        return _handle_hsi(db, meta, file, data, now)
    return _handle_visual(db, meta, file, now)
