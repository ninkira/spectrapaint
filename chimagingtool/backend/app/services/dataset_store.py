import json
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROJECT_ID = "old_man"
PROJECT_DIR = DATA_DIR / PROJECT_ID
PROJECT_REGISTRY_FILE = PROJECT_DIR / "registry.json"
HSI_ROOT = PROJECT_DIR / "hsi"
VISUAL_EXTS = {".tif", ".tiff", ".png", ".jpg", ".jpeg"}


def _to_title(text: str) -> str:
    clean = re.sub(r"[_\-]+", " ", text).strip()
    return clean.title() if clean else text


def _load_project_registry() -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Supported formats:
    1) Flat (legacy):
       {"001": {"name": "...", ...}}
    2) Structured:
       {"project": {...}, "datasets": {"001": {"name": "...", ...}}}
    """
    if not PROJECT_REGISTRY_FILE.exists():
        return {}, {}

    with open(PROJECT_REGISTRY_FILE, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if isinstance(raw, dict) and "datasets" in raw:
        project_meta = raw.get("project", {}) if isinstance(raw.get("project"), dict) else {}
        datasets_meta = raw.get("datasets", {}) if isinstance(raw.get("datasets"), dict) else {}
        return project_meta, datasets_meta

    if isinstance(raw, dict):
        return {}, raw

    return {}, {}


def _build_auto_registry() -> dict[str, Any]:
    project_meta, datasets_meta = _load_project_registry()
    project_name = project_meta.get("name", _to_title(PROJECT_ID))

    out: dict[str, Any] = {}
    if not PROJECT_DIR.exists():
        return out

    # 1) HSI records (from the HSI source tree only).
    for hdr_path in sorted(HSI_ROOT.rglob("*.hdr")) if HSI_ROOT.exists() else []:
        rel = hdr_path.relative_to(PROJECT_DIR)
        stem = hdr_path.stem
        dataset_id = rel.with_suffix("").as_posix().replace("/", "__")
        meta = datasets_meta.get(dataset_id, {}) if isinstance(datasets_meta, dict) else {}
        default_name = f"{project_name} - {_to_title(stem)}"

        out[dataset_id] = {
            "name": meta.get("name", default_name),
            "project_id": PROJECT_ID,
            "project_name": project_name,
            "envi_hdr": str(hdr_path),
            "thumbnail": meta.get("thumbnail"),
        }

    # 2) Visual records (TIFF/PNG), skip folders not intended as dataset layers.
    for vis_path in sorted(PROJECT_DIR.rglob("*")):
        if not vis_path.is_file():
            continue
        if vis_path.suffix.lower() not in VISUAL_EXTS:
            continue
        parts = [p.lower() for p in vis_path.relative_to(PROJECT_DIR).parts]
        if "spectral_libraries" in parts or "testdata" in parts:
            continue
        if "raw" in parts:
            continue

        rel = vis_path.relative_to(PROJECT_DIR)
        stem = vis_path.stem
        dataset_id = rel.with_suffix("").as_posix().replace("/", "__")
        if dataset_id in out:
            continue

        meta = datasets_meta.get(dataset_id, {}) if isinstance(datasets_meta, dict) else {}
        default_name = f"{project_name} - {_to_title(stem)}"
        rec = {
            "name": meta.get("name", default_name),
            "project_id": PROJECT_ID,
            "project_name": project_name,
            "thumbnail": meta.get("thumbnail"),
        }
        suffix = vis_path.suffix.lower()
        if suffix in {".tif", ".tiff"}:
            rec["tiff"] = str(vis_path)
        elif suffix == ".png":
            rec["png"] = str(vis_path)
        else:
            rec["jpg"] = str(vis_path)

        out[dataset_id] = rec

    return out


def registry() -> dict[str, Any]:
    return _build_auto_registry()


def get_dataset_record_or_404(dataset_id: str) -> dict[str, Any]:
    rec = registry().get(dataset_id)
    if not rec:
        raise HTTPException(404, "Unknown dataset")
    return rec
