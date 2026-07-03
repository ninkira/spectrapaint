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


from ..db.database import get_db
from ..db.ids import stable_id
from ..db.models import HsiCube, RoiAnnotation
from ..models.dataset_meta import DatasetMeta
from ..paths import APP_DATA_DIR
from ..services.cube_loader import downsample2, extract_rgb, get_cube_for_path, open_envi, read_metadata
from ..services.dataset_store import get_dataset_record_or_404, registry
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

# General calls
@router.get("/datasets", response_model=list[DatasetMeta])
def list_datasets():
    out: list[DatasetMeta] = []

    for id_, rec in registry().items():
        name = rec.get("name", id_)
        hdr = rec.get("envi_hdr")
        tiff = rec.get("tiff")
        png = rec.get("png")
        jpg = rec.get("jpg")

        if hdr:
            if not os.path.exists(hdr):
                continue
            md = read_metadata(open_envi(hdr))
            path = _to_relative_project_path(hdr)
            out.append(
                DatasetMeta(
                    id=id_,
                    name=name,
                    type="hsi",
                    path=path,
                    width=md["width"],
                    height=md["height"],
                    wavelengths_nm=md["wavelengths_nm"],
                )
            )
            continue

        visual_path = tiff or png or jpg
        if visual_path:
            if not os.path.exists(visual_path):
                continue
            width, height = _read_visual_size(visual_path)
            ext = Path(visual_path).suffix.lower()
            if ext in (".tif", ".tiff"):
                vtype = "tiff"
            elif ext == ".png":
                vtype = "png"
            else:
                vtype = "jpg"
            path = _to_relative_project_path(visual_path)
            out.append(
                DatasetMeta(
                    id=id_,
                    name=name,
                    type=vtype,
                    path=path,
                    width=width,
                    height=height,
                    wavelengths_nm=None,
                )
            )

    return out


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


def _build_roi_row(dataset_id: str, ann: dict, cube: "HsiCube | None") -> RoiAnnotation:
    """Map a frontend annotation object onto the WADM RoiAnnotation columns.

    When the dataset is an HSI cube present in the DB, the annotation is linked to it via the
    `cube_id` FK and the WADM `target` becomes the cube IRI `urn:uuid:{cube_id}`. The full
    original object is also stored in `data` so the UI round-trips losslessly (WADM has no slot
    for structured geometry, colour, group id, etc.).
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
    target = f"urn:uuid:{cube_id}" if cube_id is not None else dataset_id
    return RoiAnnotation(
        roi_id=roi_id,
        selector_type="SvgSelector",
        selector_value=_geometry_to_svg(item),
        target=target,
        dataset_id=dataset_id,
        cube_id=cube_id,
        body=body,
        body_format="text/plain" if body else None,
        motivation=_motivation_to_str(item),
        creator=item.get("creator"),
        created=_parse_dt(item.get("createdAt")) or now,
        modified=_parse_dt(item.get("updatedAt")),
        generator="ImagingTool",
        generated=now,
        data=item,
    )


def _replace_dataset_annotations(db: Session, dataset_id: str, annotations: list[dict]) -> int:
    """Replace all annotations for a dataset with the given list (mirrors old file semantics)."""
    db.query(RoiAnnotation).filter(RoiAnnotation.dataset_id == dataset_id).delete()
    cube = db.get(HsiCube, stable_id("cube", dataset_id))  # None for non-HSI / unsynced datasets
    count = 0
    for ann in annotations:
        if not isinstance(ann, dict):
            continue
        db.add(_build_roi_row(dataset_id, ann, cube))
        count += 1
    db.commit()
    return count


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


@router.put("/datasets/{id}/annotations")
def put_annotations(id: str, payload: DatasetAnnotationsPayload, db: Session = Depends(get_db)):
    get_dataset_record_or_404(id)
    count = _replace_dataset_annotations(db, id, payload.annotations)
    return {"ok": True, "count": count}
