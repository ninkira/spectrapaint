"""ROI spectral extraction endpoints.

These pin the current behaviour of the four extraction paths (pixel, region, line, polygon)
before they are unified behind a single `roi_pixel_mask` helper.

The fixture cube stores `y*100 + x*10 + b` at each band, so every assertion below checks that
the endpoint returned the spectrum of the pixel actually asked for.
"""
from __future__ import annotations

import pytest


def spectrum_at(x: int, y: int, bands: int = 5) -> list[float]:
    return [float(y * 100 + x * 10 + b) for b in range(bands)]


def test_spectra_at_pixel(client, hsi):
    body = client.get(f"/api/datasets/{hsi['id']}/spectra", params={"x": 2, "y": 1}).json()
    assert body["values"] == spectrum_at(2, 1)
    assert body["wavelengths_nm"] == [400.0, 450.0, 500.0, 550.0, 600.0]


@pytest.mark.parametrize(("x", "y"), [(-1, 0), (4, 0), (0, 3)])
def test_spectra_at_pixel_rejects_out_of_bounds(client, hsi, x, y):
    response = client.get(f"/api/datasets/{hsi['id']}/spectra", params={"x": x, "y": y})
    assert response.status_code == 400


def test_spectra_region_rect_returns_every_pixel_in_the_box(client, hsi):
    body = client.get(
        f"/api/datasets/{hsi['id']}/spectra-region",
        params={"shape": "rect", "x0": 0, "y0": 0, "x1": 1, "y1": 1},
    ).json()

    assert body["region_stats"]["n_pixels"] == 4
    assert {(s["x"], s["y"]) for s in body["region_spectra"]} == {(0, 0), (1, 0), (0, 1), (1, 1)}
    # mean of band 0 over pixels (0,0)=0, (1,0)=10, (0,1)=100, (1,1)=110
    assert body["region_stats"]["mean"][0] == pytest.approx(55.0)


def test_spectra_region_clamps_to_the_cube(client, hsi):
    body = client.get(
        f"/api/datasets/{hsi['id']}/spectra-region",
        params={"shape": "rect", "x0": -5, "y0": -5, "x1": 99, "y1": 99},
    ).json()
    assert body["region_stats"]["n_pixels"] == 12  # the whole 4x3 cube


def test_spectra_region_ellipse_selects_fewer_pixels_than_its_bbox(client, hsi):
    params = {"x0": 0, "y0": 0, "x1": 3, "y1": 2}
    rect = client.get(f"/api/datasets/{hsi['id']}/spectra-region", params={"shape": "rect", **params})
    ellipse = client.get(f"/api/datasets/{hsi['id']}/spectra-region", params={"shape": "ellipse", **params})

    n_rect = rect.json()["region_stats"]["n_pixels"]
    n_ellipse = ellipse.json()["region_stats"]["n_pixels"]
    assert 0 < n_ellipse < n_rect


def test_spectra_region_std_is_zero_for_a_single_pixel(client, hsi):
    body = client.get(
        f"/api/datasets/{hsi['id']}/spectra-region",
        params={"shape": "rect", "x0": 2, "y0": 1, "x1": 2, "y1": 1},
    ).json()
    assert body["region_stats"]["n_pixels"] == 1
    assert body["region_stats"]["mean"] == spectrum_at(2, 1)
    assert body["region_stats"]["std"] == [0.0] * 5


def test_spectra_line_walks_from_start_to_end(client, hsi):
    body = client.get(
        f"/api/datasets/{hsi['id']}/spectra-line",
        params={"x0": 0, "y0": 0, "x1": 3, "y1": 0},
    ).json()
    assert [(s["x"], s["y"]) for s in body["spectra"]] == [(0, 0), (1, 0), (2, 0), (3, 0)]
    assert body["spectra"][2]["values"] == spectrum_at(2, 0)


def test_spectra_line_step_subsamples(client, hsi):
    body = client.get(
        f"/api/datasets/{hsi['id']}/spectra-line",
        params={"x0": 0, "y0": 0, "x1": 3, "y1": 0, "step": 2},
    ).json()
    assert [(s["x"], s["y"]) for s in body["spectra"]] == [(0, 0), (2, 0)]


def test_spectra_polygon_selects_the_enclosed_pixels(client, hsi):
    body = client.post(
        f"/api/datasets/{hsi['id']}/spectra-polygon",
        json={"vertices": [{"x": 0, "y": 0}, {"x": 3, "y": 0}, {"x": 3, "y": 2}, {"x": 0, "y": 2}]},
    ).json()
    assert body["count"] > 0
    assert body["truncated"] is False
    assert len(body["wavelengths_nm"]) == 5


def test_spectra_polygon_truncates_at_max_points(client, hsi):
    body = client.post(
        f"/api/datasets/{hsi['id']}/spectra-polygon",
        json={
            "vertices": [{"x": 0, "y": 0}, {"x": 3, "y": 0}, {"x": 3, "y": 2}, {"x": 0, "y": 2}],
            "max_points": 2,
        },
    ).json()
    assert body["count"] == 2
    assert body["truncated"] is True


def test_spectra_polygon_needs_three_vertices(client, hsi):
    response = client.post(
        f"/api/datasets/{hsi['id']}/spectra-polygon",
        json={"vertices": [{"x": 0, "y": 0}, {"x": 1, "y": 1}]},
    )
    assert response.status_code == 400
