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

from collections.abc import Callable

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field

from .camera import CameraLoop, NoSheetError, list_cameras
from . import __version__
from .config import ScannerConfig
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


def build_app(
    config: ScannerConfig | None = None,
    shutdown_callback: Callable[[], None] | None = None,
) -> FastAPI:
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

    app = FastAPI(title="Stencil Scanner Companion", version=__version__, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    async def control_page():
        return f"""<!doctype html>
<html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">
<title>Stencil Scanner Companion</title>
<style>body{{font:16px system-ui;margin:0;background:#f4f7f9;color:#17212b}}main{{max-width:640px;margin:8vh auto;padding:28px;background:white;border:1px solid #dce3e8;border-radius:8px}}h1{{font-size:24px}}code{{background:#eef2f4;padding:2px 5px}}button{{padding:10px 16px;border:0;border-radius:5px;background:#164e63;color:white;font-weight:600;cursor:pointer}}small{{color:#52616b}}</style>
<main><h1>Stencil Scanner Companion</h1><p>Version {__version__} is running on this computer.</p><p>The companion keeps camera access local and accepts requests only from configured Stencil origins.</p><p><a href=\"/docs\">Open API status</a></p>{'<button onclick="fetch(\'/shutdown\',{method:\'POST\'}).then(()=>document.body.innerHTML=\'<main><h1>Scanner stopped</h1><p>You may close this window.</p></main>\')">Stop scanner</button>' if shutdown_callback else ''}<p><small>Local address: <code>127.0.0.1:{cfg.port}</code></small></p></main></html>"""

    @app.get("/health")
    async def health():
        state = loop.get_status()
        return {
            "status": "ok",
            "version": __version__,
            "camera_available": state["camera_available"],
            "service": "stencil-scanner-companion",
        }

    @app.get("/version")
    async def version():
        return {"version": __version__, "service": "stencil-scanner-companion"}

    if shutdown_callback is not None:
        @app.post("/shutdown", include_in_schema=False)
        async def shutdown():
            asyncio.get_running_loop().call_later(0.2, shutdown_callback)
            return {"status": "stopping"}

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
            "cameras": list_cameras() if cfg.camera_enabled else [],
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
