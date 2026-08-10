import io
import json
import os
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from PIL import Image
from pydantic import BaseModel
from sqlalchemy.orm import Session


from ..core.roi.extraction import ensure_extraction, extraction_id_for
from ..db.database import get_db
from ..db.ids import stable_id
from ..db.models import (
    DataAcquisition,
    ExternalInput,
    HsiCube,
    ProcessingOperation,
    RoiAnnotation,
    SpectralExtraction,
)
from ..models.dataset_meta import (
    AcquisitionMeta,
    DatasetDbMeta,
    DatasetMeta,
    ExternalInputMeta,
    HsiCubeMeta,
)
from ..paths import APP_DATA_DIR
from ..services.cube_loader import (
    _find_envi_data_file,
    downsample2,
    extract_rgb,
    get_cube_for_path,
    open_envi,
    read_full_metadata,
    read_metadata,
)
from ..services.dataset_store import (
    get_dataset_record_or_404,
    invalidate_registry_cache,
    registry,
)
from ..services.image_ops import percent_stretch, png_bytes

router = APIRouter()
DATA_ROOT = APP_DATA_DIR
PROJECT_ROOT = DATA_ROOT / "old_man"
ANNOTATIONS_DIR = PROJECT_ROOT / "annotations"

# for loading visualisations created in third-party-software
SUPPORTED_VISUAL_EXTS = {".tif", ".tiff", ".png", ".jpg", ".jpeg"}


def is_visual_file(path: str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_VISUAL_EXTS


def read_visual_metadata(path: str) -> dict:
    """
    Opens TIFF/PNG/JPEG and returns basic metadata (width/height).
    """
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    if not is_visual_file(path):
        raise HTTPException(status_code=400, detail=f"Unsupported visual file type: {path}")

    try:
        with Image.open(path) as im:
            width, height = im.size
        return {"width": width, "height": height}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not open image: {exc}") from exc


def visual_to_png_bytes(path: str) -> bytes:
    """
    Opens TIFF/PNG/JPEG and converts to PNG bytes for browser display.
    """
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    if not is_visual_file(path):
        raise HTTPException(status_code=400, detail=f"Unsupported visual file type: {path}")

    try:
        with Image.open(path) as im:
            # Normalize for consistent web rendering
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")

            buf = io.BytesIO()
            im.save(buf, format="PNG")
            return buf.getvalue()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not render image: {exc}") from exc


def _resize_to_max_width(im: Image.Image, max_w: int | None) -> Image.Image:
    if not max_w or max_w <= 0:
        return im
    if im.width <= max_w:
        return im
    scale = max_w / float(im.width)
    new_h = max(1, int(im.height * scale))
    return im.resize((max_w, new_h), Image.Resampling.LANCZOS)


def _mtime_ns(path: str) -> int:
    return os.stat(path).st_mtime_ns


@lru_cache(maxsize=256)
def _cached_visual_png_bytes(path: str, path_mtime_ns: int, max_w: int | None) -> bytes:
    del path_mtime_ns  # part of cache key for invalidation on file changes
    with Image.open(path) as im:
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")
        im = _resize_to_max_width(im, max_w)
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue()


@lru_cache(maxsize=128)
def _cached_hsi_rgb_bytes(
    hdr_path: str,
    hdr_mtime_ns: int,
    r: float,
    g: float,
    b: float,
    stretch: str,
) -> bytes:
    del hdr_mtime_ns  # part of cache key for invalidation on file changes
    cube, md = get_cube_for_path(hdr_path)
    wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, r, g, b)
    rgb8 = percent_stretch(rgb) if stretch.startswith("percent") else rgb.astype("uint8")
    return png_bytes(rgb8)



def _read_visual_size(path: str) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.width, im.height


