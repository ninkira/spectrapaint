"""User-driven dataset upload.

The Data Manager "＋" button posts here. The endpoint:
  1. saves the uploaded bytes into the managed data folder (so the existing file-reading
     endpoints — /rgb, /visual, /metadata — work unchanged),
  2. reads what it can from the file (ENVI header for cubes, width/height for visuals),
  3. writes the DB rows (Project/Object/DataAcquisition + HsiCube or ExternalInput),
  4. invalidates the registry cache so the new dataset appears immediately.

Two shapes of upload:
  * HSI  — an ENVI header (`.hdr`) plus its binary cube (`data`, typically `.dat`/`.img`/`.raw`).
    Goes under old_man/hsi/.
  * visual — a single TIFF/PNG/JPEG. The chosen target modality decides the repository folder
    (HSI→hsi, XRF→xrf, RGB→general, other→other) and is stored as the capture modality.
"""
import json
import re
import shutil
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
from ..core.preprocessing.reflectance import (
    ReferenceMismatch,
    open_cube,
    write_reflectance_cube,
)
from ..models.dataset_meta import DatasetMeta
from ..paths import APP_DATA_DIR, storage
from ..services.cube_loader import read_full_metadata
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
    # Flat-field the cube against the uploaded reference captures and register the corrected
    # result alongside it. Needs at least a dark and a white reference.
    convert_to_reflectance: bool = False
    # What the uploaded cube already is. Nothing in an ENVI header distinguishes radiance from
    # reflectance, so this is the user's claim about their own data, recorded as given.
    processing_level: Literal["radiance", "reflectance"] | None = None
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


