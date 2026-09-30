# MPOnline — AI-Assisted Examination Evaluation Platform ("Stencil")

MPOnline ("Stencil") is an exam-management platform with an AI-assisted
workflow: coordinators upload a syllabus and a question paper, the backend
converts the paper into a canonical, page-aware JSON representation, the exam
is assigned to a teacher with a student list, and teachers evaluate
answer sheets with AI help and record marks.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop app | Tauri 2 + React 19 + TypeScript + Vite + Tailwind CSS |
| Web app | Next.js (App Router) — thin client for the sheet scanner |
| Exam/AI backend | Python 3.12 + FastAPI + Uvicorn, managed with `uv` |
| Auth service | Python 3.12 + FastAPI + Uvicorn |
| Gateway | Python 3.12 + FastAPI (single entrypoint for the desktop app) |
| Sheet scanner | Python + OpenCV (classical CV, no ML models) |
| AI model | Luna vision/chat model via an OpenAI-compatible API (`free/gpt-6-luna`) |
| AI access | `openai` SDK + LangChain (`ChatOpenAI`) |
| Image storage | AWS S3 (public-read bucket, `ap-south-1`) |
| Databases | Postgres: `examdb` (exams/syllabi/marks) and `mponline_auth` (users) |
| PDF rendering | PyMuPDF (`fitz`) — each page rendered to PNG |
| Orchestration | Turborepo + pnpm (JS), `uv` workspaces (Python) |

## Architecture & Ports

```text
Desktop (Tauri, Vite :1420) ──direct──▶ Scanner :8000 (MJPEG, captures)
        │──via gateway :8090──▶ auth :8002, exam :8001, scanner :8000
        └──direct (VITE_API_URL)──▶ Exam backend :8001

Web (Next.js :3000) ──▶ Scanner :8000 (/scanner page: live feed + gallery)
```

| Service | Port | Entrypoint | Purpose |
|---|---|---|---|
| Sheet scanner | 8000 | `apps/api` → `sheet_scanner.server:app` | Owns the camera, sheet detection, MJPEG `/stream`, captures |
| Exam/AI backend | 8001 | `apps/api` → `app.main:app` | Luna chat, S3 uploads, syllabus + question-paper pipelines, marks |
| Auth service | 8002 | `apps/auth-service` → `app.main:app` | Coordinator/teacher accounts, approvals |
| Gateway | 8090 | `apps/gateway` → `app.main:app` | Path-based routing to the three services above |
| Web | 3000 | `apps/web` | Scanner preview/gallery client |
| Desktop Vite | 1420 | `apps/desktop` | Dev server inside the Tauri window |

## Repository Structure

```text
apps/
  api/                  # FastAPI exam backend (:8001) + sheet scanner (:8000)
    app/
      main.py           # Luna/S3 backend: chat, uploads, syllabus, marks, students
      ai/               # AIClient, prompts, structured-output parsing (Stencil)
      question_paper/   # Stencil engine: ingestion → pages → manifest →
                        #   boundaries → extraction → validation
      exams/routes.py   # POST /api/exams/analyze + analysis/pages/questions/
                        #   PATCH + confirm + per-page/per-question retry
      storage/images.py # S3 upload helper
    src/sheet_scanner/  # camera loop, detector, server.py (:8000 endpoints)
  auth-service/         # coordinators (seeded) + teacher register/approve/login
  gateway/              # /auth/* /exam/* /chat /upload-image /scanner/* routing
  desktop/              # Tauri + React app (coordinator & teacher workflows)
    src/
      pages/            # Onboarding, logins, dashboards, exam creation,
                        #   students, check-exam + answer-sheet analysis
      components/ExamView.tsx  # coordinator create-exam wizard
      lib/exam.ts       # typed client for the exam backend
  web/                  # Next.js scanner client (/scanner)
```

## Prerequisites

