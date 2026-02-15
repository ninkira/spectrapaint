import numpy as np
from pathlib import Path
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


def _resolve_label_for_match(
    library_dir: str,
    pigment_name: str,
    found_pigment_index: int,
) -> dict:
    """
    Resolve human-friendly pigment label/group/colour from optional sidecar files.
    This follows the prefix-matching logic provided by the user.
    """
    from pathlib import Path

    base = Path(library_dir)
    excel_candidates = [
        base / "__pigmentlistZenodo_custom.xls",
        base / "__pigmentlistZenodo_custom.xlsx",
        base / "__pigmentlistZenodo.xls",
        base / "__pigmentlistZenodo.xlsx",
    ]
    colours_path = base / "HSI_averages_sRGB.npy"

    label_name = pigment_name
    label_group = "Additional Pigment"
    colour = None

    # Optional colour lookup.
    if colours_path.exists():
        try:
            pigments_colours = np.load(str(colours_path))
            if 0 <= found_pigment_index < len(pigments_colours):
                colour = np.asarray(pigments_colours[found_pigment_index]).tolist()
        except Exception:
            pass

    excel_path = next((p for p in excel_candidates if p.exists()), None)
    if excel_path is None:
        return {"label_name": label_name, "label_group": label_group, "colour": colour}

    try:
        import pandas as pd  # local import to keep startup resilient if pandas is absent

        pigment_info_df = pd.read_excel(str(excel_path))
        if "Spectra name prefix" not in pigment_info_df.columns:
            return {"label_name": label_name, "label_group": label_group, "colour": colour}

        search_str = pigment_name[:-4] if len(pigment_name) > 4 else pigment_name
        mask = pigment_info_df["Spectra name prefix"].astype(str).str.contains(str(search_str), regex=False, na=False)
        pigment_info_row = pigment_info_df[mask]
        if pigment_info_row.empty:
            return {"label_name": label_name, "label_group": label_group, "colour": colour}

        row = pigment_info_row.iloc[0]
        if "Pigment name (pname)" in pigment_info_row.columns:
            val = row["Pigment name (pname)"]
            if isinstance(val, str) and val.strip():
                label_name = val.strip()

        if "Pigment group (zip file)" in pigment_info_row.columns and not pd.isna(row["Pigment group (zip file)"]):
            val = row["Pigment group (zip file)"]
            if isinstance(val, str) and val.strip():
                label_group = val.strip()
    except Exception:
        # Keep classification result usable even if metadata enrichment fails.
        return {"label_name": label_name, "label_group": label_group, "colour": colour}

    return {"label_name": label_name, "label_group": label_group, "colour": colour}


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
    # SPy returns SpectralLibrary for library files (.hdr+.sli/.img) and SpyFile for images.
    if hasattr(img, "spectra"):
        arr = np.asarray(img.spectra, dtype=float)
    else:
        arr = np.asarray(img.load(), dtype=float)

    if arr.ndim == 3:
        # Typical ENVI library shape: (n_spectra, 1, n_bands)
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
    return distances


@router.post("/classification/pipeline/run")
def run_pipeline(req: PipelineRequest):
    # Validate dataset and reference-library IDs early.
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
    # Temporary pragmatic alignment: compare over the shared band count.
    # TODO: replace with wavelength-based interpolation for physically correct alignment.
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
    # Use library file parent for sidecar metadata files.
    library_dir = str(Path(reference_library["hdr_path"]).parent)

    top_matches = [
        (
            {
                "rank": rank + 1,
                "index": int(idx),
                "pigment_name": pigment_names[int(idx)],
                "score": float(distances[int(idx)]),
                "values": library_matrix[int(idx)].tolist(),
            }
            | _resolve_label_for_match(
                library_dir=library_dir,
                pigment_name=pigment_names[int(idx)],
                found_pigment_index=int(idx),
            )
        )
        for rank, idx in enumerate(order)
    ]

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
