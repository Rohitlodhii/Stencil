"""HTTP server for the sheet scanner (single owner of the camera).

Endpoints:
  GET  /health          liveness probe (kept from the original backend)
  GET  /stream          MJPEG live feed with the detection overlay drawn in
  GET  /status          latest detection state (present / corners / stable)
  GET  /cameras         available camera devices + the active index
  POST /camera          switch to another camera device index
  POST /capture         manual capture of the current best-guess quadrilateral
  GET  /scans           saved scans (filenames + timestamps, newest first)
  GET  /scans/{name}    serve one saved scan image
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .camera import CameraLoop, NoSheetError, list_cameras
from .config import ScannerConfig

FRONTEND_ORIGIN = "http://localhost:3000"
# Tauri dev server + Tauri webview origins (desktop app shell).
TAURI_ORIGINS = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "https://tauri.localhost",
]
ALLOW_ORIGINS = [FRONTEND_ORIGIN, *TAURI_ORIGINS]
STREAM_FPS = 20


class CameraSelect(BaseModel):
    index: int = Field(ge=0, description="webcam device index to switch to")


def scans_dir(config: ScannerConfig) -> Path:
    path = Path(config.output_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_scans(config: ScannerConfig) -> list[dict]:
    directory = scans_dir(config)
    entries = []
    for file in directory.glob("scan_*.jpg"):
        try:
            stamp = datetime.fromtimestamp(file.stat().st_mtime)
        except OSError:
            continue
        entries.append({"filename": file.name, "timestamp": stamp.isoformat()})
    entries.sort(key=lambda e: e["timestamp"], reverse=True)
    return entries


async def mjpeg_generator(loop: CameraLoop):
    """Yield multipart JPEG chunks from the background camera loop."""
    boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
    while True:
        data = loop.get_frame_bytes()
        if data is None:
            await asyncio.sleep(0.05)
            continue
        yield boundary + data + b"\r\n"
        await asyncio.sleep(1 / STREAM_FPS)


def build_app(config: ScannerConfig | None = None) -> FastAPI:
    """Create the FastAPI app bound to the given scanner configuration."""
    cfg = config or ScannerConfig()
    loop = CameraLoop(cfg)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        loop.start()
        try:
            yield
        finally:
            loop.stop()

    app = FastAPI(title="Sheet Scanner", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOW_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/stream")
    async def stream():
        return StreamingResponse(
            mjpeg_generator(loop),
            media_type="multipart/x-mixed-replace; boundary=frame",
        )

    @app.get("/status")
    async def status():
        return loop.get_status()

    @app.get("/cameras")
    async def cameras():
        return {
            "cameras": list_cameras(),
            "current": loop.get_status()["camera_index"],
        }

    @app.post("/camera")
    async def select_camera(selection: CameraSelect):
        try:
            index = loop.set_camera(selection.index)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        return {"camera_index": index}

    @app.post("/capture")
    async def capture():
        try:
            path = loop.capture_now()
        except NoSheetError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        return {"filename": path.name}

    @app.get("/scans")
    async def scans():
        return {"scans": list_scans(cfg)}

    @app.get("/scans/{filename}")
    async def one_scan(filename: str):
        # Guard against path traversal: only direct scan_*.jpg children.
        if "/" in filename or "\\" in filename or not filename.endswith(".jpg"):
            raise HTTPException(status_code=404, detail="scan not found")
        if not filename.startswith("scan_"):
            raise HTTPException(status_code=404, detail="scan not found")
        file = scans_dir(cfg) / filename
        if not file.is_file():
            raise HTTPException(status_code=404, detail="scan not found")
        return FileResponse(str(file), media_type="image/jpeg")

    return app


app = build_app()
