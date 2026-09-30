from __future__ import annotations

from fastapi.testclient import TestClient

from sheet_scanner.config import ScannerConfig
from sheet_scanner.server import build_app


def test_companion_health_version_and_no_camera_status(tmp_path):
    app = build_app(
        ScannerConfig(
            camera_enabled=False,
            output_dir=str(tmp_path),
            allowed_origins=("https://stencil.example",),
        )
    )
    with TestClient(app) as client:
        health = client.get("/health")
        status = client.get("/status")
        version = client.get("/version")
        cameras = client.get("/cameras")

    assert health.status_code == 200
    assert health.json()["service"] == "stencil-scanner-companion"
    assert health.json()["camera_available"] is False
    assert version.json()["version"]
    assert status.json()["camera_available"] is False
    assert "disabled" in status.json()["camera_error"].lower()
    assert cameras.json()["cameras"] == []


def test_companion_cors_is_restricted(tmp_path):
    app = build_app(
        ScannerConfig(
            camera_enabled=False,
            output_dir=str(tmp_path),
            allowed_origins=("https://stencil.example",),
        )
    )
    with TestClient(app) as client:
        allowed = client.options(
            "/status",
            headers={
                "Origin": "https://stencil.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        blocked = client.options(
            "/status",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://stencil.example"
    assert blocked.status_code == 400
    assert "access-control-allow-origin" not in blocked.headers
