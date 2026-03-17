import io
import json
import os
import re
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from PIL import Image
from pydantic import BaseModel
from datetime import datetime, timezone


from ..models.dataset_meta import DatasetMeta
from ..services.cube_loader import downsample2, extract_rgb, load_cube, open_envi, read_metadata
from ..services.dataset_store import get_dataset_record_or_404, registry
from ..services.image_ops import percent_stretch, png_bytes

router = APIRouter()
DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
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
    img = open_envi(hdr_path)
    md = read_metadata(img)
    cube = load_cube(img)
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
            img = open_envi(hdr)
            md = read_metadata(img)
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
    img = open_envi(hdr)
    md = read_metadata(img)
    cube = load_cube(img)
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


@router.get("/datasets/{id}/annotations")
def get_annotations(id: str):
    get_dataset_record_or_404(id)
    file_path = _annotation_file_path(id)
    if not file_path.exists():
        return {"dataset_id": id, "annotations": []}

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read annotations: {exc}") from exc

    if isinstance(raw, dict):
        anns = raw.get("annotations", [])
        if isinstance(anns, list):
            return {"dataset_id": id, "annotations": anns}
    return {"dataset_id": id, "annotations": []}


@router.put("/datasets/{id}/annotations")
def put_annotations(id: str, payload: DatasetAnnotationsPayload):
    get_dataset_record_or_404(id)

    normalized: list[dict] = []
    for ann in payload.annotations:
        if not isinstance(ann, dict):
            continue
        item = dict(ann)
        item["datasetId"] = id
        normalized.append(item)

    document = {
        "dataset_id": id,
        "version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "annotations": normalized,
    }

    try:
        ANNOTATIONS_DIR.mkdir(parents=True, exist_ok=True)
        with open(_annotation_file_path(id), "w", encoding="utf-8") as f:
            json.dump(document, f, ensure_ascii=True, indent=2)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save annotations: {exc}") from exc

    return {"ok": True, "count": len(normalized)}