def _to_relative_project_path(path: str) -> str:
    """Path relative to the PROJECT folder, for `DatasetMeta.path`.

    Deliberately not `storage.relativise`, which is relative to the data root. This value feeds
    `buildLayerTree` in the frontend, which splits it on "/" to build the Data Manager tree, so
    rebasing it would insert a project level into that tree. That is the right end state, but it
    belongs with the change that removes the hardcoded project and adds a project selector —
    not here, where it would just be an unexplained extra folder.
    """
    p = Path(path).resolve()
    try:
        return p.relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return p.as_posix()


def _safe_annotation_file_name(dataset_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", dataset_id) + ".annotations.json"


def _annotation_file_path(dataset_id: str) -> Path:
    return ANNOTATIONS_DIR / _safe_annotation_file_name(dataset_id)


class DatasetAnnotationsPayload(BaseModel):
    annotations: list[dict]

def build_dataset_meta(id_: str, rec: dict) -> DatasetMeta | None:
    """Build a DatasetMeta from a registry record, or None if its file is missing.

    Shared by the list endpoint and the upload endpoint (so a freshly uploaded dataset comes back
    in exactly the same shape the UI already renders).
    """
    name = rec.get("name", id_)
    hdr = rec.get("envi_hdr")

    if hdr:
        if not os.path.exists(hdr):
            return None
        md = read_metadata(open_envi(hdr))
        return DatasetMeta(
            id=id_,
            name=name,
            type="hsi",
            path=_to_relative_project_path(hdr),
            width=md["width"],
            height=md["height"],
            wavelengths_nm=md["wavelengths_nm"],
        )

    visual_path = rec.get("tiff") or rec.get("png") or rec.get("jpg")
    if visual_path:
        if not os.path.exists(visual_path):
            return None
        width, height = _read_visual_size(visual_path)
        ext = Path(visual_path).suffix.lower()
        if ext in (".tif", ".tiff"):
            vtype = "tiff"
        elif ext == ".png":
            vtype = "png"
        else:
            vtype = "jpg"
        return DatasetMeta(
            id=id_,
            name=name,
            type=vtype,
            path=_to_relative_project_path(visual_path),
            width=width,
            height=height,
            wavelengths_nm=None,
        )

    return None


# General calls
@router.get("/datasets", response_model=list[DatasetMeta])
def list_datasets():
    out: list[DatasetMeta] = []
    for id_, rec in registry().items():
        meta = build_dataset_meta(id_, rec)
        if meta is not None:
            out.append(meta)
    return out


@router.get("/datasets/{id}/metadata", response_model=HsiCubeMeta)
def dataset_metadata(id: str):
    """Full ENVI-cube metadata for the dataset-info modal (HSI datasets only).

    Read straight from the ENVI header so every field is available — the DB HsiCube mirror only
    stores a subset. `cube_id` matches the deterministic id used by the DB sync; `created_at`
    is the header file's modification time. `checksum` is not computed here (it would mean
    hashing the whole cube on every open) and is returned as None.
    """
    rec = get_dataset_record_or_404(id)
    hdr = rec.get("envi_hdr")
    if not hdr:
        raise HTTPException(status_code=400, detail="Metadata is available for HSI datasets only")
    if not os.path.exists(hdr):
        raise HTTPException(status_code=404, detail=f"Header file not found: {hdr}")

    full = read_full_metadata(open_envi(hdr))
    created_at = datetime.fromtimestamp(os.stat(hdr).st_mtime, tz=timezone.utc)
    return HsiCubeMeta(
        cube_id=str(stable_id("cube", id)),
        data_ref=_to_relative_project_path(hdr),
        created_at=created_at,
        checksum=None,
        **full,
    )


@router.get("/datasets/{id}/db-meta", response_model=DatasetDbMeta)
def dataset_db_meta(id: str, db: Session = Depends(get_db)):
    """DB-stored metadata for the dataset-info tabs: the capture session (DataAcquisition) and,
    for a visual, its import row (ExternalInput). The HSI cube's ENVI metadata is served separately
    by /metadata (read from the header)."""
    rec = get_dataset_record_or_404(id)
    acquisition = None
    external = None

    if rec.get("envi_hdr"):
        cube = db.get(HsiCube, stable_id("cube", id))
        acq_id = cube.acquisition_id if cube is not None else None
    else:
        inp = db.get(ExternalInput, stable_id("input", id))
        if inp is not None:
            external = ExternalInputMeta.model_validate(inp)
        acq_id = inp.acquisition_id if inp is not None else None

    if acq_id is not None:
        acq = db.get(DataAcquisition, acq_id)
        if acq is not None:
            acquisition = AcquisitionMeta.model_validate(acq)

    return DatasetDbMeta(acquisition=acquisition, external=external)


@router.get("/datasets/{id}/thumbnail")
def thumbnail(id: str, scale: int = Query(8, ge=1)):
    rec = get_dataset_record_or_404(id)
    hdr = rec.get("envi_hdr")
    if not hdr:
        raise HTTPException(status_code=400, detail="Thumbnail endpoint supports HSI datasets only")
    cube, md = get_cube_for_path(hdr)
    wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, 650, 550, 450)
    rgb = downsample2(rgb, scale)
    return Response(content=png_bytes(percent_stretch(rgb)), media_type="image/png")