- Node.js ≥ 20, `pnpm`
- Python ≥ 3.12, `uv`
- Postgres running locally (default password per `.env`)
- AWS credentials with write access to the S3 bucket (`~/.aws/credentials`)
- Luna API key (`LUNA_API_KEY` in repo-root `.env`)

## Setup

```bash
pnpm install            # JS dependencies (root + web + desktop)
uv sync                 # Python dependencies (from root uv.lock; or inside apps/api)
```

Environment files:

| File | Contents |
|---|---|
| Repo-root `.env` | `LUNA_API_KEY`, `LUNA_BASE_URL`, `LUNA_MODEL=free/gpt-6-luna`, `S3_BUCKET`, `AWS_REGION`, `EXAM_DATABASE_URL=postgresql://postgres:…@localhost:5432/examdb` |
| `apps/desktop/.env` | `VITE_SCANNER_URL` (:8000), `VITE_API_URL` (:8001), `VITE_GATEWAY_URL`/`VITE_AUTH_URL` (:8090) |
| `apps/auth-service/.env` (gitignored) | `AUTH_DATABASE_URL=postgresql://postgres:…@localhost:5432/mponline_auth` |

Postgres databases (`examdb`, `mponline_auth`) and their tables are
auto-created on service startup; auth coordinators are seeded too.

## Running

```bash
pnpm dev        # scanner + auth-service + gateway + desktop + web (turbo filters)
pnpm dev:all    # everything (turbo dev)
```

Or per service:

```bash
# scanner :8000 + exam backend :8001 (labeled output, like pnpm dev for api)
cd apps/api && pnpm dev
# individually:
uv run uvicorn sheet_scanner.server:app --reload --port 8000
uv run uvicorn app.main:app --reload --port 8001
cd ../auth-service && uv run uvicorn app.main:app --reload --port 8002
cd ../gateway && uv run uvicorn app.main:app --reload --port 8090
```

Docs: http://localhost:8001/docs, http://localhost:8002/docs,
http://localhost:8090/docs. Only one process may bind a port — a second
`uvicorn ... --port 8001` exits with `winerror 10048`; that means the
backend is already running (check `/health`).

## User Workflows

### Roles & login

- **Coordinators** are pre-seeded (`coord_rgpv`, `coord_davv`, `coord_manit`,
  password `coord123`). No registration.
- **Teachers** register → wait for coordinator approval → login
  (`403 pending_approval` while waiting, `403 banned` after a decline).
  Sessions persist in `localStorage` (`mponline_session`).

### Coordinator: create exam (`/exam` → `ExamView`)

1. **Syllabus upload** — subject name + syllabus PDF (≤ 5 MB) →
   `POST /exam/summarize-syllabus`: PDF → page PNGs → S3 → per-page Luna
   vision analysis → one merged markdown summary. Preview/edit the markdown,
   then **Accept** (`POST /exam/save`).
2. **Question-paper upload** — paper PDF (≤ 10 MB) →
   `POST /api/exams/analyze` returns `{exam_id, status: "processing"}`
   immediately; the Stencil pipeline runs in the background while the UI
   polls `GET /api/exams/{id}/analysis` every 2 s with live progress
   (`ANALYZING_PAGES — page 3/10…`). See "Question-Paper Engine" below.
3. **Review** — `QUESTION PAPER ANALYSIS` screen shows Subject / Pages /
   Detected Questions / Maximum Marks, ✓/✗ validation ticks, ⚠ warnings,
   per-question source pages, visuals, OR alternatives, subquestions, and a
   question→pages map. Every question is editable (text, marks, number,
   section); edits `PATCH` the canonical question. **Review & confirm**
   marks the exam `READY_FOR_EVALUATION`. (If the canonical engine is down,
   the UI automatically falls back to the legacy extractor.)
4. **Assign** — pick an approved teacher + a student CSV list, then
   **Create exam** (`POST /exam/final/create`). Visible on the dashboard.

### Coordinator: students & teachers

