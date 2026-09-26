# Python App (`apps/api`): Sheet Scanner Server

The Python process is the **single owner of the camera and the detection
pipeline**. It runs a background camera loop (read → detect → overlay →
auto-capture) and serves the feed plus detection state over HTTP for the
Next.js app. No CV logic lives in the frontend.

## Run It

```bash
cd apps/api

# Install / sync dependencies (updates the root uv.lock)
uv sync

# Start BOTH the scanner server (:8000) and the Luna/S3 backend (:8001)
# with labeled output (also what root `pnpm dev` runs via Turborepo)
pnpm dev

# ...or run each server on its own:
pnpm dev:scanner  # uvicorn sheet_scanner.server:app --reload --port 8000
pnpm dev:backend  # uvicorn app.main:app --reload --port 8001
```

Local URLs:

- API: http://localhost:8000
- API docs: http://localhost:8000/docs
- Live MJPEG feed: http://localhost:8000/stream
- Frontend page: http://localhost:3000/scanner
- Luna/S3 backend: http://localhost:8001 (docs at http://localhost:8001/docs)

Scans are saved to `output/` (gitignored) as `scan_YYYYMMDD_HHMMSS.jpg`.
Auto-capture fires once the sheet corners stay within tolerance for
`--stability-frames` consecutive frames (~1–2 s after the sheet settles),
then pauses and requires the sheet to be removed before capturing again.
If no camera is available, the server still starts and streams a
"No camera available" placeholder (status reports no sheet).

## HTTP Endpoints

| Method | Path | Meaning |
|---|---|---|
| `GET` | `/health` | liveness probe → `{"status": "ok"}` |
| `GET` | `/stream` | MJPEG live feed with the sheet outline drawn in |
| `GET` | `/status` | `{sheet_detected, stable, stable_count, required_frames, corners, camera_index}` |
| `GET` | `/cameras` | `{cameras: [{index, label}], current}` — probed PC webcams |
| `POST` | `/camera` | switch device: body `{"index": N}` → `{camera_index}` |
| `POST` | `/capture` | manual capture → `{filename}` (409 when no sheet in view) |
| `GET` | `/scans` | `{scans: [{filename, timestamp}]}` newest first |
| `GET` | `/scans/{filename}` | serve one saved scan image |

The `/scanner` page in the Next.js app lists cameras from `GET /cameras`
in a dropdown and switches via `POST /camera`; the active index is also
visible in every `/status` poll. Switching resets detection state so the
previous feed can't trigger a capture on the new one.

CORS is enabled for `http://localhost:3000` only.

## CLI Options (detection tuning)

`uv run sheet-scanner` starts the same server (host/port configurable);
all detection flags are shared with the server path:

```bash
uv run sheet-scanner --help
uv run sheet-scanner --camera 1 --stability-frames 15 \
  --aspect-ratio 216:279 --port 8000
```

| Flag | Default | Meaning |
|---|---|---|
| `--camera` | `0` | webcam device index |
| `--output-dir` | `output` | where scans are saved |
| `--min-area` | `25000` | min contour area (px) |
| `--min-area-ratio` | `0.02` | min quad area as fraction of frame |
| `--stability-frames` | `12` | still frames before auto-capture |
| `--stability-tolerance` | `12` | max corner drift (px) between frames |
| `--canny-low` / `--canny-high` | `50` / `150` | Canny edge thresholds |
| `--aspect-ratio` | `210:297` | target `W:H` (A4); e.g. `216:279` for US Letter |
| `--output-width` | `1240` | scan width (px); height follows the aspect |
| `--cooldown` | `3` | seconds to pause auto-capture after a save |
| `--host` / `--port` | `127.0.0.1` / `8000` | HTTP server bind |

Tuning: no detection → lower `--min-area`, widen Canny range, use a plain
high-contrast surface; jittery outlines → raise `--min-area`, increase
`--stability-frames`, lower `--stability-tolerance`.

## Structure

```text
apps/api/
├── app/                    # original minimal backend (kept, superseded by server.py)
├── src/sheet_scanner/
│   ├── __init__.py
│   ├── server.py           # FastAPI app: /stream /status /capture /scans
│   ├── camera.py           # background camera loop + overlay + capture logic
│   ├── main.py             # CLI entry: `sheet-scanner` runs the HTTP server
│   ├── detector.py         # gray → blur → Canny → dilate → contours → quad
│   ├── stability.py        # still-sheet tracking across frames
│   ├── transform.py        # corner ordering + perspective warp
│   └── config.py           # CLI args / tunable defaults
└── output/                 # saved scans (gitignored)
```

Classical CV only — no ML models or downloads.
