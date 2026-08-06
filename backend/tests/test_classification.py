"""Classification: the distance metrics, the library registry, and the ETL provenance chain."""
from __future__ import annotations

import math
import uuid

import numpy as np
import pytest

from app.analysis.classification.distance_metrics import DistanceMetrics
from app.db.models import DerivedDataset, ProcessingOperation, SpectralExtraction, SpectralLibrary

from conftest import upload_library, write_spectral_library

WAVELENGTHS = [400.0, 450.0, 500.0, 550.0, 600.0]


# --- distance metrics (pure functions) -----------------------------------------------------


def test_sam_of_identical_spectra_is_zero():
    spectrum = np.array([1.0, 2.0, 3.0, 4.0])
    assert DistanceMetrics().pixel_spectral_angle_mapper(spectrum, spectrum) == pytest.approx(0.0, abs=1e-7)


def test_sam_of_orthogonal_spectra_is_a_right_angle():
    a = np.array([1.0, 0.0])
    b = np.array([0.0, 1.0])
    assert DistanceMetrics().pixel_spectral_angle_mapper(a, b) == pytest.approx(math.pi / 2)


def test_sam_ignores_overall_scale():
    """SAM compares shape, not brightness — doubling a spectrum must not change the angle."""
    a = np.array([1.0, 2.0, 3.0])
    assert DistanceMetrics().pixel_spectral_angle_mapper(a, a * 2.0) == pytest.approx(0.0, abs=1e-7)


def test_matrix_sam_matches_the_pixel_implementation():
    dm = DistanceMetrics()
    query = np.array([1.0, 2.0, 3.0])
    library = np.array([[1.0, 2.0, 3.0], [3.0, 2.0, 1.0], [0.0, 0.0, 1.0]])
    matrix = dm.matrix_spectral_angle_mapper(np.repeat(query[None, :], 3, axis=0), library)
    expected = [dm.pixel_spectral_angle_mapper(query, row) for row in library]
    assert np.allclose(matrix, expected)


def test_cosine_distance_of_identical_spectra_is_zero():
    a = np.array([[1.0, 2.0, 3.0]])
    assert DistanceMetrics().matrix_cosine_distance(a, a)[0] == pytest.approx(0.0, abs=1e-7)


def test_klpd_of_identical_spectra_is_zero():
    a = np.array([[1.0, 2.0, 3.0, 4.0]])
    result = np.asarray(DistanceMetrics().klpd_spectral(a, a, mode=3)).reshape(-1)
    assert result[0] == pytest.approx(0.0, abs=1e-7)


def test_klpd_grows_with_dissimilarity():
    dm = DistanceMetrics()
    query = np.array([[1.0, 2.0, 3.0, 4.0]])
    near = np.array([[1.0, 2.0, 3.0, 4.1]])
    far = np.array([[9.0, 1.0, 5.0, 0.5]])
    d_near = np.asarray(dm.klpd_spectral(query, near, mode=3)).reshape(-1)[0]
    d_far = np.asarray(dm.klpd_spectral(query, far, mode=3)).reshape(-1)[0]
    assert 0 <= d_near < d_far


# --- method + library registries -----------------------------------------------------------


def test_methods_endpoint_lists_the_implemented_metrics(client):
    methods = client.get("/api/classification/methods").json()["methods"]
    ids = {m["id"] for m in methods}
    # The paper names KL pseudo-divergence, SAM and cosine distance as what is implemented.
    assert {"klpd", "sam_matrix", "cosine_matrix"} <= ids
    assert all("label" in m for m in methods)


def test_libraries_endpoint_is_empty_before_any_upload(client):
    assert client.get("/api/classification/libraries").json()["libraries"] == []


def test_uploading_a_library_registers_it(client, db, library):
    listed = client.get("/api/classification/libraries").json()["libraries"]
    assert [item["id"] for item in listed] == [library["id"]]

    row = db.query(SpectralLibrary).one()
    assert row.number_of_bands == 5
    assert row.num_spectra == 3
    # Both of these come off the SpectralLibrary object rather than its metadata dict, which
    # spectral empties on open — see upsert_spectral_library.
    assert row.spectra_names == ["pigment_a", "pigment_b", "pigment_c"]
    assert row.wavelengths == WAVELENGTHS


