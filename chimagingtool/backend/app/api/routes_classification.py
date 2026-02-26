import logging
import re
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from spectral import io as spyio

from ..analysis.classification.distance_metrics import DistanceMetrics
from ..analysis.classification.distance_registry import METHODS
from ..analysis.classification.reference_registry import (
    get_reference_library_or_404,
    list_reference_libraries,
)
from ..services.dataset_store import get_dataset_record_or_404


router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/classification/methods")
def list_methods():
    return {"methods": METHODS}


@router.get("/classification/libraries")
def list_libraries():
    return {"libraries": list_reference_libraries()}


class MeanSignal(BaseModel):
    wavelengths_nm: list[float]
    values: list[float]


class PipelineRequest(BaseModel):
    dataset_id: str
    roi_id: str
    preprocessing_method_id: str | None = None
    classification_method_id: str
    reference_library_id: str
    mean_signal: MeanSignal
    top_k: int = 5


def _strip_spectrum_suffix(name: str) -> str:
    """
    Normalize IDs like EB_1_2_p1_sh2 -> EB_1_2_p1 for metadata matching/display.
    """
    return re.sub(r"_sh\d+$", "", str(name).strip(), flags=re.IGNORECASE)


def _norm_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).strip().lower())


def _resolve_label_for_match(
    library_dir: str,
    pigment_name: str,
) -> dict:
    """Resolve display label from Pigment name (pname) using spectra prefix match."""
    base = Path(library_dir)
    excel_candidates: list[Path] = []
    for p in (
        base / "__pigmentlistZenodo_custom.xls",
        base / "__pigmentlistZenodo_custom.xlsx",
        base / "__pigmentlistZenodo.xls",
        base / "__pigmentlistZenodo.xlsx",
    ):
        if p.exists():
            excel_candidates.append(p)

    # Project-level fallback for shared metadata file(s).
    shared_root = Path(__file__).resolve().parent.parent / "data" / "old_man" / "spectral_libraries"
    if shared_root.exists():
        for pattern in ("**/__pigmentlistZenodo_custom.xls", "**/__pigmentlistZenodo_custom.xlsx", "**/__pigmentlistZenodo.xls", "**/__pigmentlistZenodo.xlsx"):
            for p in sorted(shared_root.glob(pattern)):
                if p not in excel_candidates:
                    excel_candidates.append(p)

    label_name = pigment_name
    key_norm = _norm_token(_strip_spectrum_suffix(str(pigment_name).strip()))

    try:
        import pandas as pd
    except Exception:
        return {"label_name": label_name}

    for candidate in excel_candidates:
        if not candidate.exists():
            continue
        try:
            engine = "xlrd" if candidate.suffix.lower() == ".xls" else "openpyxl"
            df = pd.read_excel(str(candidate), engine=engine)
        except Exception:
            continue

        df.columns = [str(c).strip() for c in df.columns]
        if "Spectra name prefix" not in df.columns or "Pigment name (pname)" not in df.columns:
            continue

        prefix_norm = (
            df["Spectra name prefix"]
            .astype(str)
            .str.strip()
            .map(_strip_spectrum_suffix)
            .map(_norm_token)
        )
        match = df[prefix_norm == key_norm]
        if match.empty:
            continue

        pname = str(match.iloc[0]["Pigment name (pname)"]).strip()
        if pname:
            label_name = pname
        break

    return {"label_name": label_name}


def _parse_spectra_names(raw: object, count: int) -> list[str]:
    if isinstance(raw, list):
        names = [str(x).strip() for x in raw]
    elif isinstance(raw, str):
        cleaned = raw.strip().strip("{}")
        names = [part.strip() for part in cleaned.split(",") if part.strip()]
    else:
        names = []

    if len(names) != count:
        names = [f"spectrum_{i}" for i in range(count)]
    return names


def _load_library_matrix(reference_library: dict) -> tuple[np.ndarray, list[str], list[float]]:
    hdr_path = reference_library["hdr_path"]
    data_path = reference_library["data_path"]
    img = spyio.envi.open(hdr_path, data_path)
    if hasattr(img, "spectra"):
        arr = np.asarray(img.spectra, dtype=float)
    else:
        arr = np.asarray(img.load(), dtype=float)

    if arr.ndim == 3:
        arr = arr[:, 0, :]
    elif arr.ndim != 2:
        raise HTTPException(status_code=500, detail=f"Unsupported library array shape: {arr.shape}")

    md = getattr(img, "metadata", {}) or {}
    if hasattr(img, "names") and getattr(img, "names", None):
        names = [str(n).strip() for n in img.names]
        if len(names) != arr.shape[0]:
            names = _parse_spectra_names(md.get("spectra names"), arr.shape[0])
    else:
        names = _parse_spectra_names(md.get("spectra names"), arr.shape[0])

    raw_wl = md.get("wavelength", [])
    if (not raw_wl) and hasattr(img, "bands") and getattr(img.bands, "centers", None):
        raw_wl = img.bands.centers
    wavelengths: list[float] = []
    for w in raw_wl:
        try:
            wavelengths.append(float(w))
        except (TypeError, ValueError):
            wavelengths = []
            break

    return arr, names, wavelengths


