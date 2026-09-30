# Gateway (`:8090`)

Single entrypoint for the desktop app. Routes by path:

| prefix | target (env override) |
| ------ | --------------------- |
| `/auth/*` | auth-service (`AUTH_SERVICE_URL`, default `http://localhost:8002`) |
| `/exam/*`, `/chat`, `/upload-image`, `/config` | exam backend (`EXAM_API_URL`, default `http://localhost:8001`) |
| `/scanner/*` (prefix stripped, e.g. `/scanner/status` → `/status`) | sheet-scanner (`SCANNER_URL`, default `http://localhost:8000`) |

```bash
cd apps/gateway
  uv run uvicorn app.main:app --reload --port 8090
# docs: http://localhost:8090/docs — health: http://localhost:8090/health
```

Full local stack: scanner `:8000` + exam `:8001` + auth `:8002` + gateway
`:8090`, or `pnpm dev` from the repo root (scanner + auth-service + gateway +
desktop).
