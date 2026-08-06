"""Dataset ingestion, listing, metadata and rendering endpoints."""
from __future__ import annotations

from sqlalchemy import text

from app.db.ids import stable_id
from app.db.models import DataAcquisition, ExternalInput, HsiCube, Project
from app.services.dataset_store import invalidate_registry_cache

from conftest import is_png, open_image, upload_hsi, upload_visual, write_envi_cube, write_png


def test_healthz(client):
    assert client.get("/healthz").json() == {"ok": True}


def test_list_datasets_is_empty_before_any_upload(client):
    assert client.get("/api/datasets").json() == []


def test_upload_hsi_registers_cube_and_acquisition(client, db, tmp_path):
    meta = upload_hsi(client, write_envi_cube(tmp_path / "cube.hdr"), title="Test Cube")

    assert meta["type"] == "hsi"
    assert meta["name"] == "Test Cube"
    assert (meta["width"], meta["height"]) == (4, 3)
    assert meta["wavelengths_nm"] == [400.0, 450.0, 500.0, 550.0, 600.0]

    cube = db.query(HsiCube).one()
    assert (cube.samples, cube.lines, cube.number_of_bands) == (4, 3, 5)
    assert cube.title == "Test Cube"
    # The upload must build the full Project -> Object -> Acquisition -> Cube backbone.
    assert db.query(Project).count() == 1
    acquisition = db.get(DataAcquisition, cube.acquisition_id)
    assert acquisition is not None
    assert acquisition.capture_modality == "HSI"
    assert acquisition.envi_available is True


def test_uploaded_hsi_appears_in_the_listing(client, hsi):
    listed = client.get("/api/datasets").json()
    assert [item["id"] for item in listed] == [hsi["id"]]


def test_dataset_metadata_reports_envi_header_fields(client, hsi):
    body = client.get(f"/api/datasets/{hsi['id']}/metadata").json()
    assert (body["samples"], body["lines"], body["number_of_bands"]) == (4, 3, 5)
    assert body["wavelengths"][0] == 400.0
    assert body["wavelength_units"] == "nm"


def test_db_meta_exposes_the_acquisition_for_a_cube(client, hsi):
    body = client.get(f"/api/datasets/{hsi['id']}/db-meta").json()
    assert body["acquisition"]["capture_modality"] == "HSI"
    assert body["acquisition"]["envi_available"] is True
    assert body["external"] is None  # cubes have no ExternalInput row


def test_db_meta_exposes_the_import_row_for_a_visual(client, visual):
    body = client.get(f"/api/datasets/{visual['id']}/db-meta").json()
    assert body["external"]["capture_modality"] == "XRF"
    assert body["external"]["file_format"] == "png"


def test_thumbnail_and_rgb_render_png(client, hsi):
    thumbnail = client.get(f"/api/datasets/{hsi['id']}/thumbnail")
    assert thumbnail.status_code == 200
    assert is_png(thumbnail.content)

    rgb = client.get(f"/api/datasets/{hsi['id']}/rgb", params={"r": 600, "g": 500, "b": 400})
    assert rgb.status_code == 200
    assert open_image(rgb.content).size == (4, 3)


def test_upload_visual_registers_an_external_input(client, db, visual):
    assert visual["type"] == "png"  # DatasetMeta.type carries the concrete raster format
    assert (visual["width"], visual["height"]) == (6, 4)

    external = db.query(ExternalInput).one()
    assert external.capture_modality == "XRF"
    assert external.file_format == "png"
    assert db.query(HsiCube).count() == 0


def test_visual_endpoint_renders_png(client, visual):
    response = client.get(f"/api/datasets/{visual['id']}/visual")
    assert response.status_code == 200
    assert open_image(response.content).size == (6, 4)


def test_visual_endpoint_honours_max_width(client, tmp_path):
    # max_w is clamped to ge=64, so the source has to be wider than that to be downscaled.
    big = upload_visual(client, write_png(tmp_path / "big.png", width=200, height=100))
    response = client.get(f"/api/datasets/{big['id']}/visual", params={"max_w": 64})
    assert open_image(response.content).size == (64, 32)


def test_hsi_and_visual_datasets_coexist(client, hsi, visual):
    """The paper's Fig. 5 claim: cubes and raster maps live in one environment."""
    listed = client.get("/api/datasets").json()
    assert {item["type"] for item in listed} == {"hsi", "png"}


def test_delete_dataset_removes_row_and_file(client, db, hsi):
    assert client.delete(f"/api/datasets/{hsi['id']}").status_code == 200
    assert db.query(HsiCube).count() == 0
    assert client.get("/api/datasets").json() == []


def test_unknown_dataset_is_404(client):
    assert client.get("/api/datasets/nope/metadata").status_code == 404


def test_dataset_id_is_stored_on_the_row(client, db, hsi, visual):
    assert db.query(HsiCube).one().dataset_id == hsi["id"]
    assert db.query(ExternalInput).one().dataset_id == visual["id"]


def test_stored_dataset_id_still_derives_the_primary_key(client, db, hsi, visual):
    """The invariant the dataset_identity migration exists to protect.

    stable_id() turns the string id into the row's UUID primary key. If a stored id ever stops
    matching, lookups return None silently — annotations lose their cube link and DELETE stops
    deleting, with nothing raised.
    """
    cube = db.query(HsiCube).one()
    external = db.query(ExternalInput).one()
    assert cube.cube_id == stable_id("cube", cube.dataset_id)
    assert external.input_id == stable_id("input", external.dataset_id)


def test_registry_uses_the_stored_id_not_the_path(client, db, hsi):
    """Renaming the stored id must move the dataset, proving the path is no longer consulted."""
    db.query(HsiCube).one()  # ensure the row exists before we mutate it
    db.execute(
        text("UPDATE hsi_cubes SET dataset_id = :new WHERE dataset_id = :old"),
        {"new": "renamed__cube", "old": hsi["id"]},
    )
    db.commit()
    invalidate_registry_cache()

    assert [item["id"] for item in client.get("/api/datasets").json()] == ["renamed__cube"]


def test_registry_falls_back_to_the_path_when_the_id_is_missing(client, db, hsi):
    """A row predating the backfill still resolves rather than vanishing from the listing."""
    db.execute(text("UPDATE hsi_cubes SET dataset_id = NULL"))
    db.commit()
    invalidate_registry_cache()

    assert [item["id"] for item in client.get("/api/datasets").json()] == [hsi["id"]]