@router.get("/datasets/{id}/rgb")
def rgb(id: str, r: float = 650, g: float = 550, b: float = 450, stretch: str = "percent_2"):
    rec = get_dataset_record_or_404(id)
    hdr = rec.get("envi_hdr")
    if not hdr:
        raise HTTPException(status_code=400, detail="RGB endpoint supports HSI datasets only")
    content = _cached_hsi_rgb_bytes(hdr, _mtime_ns(hdr), r, g, b, stretch)
    return Response(content=content, media_type="image/png")

@router.get("/datasets/{id}/visual")
def visual(id: str, max_w: int | None = Query(default=None, ge=64, le=8192)):
    rec = get_dataset_record_or_404(id)
    visual_path = rec.get("tiff") or rec.get("png") or rec.get("jpg")
    if not visual_path:
        raise HTTPException(status_code=404, detail="No TIFF/PNG/JPEG visual for this dataset")
    if not is_visual_file(visual_path):
        raise HTTPException(status_code=400, detail=f"Unsupported visual file type: {visual_path}")
    content = _cached_visual_png_bytes(visual_path, _mtime_ns(visual_path), max_w)
    return Response(content=content, media_type="image/png")


def _delete_dataset_records(db: Session, dataset_id: str, rec: dict) -> list[str]:
    """Delete a dataset's DB rows and return the on-disk file paths to remove.

    Order matters because SQLite foreign-key enforcement is ON (see db.database):
      1. clear the dataset's annotations, and the spectral extractions they triggered — first
         detaching any classification run (ProcessingOperation) that referenced an extraction, so
         the run history survives rather than blocking the delete;
      2. delete the cube / external input;
      3. delete its DataAcquisition only if nothing else still points at it (old datasets shared
         one acquisition; uploads each get a dedicated one).
    """
    roi_ids = [
        r[0] for r in db.query(RoiAnnotation.roi_id)
        .filter(RoiAnnotation.dataset_id == dataset_id).all()
    ]
    if roi_ids:
        _detach_operations_from_roi_extractions(db, roi_ids)
        db.query(SpectralExtraction).filter(
            SpectralExtraction.roi_id.in_(roi_ids)
        ).delete(synchronize_session=False)
        db.query(RoiAnnotation).filter(
            RoiAnnotation.roi_id.in_(roi_ids)
        ).delete(synchronize_session=False)
        db.flush()

    files: list[str] = []
    acquisition_ids: set = set()

    hdr = rec.get("envi_hdr")
    if hdr:
        cube = db.get(HsiCube, stable_id("cube", dataset_id))
        if cube is not None:
            if cube.acquisition_id:
                acquisition_ids.add(cube.acquisition_id)
            db.delete(cube)
        files.append(hdr)
        data_file = _find_envi_data_file(hdr)
        if data_file:
            files.append(data_file)
    else:
        visual_path = rec.get("tiff") or rec.get("png") or rec.get("jpg")
        inp = db.get(ExternalInput, stable_id("input", dataset_id))
        if inp is not None:
            if inp.acquisition_id:
                acquisition_ids.add(inp.acquisition_id)
            db.delete(inp)
        if visual_path:
            files.append(visual_path)
    db.flush()

    for acq_id in acquisition_ids:
        still_used = (
            db.query(HsiCube).filter(HsiCube.acquisition_id == acq_id).count()
            + db.query(ExternalInput).filter(ExternalInput.acquisition_id == acq_id).count()
        )
        if still_used == 0:
            acq = db.get(DataAcquisition, acq_id)
            if acq is not None:
                db.delete(acq)

    return files