def _unique_path(folder: Path, stem: str, ext: str, *, also: str | None = None) -> Path:
    """A non-colliding <folder>/<stem><ext>, appending _1, _2, … if needed.

    `also` is a second extension that has to be free as well: an ENVI pair is only safely named
    when both the header and its binary are, and a binary left behind by a removed dataset would
    otherwise be silently overwritten by the next upload that happens to share its stem.
    """
    i = 0
    while True:
        candidate = folder / (f"{stem}{ext}" if i == 0 else f"{stem}_{i}{ext}")
        if not candidate.exists() and (also is None or not candidate.with_suffix(also).exists()):
            return candidate
        i += 1


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
    """Copy the upload to `dest` in chunks — an HSI cube binary can be several gigabytes, which
    is more than we want to hold in memory just to hand it straight to the filesystem."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    upload.file.seek(0)
    with open(dest, "wb") as f:
        shutil.copyfileobj(upload.file, f, length=4 * 1024 * 1024)


def _meta_or_400(id_: str) -> DatasetMeta:
    rec = registry().get(id_)
    meta = build_dataset_meta(id_, rec) if rec else None
    if meta is None:
        raise HTTPException(500, "Upload saved but the dataset could not be read back")
    return meta


def _store_envi_pair(folder: Path, header: UploadFile, data: UploadFile) -> Path:
    """Save an uploaded .hdr + its binary into `folder` under a shared stem.

    Returns the header path. The two files are deliberately given the same stem: that is what
    lets `open_envi()` find the binary for an extension SpectralPython does not probe for.
    """
    stem = _safe_stem(header.filename or "cube")
    data_ext = Path(data.filename or "").suffix or ".img"
    # ENVI also writes headers as "<cube>.dat.hdr", which leaves the data extension on the stem.
    # Drop it so either convention is stored the same way — "<cube>.hdr" + "<cube>.dat" — rather
    # than as "<cube>.dat.hdr" + "<cube>.dat.dat".
    if data_ext and stem.lower().endswith(data_ext.lower()):
        stem = stem[: -len(data_ext)] or "cube"
    hdr_path = _unique_path(folder, stem, ".hdr", also=data_ext)
    _save_upload(header, hdr_path)
    _save_upload(data, hdr_path.with_suffix(data_ext))
    return hdr_path


def _discard_pair(hdr_path: Path) -> None:
    """Remove a stored .hdr and its binary — used to undo a save that could not be read back."""
    for sibling in hdr_path.parent.glob(hdr_path.stem + ".*"):
        sibling.unlink(missing_ok=True)


def _cube_row(
    *,
    dataset_id: str,
    acquisition_id: uuid.UUID,
    hdr_path: Path,
    title: str | None,
    now: datetime,
    full: dict,
    processing_level: str | None = None,
    derived_from: str | None = None,
    reference_refs: dict[str, str] | None = None,
) -> HsiCube:
    """An HsiCube row from a read ENVI header, shared by the radiance and reflectance cubes."""
    return HsiCube(
        cube_id=stable_id("cube", dataset_id),
        acquisition_id=acquisition_id,
        data_ref=storage.relativise(hdr_path),
        dataset_id=dataset_id,
        title=title,
        created_at=now,
        processing_level=processing_level,
        derived_from_dataset_id=derived_from,
        reference_refs=reference_refs,
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
    )


def _read_header_or_400(hdr_path: Path, what: str) -> dict:
    """Read a stored pair's header, discarding the pair if it cannot be read.

    Goes through `open_cube` so the mapping is released: a cube left open cannot be deleted on
    Windows, which would strand the very files this is about to clean up.
    """
    try:
        with open_cube(hdr_path) as img:
            return read_full_metadata(img)
    except Exception as exc:
        _discard_pair(hdr_path)
        raise HTTPException(400, f"Could not read the {what} ENVI header: {exc}") from exc


def _handle_hsi(
    db: Session,
    meta: UploadMetadata,
    header: UploadFile,
    data: UploadFile,
    now: datetime,
    references: dict[str, tuple[UploadFile, UploadFile]] | None = None,
) -> DatasetMeta:
    if data is None:
        raise HTTPException(400, "An ENVI upload needs both the .hdr header and its binary cube")
    references = references or {}
    _project_uuid, object_uuid, project_dir = _resolve_destination(db, meta, now)
    folder = project_dir / "hsi"
    hdr_path = _store_envi_pair(folder, header, data)
    full = _read_header_or_400(hdr_path, "cube")

    convert = meta.convert_to_reflectance
    if convert and not {"dark", "white"} <= references.keys():
        _discard_pair(hdr_path)
        raise HTTPException(
            400,
            "Converting to reflectance needs both a dark and a white reference capture "
            "(each as its own .hdr plus binary).",
        )

    acq = _make_acquisition(meta, object_uuid, modality="HSI", envi=True)
    # The flags describe the capture session, so set them from what was actually supplied.
    acq.dark_reference = acq.dark_reference or "dark" in references
    acq.white_reference = acq.white_reference or "white" in references
    db.add(acq)

    title = meta.title.strip() if meta.title and meta.title.strip() else None
    dataset_id = _dataset_id_for(hdr_path, project_dir)
    radiance_cube = db.merge(_cube_row(
        dataset_id=dataset_id,
        acquisition_id=acq.acquisition_id,
        hdr_path=hdr_path,
        title=title,
        now=now,
        full=full,
        # Converting proves this cube is radiance; otherwise record only what the user claimed.
        processing_level="radiance" if convert else meta.processing_level,
    ))

    reflectance_id: str | None = None
    if convert:
        reflectance_id, reference_refs = _write_reflectance(
            db,
            radiance_hdr=hdr_path,
            radiance_dataset_id=dataset_id,
            acquisition_id=acq.acquisition_id,
            references=references,
            folder=folder,
            project_dir=project_dir,
            title=title,
            now=now,
        )
        # The references were captured with this scan, so they are recorded on it as well as on
        # the cube derived from it: either one going away must not take the files with it.
        radiance_cube.reference_refs = reference_refs

    db.commit()
    invalidate_registry_cache()
    # The corrected cube is the one worth opening, so it is what the client gets back.
    return _meta_or_400(reflectance_id or dataset_id)


def _write_reflectance(
    db: Session,
    *,
    radiance_hdr: Path,
    radiance_dataset_id: str,
    acquisition_id: uuid.UUID,
    references: dict[str, tuple[UploadFile, UploadFile]],
    folder: Path,
    project_dir: Path,
    title: str | None,
    now: datetime,
) -> tuple[str, dict[str, str]]:
    """Flat-field the just-stored radiance cube and register the result as its own dataset.

    The reference captures are kept (under references/) rather than discarded: they are the
    evidence for how the reflectance cube was produced, and re-deriving it needs them. Their
    stored paths are returned alongside the new dataset id, and recorded on the cube rows, so
    that deleting the cubes can later reclaim files no dataset of its own points at.
    """
    ref_folder = folder / "references"
    stored: dict[str, Path] = {}
    try:
        for role, (ref_hdr, ref_data) in references.items():
            stored[role] = _store_envi_pair(ref_folder, ref_hdr, ref_data)
            _read_header_or_400(stored[role], f"{role.replace('_', '-')} reference")

        dest_hdr = _unique_path(
            folder, radiance_hdr.stem + "_reflectance", ".hdr", also=".dat"
        )
        write_reflectance_cube(
            radiance_hdr=radiance_hdr,
            dark_hdr=stored["dark"],
            white_hdr=stored["white"],
            white_dark_hdr=stored.get("white_dark"),
            dest_hdr=dest_hdr,
        )
    except ReferenceMismatch as exc:
        for path in stored.values():
            _discard_pair(path)
        _discard_pair(radiance_hdr)
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        for path in stored.values():
            _discard_pair(path)
        _discard_pair(radiance_hdr)
        raise
    except Exception as exc:
        for path in stored.values():
            _discard_pair(path)
        _discard_pair(radiance_hdr)
        raise HTTPException(400, f"Reflectance conversion failed: {exc}") from exc

    full = _read_header_or_400(dest_hdr, "reflectance")
    reference_refs = {role: storage.relativise(path) for role, path in stored.items()}
    dataset_id = _dataset_id_for(dest_hdr, project_dir)
    db.merge(_cube_row(
        dataset_id=dataset_id,
        acquisition_id=acquisition_id,
        hdr_path=dest_hdr,
        title=f"{title} (reflectance)" if title else None,
        now=now,
        full=full,
        processing_level="reflectance",
        derived_from=radiance_dataset_id,
        reference_refs=reference_refs,
    ))
    return dataset_id, reference_refs


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
    # Reference captures, each its own .hdr + binary. Specim names them DARKREF_<stem>,
    # WHITEREF_<stem> and WHITEDARKREF_<stem> beside the scan they belong to.
    dark: UploadFile | None = File(None),
    dark_data: UploadFile | None = File(None),
    white: UploadFile | None = File(None),
    white_data: UploadFile | None = File(None),
    white_dark: UploadFile | None = File(None),
    white_dark_data: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    """Register a user-uploaded dataset (HSI cube or visual) — file bytes + DB rows.

    An HSI upload carrying reference captures and `convert_to_reflectance` also writes a
    flat-field-corrected cube and registers it as a second, linked dataset.
    """
    try:
        meta = UploadMetadata.model_validate(json.loads(metadata))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(422, f"Invalid metadata: {exc}") from exc

    now = datetime.now(timezone.utc)
    if meta.data_kind == "hsi":
        references = {
            role: (hdr, binary)
            for role, hdr, binary in (
                ("dark", dark, dark_data),
                ("white", white, white_data),
                ("white_dark", white_dark, white_dark_data),
            )
            if hdr is not None and binary is not None
        }
        return _handle_hsi(db, meta, file, data, now, references)
    return _handle_visual(db, meta, file, now)
