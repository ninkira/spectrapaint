"""ROI annotation persistence (WADM mapping) and the legacy JSON import."""
from __future__ import annotations

import json
import uuid

import pytest

from app.db.models import ProcessingOperation, RoiAnnotation, SpectralExtraction
from app.db.ids import stable_id


def rect_annotation(roi_id: str | None = None, **overrides) -> dict:
    annotation = {
        "id": roi_id or str(uuid.uuid4()),
        "kind": "region",
        "type": "rect",
        "geometry": {"x": 0, "y": 0, "w": 2, "h": 2},
        "title": "Darkened blue area",
        "motivation": ["describing", "identifying"],
        "creator": "tester",
    }
    annotation.update(overrides)
    return annotation


def put_annotations(client, dataset_id: str, annotations: list[dict]):
    return client.put(f"/api/datasets/{dataset_id}/annotations", json={"annotations": annotations})


def test_annotations_start_empty(client, hsi):
    body = client.get(f"/api/datasets/{hsi['id']}/annotations").json()
    assert body == {"dataset_id": hsi["id"], "annotations": []}


def test_annotations_round_trip_losslessly(client, hsi):
    annotation = rect_annotation()
    assert put_annotations(client, hsi["id"], [annotation]).json() == {"ok": True, "count": 1}

    stored = client.get(f"/api/datasets/{hsi['id']}/annotations").json()["annotations"]
    assert len(stored) == 1
    # `data` keeps the app-native object verbatim so the UI round-trips unchanged.
    assert stored[0]["geometry"] == annotation["geometry"]
    assert stored[0]["motivation"] == annotation["motivation"]
    assert stored[0]["id"] == annotation["id"]


def test_annotation_maps_onto_wadm_columns(client, db, hsi):
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])

    row = db.query(RoiAnnotation).one()
    assert row.selector_type == "SvgSelector"
    assert row.selector_value == '<rect x="0" y="0" width="2" height="2"/>'
    assert row.body == "Darkened blue area"
    assert row.body_format == "text/plain"
    assert row.motivation == "describing identifying"
    assert row.creator == "tester"
    assert row.generator == "SpectraPaint"
    # The ROI is linked to its cube, and the WADM target is that cube's IRI.
    assert row.cube_id == stable_id("cube", hsi["id"])
    assert row.target == f"urn:uuid:{stable_id('cube', hsi['id'])}"


def test_put_replaces_the_previous_set(client, hsi):
    put_annotations(client, hsi["id"], [rect_annotation(), rect_annotation()])
    assert put_annotations(client, hsi["id"], [rect_annotation()]).json()["count"] == 1
    assert len(client.get(f"/api/datasets/{hsi['id']}/annotations").json()["annotations"]) == 1


def test_point_annotation_uses_a_circle_selector(client, db, hsi):
    """Fig. 6 of the paper: point annotations marking previously analysed spots."""
    put_annotations(client, hsi["id"], [
        rect_annotation(kind="probe", type="point", geometry={"x": 2, "y": 1}),
    ])
    row = db.query(RoiAnnotation).one()
    assert row.selector_value == '<circle cx="2" cy="1" r="1"/>'


def test_annotations_on_a_visual_are_accepted(client, db, visual):
    """Cross-modal annotation: the ROI model spans every modality, not just HSI."""
    put_annotations(client, visual["id"], [rect_annotation()])
    row = db.query(RoiAnnotation).one()
    assert row.dataset_id == visual["id"]
    # No cube to link to, so the WADM target degrades to the bare dataset id.
    assert row.cube_id is None
    assert row.target == visual["id"]


def test_legacy_json_annotations_are_imported_on_first_read(client, hsi):
    from app.api.routes_datasets import _annotation_file_path

    legacy = _annotation_file_path(hsi["id"])
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(json.dumps({"annotations": [rect_annotation()]}), encoding="utf-8")

    imported = client.get(f"/api/datasets/{hsi['id']}/annotations").json()["annotations"]
    assert len(imported) == 1
    assert imported[0]["title"] == "Darkened blue area"


def add_extraction(db, annotation: dict) -> SpectralExtraction:
    """Attach a SpectralExtraction to a saved ROI, as running a classification would."""
    extraction = SpectralExtraction(
        extraction_id=stable_id("extraction", annotation["id"]),
        roi_id=uuid.UUID(annotation["id"]),
        mean_spectrum=[1.0, 2.0],
        std_spectrum=[0.1, 0.2],
        pixel_count=4,
    )
    db.add(extraction)
    db.commit()
    return extraction


def test_re_saving_an_annotation_that_has_an_extraction_does_not_fail(client, db, hsi):
    """Regression: a bulk delete here bypassed the ORM cascade and tripped the FK constraint."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    add_extraction(db, annotation)

    assert put_annotations(client, hsi["id"], [annotation]).status_code == 200
    assert db.query(SpectralExtraction).count() == 1


def test_editing_an_annotation_keeps_its_extraction(client, db, hsi):
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    add_extraction(db, annotation)

    annotation["title"] = "Renamed region"
    put_annotations(client, hsi["id"], [annotation])

    db.expire_all()
    assert db.query(RoiAnnotation).one().body == "Renamed region"
    assert db.query(SpectralExtraction).count() == 1


def test_editing_an_annotation_preserves_its_created_timestamp(client, db, hsi):
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    created = db.query(RoiAnnotation).one().created

    annotation["title"] = "Second thoughts"
    put_annotations(client, hsi["id"], [annotation])

    db.expire_all()
    row = db.query(RoiAnnotation).one()
    assert row.created == created  # WADM `created` belongs to the original, not to this save
    assert row.body == "Second thoughts"


def test_removing_an_annotation_deletes_its_extraction(client, db, hsi):
    keep, drop = rect_annotation(), rect_annotation()
    put_annotations(client, hsi["id"], [keep, drop])
    add_extraction(db, drop)

    put_annotations(client, hsi["id"], [keep])

    db.expire_all()
    assert [r.roi_id for r in db.query(RoiAnnotation).all()] == [uuid.UUID(keep["id"])]
    assert db.query(SpectralExtraction).count() == 0


def test_removing_an_annotation_keeps_the_classification_run_that_used_it(client, db, hsi):
    """The extraction goes, but the ProcessingOperation is detached rather than deleted."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    extraction = add_extraction(db, annotation)
    db.add(ProcessingOperation(
        operation_id=uuid.uuid4(),
        operation_type="classification",
        method_name="klpd",
        parameters={},
        software_version="SpectraPaint",
        input_extraction_id=extraction.extraction_id,
    ))
    db.commit()

    assert put_annotations(client, hsi["id"], []).status_code == 200

    db.expire_all()
    assert db.query(SpectralExtraction).count() == 0
    operation = db.query(ProcessingOperation).one()  # history survives
    assert operation.input_extraction_id is None


def test_duplicate_ids_in_one_payload_are_collapsed(client, db, hsi):
    roi_id = str(uuid.uuid4())
    response = put_annotations(client, hsi["id"], [
        rect_annotation(roi_id, title="first"),
        rect_annotation(roi_id, title="second"),
    ])
    assert response.json()["count"] == 1
    assert db.query(RoiAnnotation).one().body == "first"
