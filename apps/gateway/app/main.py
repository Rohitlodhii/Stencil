"""Gateway — single entrypoint that routes to the right backend service.

  /auth/*    -> auth-service   (default http://localhost:8002)
  /exam/*, /chat, /upload-image, /config
             -> exam backend   (default http://localhost:8001)
  /scanner/* -> sheet-scanner  (default http://localhost:8000, prefix stripped)

Desktop app should talk ONLY to this gateway (default http://localhost:8080).

Run:
  cd apps/gateway
  uv run uvicorn app.main:app --reload --port 8080
Docs: http://localhost:8080/docs
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

_HERE = Path(__file__).resolve()
load_dotenv(_HERE.parents[1] / ".env", override=False)
load_dotenv(_HERE.parents[3] / ".env", override=False)

def _service_url(name: str, default: str) -> str:
    value = os.getenv(name, default).strip().rstrip("/")
    if "://" not in value:
        value = f"http://{value}"
    return value


AUTH_SERVICE_URL = _service_url("AUTH_SERVICE_URL", "http://localhost:8002")
EXAM_API_URL = _service_url("EXAM_API_URL", "http://localhost:8001")
SCANNER_URL = _service_url("SCANNER_URL", "http://localhost:8000")
WEB_DIST = Path(os.getenv("STENCIL_WEB_DIST", "")).resolve()

HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
}

app = FastAPI(title="MPOnline Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api")
async def root():
    return {
        "service": "mponline-gateway",
        "docs": "/docs",
        "routes": {
            "/auth/*": AUTH_SERVICE_URL,
            "/exam/*, /chat, /upload-image, /config": EXAM_API_URL,
            "/scanner/* (prefix stripped)": SCANNER_URL,
        },
    }


@app.get("/health")
async def health():
    async def check(url: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{url}/health")
                return {"url": url, "ok": r.status_code < 500, "status": r.status_code}
        except Exception as exc:
            return {"url": url, "ok": False, "error": str(exc)[:200]}

    auth, exam = await _gather(check(AUTH_SERVICE_URL), check(EXAM_API_URL))
    all_ok = all(service.get("ok") for service in (auth, exam))
    return {
        "status": "ok" if all_ok else "degraded",
        "auth": auth,
        "exam": exam,
        "scanner": {
            "ok": None,
            "mode": "local_companion",
            "detail": "Checked by the examiner browser on 127.0.0.1, not by Render.",
        },
    }


async def _gather(*coros):
    import asyncio

    return list(await asyncio.gather(*coros))


async def _proxy(request: Request, target_base: str, path: str) -> Response:
    url = f"{target_base}{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream = await client.request(
                request.method, url, content=body, headers=headers
            )
    except httpx.ConnectError:
        return JSONResponse({"detail": f"upstream unreachable: {target_base}"}, status_code=502)
    except Exception as exc:
        return JSONResponse({"detail": f"gateway error: {exc}"}, status_code=502)

    resp_headers = {k: v for k, v in upstream.headers.items() if k.lower() not in HOP_BY_HOP}
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=upstream.headers.get("content-type"),
    )


# ---- auth ----
@app.api_route("/auth/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_auth(path: str, request: Request):
    return await _proxy(request, AUTH_SERVICE_URL, f"/auth/{path}")


# ---- exam backend ----
@app.api_route("/exam/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_exam(path: str, request: Request):
    return await _proxy(request, EXAM_API_URL, f"/exam/{path}")


@app.api_route("/chat", methods=["GET", "POST", "OPTIONS"])
async def proxy_chat(request: Request):
    return await _proxy(request, EXAM_API_URL, "/chat")


@app.api_route("/upload-image", methods=["POST", "OPTIONS"])
async def proxy_upload(request: Request):
    return await _proxy(request, EXAM_API_URL, "/upload-image")


@app.api_route("/config", methods=["GET", "OPTIONS"])
async def proxy_config(request: Request):
    return await _proxy(request, EXAM_API_URL, "/config")


@app.api_route("/status", methods=["GET", "OPTIONS"])
async def proxy_status(request: Request):
    return await _proxy(request, EXAM_API_URL, "/status")


@app.api_route("/demo/report", methods=["GET", "OPTIONS"])
async def proxy_demo_report(request: Request):
    return await _proxy(request, EXAM_API_URL, "/demo/report")


@app.api_route("/demo-uploads/{path:path}", methods=["GET", "HEAD", "OPTIONS"])
async def proxy_demo_upload(path: str, request: Request):
    return await _proxy(request, EXAM_API_URL, f"/demo-uploads/{path}")


# ---- scanner ----
@app.api_route("/scanner/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_scanner(path: str, request: Request):
    # strip /scanner prefix: gateway /scanner/status -> scanner /status
    if path in ("stream",) or request.method == "GET" and "text/event-stream" in request.headers.get("accept", ""):
        # MJPEG stream: stream bytes back without buffering the whole body
        url = f"{SCANNER_URL}/{path}"
        if request.url.query:
            url += f"?{request.url.query}"
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}

        async def gen():
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(request.method, url, headers=headers) as upstream:
                        async for chunk in upstream.aiter_bytes():
                            yield chunk
            except Exception:
                return

        return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")
    return await _proxy(request, SCANNER_URL, f"/{path}")


# The production gateway owns the public origin and serves the Vite build.
# HashRouter keeps browser navigation compatible with static hosting.
if (WEB_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
