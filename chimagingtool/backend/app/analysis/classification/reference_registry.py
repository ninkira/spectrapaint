from pathlib import Path

from fastapi import HTTPException


LIBRARIES_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "spectral_libraries"


def _label_from_path(path: Path) -> str:
    raw = path.stem.replace("_", " ").replace("-", " ").strip()
    return raw if raw else path.stem


def _title_case_tokens(raw: str) -> str:
    cleaned = raw.replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return raw
    return " ".join(token.capitalize() for token in cleaned.split())


def _variant_from_stem(stem: str) -> str:
    normalized = stem.strip("_").lower()
    for prefix in ("speclib_", "spectral_library_", "library_"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix):]
            break
    return _title_case_tokens(normalized)


def list_reference_libraries() -> list[dict]:
    libraries: list[dict] = []
    if not LIBRARIES_ROOT.exists():
        return libraries

    # backend/app/analysis/classification/reference_registry.py
    for hdr_path in sorted(LIBRARIES_ROOT.rglob("*.hdr")):
        candidates = [hdr_path.with_suffix(".sli"), hdr_path.with_suffix(".img")]
        data_path = next((p for p in candidates if p.exists()), None)
        if data_path is None:
            continue
        rel = hdr_path.relative_to(LIBRARIES_ROOT).as_posix()
        lib_id = rel.replace("/", "__")
        group_name = _title_case_tokens(hdr_path.parent.name)
        variant_name = _variant_from_stem(hdr_path.stem)

        libraries.append({
            "id": lib_id,
            "label": f"{group_name} - {variant_name}",
            "group": group_name,
            "variant": variant_name,
            "hdr_path": str(hdr_path),
            "data_path": str(data_path),
        })

    return libraries


def get_reference_library_or_404(library_id: str) -> dict:
    for lib in list_reference_libraries():
        if lib["id"] == library_id:
            return lib
    raise HTTPException(status_code=404, detail="Unknown reference library")