def _compute_distances(method_id: str, query: np.ndarray, library_matrix: np.ndarray) -> np.ndarray:
    dm = DistanceMetrics()
    query_matrix = np.repeat(query[None, :], library_matrix.shape[0], axis=0)

    if method_id == "sam_matrix":
        distances = dm.matrix_spectral_angle_mapper(query_matrix, library_matrix)
    elif method_id == "cosine_matrix":
        distances = dm.matrix_cosine_distance(query_matrix, library_matrix)
    elif method_id == "klpd":
        distances = np.asarray(dm.klpd_spectral(query_matrix, library_matrix, mode=3)).reshape(-1)
    elif method_id == "sam_pixel":
        distances = np.asarray(
            [dm.pixel_spectral_angle_mapper(query, row) for row in library_matrix],
            dtype=float,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown classification method: {method_id}")

    finite_mask = np.isfinite(distances)
    if not np.all(finite_mask):
        distances = np.where(finite_mask, distances, np.inf)
    if distances.shape[0] != library_matrix.shape[0]:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Distance size mismatch for method '{method_id}': "
                f"expected {library_matrix.shape[0]}, got {distances.shape[0]}"
            ),
        )
    return distances


@router.post("/classification/pipeline/run")
def run_pipeline(req: PipelineRequest):
    get_dataset_record_or_404(req.dataset_id)
    reference_library = get_reference_library_or_404(req.reference_library_id)

    if not req.mean_signal.values:
        raise HTTPException(status_code=400, detail="mean_signal.values is empty")
    if len(req.mean_signal.wavelengths_nm) != len(req.mean_signal.values):
        raise HTTPException(status_code=400, detail="mean_signal wavelengths/values length mismatch")

    known_methods = {m["id"] for m in METHODS}
    if req.classification_method_id not in known_methods:
        raise HTTPException(status_code=400, detail=f"Unknown classification method: {req.classification_method_id}")

    query = np.asarray(req.mean_signal.values, dtype=float)
    library_matrix, pigment_names, library_wavelengths = _load_library_matrix(reference_library)

    min_bands = min(query.shape[0], library_matrix.shape[1])
    if min_bands <= 0:
        raise HTTPException(status_code=400, detail="No overlapping bands for classification")
    if query.shape[0] != min_bands:
        query = query[:min_bands]
    if library_matrix.shape[1] != min_bands:
        library_matrix = library_matrix[:, :min_bands]
    if library_wavelengths and len(library_wavelengths) >= min_bands:
        library_wavelengths = library_wavelengths[:min_bands]

    distances = _compute_distances(req.classification_method_id, query, library_matrix)
    k = max(1, min(int(req.top_k), int(distances.shape[0])))
    order = np.argsort(distances)[:k]
    library_dir = str(Path(reference_library["hdr_path"]).parent)

    top_matches = []
    for rank, idx in enumerate(order):
        raw_name = pigment_names[int(idx)]
        meta = _resolve_label_for_match(
            library_dir=library_dir,
            pigment_name=raw_name,
        )
        top_matches.append(
            {
                "rank": rank + 1,
                "index": int(idx),
                "pigment_name": raw_name,
                "spectra_name_prefix": _strip_spectrum_suffix(raw_name),
                "label_name": meta.get("label_name", raw_name),
                "score": float(distances[int(idx)]),
                "values": library_matrix[int(idx)].tolist(),
            }
        )

    results = {
        "preprocessing_method": req.preprocessing_method_id,
        "classification_method": req.classification_method_id,
        "reference_library_id": req.reference_library_id,
        "reference_library_label": reference_library["label"],
        "top_matches": top_matches,
    }

    return {
        "datasetId": req.dataset_id,
        "roiId": req.roi_id,
        "mean_signal": req.mean_signal.model_dump(),
        "library": {
            "bands": int(library_matrix.shape[1]),
            "size": int(library_matrix.shape[0]),
            "wavelengths_nm": library_wavelengths,
        },
        "results": results,
    }
