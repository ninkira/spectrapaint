"""Radiance to reflectance — flat-field correction and the upload path that applies it."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.core.preprocessing.reflectance import (
    ReferenceMismatch,
    average_reference,
    correction_planes,
    dead_fraction,
    open_cube,
    to_reflectance,
    valid_band_range,
    write_reflectance_cube,
)
from app.db.models import HsiCube
from app.paths import APP_DATA_DIR

from conftest import write_cube_array

LINES, SAMPLES, BANDS = 6, 4, 5
WAVELENGTHS = [400.0, 450.0, 500.0, 550.0, 600.0]


def specim_set(
    folder: Path, stem: str = "087", *, lamp_profile: list[float] | None = None
) -> tuple[dict[str, Path], np.ndarray]:
    """Write a Specim-shaped capture set and return its paths plus the reflectance it encodes.

    The sample is built *from* a known reflectance — radiance = truth * lamp + dark — so a test
    can assert the correction recovers that exact array rather than merely "something plausible".
    The lamp climbs steeply across the bands and varies per detector column, which is the
    illumination shape flat-fielding exists to remove.

    `lamp_profile` overrides the per-band lamp output, which is what decides where the detector
    is blind: a profile that collapses at both ends gives a set with dead band edges.
    """
    rng = np.random.default_rng(7)
    truth = rng.uniform(0.1, 0.9, (LINES, SAMPLES, BANDS)).astype(np.float32)
    profile = (
        np.linspace(1.0, 5.0, BANDS) if lamp_profile is None else np.asarray(lamp_profile, float)
    )
    lamp = profile[None, :] * rng.uniform(0.9, 1.1, (SAMPLES, 1))
    dark = rng.uniform(90, 110, (SAMPLES, BANDS)).astype(np.float32)
    white_dark = rng.uniform(40, 60, (SAMPLES, BANDS)).astype(np.float32)

    frames = 8  # a reference capture is a short burst of frames, not a full scan
    paths = {
        "sample": write_cube_array(
            folder / f"{stem}.hdr", truth * lamp[None] + dark[None], WAVELENGTHS
        ),
        "dark": write_cube_array(
            folder / f"DARKREF_{stem}.hdr", np.repeat(dark[None], frames, 0), WAVELENGTHS
        ),
        "white": write_cube_array(
            folder / f"WHITEREF_{stem}.hdr",
            np.repeat((lamp + white_dark)[None], frames, 0),
            WAVELENGTHS,
        ),
        "white_dark": write_cube_array(
            folder / f"WHITEDARKREF_{stem}.hdr", np.repeat(white_dark[None], frames, 0), WAVELENGTHS
        ),
    }
    return paths, truth


def upload_with_references(
    client, paths: dict[str, Path], *, roles=("dark", "white", "white_dark"), **meta
) -> tuple[int, dict]:
    """POST a cube plus the named reference captures; return (status, body)."""
    payload = {
        "data_kind": "hsi",
        "target_modality": "HSI",
        "convert_to_reflectance": True,
        **meta,
    }
    handles, files = [], {}

    def add(field: str, hdr: Path) -> None:
        binary = hdr.with_suffix(".img")
        for name, path in ((field, hdr), (f"{field}_data", binary)):
            handle = open(path, "rb")
            handles.append(handle)
            files[name] = (path.name, handle, "application/octet-stream")

    try:
        sample = paths["sample"]
        for name, path in (("file", sample), ("data", sample.with_suffix(".img"))):
            handle = open(path, "rb")
            handles.append(handle)
            files[name] = (path.name, handle, "application/octet-stream")
        for role in roles:
            add(role, paths[role])
        response = client.post(
            "/api/datasets/upload", data={"metadata": json.dumps(payload)}, files=files
        )
    finally:
        for handle in handles:
            handle.close()
    return response.status_code, response.json()


# --- the correction itself ----------------------------------------------------------------


def read_cube(hdr_path: Path) -> np.ndarray:
    with open_cube(hdr_path) as img:
        return np.asarray(img.load(), dtype=np.float32)


def test_correction_recovers_a_known_reflectance(tmp_path):
    paths, truth = specim_set(tmp_path)
    dest = tmp_path / "out.hdr"
    write_reflectance_cube(
        radiance_hdr=paths["sample"],
        dark_hdr=paths["dark"],
        white_hdr=paths["white"],
        white_dark_hdr=paths["white_dark"],
        dest_hdr=dest,
    )
    got = read_cube(dest)

    assert got.shape == truth.shape
    assert np.abs(got - truth).max() < 1e-4


def test_the_white_capture_uses_its_own_dark(tmp_path):
    """WHITEDARKREF is not interchangeable with DARKREF: the white capture is taken at a
    different integration time, so reusing the sample's dark skews the denominator."""
    paths, truth = specim_set(tmp_path)
    dest = tmp_path / "no_white_dark.hdr"
    write_reflectance_cube(
        radiance_hdr=paths["sample"],
        dark_hdr=paths["dark"],
        white_hdr=paths["white"],
        white_dark_hdr=None,  # falls back to the sample's dark
        dest_hdr=dest,
    )
    got = read_cube(dest)

    # It still produces a cube, but a visibly wrong one — that is why the fourth file matters.
    assert np.abs(got - truth).max() > 0.1


