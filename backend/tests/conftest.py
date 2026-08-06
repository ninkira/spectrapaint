"""Shared test fixtures.

`app.paths` reads SPECTRAPAINT_HOME / SPECTRAPAINT_DB / SPECTRAPAINT_DATA_DIR at *import*
time, and `app.db.database` builds its engine from the resulting DATABASE_URL — also at
import time. So the environment has to point at a scratch directory before anything under
`app` is imported, which is why that happens here at module scope rather than in a fixture.

ENVI fixtures are generated rather than committed: `*.hdr` and `*.img` are in .gitignore,
so a checked-in cube would be silently dropped from the repo.
"""
from __future__ import annotations

import atexit
import os
import shutil
import tempfile
from pathlib import Path

_SCRATCH = Path(tempfile.mkdtemp(prefix="spectrapaint-tests-"))
os.environ["SPECTRAPAINT_HOME"] = str(_SCRATCH / "home")
os.environ["SPECTRAPAINT_DB"] = str(_SCRATCH / "db")
os.environ["SPECTRAPAINT_DATA_DIR"] = str(_SCRATCH / "data")

# SQLite may still hold the file open on Windows, so never fail the run over cleanup.
atexit.register(shutil.rmtree, _SCRATCH, True)

import io  # noqa: E402
import json  # noqa: E402

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from spectral.io import envi  # noqa: E402

from app.db.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app.paths import APP_DATA_DIR  # noqa: E402
from app.services.dataset_store import invalidate_registry_cache  # noqa: E402

# --- fixture builders --------------------------------------------------------------------


def write_envi_cube(
    hdr_path: Path,
    *,
    samples: int = 4,
    lines: int = 3,
    bands: int = 5,
    wavelengths: list[float] | None = None,
) -> Path:
    """Write a small ENVI cube (.hdr + .img) and return the header path.

    Band values are `y*100 + x*10 + b`, so a test can assert it got the spectrum of the pixel
    it actually asked for rather than merely "a list of the right length".
    """
    if wavelengths is None:
        wavelengths = [400.0 + 50.0 * i for i in range(bands)]

    y, x, b = np.indices((lines, samples, bands))
    cube = (y * 100 + x * 10 + b).astype(np.float32)

    hdr_path.parent.mkdir(parents=True, exist_ok=True)
    envi.save_image(
        str(hdr_path),
        cube,
        dtype=np.float32,
        force=True,
        interleave="bsq",
        metadata={
            "wavelength": [str(w) for w in wavelengths],
            "wavelength units": "nm",
            "description": "synthetic test cube",
        },
    )
    return hdr_path


def write_spectral_library(
    hdr_path: Path,
    *,
    names: list[str] | None = None,
    wavelengths: list[float] | None = None,
) -> Path:
    """Write an ENVI spectral library (.hdr + .sli) and return the header path.

    Hand-rolled rather than built with spectral's writer because an ENVI *library* header has a
    different shape from an image header: `samples` is the band count and `lines` the number of
    spectra.
    """
    names = names or ["pigment_a", "pigment_b", "pigment_c"]
    wavelengths = wavelengths or [400.0, 450.0, 500.0, 550.0, 600.0]

    # Row i is a distinct, strictly positive spectrum — KLPD needs non-negative input.
    spectra = np.array(
        [[1.0 + i + 0.1 * b for b in range(len(wavelengths))] for i in range(len(names))],
        dtype=np.float32,
    )

    hdr_path.parent.mkdir(parents=True, exist_ok=True)
    hdr_path.with_suffix(".sli").write_bytes(spectra.tobytes())
    hdr_path.write_text(
        "ENVI\n"
        "description = {synthetic test library}\n"
        f"samples = {len(wavelengths)}\n"
        f"lines = {len(names)}\n"
        "bands = 1\n"
        "header offset = 0\n"
        "file type = ENVI Spectral Library\n"
        "data type = 4\n"
        "interleave = bsq\n"
        "byte order = 0\n"
        "wavelength units = nm\n"
        "band names = { Spectral Library }\n"
        f"spectra names = {{ {', '.join(names)} }}\n"
        f"wavelength = {{ {', '.join(str(w) for w in wavelengths)} }}\n",
        encoding="utf-8",
    )
    return hdr_path


