import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REGISTRY_FILE = DATA_DIR / "registry.json"


def registry() -> dict[str, Any]:
    with open(REGISTRY_FILE, "r") as f:
        return json.load(f)


def get_dataset_record_or_404(dataset_id: str) -> dict[str, Any]:
    rec = registry().get(dataset_id)
    if not rec:
        raise HTTPException(404, "Unknown dataset")
    return rec
