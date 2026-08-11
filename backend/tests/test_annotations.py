"""ROI annotation persistence (WADM mapping) and the legacy JSON import."""
from __future__ import annotations

import json
import uuid

import pytest

from app.db.models import (
    ExternalInput,
    HsiCube,
    ProcessingOperation,
    RoiAnnotation,
    SpectralExtraction,
)
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
    external = db.query(ExternalInput).one()

    assert row.dataset_id == visual["id"]
    # The ROI targets the raster input, not a cube, and the WADM target is that row's IRI.
    assert row.cube_id is None
    assert row.external_input_id == external.input_id
    assert row.target == f"urn:uuid:{external.input_id}"


def test_an_roi_targets_exactly_one_source(client, db, hsi, visual):
    """Fig. 3: an ROI is associated with one HSI Cube or one External Input, never both."""
    put_annotations(client, hsi["id"], [rect_annotation()])
    put_annotations(client, visual["id"], [rect_annotation()])

    for row in db.query(RoiAnnotation).all():
        assert (row.cube_id is not None) != (row.external_input_id is not None)


def test_the_single_source_check_is_enforced(client, db, hsi, visual):
    """The database refuses a row linked to both, not just the code path that writes them."""
    from sqlalchemy.exc import IntegrityError

    cube = db.query(HsiCube).one()
    external = db.query(ExternalInput).one()
    db.add(RoiAnnotation(
        roi_id=uuid.uuid4(),
        selector_type="SvgSelector",
        selector_value="<rect/>",
        target="both",
        motivation="highlighting",
        cube_id=cube.cube_id,
        external_input_id=external.input_id,
        data={},
    ))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_legacy_json_annotations_are_imported_on_first_read(client, hsi):
    from app.api.routes_datasets import _annotation_file_path

    legacy = _annotation_file_path(hsi["id"])
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(json.dumps({"annotations": [rect_annotation()]}), encoding="utf-8")

    imported = client.get(f"/api/datasets/{hsi['id']}/annotations").json()["annotations"]
    assert len(imported) == 1
    assert imported[0]["title"] == "Darkened blue area"


def test_re_saving_an_annotation_that_has_an_extraction_does_not_fail(client, db, hsi):
    """Regression: a bulk delete here bypassed the ORM cascade and tripped the FK constraint."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    assert db.query(SpectralExtraction).count() == 1  # saving extracted spectra automatically

    assert put_annotations(client, hsi["id"], [annotation]).status_code == 200
    assert db.query(SpectralExtraction).count() == 1


def test_editing_an_annotation_keeps_its_extraction(client, db, hsi):
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])

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
    assert db.query(SpectralExtraction).count() == 2

    put_annotations(client, hsi["id"], [keep])

    db.expire_all()
    assert [r.roi_id for r in db.query(RoiAnnotation).all()] == [uuid.UUID(keep["id"])]
    assert db.query(SpectralExtraction).count() == 1
    assert db.query(SpectralExtraction).one().roi_id == uuid.UUID(keep["id"])


def test_removing_an_annotation_keeps_the_classification_run_that_used_it(client, db, hsi):
    """The extraction goes, but the ProcessingOperation is detached rather than deleted."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    db.add(ProcessingOperation(
        operation_id=uuid.uuid4(),
        operation_type="classification",
        method_name="klpd",
        parameters={},
        software_version="SpectraPaint",
        input_extraction_id=stable_id("extraction", annotation["id"]),
    ))
    db.commit()

    assert put_annotations(client, hsi["id"], []).status_code == 200

    db.expire_all()
    assert db.query(SpectralExtraction).count() == 0
    operation = db.query(ProcessingOperation).one()  # history survives
    assert operation.input_extraction_id is None


def test_saving_an_roi_extracts_its_spectra(client, db, hsi):
    """Fig. 4: ROI selection triggers Spectral Extraction — mean, std and pixel count."""
    annotation = rect_annotation()  # 2x2 box at the origin
    put_annotations(client, hsi["id"], [annotation])

    extraction = db.query(SpectralExtraction).one()
    assert extraction.roi_id == uuid.UUID(annotation["id"])
    assert extraction.pixel_count == 4
    # Cube values are y*100 + x*10 + b, so band 0 over (0,0),(1,0),(0,1),(1,1) averages 55.
    assert extraction.mean_spectrum[0] == pytest.approx(55.0)
    assert extraction.std_spectrum[0] == pytest.approx(58.023, abs=0.01)  # ddof=1
    assert extraction.min_spectrum[0] == pytest.approx(0.0)
    assert extraction.max_spectrum[0] == pytest.approx(110.0)
    assert extraction.wavelength_range == "400.0-600.0 nm"
    # An extraction is derived from its cube; only a classification associates a library.
    assert extraction.library_id is None