def upload_library(client: TestClient, hdr_path: Path, *, name: str = "test_library") -> dict:
    sli_path = hdr_path.with_suffix(".sli")
    with open(hdr_path, "rb") as hdr, open(sli_path, "rb") as data:
        response = client.post(
            "/api/classification/libraries/upload",
            data={"name": name},
            files={
                "header": (hdr_path.name, hdr, "application/octet-stream"),
                "data": (sli_path.name, data, "application/octet-stream"),
            },
        )
    assert response.status_code == 200, response.text
    return response.json()


def write_png(path: Path, *, width: int = 6, height: int = 4) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (width, height), (10, 120, 200)).save(path, format="PNG")
    return path


def upload_hsi(client: TestClient, hdr_path: Path, **meta) -> dict:
    """POST an ENVI pair through the real upload endpoint and return the DatasetMeta."""
    payload = {"data_kind": "hsi", "target_modality": "HSI", **meta}
    img_path = hdr_path.with_suffix(".img")
    with open(hdr_path, "rb") as hdr, open(img_path, "rb") as data:
        response = client.post(
            "/api/datasets/upload",
            data={"metadata": json.dumps(payload)},
            files={
                "file": (hdr_path.name, hdr, "application/octet-stream"),
                "data": (img_path.name, data, "application/octet-stream"),
            },
        )
    assert response.status_code == 200, response.text
    return response.json()


def upload_visual(client: TestClient, image_path: Path, *, modality: str = "XRF", **meta) -> dict:
    payload = {"data_kind": "visual", "target_modality": modality, **meta}
    with open(image_path, "rb") as handle:
        response = client.post(
            "/api/datasets/upload",
            data={"metadata": json.dumps(payload)},
            files={"file": (image_path.name, handle, "image/png")},
        )
    assert response.status_code == 200, response.text
    return response.json()


def is_png(payload: bytes) -> bool:
    return payload.startswith(b"\x89PNG\r\n\x1a\n")


def open_image(payload: bytes) -> Image.Image:
    return Image.open(io.BytesIO(payload))


# --- fixtures ----------------------------------------------------------------------------


@pytest.fixture(scope="session")
def client():
    """A TestClient with the lifespan run.

    Entering the context manager triggers `init_app()`, i.e. `alembic upgrade head`, so every
    test run exercises the migration chain against a fresh database.
    """
    with TestClient(fastapi_app) as test_client:
        yield test_client


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _isolate(client):
    """Each test starts with an empty database, an empty data dir and a cold registry cache."""
    yield
    with engine.begin() as conn:
        # Reverse topological order so foreign keys never block the delete.
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    for child in APP_DATA_DIR.iterdir():
        shutil.rmtree(child, ignore_errors=True) if child.is_dir() else child.unlink(missing_ok=True)
    invalidate_registry_cache()


@pytest.fixture()
def hsi(client, tmp_path):
    """An uploaded 4x3x5 HSI cube; returns its DatasetMeta."""
    return upload_hsi(client, write_envi_cube(tmp_path / "cube.hdr"))


@pytest.fixture()
def visual(client, tmp_path):
    """An uploaded 6x4 PNG registered as an XRF map; returns its DatasetMeta."""
    return upload_visual(client, write_png(tmp_path / "xrf_map.png"))


@pytest.fixture()
def library(client, tmp_path):
    """An uploaded 3-spectrum reference library; returns {"id", "label"}."""
    return upload_library(client, write_spectral_library(tmp_path / "kremer.hdr"))