@router.delete("/datasets/{id}")
def delete_dataset(id: str, db: Session = Depends(get_db)):
    """Remove a dataset: its DB rows (annotations, cube/input, orphaned acquisition) and file(s)."""
    rec = get_dataset_record_or_404(id)
    files = _delete_dataset_records(db, id, rec)
    db.commit()
    invalidate_registry_cache()
    # Files are removed only after the DB commit (the DB is the source of truth for the listing).
    for path in files:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass
    return {"ok": True, "id": id}


def _load_legacy_annotations(dataset_id: str) -> list[dict]:
    """Read annotations from the old per-dataset JSON file, if present (used for migration)."""
    file_path = _annotation_file_path(dataset_id)
    if not file_path.exists():
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return []
    anns = raw.get("annotations") if isinstance(raw, dict) else None
    return [a for a in anns if isinstance(a, dict)] if isinstance(anns, list) else []


def _parse_dt(value: object) -> datetime | None:
    """Parse an ISO-8601 timestamp string into a datetime, tolerating a trailing 'Z'."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _kind_to_motivation(kind: object) -> str:
    """Map the app's annotation kind to a WADM motivation."""
    return "identifying" if kind == "probe" else "highlighting"


def _motivation_to_str(item: dict) -> str:
    """WADM motivation column value.

    Standard WADM usually carries a single motivation; this app allows the user to pick
    several. The frontend sends them as a list, which we join into one space-separated string
    for the column (the full list is preserved in `data`). Storing the joined string is a
    deliberate for-now choice — good enough for display/filtering. Falls back to the
    kind-derived default when nothing was chosen; also tolerates a legacy single-string value.
    """
    motivation = item.get("motivation")
    if isinstance(motivation, (list, tuple)):
        joined = " ".join(str(m).strip() for m in motivation if str(m).strip())
        if joined:
            return joined
    elif isinstance(motivation, str) and motivation.strip():
        return motivation.strip()
    return _kind_to_motivation(item.get("kind"))


def _geometry_to_svg(ann: dict) -> str:
    """Render the annotation geometry as an SVG fragment (the WADM SvgSelector value)."""
    geom = ann.get("geometry") or {}
    shape = ann.get("type")
    try:
        if shape == "rect":
            return f'<rect x="{geom["x"]}" y="{geom["y"]}" width="{geom["w"]}" height="{geom["h"]}"/>'
        if shape == "ellipse":
            return f'<ellipse cx="{geom["cx"]}" cy="{geom["cy"]}" rx="{geom["rx"]}" ry="{geom["ry"]}"/>'
        if shape == "polygon":
            pts = " ".join(f'{p["x"]},{p["y"]}' for p in geom.get("vertices", []))
            return f'<polygon points="{pts}"/>'
        if shape == "line":
            pts = " ".join(f'{p["x"]},{p["y"]}' for p in geom.get("points", []))
            return f'<polyline points="{pts}"/>'
        if shape == "point":
            return f'<circle cx="{geom["x"]}" cy="{geom["y"]}" r="1"/>'
    except (KeyError, TypeError):
        pass
    return json.dumps({"type": shape, "geometry": geom})  # fallback: keep it, non-SVG


