import os

from fastapi import APIRouter, Query, Response

from ..models.dataset_meta import DatasetMeta
from ..services.cube_loader import downsample2, extract_rgb, load_cube, open_envi, read_metadata
from ..services.dataset_store import get_dataset_record_or_404, registry
from ..services.image_ops import percent_stretch, png_bytes


router = APIRouter()


@router.get("/datasets", response_model=list[DatasetMeta])
def list_datasets():
    out = []
    for id_, rec in registry().items():
        hdr = rec["envi_hdr"]
        if not os.path.exists(hdr):
            continue
        img = open_envi(hdr)
        md = read_metadata(img)
        out.append(
            DatasetMeta(
                id=id_,
                name=rec.get("name", id_),
                width=md["width"],
                height=md["height"],
                wavelengths_nm=md["wavelengths_nm"],
            )
        )
    return out


@router.get("/datasets/{id}/thumbnail")
def thumbnail(id: str, scale: int = Query(8, ge=1)):
    rec = get_dataset_record_or_404(id)
    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)
    wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, 650, 550, 450)
    rgb = downsample2(rgb, scale)
    return Response(content=png_bytes(percent_stretch(rgb)), media_type="image/png")


@router.get("/datasets/{id}/rgb")
def rgb(id: str, r: float = 650, g: float = 550, b: float = 450, stretch: str = "percent_2"):
    rec = get_dataset_record_or_404(id)
    img = open_envi(rec["envi_hdr"])
    md = read_metadata(img)
    cube = load_cube(img)
    wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, r, g, b)
    rgb8 = percent_stretch(rgb) if stretch.startswith("percent") else rgb.astype("uint8")
    return Response(content=png_bytes(rgb8), media_type="image/png")
