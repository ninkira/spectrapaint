"""The in-memory dataset registry — the single map the read endpoints consume.

Historically this was built by scanning the on-disk data folder. The app is now *upload-driven*:
datasets exist because the user uploaded them through the Data Manager modal, which writes both
the file (into APP_DATA_DIR) and a DB row (HsiCube / ExternalInput). So the registry is now built
**from the database**. The dict shape is unchanged, so every consumer
(routes_datasets / routes_spectra / routes_classification, all via `get_dataset_record_or_404`)
keeps working without modification.

Each record:
    {
      "name": str,
      "project_id": str,
      "project_name": str,
      "envi_hdr": str,          # HSI cubes only  (absolute path)
      "tiff" | "png" | "jpg": str,  # visual inputs only (absolute path)
    }
"""
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..core.data.projects import DEFAULT_PROJECT_SLUG, dataset_owners
from ..paths import APP_DATA_DIR, storage

# Legacy aliases. Every pre-existing row belongs to this project and its keys are derived from
# its slug, so the constants stay — but the registry now reads each dataset's real project from
# the database rather than assuming this one.
PROJECT_ID = DEFAULT_PROJECT_SLUG
PROJECT_DIR = APP_DATA_DIR / PROJECT_ID


def _to_title(text: str) -> str:
    clean = re.sub(r"[_\-]+", " ", text).strip()
    return clean.title() if clean else text


PROJECT_NAME = _to_title(PROJECT_ID)


def dataset_id_for_data_ref(data_ref: str) -> str:
    """Derive a dataset id from a stored path, for rows that do not have one yet.

    Path relative to the project folder, without its suffix, with "/" replaced by "__"
    (e.g. "old_man/hsi/raw/001.hdr" -> "hsi__raw__001").

    This is now only a fallback. The id is a stored column (see the `dataset_identity`
    migration) precisely because `stable_id("cube"/"input", dataset_id)` derives each row's
    primary key from it — recomputing it on every read welded the key to the path scheme.
    """
    rel = Path(data_ref)
    parts = rel.parts
    if parts and parts[0] == PROJECT_ID:
        rel = Path(*parts[1:])
    return rel.with_suffix("").as_posix().replace("/", "__")


def _default_name(data_ref: str) -> str:
    stem = Path(data_ref).stem
    return f"{PROJECT_NAME} - {_to_title(stem)}"


def _build_registry_from_db() -> dict[str, Any]:
    """Assemble the registry from the HsiCube and ExternalInput tables."""
    # Imported lazily to avoid a circular import at module load time.
    from ..db.database import SessionLocal
    from ..db.models import ExternalInput, HsiCube

    out: dict[str, Any] = {}
    with SessionLocal() as db:
        owners = dataset_owners(db)

        def owner(dataset_id: str) -> tuple[str, str]:
            """The project a dataset belongs to, falling back to the legacy one."""
            found = owners.get(dataset_id)
            return (str(found[0]), found[1]) if found else (PROJECT_ID, PROJECT_NAME)

        for cube in db.query(HsiCube).all():
            dataset_id = cube.dataset_id or dataset_id_for_data_ref(cube.data_ref)
            project_id, project_name = owner(dataset_id)
            out[dataset_id] = {
                "name": cube.title or _default_name(cube.data_ref),
                "project_id": project_id,
                "project_name": project_name,
                "envi_hdr": str(storage.resolve(cube.data_ref)),
            }

        for inp in db.query(ExternalInput).all():
            dataset_id = inp.dataset_id or dataset_id_for_data_ref(inp.data_ref)
            if dataset_id in out:
                continue
            project_id, project_name = owner(dataset_id)
            rec: dict[str, Any] = {
                "name": inp.title or _default_name(inp.data_ref),
                "project_id": project_id,
                "project_name": project_name,
            }
            suffix = Path(inp.data_ref).suffix.lower()
            key = "tiff" if suffix in {".tif", ".tiff"} else "png" if suffix == ".png" else "jpg"
            rec[key] = str(storage.resolve(inp.data_ref))
            out[dataset_id] = rec

    return out


_registry_cache: dict[str, Any] | None = None


def invalidate_registry_cache() -> None:
    """Drop the cache so the next `registry()` call rebuilds from the DB (call after an upload)."""
    global _registry_cache
    _registry_cache = None


def registry() -> dict[str, Any]:
    global _registry_cache
    if _registry_cache is None:
        _registry_cache = _build_registry_from_db()
    return _registry_cache


def get_dataset_record_or_404(dataset_id: str) -> dict[str, Any]:
    rec = registry().get(dataset_id)
    if not rec:
        raise HTTPException(404, "Unknown dataset")
    return rec