def _roi_column_values(
    dataset_id: str, ann: dict, cube: "HsiCube | None", external: "ExternalInput | None"
) -> tuple[uuid.UUID, dict]:
    """Map a frontend annotation object onto the WADM RoiAnnotation columns.

    An ROI targets exactly one source: the cube it was drawn on, or the raster input. Whichever
    it is gets the FK, and the WADM `target` becomes that row's IRI `urn:uuid:{id}`. The full
    original object is also stored in `data` so the UI round-trips losslessly (WADM has no slot
    for structured geometry, colour, group id, etc.).

    Returns the ROI id separately from the column payload so the same mapping can either build
    a new row or be applied on top of an existing one.
    """
    item = dict(ann)
    item["datasetId"] = dataset_id
    try:
        roi_id = uuid.UUID(str(item.get("id")))
    except (ValueError, TypeError):
        roi_id = uuid.uuid4()
    item["id"] = str(roi_id)

    body = item.get("title") or item.get("label") or item.get("description")
    now = datetime.now(timezone.utc)
    cube_id = cube.cube_id if cube is not None else None
    external_input_id = external.input_id if external is not None else None
    source_id = cube_id or external_input_id
    target = f"urn:uuid:{source_id}" if source_id is not None else dataset_id
    return roi_id, {
        "selector_type": "SvgSelector",
        "selector_value": _geometry_to_svg(item),
        "target": target,
        "dataset_id": dataset_id,
        "cube_id": cube_id,
        "external_input_id": external_input_id,
        "body": body,
        "body_format": "text/plain" if body else None,
        "motivation": _motivation_to_str(item),
        "creator": item.get("creator"),
        "created": _parse_dt(item.get("createdAt")) or now,
        "modified": _parse_dt(item.get("updatedAt")),
        "generator": "SpectraPaint",
        "generated": now,
        "data": item,
    }


def _detach_operations_from_roi_extractions(db: Session, roi_ids: list[uuid.UUID]) -> None:
    """Unlink classification runs from the extractions of ROIs that are about to be deleted.

    A ProcessingOperation points at the SpectralExtraction it consumed. Removing the extraction
    would otherwise trip that foreign key, so the run is detached first — the history row itself
    survives, which is the whole reason for keeping it.
    """
    if not roi_ids:
        return
    ext_ids = [
        r[0] for r in db.query(SpectralExtraction.extraction_id)
        .filter(SpectralExtraction.roi_id.in_(roi_ids)).all()
    ]
    if not ext_ids:
        return
    db.query(ProcessingOperation).filter(
        ProcessingOperation.input_extraction_id.in_(ext_ids)
    ).update({ProcessingOperation.input_extraction_id: None}, synchronize_session=False)