- **Students** (`/students/new`): upload a CSV (branch, semester, teacher,
  subject + column mapping for `student_name/total_marks/obtained_marks/
  attendance`) → raw file to S3, metadata in `examdb`. Datasets are
  re-readable row-by-row for evaluation.
- **Teachers** (`/teachers`): approve/reject registrations, manage the roster.

### Teacher: evaluate (`/check-exam`)

- Open an assigned exam → pick a student → photograph/upload the handwritten
  answer sheet → `POST /exam/analyze-answer-sheet`: Luna matches the
  handwriting to one question and returns `max_marks`, `awarded_marks`,
  expected answer, strengths, improvements.
- Confirm/adjust per-question marks → `PUT /exam/marks` (upsert, clamped to
  `[0, max_marks]`, total recomputed server-side) → `GET /exam/marks` lists
  saved marks. The scanner page (`/scanner`) shows the live sheet-detection
  feed for capturing sheets with a PC webcam.

## Question-Paper Engine ("Stencil" canonical JSON)

A physical page is **not** a logical question: a question can span pages and
a page can hold many questions. The model is always
question → many pages **and** page → many questions. Answer-sheet evaluation
is intentionally **not** part of this engine; it only produces the canonical
exam JSON that the evaluator will later consume.

Pipeline (`PDF → Page Analysis → Manifest → Boundaries → Extraction →
Validation → Review → READY`):

1. **Ingestion** (`question_paper/ingestion.py`, `pdf_renderer.py`) —
   validate PDF, render each page to PNG (PyMuPDF, no cropping), upload to
   S3, create `PageRecord`s (`page_number, image_url, width, height, status`).
2. **Page analysis** (`page_analyzer.py`) — **one small Luna vision call per
   page**, never the final JSON: sections, question `start`/`continuation`
   blocks with pixel bboxes, subquestions, OR indicators, marks, word
   limits, attempt rules, passages/tables/diagrams/graphs/formulas,
   instructions, exam info. One bad page degrades to an empty analysis, not
   a failed job.
3. **Page manifest** (`page_manifest.py`) — first-class stored object kept
   after the final JSON (powers `/pages` + debugging).
4. **Boundary resolution** (`boundary_resolver.py`, pure Python) — e.g.
   `Q1 → [2,3,4]`, `Q2 → [4,5,6]`; shared pages belong to both questions.
5. **Question extraction** (`question_extractor.py`) — one targeted Luna call
   per logical question carrying **only its pages/regions**. Preserves
   wording, marks, OR alternatives (`choose_one`), "attempt any N"
   (`choose_n` + `marks_per_item`), word limits, subquestions, passages
   (one object across pages), visuals (image is truth, description is
   supplemental; tables keep `structured_data`, `null` when uncertain).
   Every object keeps source pages + bboxes ("View source" traceability)
   plus a `confidence` block.
6. **Validation** (`validator.py`, deterministic — AI output is never
   trusted): marks totals, `N × marks` rules, OR/subquestion sums, duplicate
   / missing question numbers, page references, bbox validity.
7. **Review/confirm** — `NEEDS_REVIEW` → human edits → `POST …/confirm` →
   `READY_FOR_EVALUATION`. Single-page retry (`…/pages/{n}/retry`) and
   single-question retry (`…/questions/{id}/retry`) — never a full restart.

**AI call budget:** exactly **pages + logical questions** per paper
(e.g. 10 pages / 8 questions ≈ 18 Luna calls, sequential ⇒ several
minutes). `GET …/analysis` reports the live `ai_calls`
`{total, page_analysis, question_extraction, failed}` breakdown.
All Luna access goes through `AIClient` (`app/ai/`), so the model can be
swapped without touching the engine. Every AI operation is logged
(exam/page/question, retries, success, error — never API keys); pipeline
progress also prints as `[stencil:<exam_id>] …` lines in the `:8001`
terminal.