@pytest.mark.parametrize(
    ("shape", "geometry", "expected_pixels"),
    [
        ("rect", {"x": 0, "y": 0, "w": 4, "h": 3}, 12),          # the whole 4x3 cube
        ("point", {"x": 2, "y": 1}, 1),
        # matplotlib's contains_points excludes the y=0 boundary row, so a polygon tracing the
        # full extent yields 8 rather than 12. Pre-existing behaviour of the polygon endpoint.
        ("polygon", [{"x": 0, "y": 0}, {"x": 3, "y": 0}, {"x": 3, "y": 2}, {"x": 0, "y": 2}], 8),
        ("polygon", [{"x": 0, "y": 0}, {"x": 3, "y": 0}, {"x": 3, "y": 2}], 3),
        ("line", [{"x": 0, "y": 0}, {"x": 3, "y": 0}], 4),
        ("line", [{"x": 0, "y": 0}, {"x": 3, "y": 0}, {"x": 3, "y": 2}], 6),  # multi-point polyline
        ("ellipse", {"cx": 1, "cy": 1, "rx": 1, "ry": 1}, 5),
    ],
)
def test_every_roi_shape_extracts(client, db, hsi, shape, geometry, expected_pixels):
    if shape == "polygon":
        geometry = {"vertices": geometry}
    elif shape == "line":
        geometry = {"points": geometry}
    put_annotations(client, hsi["id"], [rect_annotation(type=shape, geometry=geometry)])
    assert db.query(SpectralExtraction).one().pixel_count == expected_pixels


def test_an_unchanged_roi_is_not_re_extracted(client, db, hsi):
    """The guard that keeps a dataset with thirty ROIs from re-reading the cube thirty times."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])

    # Tag the stored row; a recompute would overwrite it.
    db.query(SpectralExtraction).one().mean_spectrum = [-1.0]
    db.commit()

    annotation["title"] = "Only the label changed"
    put_annotations(client, hsi["id"], [annotation])

    db.expire_all()
    assert db.query(SpectralExtraction).one().mean_spectrum == [-1.0]


def test_a_placeholder_extraction_is_upgraded_on_the_next_save(client, db, hsi):
    """A classification on an unsaved ROI leaves pixel_count=0; saving must fill in the real one."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    extraction = db.query(SpectralExtraction).one()
    extraction.pixel_count = 0          # what a pre-W3-3 classification run left behind
    extraction.std_spectrum = []
    db.commit()

    put_annotations(client, hsi["id"], [annotation])  # same geometry

    db.expire_all()
    refreshed = db.query(SpectralExtraction).one()
    assert refreshed.pixel_count == 4
    assert len(refreshed.std_spectrum) == 5


def test_moving_an_roi_recomputes_its_spectra(client, db, hsi):
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    assert db.query(SpectralExtraction).one().pixel_count == 4

    annotation["geometry"] = {"x": 0, "y": 0, "w": 4, "h": 3}
    put_annotations(client, hsi["id"], [annotation])

    db.expire_all()
    assert db.query(SpectralExtraction).one().pixel_count == 12


def test_an_roi_on_a_visual_gets_no_extraction(client, db, visual):
    """External inputs enter the pipeline for annotation only, not for spectral processing."""
    put_annotations(client, visual["id"], [rect_annotation()])
    assert db.query(RoiAnnotation).count() == 1
    assert db.query(SpectralExtraction).count() == 0


def test_a_malformed_geometry_still_saves_the_annotation(client, db, hsi):
    """Extraction is best-effort — a geometry we cannot mask must not block the save."""
    response = put_annotations(client, hsi["id"], [
        rect_annotation(type="rect", geometry={"nonsense": True}),
    ])
    assert response.status_code == 200
    assert db.query(RoiAnnotation).count() == 1
    assert db.query(SpectralExtraction).count() == 0


def test_extraction_endpoint_serves_a_saved_roi(client, hsi):
    """W3-6: selecting a saved ROI reads its spectra back instead of finding nothing."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])

    body = client.get(
        f"/api/datasets/{hsi['id']}/annotations/{annotation['id']}/extraction"
    ).json()

    assert body["stats"]["n_pixels"] == 4
    assert body["stats"]["mean"][0] == pytest.approx(55.0)
    assert len(body["stats"]["std"]) == 5
    assert body["wavelengths_nm"] == [400.0, 450.0, 500.0, 550.0, 600.0]
    assert body["wavelength_range"] == "400.0-600.0 nm"


def test_extraction_endpoint_404s_for_an_unmeasured_roi(client, visual):
    """An ROI on an external input has no spectra, and says so rather than returning empty."""
    annotation = rect_annotation()
    put_annotations(client, visual["id"], [annotation])

    response = client.get(
        f"/api/datasets/{visual['id']}/annotations/{annotation['id']}/extraction"
    )
    assert response.status_code == 404


def test_extraction_endpoint_hides_classification_placeholders(client, db, hsi):
    """A pixel_count=0 row has a client-supplied mean and no std — not worth plotting."""
    annotation = rect_annotation()
    put_annotations(client, hsi["id"], [annotation])
    row = db.query(SpectralExtraction).one()
    row.pixel_count = 0
    row.std_spectrum = []
    db.commit()

    response = client.get(
        f"/api/datasets/{hsi['id']}/annotations/{annotation['id']}/extraction"
    )
    assert response.status_code == 404


def test_duplicate_ids_in_one_payload_are_collapsed(client, db, hsi):
    roi_id = str(uuid.uuid4())
    response = put_annotations(client, hsi["id"], [
        rect_annotation(roi_id, title="first"),
        rect_annotation(roi_id, title="second"),
    ])
    assert response.json()["count"] == 1
    assert db.query(RoiAnnotation).one().body == "first"
