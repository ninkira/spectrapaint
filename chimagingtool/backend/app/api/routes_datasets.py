import io
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from PIL import Image


from ..models.dataset_meta import DatasetMeta
from ..services.cube_loader import downsample2, extract_rgb, load_cube, open_envi, read_metadata
from ..services.dataset_store import get_dataset_record_or_404, registry
from ..services.image_ops import percent_stretch, png_bytes

router = APIRouter()
DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
PROJECT_ROOT = DATA_ROOT / "old_man"

# for loading visualisations created in third-party-software
SUPPORTED_VISUAL_EXTS = {".tif", ".tiff", ".png"}


def is_visual_file(path: str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_VISUAL_EXTS


def read_visual_metadata(path: str) -> dict:
    """
    Opens TIFF/PNG and returns basic metadata (width/height).
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
    Opens TIFF/PNG and converts to PNG bytes for browser display.
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



def _read_visual_size(path: str) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.width, im.height


def _to_relative_project_path(path: str) -> str:
    p = Path(path).resolve()
    try:
        return p.relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return p.as_posix()

# General calls
@router.get("/datasets", response_model=list[DatasetMeta])
def list_datasets():
    out: list[DatasetMeta] = []

    for id_, rec in registry().items():
        name = rec.get("name", id_)
        hdr = rec.get("envi_hdr")
        tiff = rec.get("tiff")
        png = rec.get("png")

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

        visual_path = tiff or png
        if visual_path:
            if not os.path.exists(visual_path):
                continue
            width, height = _read_visual_size(visual_path)
            ext = Path(visual_path).suffix.lower()
            vtype = "tiff" if ext in (".tif", ".tiff") else "png"
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
    img = open_envi(hdr)
    md = read_metadata(img)
    cube = load_cube(img)
    wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, r, g, b)
    rgb8 = percent_stretch(rgb) if stretch.startswith("percent") else rgb.astype("uint8")
    return Response(content=png_bytes(rgb8), media_type="image/png")

@router.get("/datasets/{id}/visual")
def visual(id: str):
    rec = get_dataset_record_or_404(id)
    visual_path = rec.get("tiff") or rec.get("png")
    if not visual_path:
        raise HTTPException(status_code=404, detail="No TIFF/PNG visual for this dataset")

    return Response(content=visual_to_png_bytes(visual_path), media_type="image/png")