Explicit states: `UPLOADED → RENDERING → ANALYZING_PAGES →
BUILDING_PAGE_MANIFEST → RESOLVING_QUESTIONS → EXTRACTING_QUESTIONS →
VALIDATING → NEEDS_REVIEW → READY_FOR_EVALUATION` (plus `FAILED`).

## API Reference (exam backend `:8001`)

| Method | Path | Meaning |
|---|---|---|
| `GET` | `/health`, `/config` | liveness + non-secret config |
| `GET` | `/metrics/hits` | requests in last minute + per-minute buckets (15 min, in-memory) |
| `POST` | `/chat` | Luna chat completion (LangChain) |
| `POST` | `/upload-image` | image → S3 public URL (≤ 10 MB) |
| `POST` | `/exam/summarize-syllabus` | syllabus PDF → per-page analysis → merged markdown |
| `POST` | `/exam/save`, `GET` | persist / list accepted syllabus summaries |
| `POST` | `/api/exams/analyze` | question-paper PDF → `{exam_id, status: "processing"}` (background) |
| `GET` | `/api/exams/{id}/analysis` | status, progress, validation, warnings, `ai_calls`, error |
| `GET` | `/api/exams/{id}/pages` | page manifest + question ranges + page→questions |
| `GET` | `/api/exams/{id}/questions` | canonical question JSON |
| `GET` | `/api/exams/{id}/questions/{qid}` | one question + source + visuals |
| `PATCH` | `/api/exams/{id}/questions/{qid}` | human correction (re-validates) |
| `POST` | `/api/exams/{id}/confirm` | → `READY_FOR_EVALUATION` |
| `POST` | `/api/exams/{id}/pages/{n}/retry` | retry one page |
| `POST` | `/api/exams/{id}/questions/{qid}/retry` | retry one question |
| `POST` | `/exam/analyze-question-paper` | legacy extractor (UI fallback) |
| `POST` | `/exam/final/create` | create assigned exam |
| `GET` | `/exam/final/list?teacher=`, `/exam/final/{id}` | list / detail |
| `POST` | `/exam/analyze-answer-sheet` | answer photo vs paper JSON → marks + feedback |
| `PUT`/`GET` | `/exam/marks` | upsert / list teacher marks |
| `POST`/`GET` | `/exam/students/upload`, `/exam/students…` | student CSV datasets + rows |

Auth (`:8002`): `GET /auth/colleges`, `GET /auth/seeded-coordinators`,
`POST /auth/teacher/register|login`, `POST /auth/coordinator/login`,
`GET /auth/me`, `GET /auth/coordinator/requests?status=`,
`POST /auth/coordinator/requests/{id}/decision`.

Scanner (`:8000`): `GET /health /stream /status /cameras /scans
/scans/{f}`, `POST /camera /capture`.

## Databases

- **`examdb`** (`EXAM_DATABASE_URL`): `exams` (syllabus summaries),
  `final_exams`, `student_marks`, `student_datasets`, plus `stencil_exams`,
  `stencil_pages`, `stencil_sections`, `stencil_questions`,
  `stencil_visuals`, `stencil_subquestions` (canonical pipeline; memory
  store keeps the API working when Postgres is down).
- **`mponline_auth`** (`AUTH_DATABASE_URL`): users + approval requests.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `winerror 10048` on startup | Port already bound — the service is already running; use it or `Stop-Process -Id <pid>` first |
| Analysis spins with no progress | Old backend predates the background pipeline — wait for `--reload`, then re-upload; watch for `[stencil:…]` lines in the `:8001` terminal |
| `FAILED` analysis | Read `error` from `GET …/analysis`; retry the flagged page/question via the retry endpoints |
| S3 upload errors | Check AWS credentials + bucket/region env |
| Luna errors / empty replies | Check `LUNA_API_KEY`/`LUNA_BASE_URL`; per-page fallback keeps the job alive |
| Camera issues | Tune `uv run sheet-scanner --help` flags (area, Canny, stability) |
