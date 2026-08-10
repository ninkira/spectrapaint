"""Projects and objects — the data model's claim that one investigation spans several artefacts."""
from __future__ import annotations

import json
import uuid

from app.core.data.projects import default_object_id, default_project_id
from app.db.models import DataAcquisition, ExternalInput, HsiCube, Object, Project

from conftest import upload_hsi, upload_visual, write_envi_cube, write_png


def create_project(client, title="Second Investigation", **fields):
    response = client.post("/api/projects", json={"dc_title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_object(client, project_id, title="The Scream", **fields):
    response = client.post(f"/api/projects/{project_id}/objects", json={"dc_title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_listing_projects_creates_the_default_one(client, db):
    projects = client.get("/api/projects").json()
    assert [p["project_id"] for p in projects] == [str(default_project_id())]
    assert projects[0]["storage_root"] == "old_man"
    assert db.get(Object, default_object_id()) is not None


def test_the_default_keys_are_the_ones_existing_rows_use(client, hsi, db):
    """Uploading without a project must land on the keys legacy data already carries."""
    client.get("/api/projects")
    cube = db.query(HsiCube).one()
    acquisition = db.get(DataAcquisition, cube.acquisition_id)
    assert acquisition.object_id == default_object_id()
    assert db.get(Object, default_object_id()).project_id == default_project_id()


def test_create_a_project_with_dublin_core(client, db):
    created = create_project(
        client, "Munch Survey", dc_creator="NTNU", dc_rights="CC BY 4.0", dc_date="2026",
    )
    assert created["storage_root"] == "munch_survey"  # slugged from the title

    row = db.get(Project, uuid.UUID(created["project_id"]))
    assert (row.dc_creator, row.dc_rights, row.dc_date) == ("NTNU", "CC BY 4.0", "2026")


def test_storage_roots_must_be_unique(client):
    create_project(client, "Munch Survey")
    assert client.post("/api/projects", json={"dc_title": "Munch Survey"}).status_code == 409


def test_patch_a_project(client):
    created = create_project(client)
    patched = client.patch(
        f"/api/projects/{created['project_id']}", json={"dc_rights": "In copyright"}
    ).json()
    assert patched["dc_rights"] == "In copyright"
    assert patched["dc_title"] == created["dc_title"]  # untouched fields survive


def test_an_object_carries_all_fifteen_dublin_core_elements(client):
    project = create_project(client)
    obj = create_object(client, project["project_id"], object_pid="https://www.wikidata.org/wiki/Q1")

    elements = {
        "contributor", "coverage", "creator", "date", "description", "format", "identifier",
        "language", "publisher", "relation", "rights", "source", "subject", "title", "type",
    }
    assert {f"dc_{e}" for e in elements} <= set(obj)
    assert obj["object_pid"] == "https://www.wikidata.org/wiki/Q1"
    assert obj["object_type"] == "painting"


def test_a_project_can_hold_several_objects(client):
    """§3.4.2: several paintings by the same artist within one investigation."""
    project = create_project(client)
    create_object(client, project["project_id"], "The Scream")
    create_object(client, project["project_id"], "Madonna")

    objects = client.get(f"/api/projects/{project['project_id']}/objects").json()
    assert [o["dc_title"] for o in objects] == ["The Scream", "Madonna"]


def test_objects_of_an_unknown_project_are_404(client):
    assert client.get("/api/projects/00000000-0000-0000-0000-000000000000/objects").status_code == 404


# --- datasets belong to a project ------------------------------------------------------------


def test_upload_into_a_named_project(client, db, tmp_path):
    project = create_project(client, "Munch Survey")
    obj = create_object(client, project["project_id"], "The Scream")

    meta = upload_hsi(
        client, write_envi_cube(tmp_path / "scream.hdr"),
        project_id=project["project_id"], object_id=obj["object_id"],
    )

    cube = db.query(HsiCube).one()
    # Stored under the project's own root, not the legacy folder.
    assert cube.data_ref.startswith("munch_survey/hsi/")
    assert db.get(DataAcquisition, cube.acquisition_id).object_id == uuid.UUID(obj["object_id"])
    assert meta["id"] == "hsi__scream"


def test_datasets_can_be_filtered_by_project(client, tmp_path, hsi):
    project = create_project(client, "Munch Survey")
    other = upload_visual(
        client, write_png(tmp_path / "other.png"), project_id=project["project_id"],
    )

    everything = client.get("/api/datasets").json()
    assert {d["id"] for d in everything} == {hsi["id"], other["id"]}

    only_new = client.get("/api/datasets", params={"project_id": project["project_id"]}).json()
    assert [d["id"] for d in only_new] == [other["id"]]

    legacy = client.get("/api/datasets", params={"project_id": str(default_project_id())}).json()
    assert [d["id"] for d in legacy] == [hsi["id"]]


def test_datasets_can_be_filtered_by_object(client, tmp_path):
    project = create_project(client, "Munch Survey")
    scream = create_object(client, project["project_id"], "The Scream")
    madonna = create_object(client, project["project_id"], "Madonna")

    a = upload_visual(client, write_png(tmp_path / "a.png"),
                      project_id=project["project_id"], object_id=scream["object_id"])
    upload_visual(client, write_png(tmp_path / "b.png"),
                  project_id=project["project_id"], object_id=madonna["object_id"])

    filtered = client.get("/api/datasets", params={"object_id": scream["object_id"]}).json()
    assert [d["id"] for d in filtered] == [a["id"]]


def test_uploading_to_an_unknown_project_is_rejected(client, tmp_path):
    with open(write_png(tmp_path / "x.png"), "rb") as handle:
        response = client.post(
            "/api/datasets/upload",
            data={"metadata": json.dumps({
                "data_kind": "visual", "target_modality": "XRF",
                "project_id": "00000000-0000-0000-0000-000000000000",
            })},
            files={"file": ("x.png", handle, "image/png")},
        )
    assert response.status_code == 400
    assert "Unknown project" in response.json()["detail"]


def test_an_object_from_another_project_is_rejected(client, tmp_path):
    a = create_project(client, "Project A")
    b = create_project(client, "Project B")
    stray = create_object(client, b["project_id"], "Belongs to B")

    with open(write_png(tmp_path / "x.png"), "rb") as handle:
        response = client.post(
            "/api/datasets/upload",
            data={"metadata": json.dumps({
                "data_kind": "visual", "target_modality": "XRF",
                "project_id": a["project_id"], "object_id": stray["object_id"],
            })},
            files={"file": ("x.png", handle, "image/png")},
        )
    assert response.status_code == 400
    assert "does not belong" in response.json()["detail"]


def test_external_inputs_reach_their_object_through_the_acquisition(client, db, tmp_path):
    """Otherwise "which painting is this XRF map of?" is unanswerable in a multi-object project."""
    project = create_project(client, "Munch Survey")
    obj = create_object(client, project["project_id"], "The Scream")
    upload_visual(client, write_png(tmp_path / "map.png"),
                  project_id=project["project_id"], object_id=obj["object_id"])

    external = db.query(ExternalInput).one()
    assert external.acquisition_id is not None
    assert db.get(DataAcquisition, external.acquisition_id).object_id == uuid.UUID(obj["object_id"])