def test_averaging_a_reference_collapses_its_frames(tmp_path):
    plane = np.arange(SAMPLES * BANDS, dtype=np.float32).reshape(SAMPLES, BANDS)
    hdr = write_cube_array(tmp_path / "ref.hdr", np.repeat(plane[None], 8, 0), WAVELENGTHS)

    with open_cube(hdr) as img:
        averaged = average_reference(img)
    assert averaged.shape == (SAMPLES, BANDS)
    assert np.allclose(averaged, plane)


def test_dead_cells_are_zeroed_rather_than_infinite():
    """Where white and white-dark agree there is no signal to normalise against; dividing would
    turn sensor noise into huge values, so those cells come back as 0."""
    dark = np.zeros((2, 3), dtype=np.float32)
    white = np.array([[5.0, 5.0, 5.0], [5.0, 5.0, 5.0]], dtype=np.float32)
    white_dark = np.array([[0.0, 5.0, 0.0], [0.0, 0.0, 5.0]], dtype=np.float32)

    plane, denominator = correction_planes(dark, white, white_dark)
    radiance = np.full((4, 2, 3), 2.5, dtype=np.float32)
    out = to_reflectance(radiance, plane, denominator)

    assert np.isfinite(out).all()
    assert out[:, 0, 1].tolist() == [0.0, 0.0, 0.0, 0.0]  # white == white_dark -> zeroed
    assert out[:, 1, 2].tolist() == [0.0, 0.0, 0.0, 0.0]
    assert np.allclose(out[:, 0, 0], 0.5)                 # 2.5 / (5 - 0)
    assert dead_fraction(denominator) == pytest.approx(2 / 6)


# --- the usable band range ----------------------------------------------------------------


def plane(response: list[float], samples: int = 6) -> np.ndarray:
    """A (samples, bands) denominator whose every column has the given per-band response."""
    return np.repeat(np.asarray(response, dtype=np.float32)[None, :], samples, axis=0)


def test_dead_band_edges_fall_outside_the_derived_range():
    """A VNIR detector's shape in miniature: blind at both ends, strong in the middle. Those
    ends are where the correction divides noise by noise, so they are what the range excludes."""
    assert valid_band_range(plane([2.0, 5.0, 50.0, 100.0, 90.0, 40.0, 4.0, 1.0])) == (2, 5)


def test_a_detector_that_is_good_throughout_keeps_every_band():
    assert valid_band_range(plane([90.0, 95.0, 100.0, 98.0, 92.0])) == (0, 4)


def test_only_one_edge_may_be_dead():
    """Nothing says the two ends fail together — a range with one open end is still a range."""
    assert valid_band_range(plane([1.0, 2.0, 60.0, 100.0, 95.0])) == (2, 4)


def test_a_noise_spike_in_the_dead_region_does_not_widen_the_range():
    """One band out in the dead zone can cross the threshold on noise alone. Taking the longest
    run rather than the outermost passing bands is what stops it dragging the boundary back."""
    assert valid_band_range(plane([1.0, 80.0, 1.0, 1.0, 50.0, 100.0, 60.0, 2.0])) == (4, 6)


def test_a_hot_column_does_not_speak_for_a_blind_band():
    """The response is a median across the detector's columns, not a mean: a pushbroom sensor
    has hot and dead columns, and one saturated column must not rescue a band that saw nothing."""
    denominator = np.full((9, 4), 100.0, dtype=np.float32)
    denominator[:, 0] = 1.0          # band 0 is blind in every column ...
    denominator[0, 0] = 10_000.0     # ... except one, which is broken
    assert valid_band_range(denominator) == (1, 3)


