"""Sync the on-disk datasets (from dataset_store.registry()) into the DB backbone.

Idempotent: every row uses a deterministic UUID (app.db.ids.stable_id), so this can run on
every startup and simply keeps Project / Object / DataAcquisition / HsiCube / ExternalInput
in step with what's on disk. Large binaries stay on disk — we store paths relative to
APP_DATA_DIR.
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session
from spectral import io as spyio

from ..paths import storage
from ..analysis.classification.reference_registry import list_reference_libraries
from ..services.cube_loader import open_envi, read_metadata
from ..services.dataset_store import registry
from ..db.ids import stable_id
from ..db.models import DataAcquisition, ExternalInput, HsiCube, Object, Project, SpectralLibrary

logger = logging.getLogger(__name__)


def _to_int(v: object) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _to_float_list(v: object) -> list[float] | None:
    if v is None:
        return None
    if isinstance(v, str):
        parts = [p.strip() for p in v.strip().strip("{}").split(",") if p.strip()]
    elif isinstance(v, (list, tuple)):
        parts = list(v)
    else:
        return None
    try:
        out = [float(p) for p in parts]
    except (TypeError, ValueError):
        return None
    return out or None


def _infer_modality(path: str) -> str:
    parts = {p.lower() for p in Path(path).parts}
    if "xrf" in parts:
        return "XRF"
    if "general" in parts:
        return "RGB"
    return "other"


def _parse_str_list(v: object) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [p.strip() for p in v.strip().strip("{}").split(",") if p.strip()]
    if isinstance(v, (list, tuple)):
        return [str(x).strip() for x in v]
    return []


def upsert_spectral_library(db: Session, lib: dict, now: datetime | None = None) -> None:
    """Upsert one SpectralLibrary row from a reference-registry library dict (ENVI .hdr/.sli).

    Reads the ENVI header metadata only (samples=bands, lines=spectra, wavelength, spectra
    names, interleave, data type). Required-but-unknown model fields get safe placeholders.
    """
    now = now or datetime.now(timezone.utc)
    img = None
    try:
        img = spyio.envi.open(lib["hdr_path"], lib["data_path"])
        md = dict(getattr(img, "metadata", {}) or {})
    except Exception:
        md = {}

    # Opening an ENVI *library* moves "spectra names" and "wavelength" out of the metadata dict
    # and onto the object (as .names / .bands.centers), so reading md alone would silently store
    # empty lists. This mirrors the fallback _load_library_matrix already applies.
    wl = _to_float_list(md.get("wavelength")) or _to_float_list(getattr(getattr(img, "bands", None), "centers", None)) or []
    names = _parse_str_list(md.get("spectra names")) or _parse_str_list(getattr(img, "names", None))
    n_bands = _to_int(md.get("samples")) or (len(wl) if wl else 0)
    db.merge(SpectralLibrary(
        library_id=stable_id("library", lib["id"]),
        library_name=lib.get("label", lib["id"]),
        version="1",
        file_format="ENVI",
        data_ref=storage.relativise(lib["data_path"]),
        created_at=now,
        num_spectra=_to_int(md.get("lines")),
        dc_creator="unknown",
        wavelengths=[float(w) for w in wl],
        wavelength_units=str(md.get("wavelength units", "nm") or "nm"),
        fwhm=_to_float_list(md.get("fwhm")),
        number_of_bands=n_bands,
        interleave=(str(md["interleave"]).upper() if md.get("interleave") else "BSQ"),
        data_type=_to_int(md.get("data type")) or 0,
        file_type=str(md.get("file type", "ENVI Spectral Library")),
        spectra_names=names,
    ))


def sync_datasets_to_db(db: Session) -> dict[str, int]:
    """Upsert on-disk datasets into the DB. Idempotent; best-effort per record; returns counts."""
    reg = registry()
    if not reg:
        return {"projects": 0, "objects": 0, "acquisitions": 0, "cubes": 0, "external_inputs": 0}

    now = datetime.now(timezone.utc)
    # Current records all belong to one project; take its identity from the first record.
    first = next(iter(reg.values()))
    pid = first.get("project_id", "default")
    project_name = first.get("project_name", pid)

    project_uuid = stable_id("project", pid)
    # Kind string stays "artefact" — it is hashed into the existing primary keys.
    object_uuid = stable_id("artefact", pid)
    acq_uuid = stable_id("acq", f"{pid}:hsi")

    db.merge(Project(project_id=project_uuid, storage_root=pid, dc_title=project_name, created_at=now))
    db.merge(Object(object_id=object_uuid, project_id=project_uuid,
                      object_type="painting", dc_title=project_name, created_at=now))
    db.merge(DataAcquisition(acquisition_id=acq_uuid, object_id=object_uuid,
                             capture_modality="HSI"))

    cubes = inputs = 0
    for dataset_id, rec in reg.items():
        hdr = rec.get("envi_hdr")
        if hdr:
            try:
                img = open_envi(hdr)
                md = read_metadata(img)
                raw = dict(img.metadata)
                wl = md["wavelengths_nm"]
                db.merge(HsiCube(
                    cube_id=stable_id("cube", dataset_id),
                    acquisition_id=acq_uuid,
                    data_ref=storage.relativise(hdr),
                    created_at=now,
                    samples=md["width"],
                    lines=md["height"],
                    number_of_bands=md["bands"],
                    wavelengths=wl,
                    wavelength_units=str(raw.get("wavelength units", "nm") or "nm"),
                    fwhm=_to_float_list(raw.get("fwhm")),
                    interleave=(str(raw["interleave"]).upper() if raw.get("interleave") else None),
                    data_type=_to_int(raw.get("data type")),
                    spectral_range_min=min(wl) if wl else None,
                    spectral_range_max=max(wl) if wl else None,
                ))
                cubes += 1
            except Exception as exc:
                logger.warning("Skipping cube %s: %s", dataset_id, exc)
            continue

        path = rec.get("tiff") or rec.get("png") or rec.get("jpg")
        if not path:
            continue
        try:
            db.merge(ExternalInput(
                input_id=stable_id("input", dataset_id),
                project_id=project_uuid,
                source_tool="imported",
                capture_modality=_infer_modality(path),
                file_format=Path(path).suffix.lstrip(".").lower(),
                data_ref=storage.relativise(path),
                imported_at=now,
            ))
            inputs += 1
        except Exception as exc:
            logger.warning("Skipping external input %s: %s", dataset_id, exc)

    libs = 0
    for lib in list_reference_libraries():
        try:
            upsert_spectral_library(db, lib, now)
            libs += 1
        except Exception as exc:
            logger.warning("Skipping library %s: %s", lib.get("id"), exc)

    db.commit()
    counts = {"projects": 1, "objects": 1, "acquisitions": 1,
              "cubes": cubes, "external_inputs": inputs, "spectral_libraries": libs}
    logger.info("Dataset sync complete: %s", counts)
    return counts