def test_library_upload_rejects_a_non_hdr_header(client, tmp_path):
    hdr = write_spectral_library(tmp_path / "lib.hdr")
    with open(hdr, "rb") as handle:
        response = client.post(
            "/api/classification/libraries/upload",
            files={
                "header": ("lib.txt", handle, "text/plain"),
                "data": ("lib.sli", b"\x00", "application/octet-stream"),
            },
        )
    assert response.status_code == 400


# --- the pipeline --------------------------------------------------------------------------


_DEFAULT_SIGNAL = [1.0, 1.1, 1.2, 1.3, 1.4]


def run_pipeline(client, dataset_id, library_id, *, roi_id=None, method="klpd", values=None, top_k=3):
    # `values` is compared against None, not falsiness — an explicitly empty list is a valid
    # input to test with.
    signal = _DEFAULT_SIGNAL if values is None else values
    return client.post("/api/classification/pipeline/run", json={
        "dataset_id": dataset_id,
        "roi_id": roi_id or str(uuid.uuid4()),
        "classification_method_id": method,
        "reference_library_id": library_id,
        "mean_signal": {"wavelengths_nm": WAVELENGTHS[:len(signal)], "values": signal},
        "top_k": top_k,
    })


@pytest.mark.parametrize("method", ["klpd", "sam_matrix", "cosine_matrix", "sam_pixel"])
def test_pipeline_ranks_matches_for_every_method(client, hsi, library, method):
    body = run_pipeline(client, hsi["id"], library["id"], method=method).json()
    matches = body["results"]["top_matches"]

    assert [m["rank"] for m in matches] == [1, 2, 3]
    assert [m["score"] for m in matches] == sorted(m["score"] for m in matches)
    assert {m["pigment_name"] for m in matches} == {"pigment_a", "pigment_b", "pigment_c"}
    assert body["library"]["size"] == 3
    assert body["library"]["bands"] == 5


def test_pipeline_honours_top_k(client, hsi, library):
    body = run_pipeline(client, hsi["id"], library["id"], top_k=2).json()
    assert len(body["results"]["top_matches"]) == 2


def test_pipeline_records_the_provenance_chain(client, db, hsi, library):
    """Fig. 4 Load stage: ROI -> Spectral Extraction -> Processing Operation -> Derived Dataset."""
    roi_id = str(uuid.uuid4())
    run_pipeline(client, hsi["id"], library["id"], roi_id=roi_id)

    extraction = db.query(SpectralExtraction).one()
    operation = db.query(ProcessingOperation).one()
    derived = db.query(DerivedDataset).one()

    assert operation.operation_type == "classification"
    assert operation.method_name == "klpd"
    assert operation.parameters["reference_library_id"] == library["id"]
    assert operation.input_extraction_id == extraction.extraction_id
    assert derived.operation_id == operation.operation_id
    assert derived.type == "classification"
    assert derived.file_format == "json"
    assert len(derived.class_names) == 3


def test_pipeline_rejects_an_unknown_method(client, hsi, library):
    assert run_pipeline(client, hsi["id"], library["id"], method="nope").status_code == 400


def test_pipeline_rejects_an_empty_signal(client, hsi, library):
    assert run_pipeline(client, hsi["id"], library["id"], values=[]).status_code == 400


def test_pipeline_rejects_an_unknown_dataset(client, library):
    assert run_pipeline(client, "no-such-dataset", library["id"]).status_code == 404


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Known bug (plan W3-5): the pipeline aligns query and library spectra by truncating "
        "both to min_bands instead of matching them by wavelength, so a cube and a library "
        "covering disjoint spectral ranges are compared band-index to band-index and return "
        "confident nonsense. Remove this marker once resampling lands."
    ),
)
def test_pipeline_refuses_a_library_with_no_spectral_overlap(client, hsi, tmp_path):
    swir = upload_library(
        client,
        write_spectral_library(
            tmp_path / "swir.hdr",
            wavelengths=[1000.0, 1400.0, 1800.0, 2200.0, 2500.0],
        ),
        name="swir_library",
    )
    # The cube covers 400-600 nm; this library covers 1000-2500 nm. There is no overlap.
    assert run_pipeline(client, hsi["id"], swir["id"]).status_code == 400
