from fastapi import APIRouter, HTTPException, Query, Response
from ..services.cube_loader import open_envi, read_metadata, load_cube, extract_rgb, downsample2
from ..services.image_ops import percent_stretch, png_bytes
from ..models.dataset_meta import DatasetMeta
import json, os, numpy as np
from pathlib import Path
import json

router = APIRouter()

# compute absolute path dynamically
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REGISTRY_FILE = DATA_DIR / "registry.json"

def registry():
    with open(REGISTRY_FILE, "r") as f:
        return json.load(f)


@router.get("/datasets", response_model=list[DatasetMeta])
def list_datasets():
    out = []
    for id_, rec in registry().items():
        hdr = rec["envi_hdr"]
        if not os.path.exists(hdr): continue
        img = open_envi(hdr)
        md = read_metadata(img)
        out.append(DatasetMeta(id=id_, name=rec.get("name", id_), width=md["width"],
                               height=md["height"], wavelengths_nm=md["wavelengths_nm"]))
    return out

@router.get("/datasets/{id}/thumbnail")
def thumbnail(id: str, scale: int = Query(8, ge=1)):
    rec = registry().get(id);
    if not rec: raise HTTPException(404, "Unknown dataset")
    img = open_envi(rec["envi_hdr"]); md = read_metadata(img)
    cube = load_cube(img); wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, 650, 550, 450)
    rgb = downsample2(rgb, scale)
    return Response(content=png_bytes(percent_stretch(rgb)), media_type="image/png")

@router.get("/datasets/{id}/rgb")
def rgb(id: str, r: float = 650, g: float = 550, b: float = 450, stretch: str = "percent_2"):
    rec = registry().get(id)
    if not rec: raise HTTPException(404, "Unknown dataset")
    img = open_envi(rec["envi_hdr"]); md = read_metadata(img)
    cube = load_cube(img); wl = md["wavelengths_nm"]
    rgb = extract_rgb(cube, wl, r, g, b)
    rgb8 = percent_stretch(rgb) if stretch.startswith("percent") else rgb.astype("uint8")
    return Response(content=png_bytes(rgb8), media_type="image/png")

@router.get("/datasets/{id}/spectra")
def spectra_at_pixel(id: str, x: int, y: int):
    rec = registry().get(id)
    if not rec: raise HTTPException(404, "Unknown dataset")
    img = open_envi(rec["envi_hdr"]); md = read_metadata(img)
    cube = load_cube(img); H, W, _ = cube.shape
    if not (0 <= x < W and 0 <= y < H): raise HTTPException(400, "x/y out of bounds")
    return {"wavelengths_nm": md["wavelengths_nm"], "reflectance": cube[y, x, :].astype(float).tolist()}