def _replace_dataset_annotations(db: Session, dataset_id: str, annotations: list[dict]) -> int:
    """Make the stored annotations for a dataset match `annotations`.

    A diff keyed on `roi_id` rather than a delete-and-recreate, for two reasons. A bulk delete
    bypasses the ORM cascade to SpectralExtraction, and with `PRAGMA foreign_keys=ON` the
    orphaned extraction then blocks the delete outright. And rebuilding every row on each save
    would discard the WADM `created` timestamp plus the extraction a saved ROI had triggered,
    even for annotations the user never touched.
    """
    existing = {
        row.roi_id: row
        for row in db.query(RoiAnnotation).filter(RoiAnnotation.dataset_id == dataset_id)
    }
    # Exactly one of these resolves for a dataset the database knows about.
    cube = db.get(HsiCube, stable_id("cube", dataset_id))
    external = db.get(ExternalInput, stable_id("input", dataset_id))

    seen: set[uuid.UUID] = set()
    # Every ROI that survives this save, paired with whether its geometry moved. Unmoved ROIs
    # are still passed through so a missing extraction gets filled in; `ensure_extraction`
    # short-circuits when one is already on record.
    kept: list[tuple[RoiAnnotation, bool]] = []

    for ann in annotations:
        if not isinstance(ann, dict):
            continue
        roi_id, values = _roi_column_values(dataset_id, ann, cube, external)
        if roi_id in seen:
            continue  # the payload listed one id twice; first occurrence wins
        seen.add(roi_id)

        row = existing.get(roi_id)
        if row is None:
            row = RoiAnnotation(roi_id=roi_id, **values)
            db.add(row)
            kept.append((row, True))
            continue

        previous_geometry = (row.data or {}).get("geometry")
        # `created` is the WADM creation time and belongs to the original row, not this save.
        del values["created"]
        for column, value in values.items():
            setattr(row, column, value)
        kept.append((row, previous_geometry != (row.data or {}).get("geometry")))

    removed = [roi_id for roi_id in existing if roi_id not in seen]
    _detach_operations_from_roi_extractions(db, removed)
    for roi_id in removed:
        db.delete(existing[roi_id])  # ORM delete, so the cascade to SpectralExtraction fires

    db.flush()  # the ROI rows must exist before an extraction can reference them
    for row, geometry_changed in kept:
        ensure_extraction(db, row, cube, recompute=geometry_changed)

    db.commit()
    return len(seen)


@router.get("/datasets/{id}/annotations")
def get_annotations(id: str, db: Session = Depends(get_db)):
    get_dataset_record_or_404(id)
    rows = db.query(RoiAnnotation).filter(RoiAnnotation.dataset_id == id).all()
    if not rows:
        # One-time migration: import legacy JSON annotations for this dataset, if any exist.
        legacy = _load_legacy_annotations(id)
        if legacy:
            _replace_dataset_annotations(db, id, legacy)
            rows = db.query(RoiAnnotation).filter(RoiAnnotation.dataset_id == id).all()
    return {"dataset_id": id, "annotations": [r.data for r in rows]}


@router.get("/datasets/{id}/annotations/{roi_id}/extraction")
def get_roi_extraction(id: str, roi_id: str, db: Session = Depends(get_db)):
    """The spectra measured for a saved ROI, so selecting it does not re-read the cube.

    Returns the stored aggregate — mean, standard deviation, min, max and pixel count — not the
    per-pixel spectra. A 45,000-pixel ROI is tens of megabytes per-pixel but a few hundred
    numbers as statistics, and the plot draws its mean line and sigma band from exactly these.
    Callers that need the individual signals re-extract them from the cube on demand.
    """
    get_dataset_record_or_404(id)
    extraction = db.get(SpectralExtraction, extraction_id_for(roi_id))
    # pixel_count == 0 marks a placeholder written by a classification run on an ROI that was
    # never measured: it carries a client-supplied mean and no statistics, so there is nothing
    # here worth serving. Saving the annotation replaces it with a real measurement.
    if extraction is None or not extraction.pixel_count:
        raise HTTPException(
            status_code=404,
            detail="No spectral extraction for this ROI",
        )

    cube = db.get(HsiCube, stable_id("cube", id))
    return {
        "dataset_id": id,
        "roi_id": roi_id,
        "wavelengths_nm": (cube.wavelengths if cube else None) or [],
        "wavelength_range": extraction.wavelength_range,
        "extracted_at": extraction.extracted_at,
        "stats": {
            "n_pixels": extraction.pixel_count,
            "mean": extraction.mean_spectrum,
            "std": extraction.std_spectrum,
            "min": extraction.min_spectrum,
            "max": extraction.max_spectrum,
        },
    }


@router.put("/datasets/{id}/annotations")
def put_annotations(id: str, payload: DatasetAnnotationsPayload, db: Session = Depends(get_db)):
    get_dataset_record_or_404(id)
    count = _replace_dataset_annotations(db, id, payload.annotations)
    return {"ok": True, "count": count}