def test_a_white_reference_with_no_signal_has_no_range_at_all():
    """Better to report nothing than to invent a range: an empty or mis-captured white
    reference gives no basis for one, and saying so is what prompts a user to set it by hand."""
    assert valid_band_range(np.zeros((4, 6), dtype=np.float32)) is None
    assert valid_band_range(np.zeros((0, 0), dtype=np.float32)) is None


def test_the_correction_reports_the_range_it_derived(tmp_path):
    paths, _ = specim_set(tmp_path, lamp_profile=[0.02, 2.0, 5.0, 3.0, 0.03])
    correction = write_reflectance_cube(
        radiance_hdr=paths["sample"],
        dark_hdr=paths["dark"],
        white_hdr=paths["white"],
        white_dark_hdr=paths["white_dark"],
        dest_hdr=tmp_path / "edges.hdr",
    )
    # The lamp puts out a hundredth of its mid-range output in bands 0 and 4.
    assert correction.valid_bands == (1, 3)
    assert correction.metadata["data type"] == 4


def test_the_upload_records_the_derived_range_on_the_corrected_cube(client, db, tmp_path):
    """The range has to be stored at correction time: by the time anything classifies this cube
    the reference captures are closed, and they are the only thing that knew where it was blind."""
    paths, _ = specim_set(tmp_path, lamp_profile=[0.02, 2.0, 5.0, 3.0, 0.03])
    status, meta = upload_with_references(client, paths, title="Dead edges")
    assert status == 200, meta

    cubes = {cube.processing_level: cube for cube in db.query(HsiCube).all()}
    assert (cubes["reflectance"].valid_band_min, cubes["reflectance"].valid_band_max) == (1, 3)
    # The radiance cube was never divided by anything, so no range applies to it.
    assert cubes["radiance"].valid_band_min is None
    assert cubes["radiance"].valid_band_max is None

    # And it reaches the client, which needs it to shade the excluded part of the plot.
    listed = {item["id"]: item for item in client.get("/api/datasets").json()}
    assert listed[meta["id"]]["valid_band_min"] == 1
    assert listed[meta["id"]]["valid_band_max"] == 3


def test_a_reference_from_another_sensor_is_rejected(tmp_path):
    paths, _ = specim_set(tmp_path)
    wrong = write_cube_array(
        tmp_path / "wrong.hdr", np.ones((4, SAMPLES + 3, BANDS), dtype=np.float32)
    )
    with pytest.raises(ReferenceMismatch, match="samples x bands"):
        write_reflectance_cube(
            radiance_hdr=paths["sample"],
            dark_hdr=wrong,
            white_hdr=paths["white"],
            white_dark_hdr=None,
            dest_hdr=tmp_path / "never.hdr",
        )


# --- through the upload endpoint ----------------------------------------------------------


def test_upload_registers_both_the_radiance_and_the_reflectance_cube(client, db, tmp_path):
    paths, truth = specim_set(tmp_path)
    status, meta = upload_with_references(client, paths, title="Old Man")
    assert status == 200, meta

    cubes = {cube.processing_level: cube for cube in db.query(HsiCube).all()}
    assert set(cubes) == {"radiance", "reflectance"}
    assert cubes["reflectance"].derived_from_dataset_id == cubes["radiance"].dataset_id
    assert cubes["radiance"].derived_from_dataset_id is None
    assert cubes["reflectance"].title == "Old Man (reflectance)"

    # The upload answers with the corrected cube, since that is the one worth opening.
    assert meta["id"] == cubes["reflectance"].dataset_id

    listed = {item["id"] for item in client.get("/api/datasets").json()}
    assert listed == {cubes["radiance"].dataset_id, cubes["reflectance"].dataset_id}


def test_the_registered_reflectance_cube_serves_corrected_spectra(client, tmp_path):
    paths, truth = specim_set(tmp_path)
    status, meta = upload_with_references(client, paths, title="Old Man")
    assert status == 200, meta

    body = client.get(f"/api/datasets/{meta['id']}/spectra", params={"x": 2, "y": 1}).json()
    assert body["wavelengths_nm"] == WAVELENGTHS
    assert body["values"] == pytest.approx(truth[1, 2, :].tolist(), abs=1e-4)


def test_the_capture_session_records_which_references_were_supplied(client, db, tmp_path):
    paths, _ = specim_set(tmp_path)
    status, meta = upload_with_references(client, paths)
    assert status == 200, meta

    body = client.get(f"/api/datasets/{meta['id']}/db-meta").json()
    assert body["acquisition"]["dark_reference"] is True
    assert body["acquisition"]["white_reference"] is True


