# Stencil

Stencil is a university examination workspace with a React/Vite and Tauri client,
FastAPI examination and authentication services, an API gateway, an optional local
OpenCV scanner, and PostgreSQL persistence. The repository uses pnpm and uv
workspaces with committed lockfiles.

The primary frontend is `apps/desktop`; `apps/web` is a small legacy Next.js scanner
surface. Render architecture, deployment blockers, environment variables, and exact
validation commands are documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Project Structure

```text
project-root/
├── apps/
│   ├── web/              # Next.js frontend → http://localhost:3000
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── globals.css
│   │   ├── public/
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   └── tsconfig.json
│   └── api/              # FastAPI backend → http://localhost:8000
│       ├── app/
│       │   ├── __init__.py
│       │   └── main.py
│       ├── package.json  # turbo task runner (delegates to uv)
│       └── pyproject.toml
├── packages/             # (empty, reserved for future shared packages)
├── package.json          # root scripts: turbo dev / build / lint / typecheck
├── pnpm-workspace.yaml
├── turbo.json
├── pyproject.toml        # uv workspace root (members = ["apps/api"])
├── uv.lock
├── .gitignore
└── README.md
```

## Prerequisites

- Node.js >= 20
- `pnpm` (JS/TS package manager)
- Python >= 3.12
- `uv` (Python package manager)

## Installing Dependencies

```bash
# Install JS dependencies
pnpm install

# Install Python dependencies
cd apps/api
uv sync
```

(`uv sync` resolves the workspace from the root `uv.lock`. You can also run `uv sync`
from the repository root.)

## Running the Dev Stack

```bash
# Scanner (:8000) + Luna/S3 backend (:8001) + Tauri desktop window
pnpm dev
```

This starts only the desktop workflow (`turbo dev --filter=scanner --filter=desktop`):

```text
apps/api (scanner) → OpenCV sheet-scanner server → http://localhost:8000
apps/api (backend) → Luna chat + S3 uploads API    → http://localhost:8001
apps/desktop       → Tauri dev (Vite + native app window)
```

- Scanner: http://localhost:8000/health (`/docs`, MJPEG feed at `/stream`).
- Backend: http://localhost:8001/health (`/docs`, `/chat`, `/upload-image`).
- Desktop: native app window opens automatically (Vite on http://localhost:1420).
- The Next.js web app is **not** started by `pnpm dev`; use `pnpm dev:all`
  (everything) or `pnpm --filter web dev` (just the web app on :3000).

- Frontend: http://localhost:3000; scanner page at http://localhost:3000/scanner
  (live preview, status indicator, Capture button, scans gallery).
- Backend: http://localhost:8000/health returns `{"status": "ok"}`
  (docs at http://localhost:8000/docs, MJPEG feed at `/stream`).

## Running Only Next.js

```bash
cd apps/web
pnpm dev
```

Open http://localhost:3000.

## Running Only the Scanner Server

```bash
cd apps/api
uv run uvicorn sheet_scanner.server:app --reload --port 8000
```

Open http://localhost:8000/health and http://localhost:8000/stream.

## Turborepo Commands

Run from the repository root:

```bash
pnpm dev        # desktop workflow only: scanner + backend + Tauri window
pnpm dev:all    # turbo dev — starts every dev task incl. Next.js web
pnpm build      # turbo build — builds all apps that define a build script
pnpm lint       # turbo lint — lints all apps that define a lint script
pnpm typecheck  # turbo typecheck — typechecks all apps that define a typecheck script
```

`turbo.json` marks `dev` as `persistent: true` with `cache: false`, which is the
correct configuration for long-running dev servers in current Turborepo versions.

The scanner `dev` task (`apps/api/package.json`, named `scanner`) runs both
Python servers side by side with labeled output (via `concurrently`):

```bash
uv run uvicorn sheet_scanner.server:app --reload --port 8000  # OpenCV scanner
uv run uvicorn app.main:app --reload --port 8001              # Luna/S3 backend
```

## Python / uv Commands

Run from `apps/api` (or the repo root — `uv` finds the workspace):

```bash
uv sync                                                # install / sync dependencies from uv.lock
uv run uvicorn sheet_scanner.server:app --reload --port 8000  # run the scanner server
uv run sheet-scanner                                   # same server via the CLI entry point
uv add <package>                                       # add a dependency (updates uv.lock)
```

- Python dependencies are managed **only** with `uv`, never with npm/pnpm.
- `uv.lock` is committed. `.venv` is gitignored.

## Sheet Scanner (Python, OpenCV) + Frontend

`apps/api` is the sheet-scanner server: it owns the camera, runs detection
in a background loop, auto-captures settled sheets, and exposes
`/stream` (MJPEG), `/status`, `/cameras` + `/camera` (PC webcam selection),
`/capture`, `/scans`, `/scans/{filename}`.
CORS is enabled for `http://localhost:3000` only.

`apps/web` is a pure client: `/scanner` embeds the MJPEG stream in an
`<img>`, polls `/status` every 400 ms, and renders the gallery from
`/scans`. No camera or CV code exists in the frontend. See
`apps/api/README.md` for full docs.

```bash
cd apps/api
uv sync
uv run sheet-scanner   # 'c' = capture now, 'q' = quit
```

## App Relationship

The Python scanner owns the camera and all CV logic; the Next.js app is a
pure client that embeds its MJPEG stream and calls its REST endpoints.
There is no shared code, no shared env vars beyond the scanner URL, and no
browser-side camera access.