def test_conversion_without_a_white_reference_is_refused(client, db, tmp_path):
    paths, _ = specim_set(tmp_path)
    status, body = upload_with_references(client, paths, roles=("dark",))

    assert status == 400
    assert "white reference" in body["detail"]
    # The refusal must not leave a half-registered dataset behind.
    assert db.query(HsiCube).count() == 0
    assert client.get("/api/datasets").json() == []


def test_a_mismatched_reference_is_refused_and_registers_nothing(client, db, tmp_path):
    paths, _ = specim_set(tmp_path)
    paths["dark"] = write_cube_array(
        tmp_path / "DARKREF_wrong.hdr", np.ones((4, SAMPLES + 2, BANDS), dtype=np.float32)
    )
    status, body = upload_with_references(client, paths)

    assert status == 400
    assert "same scanner" in body["detail"]
    assert db.query(HsiCube).count() == 0


def test_uploading_without_conversion_still_registers_one_plain_cube(client, db, tmp_path):
    paths, _ = specim_set(tmp_path)
    status, meta = upload_with_references(
        client, paths, roles=(), convert_to_reflectance=False, title="Raw only"
    )
    assert status == 200, meta

    cube = db.query(HsiCube).one()
    assert cube.processing_level is None
    assert cube.derived_from_dataset_id is None
    assert cube.reference_refs is None
    assert reference_files() == []


# --- the stored reference captures --------------------------------------------------------


def reference_files() -> list[Path]:
    """Every reference capture stored anywhere in the data folder — headers and binaries alike.

    Globbed from disk rather than read from the database on purpose: these files are not
    datasets, so the point of the assertions below is precisely what is left on the filesystem
    once the app believes it has deleted everything.
    """
    return sorted(p for p in APP_DATA_DIR.rglob("references/*") if p.is_file())


def converted_upload(client, db, tmp_path, *, stem: str = "087") -> dict[str, str]:
    """Upload a Specim set with conversion on; return its two dataset ids by processing level.

    The upload answers with the reflectance cube, and that cube records the scan it came from,
    so one response is enough to name both — no guessing at ids derived from file names.
    """
    paths, _ = specim_set(tmp_path, stem)
    status, meta = upload_with_references(client, paths, title=f"Old Man {stem}")
    assert status == 200, meta
    db.expire_all()
    reflectance = db.query(HsiCube).filter(HsiCube.dataset_id == meta["id"]).one()
    return {
        "reflectance": reflectance.dataset_id,
        "radiance": reflectance.derived_from_dataset_id,
    }


def test_the_references_are_removed_with_the_last_cube_that_needs_them(client, db, tmp_path):
    """Three captures, six files, and no dataset of their own — deleting the two cubes they
    belong to is the only thing that can ever reclaim them."""
    cubes = converted_upload(client, db, tmp_path)
    assert len(reference_files()) == 6

    assert client.delete(f"/api/datasets/{cubes['reflectance']}").status_code == 200
    # The radiance cube is still here, and re-deriving a reflectance cube from it needs these.
    assert len(reference_files()) == 6

    assert client.delete(f"/api/datasets/{cubes['radiance']}").status_code == 200
    assert reference_files() == []
    # The folder goes too, rather than lingering empty in the user's data directory.
    assert list(APP_DATA_DIR.rglob("references")) == []


def test_deleting_the_radiance_cube_leaves_the_references_for_the_derived_one(client, db, tmp_path):
    """The other deletion order. The references belong to the scan, but the reflectance cube is
    the evidence trail they document, so they outlive the scan while it exists."""
    cubes = converted_upload(client, db, tmp_path)

    assert client.delete(f"/api/datasets/{cubes['radiance']}").status_code == 200
    assert len(reference_files()) == 6

    assert client.delete(f"/api/datasets/{cubes['reflectance']}").status_code == 200
    assert reference_files() == []


def test_one_capture_set_is_deleted_without_disturbing_another(client, db, tmp_path):
    """Every project keeps its references in one folder, so removing one set's files must leave
    the next scan's alone."""
    first = converted_upload(client, db, tmp_path, stem="087")
    second = converted_upload(client, db, tmp_path, stem="088")
    assert len(reference_files()) == 12

    for dataset_id in first.values():
        assert client.delete(f"/api/datasets/{dataset_id}").status_code == 200

    kept = reference_files()
    assert len(kept) == 6
    assert all("088" in path.name for path in kept)

    db.expire_all()
    surviving = db.query(HsiCube).filter(HsiCube.dataset_id == second["reflectance"]).one()
    assert set(surviving.reference_refs) == {"dark", "white", "white_dark"}
