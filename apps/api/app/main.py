"""New FastAPI backend: Luna chat (LangChain + OpenAI-compatible) + S3 image uploads.

Luna config (from root .env):
  LUNA_API_KEY, LUNA_BASE_URL=https://api.apinex.bond/v1, model=free/gpt-6-luna

S3 config:
  bucket=mponline-images-398218088339, region=ap-south-1 (public-read via bucket policy)

Run:
  cd apps/api
  uv run uvicorn app.main:app --reload --port 8001
Docs: http://localhost:8001/docs
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Literal

import boto3
import psycopg
from botocore.exceptions import BotoCoreError, ClientError
from psycopg.rows import dict_row
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

# Load env: apps/api/.env first, then repo-root .env (where LUNA_* live).
_HERE = Path(__file__).resolve()
_ROOT_ENV = _HERE.parents[3] / ".env"  # apps/api/app/main.py -> project root
load_dotenv(_HERE.parents[1] / ".env", override=False)
load_dotenv(_ROOT_ENV, override=False)

LUNA_API_KEY = os.getenv("LUNA_API_KEY", "")
LUNA_BASE_URL = os.getenv("LUNA_BASE_URL", "https://api.apinex.bond/v1")
LUNA_MODEL = os.getenv("LUNA_MODEL", "free/gpt-6-luna")

# ---- analysis AI provider: Luna everywhere (for now) ----
# All image->text calls (syllabus analysis, question-paper
# extraction, answer-sheet checking) use the Luna provider.
# VISION_* env vars are deprecated and ignored; Luna is authoritative.

S3_BUCKET = os.getenv("S3_BUCKET", "mponline-images-398218088339")
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ap-south-1"))

EXAM_DATABASE_URL = os.getenv(
    "EXAM_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/examdb"),
)

MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# ---- exam / syllabus pipeline ----
MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 20
PDF_RENDER_DPI = 150

# ---- student csv uploads ----
MAX_CSV_BYTES = 10 * 1024 * 1024

app = FastAPI(title="MPOnline API — Luna + S3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    try:
        init_exam_db()
    except Exception as exc:
        # postgres down must not kill the whole API; /health reports db state
        print(f"examdb init skipped: {exc}")
    try:
        from app.question_paper.repository import init_stencil_db

        init_stencil_db()
    except Exception as exc:
        print(f"stencil db init skipped: {exc}")


try:
    from app.exams.routes import router as stencil_router

    app.include_router(stencil_router)
except Exception as exc:  # stencil engine optional at import time
    print(f"stencil router skipped: {exc}")


# ---- lightweight request-rate metrics (in-memory, per worker process) ----
import time as _time
from collections import deque as _deque

_HIT_WINDOW_S = 15 * 60  # keep last 15 minutes of hits
_hits: _deque = _deque()  # entries: (timestamp, method, path)
_STARTED_AT = _time.time()


@app.middleware("http")
async def _count_hits(request, call_next):
    _hits.append((_time.time(), request.method, request.url.path))
    try:
        return await call_next(request)
    finally:
        # prune old entries + hard cap so memory stays bounded
        cutoff = _time.time() - _HIT_WINDOW_S
        while _hits and _hits[0][0] < cutoff:
            _hits.popleft()
        while len(_hits) > 20000:
            _hits.popleft()


@app.get("/metrics/hits")
async def hits_per_minute():
    """Request rate: hits in the last minute + per-minute buckets (last 15 min).

    Counts reset on server restart (in-memory per worker). Poll this to see
    live traffic, e.g. while the desktop app polls analysis progress.
    """
    now = _time.time()
    buckets: dict[str, int] = {}
    by_path: dict[str, int] = {}
    last_min = 0
    for ts, method, path in _hits:
        if ts < now - _HIT_WINDOW_S:
            continue
        minute = _time.strftime("%H:%M", _time.localtime(ts))
        buckets[minute] = buckets.get(minute, 0) + 1
        if ts >= now - 60:
            last_min += 1
            key = f"{method} {path}"
            by_path[key] = by_path.get(key, 0) + 1
    return {
        "uptime_s": round(now - _STARTED_AT, 1),
        "last_minute_hits": last_min,
        "window_min": 15,
        "per_minute": buckets,
        "last_minute_by_endpoint": dict(
            sorted(by_path.items(), key=lambda kv: -kv[1])
        ),
    }


def get_luna_llm(temperature: float = 0.7, max_tokens: int | None = None) -> ChatOpenAI:
    if not LUNA_API_KEY:
        raise HTTPException(status_code=500, detail="LUNA_API_KEY is not configured")
    kwargs: dict = {
        "model": LUNA_MODEL,
        "api_key": LUNA_API_KEY,
        "base_url": LUNA_BASE_URL,
        "temperature": temperature,
    }
    if max_tokens:
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(**kwargs)


def get_s3_client():
    try:
        return boto3.client("s3", region_name=AWS_REGION)
    except (BotoCoreError, Exception) as exc:
        raise HTTPException(status_code=500, detail=f"cannot create S3 client: {exc}")


def public_s3_url(key: str) -> str:
    return f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}"


def get_async_openai_client() -> AsyncOpenAI:
    """Async client for analysis AI (Luna everywhere)."""
    if not LUNA_API_KEY:
        raise HTTPException(status_code=500, detail="LUNA_API_KEY is not configured")
    return AsyncOpenAI(api_key=LUNA_API_KEY, base_url=LUNA_BASE_URL)


# ---- examdb (postgres): accepted exam summaries ----
def _exam_db_name() -> str:
    from urllib.parse import urlparse

    try:
        return (urlparse(EXAM_DATABASE_URL).path or "/?").lstrip("/") or "?"
    except Exception:
        return "?"


def ensure_exam_database() -> None:
    target = _exam_db_name()
    try:
        admin = psycopg.connect(EXAM_DATABASE_URL, dbname="postgres", autocommit=True)
    except psycopg.OperationalError as exc:
        raise RuntimeError(f"cannot reach postgres server: {str(exc).strip().splitlines()[0][:200]}")
    try:
        with admin.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target,))
            if cur.fetchone() is None:
                cur.execute(f'CREATE DATABASE "{target}"')
    finally:
        admin.close()


def init_exam_db() -> None:
    ensure_exam_database()
    with psycopg.connect(EXAM_DATABASE_URL) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS exams (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                image_urls TEXT[] NOT NULL DEFAULT '{}',
                summary_md TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS final_exams (
                id SERIAL PRIMARY KEY,
                subject_name TEXT NOT NULL,
                syllabus_exam_id INTEGER NULL,
                syllabus_summary TEXT NOT NULL DEFAULT '',
                question_json JSONB NOT NULL DEFAULT '[]',
                total_marks INTEGER NOT NULL DEFAULT 0,
                total_questions INTEGER NOT NULL DEFAULT 0,
                question_pages JSONB NOT NULL DEFAULT '[]',
                assigned_teacher TEXT NOT NULL DEFAULT '',
                student_dataset_id INTEGER NULL,
                student_label TEXT NOT NULL DEFAULT '',
                is_released BOOLEAN NOT NULL DEFAULT FALSE,
                released_at TIMESTAMPTZ NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS student_marks (
                id SERIAL PRIMARY KEY,
                exam_id INTEGER NOT NULL REFERENCES final_exams(id) ON DELETE CASCADE,
                student_dataset_id INTEGER NOT NULL,
                row_index INTEGER NOT NULL,
                student_name TEXT NOT NULL DEFAULT '',
                marks_json JSONB NOT NULL DEFAULT '[]',
                total_obtained DOUBLE PRECISION NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (exam_id, student_dataset_id, row_index)
            );
            CREATE TABLE IF NOT EXISTS student_datasets (
                id SERIAL PRIMARY KEY,
                branch TEXT NOT NULL,
                semester TEXT NOT NULL,
                assigned_teacher TEXT NOT NULL,
                subject_name TEXT NOT NULL,
                original_filename TEXT NOT NULL DEFAULT '',
                s3_url TEXT NOT NULL DEFAULT '',
                s3_key TEXT NOT NULL DEFAULT '',
                columns_json JSONB NOT NULL DEFAULT '[]',
                mapping_json JSONB NOT NULL DEFAULT '{}',
                row_count INTEGER NOT NULL DEFAULT 0,
                preview_json JSONB NOT NULL DEFAULT '[]',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            """
        )
        # ---- lightweight migrations for pre-existing databases ----
        # Older DBs were created without the results-release columns, so
        # backfill them idempotently; a failure here must not kill startup.
        for ddl in (
            "ALTER TABLE final_exams ADD COLUMN IF NOT EXISTS"
            " is_released BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE final_exams ADD COLUMN IF NOT EXISTS"
            " released_at TIMESTAMPTZ NULL",
        ):
            try:
                with psycopg.connect(EXAM_DATABASE_URL) as migrate_conn:
                    migrate_conn.execute(ddl)
                    migrate_conn.commit()
            except Exception as exc:  # keep startup resilient
                print(f"final_exams migration skipped ({ddl}): {exc}")


def upload_bytes_to_s3(data: bytes, content_type: str, ext: str, prefix: str) -> dict:
    """Upload raw bytes to S3 and return url/key metadata."""
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    key = f"{prefix}/{day}/{uuid.uuid4().hex}{ext}"
    s3 = get_s3_client()

    try:
        s3.upload_fileobj(
            BytesIO(data),
            S3_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    except (ClientError, BotoCoreError) as exc:
        raise HTTPException(status_code=502, detail=f"s3 upload failed: {exc}")

    return {
        "url": public_s3_url(key),
        "key": key,
        "bucket": S3_BUCKET,
        "region": AWS_REGION,
        "content_type": content_type,
        "size_bytes": len(data),
    }


def _validate_pdf_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    if ctype and ctype != "application/pdf" and "pdf" not in ctype:
        raise HTTPException(status_code=415, detail=f"not a pdf: {file.content_type}")
    if name and not name.endswith(".pdf"):
        raise HTTPException(status_code=415, detail="file must be a .pdf")


def pdf_bytes_to_page_pngs(pdf_bytes: bytes, dpi: int = PDF_RENDER_DPI) -> list[bytes]:
    """Render each PDF page to PNG bytes using PyMuPDF (no system deps needed)."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="pdf rendering library missing: install pymupdf",
        )
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"cannot parse pdf: {exc}")
    if doc.page_count == 0:
        raise HTTPException(status_code=422, detail="pdf has no pages")
    if doc.page_count > MAX_PDF_PAGES:
        raise HTTPException(
            status_code=422,
            detail=f"pdf has {doc.page_count} pages, max is {MAX_PDF_PAGES}",
        )
    pngs: list[bytes] = []
    try:
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            pngs.append(pix.tobytes("png"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"pdf rendering failed: {exc}")
    finally:
        doc.close()
    return pngs


async def analyze_syllabus_image_url(image_url: str, subject: str) -> str:
    """Send one syllabus page image URL to the vision chat-completion model."""
    subject_label = subject.strip() or "General"
    prompt = (
        f"You are an exam-preparation assistant for the subject '{subject_label}'. "
        "Analyse this syllabus page image carefully and return markdown with:\n"
        "1. **Topics on this page** — bullet list of every topic/sub-topic you can read.\n"
        "2. **Key points** — 2-4 sentences summarising what the page covers.\n"
        "3. **Suggested exam focus** — what a student should prioritise from this page.\n"
        "If any text is unreadable, say so explicitly."
    )
    client = get_async_openai_client()
    try:
        completion = await client.chat.completions.create(
            model=LUNA_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ai analysis failed: {exc}")
    try:
        reply = (completion.choices[0].message.content or "").strip()
    except (IndexError, AttributeError):
        reply = ""
    if not reply:
        raise HTTPException(status_code=502, detail="ai returned an empty analysis")
    return reply


async def summarize_analyses_to_md(subject: str, per_page: list[tuple[int, str]]) -> str:
    """Combine per-page syllabus analyses into one markdown summary."""
    joined = "\n\n".join(f"## Syllabus page {n}\n{a}" for n, a in per_page)
    prompt = (
        f"Subject: {subject.strip() or 'General'}\n\n"
        "Below are per-page analyses of a syllabus. Combine them into ONE "
        "concise markdown summary of the whole syllabus with this structure:\n"
        "# <subject> — Syllabus Summary\n"
        "## Topics covered — bullet list of every topic\n"
        "## Key points — short summary of what matters\n"
        "## Suggested exam focus — what to prioritise\n"
        "Deduplicate topics that repeat across pages. Reply with markdown only.\n\n"
        f"{joined}"
    )
    client = get_async_openai_client()
    try:
        completion = await client.chat.completions.create(
            model=LUNA_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an exam-preparation assistant. Reply with "
                    "GitHub-flavored markdown only, no wrapping code fences.",
                },
                {"role": "user", "content": prompt},
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ai summary failed: {exc}")
    try:
        reply = (completion.choices[0].message.content or "").strip()
    except (IndexError, AttributeError):
        reply = ""
    if not reply:
        raise HTTPException(status_code=502, detail="ai returned an empty summary")
    return reply


# ---- models ----
class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"] = "user"
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=8192)


class ChatResponse(BaseModel):
    model: str
    reply: str


class SyllabusPageImage(BaseModel):
    page: int
    url: str
    key: str
    content_type: str = "image/png"
    size_bytes: int


class SyllabusToImagesResponse(BaseModel):
    subject: str
    num_pages: int
    pages: list[SyllabusPageImage]


class AnalyzeImageRequest(BaseModel):
    image_url: str = Field(min_length=8)
    subject: str = Field(default="General", max_length=200)


class AnalyzeImageResponse(BaseModel):
    model: str
    subject: str
    image_url: str
    analysis: str


class AnalysedSyllabusPage(BaseModel):
    page: int
    image_url: str
    key: str
    analysis: str


class AnalyzeSyllabusResponse(BaseModel):
    model: str
    subject: str
    num_pages: int
    pages: list[AnalysedSyllabusPage]


# ---- routes ----
@app.get("/")
async def root():
    return {
        "service": "mponline-api",
        "docs": "/docs",
        "luna_model": LUNA_MODEL,
        "luna_base_url": LUNA_BASE_URL,
        "vision_model": LUNA_MODEL,
        "vision_base_url": LUNA_BASE_URL,
        "s3_bucket": S3_BUCKET,
        "aws_region": AWS_REGION,
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "luna_model": LUNA_MODEL,
        "luna_configured": bool(LUNA_API_KEY),
        "vision_model": LUNA_MODEL,
        "vision_configured": bool(LUNA_API_KEY),
        "s3_bucket": S3_BUCKET,
        "aws_region": AWS_REGION,
    }


@app.get("/config")
async def config():
    """Non-secret runtime config (never leaks the API key)."""
    return {
        "luna_model": LUNA_MODEL,
        "luna_base_url": LUNA_BASE_URL,
        "luna_key_configured": bool(LUNA_API_KEY),
        "vision_model": LUNA_MODEL,
        "vision_base_url": LUNA_BASE_URL,
        "vision_key_configured": bool(LUNA_API_KEY),
        "s3_bucket": S3_BUCKET,
        "aws_region": AWS_REGION,
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    """OpenAI-style message completion via LangChain ChatOpenAI (Luna)."""
    if not body.messages:
        raise HTTPException(status_code=422, detail="messages must not be empty")
    lc_messages = []
    for m in body.messages:
        if m.role == "system":
            lc_messages.append(SystemMessage(content=m.content))
        elif m.role == "assistant":
            lc_messages.append(AIMessage(content=m.content))
        else:
            lc_messages.append(HumanMessage(content=m.content))
    llm = get_luna_llm(temperature=body.temperature, max_tokens=body.max_tokens)
    try:
        result = await llm.ainvoke(lc_messages)
        reply = result.content if isinstance(result.content, str) else str(result.content)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"luna request failed: {exc}")
    return ChatResponse(model=LUNA_MODEL, reply=reply)


@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """Upload an image to the public S3 bucket and return its public URL."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail=f"not an image: {file.content_type}")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTS:
        # fall back to content-type mapping when filename has no/odd extension
        ext = ALLOWED_CONTENT_TYPES.get(file.content_type, "")
        if not ext:
            raise HTTPException(status_code=415, detail=f"unsupported image type: {file.content_type}")
    if ext == ".jpeg":
        ext = ".jpg"

    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image larger than 10 MB")

    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    key = f"uploads/{day}/{uuid.uuid4().hex}{ext}"
    content_type = file.content_type
    # normalise jpeg extension/content-type pair
    if ext == ".jpg" and content_type not in ALLOWED_CONTENT_TYPES:
        content_type = "image/jpeg"

    s3 = get_s3_client()

    try:
        s3.upload_fileobj(
            BytesIO(data),
            S3_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    except (ClientError, BotoCoreError) as exc:
        raise HTTPException(status_code=502, detail=f"s3 upload failed: {exc}")

    return {
        "url": public_s3_url(key),
        "key": key,
        "bucket": S3_BUCKET,
        "region": AWS_REGION,
        "content_type": content_type,
        "size_bytes": len(data),
    }


@app.post("/exam/syllabus-to-images", response_model=SyllabusToImagesResponse)
async def syllabus_to_images(
    subject: str = Form(default="General"),
    file: UploadFile = File(...),
):
    """PDF syllabus -> one PNG per page (PyMuPDF) -> S3. Returns public image URLs."""
    _validate_pdf_upload(file)
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=422, detail="empty pdf")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="pdf larger than 25 MB")

    pngs = pdf_bytes_to_page_pngs(pdf_bytes)
    pages: list[SyllabusPageImage] = []
    for i, png in enumerate(pngs, start=1):
        meta = upload_bytes_to_s3(png, "image/png", ".png", prefix="syllabus")
        pages.append(
            SyllabusPageImage(
                page=i,
                url=meta["url"],
                key=meta["key"],
                content_type="image/png",
                size_bytes=meta["size_bytes"],
            )
        )
    return SyllabusToImagesResponse(
        subject=subject.strip() or "General", num_pages=len(pages), pages=pages
    )


@app.post("/exam/analyze-image", response_model=AnalyzeImageResponse)
async def analyze_image(body: AnalyzeImageRequest):
    """Give one S3 syllabus-page image URL to the Luna chat-completion model."""
    analysis = await analyze_syllabus_image_url(body.image_url, body.subject)
    return AnalyzeImageResponse(
        model=LUNA_MODEL,
        subject=body.subject.strip() or "General",
        image_url=body.image_url,
        analysis=analysis,
    )


@app.post("/exam/analyze-syllabus", response_model=AnalyzeSyllabusResponse)
async def analyze_syllabus(
    subject: str = Form(...),
    file: UploadFile = File(...),
):
    """Full pipeline: pdf -> page PNGs -> S3 -> Luna vision analysis per page."""
    subject_clean = (subject or "").strip()
    if not subject_clean:
        raise HTTPException(status_code=422, detail="subject name is required")
    _validate_pdf_upload(file)
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=422, detail="empty pdf")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="pdf larger than 25 MB")

    pngs = pdf_bytes_to_page_pngs(pdf_bytes)
    pages: list[AnalysedSyllabusPage] = []
    for i, png in enumerate(pngs, start=1):
        meta = upload_bytes_to_s3(png, "image/png", ".png", prefix="syllabus")
        analysis = await analyze_syllabus_image_url(meta["url"], subject_clean)
        pages.append(
            AnalysedSyllabusPage(
                page=i, image_url=meta["url"], key=meta["key"], analysis=analysis
            )
        )
    return AnalyzeSyllabusResponse(
        model=LUNA_MODEL, subject=subject_clean, num_pages=len(pages), pages=pages
    )


class SyllabusSummaryPage(BaseModel):
    page: int
    image_url: str
    key: str


class SummarizeSyllabusResponse(BaseModel):
    model: str
    subject: str
    num_pages: int
    pages: list[SyllabusSummaryPage]
    summary_md: str


class SaveExamRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    image_urls: list[str] = Field(default_factory=list)
    summary_md: str = Field(min_length=1)


@app.post("/exam/summarize-syllabus", response_model=SummarizeSyllabusResponse)
async def summarize_syllabus(
    subject: str = Form(...),
    file: UploadFile = File(...),
):
    """Full pipeline: pdf -> page PNGs -> S3 -> per-page analysis -> ONE markdown summary."""
    subject_clean = (subject or "").strip()
    if not subject_clean:
        raise HTTPException(status_code=422, detail="subject name is required")
    _validate_pdf_upload(file)
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=422, detail="empty pdf")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="pdf larger than 25 MB")

    pngs = pdf_bytes_to_page_pngs(pdf_bytes)
    pages: list[SyllabusSummaryPage] = []
    per_page: list[tuple[int, str]] = []
    for i, png in enumerate(pngs, start=1):
        meta = upload_bytes_to_s3(png, "image/png", ".png", prefix="syllabus")
        analysis = await analyze_syllabus_image_url(meta["url"], subject_clean)
        pages.append(
            SyllabusSummaryPage(page=i, image_url=meta["url"], key=meta["key"])
        )
        per_page.append((i, analysis))
    summary_md = await summarize_analyses_to_md(subject_clean, per_page)
    return SummarizeSyllabusResponse(
        model=LUNA_MODEL,
        subject=subject_clean,
        num_pages=len(pages),
        pages=pages,
        summary_md=summary_md,
    )


@app.post("/exam/save")
async def save_exam(body: SaveExamRequest):
    """Persist an accepted summary: name + page image urls + markdown → examdb."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "INSERT INTO exams (name, image_urls, summary_md)"
                " VALUES (%s, %s, %s) RETURNING id, created_at",
                (body.name.strip(), body.image_urls, body.summary_md),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    return {
        "id": row["id"],
        "name": body.name.strip(),
        "num_images": len(body.image_urls),
        "created_at": str(row["created_at"]),
    }


@app.get("/exam/list")
async def list_exams():
    """List saved exams (newest first)."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT id, name,"
                " COALESCE(array_length(image_urls, 1), 0) AS num_images,"
                " created_at FROM exams ORDER BY created_at DESC"
            ).fetchall()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    return {
        "exams": [
            {
                "id": r["id"],
                "name": r["name"],
                "num_images": r["num_images"] or 0,
                "created_at": str(r["created_at"]),
            }
            for r in rows
        ]
    }


def _extract_json_object(text: str) -> dict:
    """Pull the first JSON object out of an LLM reply (strips fences/prose)."""
    import json as _json
    import re as _re

    t = text.strip()
    t = _re.sub(r"^```(?:json)?\s*", "", t)
    t = _re.sub(r"\s*```$", "", t)
    start = t.find("{")
    if start == -1:
        raise HTTPException(status_code=502, detail="ai did not return JSON")
    # balanced-brace scan so nested objects survive
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return _json.loads(t[start : i + 1])
                    except Exception as exc:
                        raise HTTPException(
                            status_code=502, detail=f"ai returned bad JSON: {exc}"
                        )
    # fallback: try the whole trimmed string
    try:
        obj = _json.loads(t[start:])
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    raise HTTPException(status_code=502, detail="ai did not return valid JSON")


async def _extract_qp_page(
    image_url: str, page_no: int, num_pages: int, prev_questions_json: str
) -> dict:
    """Vision extraction for ONE question-paper page, with previous pages as context."""
    prompt = (
        "You are extracting a question paper into structured JSON. "
        f"This is page {page_no} of {num_pages}.\n"
        "Questions already extracted from PREVIOUS pages (the last one may "
        "continue onto this page):\n"
        f"{prev_questions_json}\n"
        "Instructions:\n"
        "- Read every question visible on THIS page image only.\n"
        "- If the first text on this page continues the last previous question "
        "(no new question number/section), include it with \"continued\": true "
        "and the FULL merged text of that question.\n"
        "- Parse SUB-QUESTIONS into nested objects: a question like 1 with "
        "parts (a), (b), (c) gets \"sub_questions\": [{\"q_no\": \"a\", ...}]; "
        "a part like (a) with roman-numeral items (i), (ii) nests one level "
        "deeper inside that part's own \"sub_questions\". Nest as deep as the "
        "paper goes.\n"
        "- Identify MARKS at every level: the marks printed against each "
        "question AND against each nested sub-question (e.g. \"(a) ... [3]\" "
        "means part (a) carries 3 marks). A parent's marks should equal the "
        "sum of its parts when both are printed; if only parts carry marks, "
        "still record the parent marks as printed (or null if not printed).\n"
        "- Total marks and subject name are usually printed on page 1 — capture "
        "them in page_info when visible.\n"
        "- section: section header (e.g. \"A\", \"Section B\") if shown, else \"\".\n"
        "- marks: printed marks for that (sub-)question, else null.\n"
        "Return ONLY this JSON, no prose:\n"
        '{"questions": [{"q_no": "1", "section": "A", "text": "...", '
        '"marks": 10, "continued": false, "sub_questions": ['
        '{"q_no": "a", "section": "", "text": "...", "marks": 4, '
        '"continued": false, "sub_questions": ['
        '{"q_no": "i", "section": "", "text": "...", "marks": 2, '
        '"continued": false, "sub_questions": []}]}]}], '
        '"page_info": {"subject_name": "...", "total_marks": null}}'
    )
    client = get_async_openai_client()
    try:
        completion = await client.chat.completions.create(
            model=LUNA_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ai analysis failed: {exc}")
    try:
        reply = (completion.choices[0].message.content or "").strip()
    except (IndexError, AttributeError):
        reply = ""
    if not reply:
        raise HTTPException(status_code=502, detail="ai returned an empty analysis")
    return _extract_json_object(reply)


async def _consolidate_qp(per_page: list[dict]) -> dict:
    """Merge per-page extractions into one final question-paper JSON."""
    import json as _json

    joined = _json.dumps(per_page)
    prompt = (
        "Merge these per-page question-paper extractions into ONE final JSON "
        "for the whole paper, questions in order from first to last.\n"
        "- Merge any entry with \"continued\": true into the previous question "
        "at the SAME nesting level (single entry, full text, keep original "
        "q_no/marks, keep its sub_questions).\n"
        "- Preserve the nested sub_questions structure exactly (parts a/b/c "
        "inside their parent, roman-numeral items inside their part).\n"
        "- Every question and sub-question keeps its own marks as printed; "
        "verify a parent's marks against the sum of its parts where both are "
        "printed.\n"
        "- total_questions = number of merged TOP-LEVEL questions (do not "
        "count sub-questions).\n"
        "- total_marks = the printed total if present, else the sum of marks.\n"
        "- subject_name = the printed subject, else \"\".\n"
        "Return ONLY this JSON, no prose:\n"
        '{"subject_name": "...", "total_marks": 70, "total_questions": 12, '
        '"questions": [{"q_no": "1", "section": "A", "text": "...", '
        '"marks": 10, "page": 1, "sub_questions": ['
        '{"q_no": "a", "section": "", "text": "...", "marks": 4, "page": 1, '
        '"sub_questions": []}]}]}'
        f"\n\nPer-page data:\n{joined}"
    )
    client = get_async_openai_client()
    try:
        completion = await client.chat.completions.create(
            model=LUNA_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You merge question-paper data. Reply with a single "
                    "JSON object only, no code fences, no prose.",
                },
                {"role": "user", "content": prompt},
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ai merge failed: {exc}")
    try:
        reply = (completion.choices[0].message.content or "").strip()
    except (IndexError, AttributeError):
        reply = ""
    if not reply:
        raise HTTPException(status_code=502, detail="ai returned an empty merge")
    return _extract_json_object(reply)


class QuestionPaperPage(BaseModel):
    page: int
    url: str
    key: str


class QuestionItem(BaseModel):
    q_no: str = ""
    section: str = ""
    text: str = ""
    marks: int | None = None
    page: int | None = None
    sub_questions: list["QuestionItem"] = Field(default_factory=list)


QuestionItem.model_rebuild()


class AnalyzeQuestionPaperResponse(BaseModel):
    model: str
    subject_name: str = ""
    total_marks: int = 0
    total_questions: int = 0
    questions: list[QuestionItem] = Field(default_factory=list)
    pages: list[QuestionPaperPage] = Field(default_factory=list)


@app.post("/exam/analyze-question-paper", response_model=AnalyzeQuestionPaperResponse)
async def analyze_question_paper(
    subject: str = Form(default=""),
    file: UploadFile = File(...),
):
    """Full pipeline: question-paper pdf -> page PNGs -> S3 -> structured AI extraction (vision model).

    Pages are analysed sequentially with previous pages as context so questions
    split across pages stay intact; a final merge pass consolidates everything.
    """
    import json as _json

    subject_hint = (subject or "").strip()
    _validate_pdf_upload(file)
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=422, detail="empty pdf")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="pdf larger than 25 MB")

    pngs = pdf_bytes_to_page_pngs(pdf_bytes)
    pages: list[QuestionPaperPage] = []
    per_page: list[dict] = []
    running: list[dict] = []  # context carried forward page to page
    for i, png in enumerate(pngs, start=1):
        meta = upload_bytes_to_s3(png, "image/png", ".png", prefix="question-paper")
        pages.append(QuestionPaperPage(page=i, url=meta["url"], key=meta["key"]))
        prev_json = _json.dumps(running) if running else "[] (this is the first page)"
        extracted = await _extract_qp_page(meta["url"], i, len(pngs), prev_json)
        extracted["page"] = i
        per_page.append(extracted)
        for q in extracted.get("questions", []) or []:
            running.append({**q, "page": i})

    merged = await _consolidate_qp(per_page)

    def _to_int_or_none(v) -> int | None:
        try:
            return int(v) if v is not None and str(v).strip() != "" else None
        except (ValueError, TypeError, AttributeError):
            return None

    def _to_item(q: dict) -> QuestionItem:
        subs = q.get("sub_questions", []) or []
        return QuestionItem(
            q_no=str(q.get("q_no", "") or ""),
            section=str(q.get("section", "") or ""),
            text=str(q.get("text", "") or ""),
            marks=_to_int_or_none(q.get("marks")),
            page=_to_int_or_none(q.get("page")),
            sub_questions=[_to_item(s) for s in subs if isinstance(s, dict)],
        )

    questions: list[QuestionItem] = [
        _to_item(q) for q in merged.get("questions", []) or [] if isinstance(q, dict)
    ]
    try:
        tm = merged.get("total_marks", 0) or 0
        total_marks = int(tm)
    except (ValueError, TypeError):
        total_marks = 0
    total_questions = int(merged.get("total_questions", 0) or 0) or len(questions)
    subject_name = str(merged.get("subject_name", "") or "") or subject_hint
    return AnalyzeQuestionPaperResponse(
        model=LUNA_MODEL,
        subject_name=subject_name,
        total_marks=total_marks,
        total_questions=total_questions,
        questions=questions,
        pages=pages,
    )


class FinalExamCreate(BaseModel):
    subject_name: str = Field(min_length=1, max_length=200)
    syllabus_exam_id: int | None = None
    syllabus_summary: str = ""
    questions: list[QuestionItem] = Field(default_factory=list)
    total_marks: int = 0
    total_questions: int = 0
    question_pages: list[QuestionPaperPage] = Field(default_factory=list)
    assigned_teacher: str = Field(min_length=1, max_length=200)
    student_dataset_id: int | None = None
    student_label: str = ""


@app.post("/exam/final/create")
async def create_final_exam(body: FinalExamCreate):
    """Create the final exam: links syllabus + analysed paper + teacher + students."""
    import json as _json

    if not body.assigned_teacher.strip():
        raise HTTPException(status_code=422, detail="assigned_teacher is required")
    questions = [q.model_dump() for q in body.questions]
    pages = [p.model_dump() for p in body.question_pages]
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "INSERT INTO final_exams (subject_name, syllabus_exam_id,"
                " syllabus_summary, question_json, total_marks, total_questions,"
                " question_pages, assigned_teacher, student_dataset_id, student_label)"
                " VALUES (%s,%s,%s,%s::jsonb,%s,%s,%s::jsonb,%s,%s,%s)"
                " RETURNING id, created_at",
                (
                    body.subject_name.strip(),
                    body.syllabus_exam_id,
                    body.syllabus_summary,
                    _json.dumps(questions),
                    body.total_marks,
                    body.total_questions or len(questions),
                    _json.dumps(pages),
                    body.assigned_teacher.strip(),
                    body.student_dataset_id,
                    body.student_label.strip(),
                ),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    return {
        "id": row["id"],
        "subject_name": body.subject_name.strip(),
        "total_marks": body.total_marks,
        "total_questions": body.total_questions or len(questions),
        "assigned_teacher": body.assigned_teacher.strip(),
        "created_at": str(row["created_at"]),
    }


@app.get("/exam/final/list")
async def list_final_exams(teacher: str = ""):
    """List created exams; pass ?teacher=<name> so a teacher sees only their own."""
    teacher = (teacher or "").strip()
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            if teacher:
                rows = conn.execute(
                    "SELECT id, subject_name, total_marks, total_questions,"
                    " assigned_teacher, student_dataset_id, student_label,"
                    " is_released, released_at,"
                    " created_at FROM final_exams"
                    " WHERE assigned_teacher = %s ORDER BY created_at DESC",
                    (teacher,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, subject_name, total_marks, total_questions,"
                    " assigned_teacher, student_dataset_id, student_label,"
                    " is_released, released_at,"
                    " created_at FROM final_exams ORDER BY created_at DESC"
                ).fetchall()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    return {
        "exams": [
            {
                "id": r["id"],
                "subject_name": r["subject_name"],
                "total_marks": r["total_marks"],
                "total_questions": r["total_questions"],
                "assigned_teacher": r["assigned_teacher"],
                "student_dataset_id": r["student_dataset_id"],
                "student_label": r["student_label"],
                "is_released": bool(r.get("is_released", False)),
                "released_at": str(r["released_at"]) if r.get("released_at") else None,
                "created_at": str(r["created_at"]),
            }
            for r in rows
        ]
    }


@app.get("/exam/final/{exam_id}")
async def get_final_exam(exam_id: int):
    """Full detail for one exam: questions, pages, syllabus + linked students."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            r = conn.execute(
                "SELECT id, subject_name, syllabus_exam_id, syllabus_summary,"
                " question_json, total_marks, total_questions, question_pages,"
                " assigned_teacher, student_dataset_id, student_label,"
                " is_released, released_at,"
                " created_at FROM final_exams WHERE id = %s",
                (exam_id,),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    if r is None:
        raise HTTPException(status_code=404, detail="exam not found")
    return {
        "id": r["id"],
        "subject_name": r["subject_name"],
        "syllabus_exam_id": r["syllabus_exam_id"],
        "syllabus_summary": r["syllabus_summary"] or "",
        "questions": r["question_json"] or [],
        "total_marks": r["total_marks"],
        "total_questions": r["total_questions"],
        "question_pages": r["question_pages"] or [],
        "assigned_teacher": r["assigned_teacher"],
        "student_dataset_id": r["student_dataset_id"],
        "student_label": r["student_label"] or "",
        "is_released": bool(r.get("is_released", False)),
        "released_at": str(r["released_at"]) if r.get("released_at") else None,
        "created_at": str(r["created_at"]),
    }


@app.post("/exam/final/{exam_id}/release")
async def release_final_exam(exam_id: int):
    """Release an exam's results: makes it visible on public /results."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            existing = conn.execute(
                "SELECT id, student_dataset_id FROM final_exams WHERE id = %s",
                (exam_id,),
            ).fetchone()
            if existing is None:
                raise HTTPException(status_code=404, detail="exam not found")
            if not existing.get("student_dataset_id"):
                raise HTTPException(
                    status_code=422,
                    detail="link a student list before releasing results",
                )
            r = conn.execute(
                "UPDATE final_exams SET is_released = TRUE, released_at = now()"
                " WHERE id = %s RETURNING id, is_released, released_at",
                (exam_id,),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail="examdb unreachable")
    return {
        "id": r["id"],
        "is_released": bool(r["is_released"]),
        "released_at": str(r["released_at"]) if r.get("released_at") else None,
    }


@app.post("/exam/final/{exam_id}/unrelease")
async def unrelease_final_exam(exam_id: int):
    """Hide an exam's results again (removes it from public /results)."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            r = conn.execute(
                "UPDATE final_exams SET is_released = FALSE, released_at = NULL"
                " WHERE id = %s RETURNING id",
                (exam_id,),
            ).fetchone()
            if r is None:
                raise HTTPException(status_code=404, detail="exam not found")
            conn.commit()
    except HTTPException:
        raise
    except psycopg.OperationalError:
        raise HTTPException(status_code=503, detail="examdb unreachable")
    return {"id": r["id"], "is_released": False, "released_at": None}


def _num_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        text = str(value).strip()
        if text == "":
            return None
        return float(text)
    except (TypeError, ValueError):
        return None


def _released_exam_or_error(exam_id: int) -> dict:
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            r = conn.execute(
                "SELECT id, subject_name, total_marks,"
                " assigned_teacher, student_dataset_id, student_label,"
                " is_released FROM final_exams WHERE id = %s",
                (exam_id,),
            ).fetchone()
    except psycopg.OperationalError:
        raise HTTPException(status_code=503, detail="examdb unreachable")
    if r is None:
        raise HTTPException(status_code=404, detail="exam not found")
    if not r.get("is_released"):
        raise HTTPException(status_code=403, detail="results not released yet")
    if not r.get("student_dataset_id"):
        raise HTTPException(status_code=422, detail="no student list linked")
    return dict(r)


def _read_dataset_csv_rows(ds: dict, limit: int = 5000) -> tuple[list[str], list[dict]]:
    """Read full CSV rows for a dataset (S3 first, stored preview fallback)."""
    columns = ds.get("columns") or []
    s3_key = ds.get("s3_key") or ""
    if s3_key:
        try:
            s3 = get_s3_client()
            buf = BytesIO()
            s3.download_fileobj(S3_BUCKET, s3_key, buf)
            raw = buf.getvalue()
            try:
                csv_text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                csv_text = raw.decode("latin-1")
            import csv as _csv

            text = csv_text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
            lines = [ln for ln in text.split("\n") if ln.strip() != ""]
            reader = _csv.DictReader(lines)
            cols = [c.strip() if isinstance(c, str) else c for c in (reader.fieldnames or [])]
            rows: list[dict] = []
            for row in reader:
                if len(rows) >= limit:
                    break
                rows.append({c: (row.get(c, "") or "") for c in cols})
            return cols, rows
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"could not read csv: {exc}")
    preview = ds.get("preview") or []
    return columns, [{c: (row.get(c, "") or "") for c in columns} for row in preview]


def _teacher_marks_map(exam_id: int, dataset_id: int) -> dict[int, float]:
    """row_index -> teacher-entered total (overrides CSV obtained value)."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT row_index, total_obtained FROM student_marks"
                " WHERE exam_id = %s AND student_dataset_id = %s",
                (exam_id, dataset_id),
            ).fetchall()
    except psycopg.OperationalError:
        return {}
    out: dict[int, float] = {}
    for r in rows:
        try:
            out[int(r["row_index"])] = float(r["total_obtained"])
        except (TypeError, ValueError, KeyError):
            continue
    return out


@app.get("/exam/results")
async def list_released_results():
    """Public: exams whose results the coordinator released (newest first)."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT f.id, f.subject_name, f.total_marks, f.total_questions,"
                " f.assigned_teacher, f.student_label, f.released_at,"
                " COALESCE(d.row_count, 0) AS student_count,"
                " COALESCE(d.mapping_json->>'unique_field', '') AS unique_field"
                " FROM final_exams f"
                " LEFT JOIN student_datasets d ON d.id = f.student_dataset_id"
                " WHERE f.is_released = TRUE"
                " ORDER BY f.released_at DESC NULLS LAST, f.created_at DESC"
            ).fetchall()
    except psycopg.OperationalError:
        raise HTTPException(status_code=503, detail="examdb unreachable")
    return {
        "exams": [
            {
                "id": r["id"],
                "subject_name": r["subject_name"],
                "total_marks": r["total_marks"],
                "released_at": str(r["released_at"]) if r.get("released_at") else None,
                "student_label": r["student_label"] or "",
                "student_count": r["student_count"] or 0,
                "unique_field": r.get("unique_field") or "",
            }
            for r in rows
        ]
    }


@app.get("/exam/results/{exam_id}")
async def lookup_released_result(exam_id: int, q: str):
    """Public: look up one student's result by the dataset unique field."""
    query = (q or "").strip()
    if not query:
        raise HTTPException(status_code=422, detail="search text required")
    exam = _released_exam_or_error(exam_id)
    dataset_id = int(exam["student_dataset_id"])
    ds = _get_dataset_or_404(dataset_id)
    mapping = ds.get("mapping") or {}
    unique_col = (mapping.get("unique_field") or "").strip()
    name_col = (mapping.get("student_name") or "").strip()
    total_col = (mapping.get("total_marks") or "").strip()
    obtained_col = (mapping.get("obtained_marks") or "").strip()
    search_col = unique_col or name_col
    if not search_col:
        raise HTTPException(status_code=422, detail="no searchable column")
    columns, csv_rows = _read_dataset_csv_rows(ds)
    if search_col not in columns:
        raise HTTPException(status_code=422, detail="search column missing")
    marks_map = _teacher_marks_map(exam_id, dataset_id)
    norm = query.lower()
    exact: list[tuple[int, dict]] = []
    partial: list[tuple[int, dict]] = []
    for idx, row in enumerate(csv_rows):
        cell = str(row.get(search_col, "") or "").strip()
        if not cell:
            continue
        low = cell.lower()
        if low == norm:
            exact.append((idx, row))
        elif norm in low:
            partial.append((idx, row))
    hits = exact or partial
    if not hits:
        raise HTTPException(status_code=404, detail="no student found")
    if len(hits) > 1 and not exact:
        cands = []
        for idx, row in hits[:10]:
            cands.append({
                "row_index": idx,
                search_col: str(row.get(search_col, "") or ""),
                "student_name": str(row.get(name_col, "") or "") if name_col else "",
            })
        return {
            "match": "candidates", "search_column": search_col,
            "total": len(hits), "candidates": cands,
        }
    row_index, row = hits[0]
    override = marks_map.get(row_index)
    csv_obtained = _num_or_none(row.get(obtained_col)) if obtained_col else None
    csv_max = _num_or_none(row.get(total_col)) if total_col else None
    obtained = override if override is not None else csv_obtained
    max_marks = csv_max if csv_max is not None else _num_or_none(exam.get("total_marks"))
    pct = (obtained / max_marks * 100) if obtained is not None and max_marks else None
    return {
        "match": "single", "search_column": search_col,
        "exam": {"id": exam["id"], "subject_name": exam["subject_name"]},
        "student": {
            "row_index": row_index,
            "unique_value": str(row.get(search_col, "") or ""),
            "student_name": str(row.get(name_col, "") or "") if name_col else "",
            "max_marks": max_marks,
            "obtained_marks": obtained,
            "percentage": round(pct, 2) if pct is not None else None,
            "updated_by_teacher": override is not None,
        },
    }


class AnswerSheetAnalysisResponse(BaseModel):
    model: str
    matched_question: str = ""
    max_marks: float = 0
    awarded_marks: float = 0
    expected_answer: str = ""
    strengths: str = ""
    improvements: str = ""


def _downscale_image(data: bytes, content_type: str, max_side: int = 1600) -> tuple[bytes, str]:
    """Downscale large answer-sheet photos so vision payloads stay small."""
    try:
        from PIL import Image
    except ImportError:
        return data, content_type
    try:
        img = Image.open(BytesIO(data)).convert("RGB")
        if max(img.size) > max_side:
            img.thumbnail((max_side, max_side))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return data, content_type


@app.post("/exam/analyze-answer-sheet", response_model=AnswerSheetAnalysisResponse)
async def analyze_answer_sheet(
    subject: str = Form(default=""),
    questions: str = Form(...),
    file: UploadFile = File(...),
):
    """Check one answer-sheet photo against the question paper.

    `questions` is a JSON array of {q_no, text, marks, sub_questions}.
    The model matches the handwriting to one question and returns
    max/awarded marks plus qualitative feedback as JSON.
    """
    import base64 as _b64
    import json as _json

    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=415, detail=f"not an image: {file.content_type}")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="empty image")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image larger than 10 MB")

    try:
        questions_obj = _json.loads(questions or "[]")
    except Exception:
        raise HTTPException(status_code=422, detail="questions must be valid JSON")
    if not isinstance(questions_obj, list) or not questions_obj:
        raise HTTPException(status_code=422, detail="questions must be a non-empty JSON array")

    small, small_type = _downscale_image(raw, ctype)
    data_uri = f"data:{small_type};base64,{_b64.b64encode(small).decode('ascii')}"

    subject_label = (subject or "").strip() or "General"
    prompt = (
        f"You are checking a student's handwritten answer-sheet photo for '{subject_label}'. "
        "Below is the question paper as JSON (each entry has q_no, text, marks "
        "and nested sub_questions).\n"
        f"{_json.dumps(questions_obj)}\n"
        "Task:\n"
        "- Match the handwritten answer in the photo to the ONE question it answers "
        "(use its q_no, e.g. \"1\" or \"2a\" for a sub-question).\n"
        "- max_marks = the marks that question carries per the paper (number only).\n"
        "- awarded_marks = how many marks the answer deserves (number only, 0 to max_marks).\n"
        "- expected_answer = what a full-marks answer should contain (2-5 sentences).\n"
        "- strengths = what is good in this student's answer (2-4 short phrases).\n"
        "- improvements = what is missing or wrong and would gain marks.\n"
        "Return ONLY this JSON, no prose:\n"
        '{"matched_question": "1", "max_marks": 5, "awarded_marks": 3.5, '
        '"expected_answer": "...", "strengths": "...", "improvements": "..."}'
    )
    client = get_async_openai_client()
    try:
        completion = await client.chat.completions.create(
            model=LUNA_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_uri}},
                    ],
                }
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ai analysis failed: {exc}")
    try:
        reply = (completion.choices[0].message.content or "").strip()
    except (IndexError, AttributeError):
        reply = ""
    if not reply:
        raise HTTPException(status_code=502, detail="ai returned an empty analysis")
    obj = _extract_json_object(reply)

    def _to_float(v) -> float:
        try:
            return float(v)
        except (ValueError, TypeError):
            return 0

    max_marks = _to_float(obj.get("max_marks"))
    awarded = _to_float(obj.get("awarded_marks"))
    if max_marks and awarded > max_marks:
        awarded = max_marks
    if awarded < 0:
        awarded = 0
    return AnswerSheetAnalysisResponse(
        model=LUNA_MODEL,
        matched_question=str(obj.get("matched_question", "") or ""),
        max_marks=max_marks,
        awarded_marks=awarded,
        expected_answer=str(obj.get("expected_answer", "") or ""),
        strengths=str(obj.get("strengths", "") or ""),
        improvements=str(obj.get("improvements", "") or ""),
    )


class AnswerSheetChatResponse(BaseModel):
    model: str
    # "grading" = marks card for an attached answer page; "chat" = conversational.
    kind: Literal["grading", "chat"] = "chat"
    reply: str = ""
    matched_question: str = ""
    max_marks: float = 0
    awarded_marks: float = 0
    expected_answer: str = ""
    strengths: str = ""
    improvements: str = ""
    suggestions: list[str] = Field(default_factory=list)


@app.post("/exam/answer-sheet/chat", response_model=AnswerSheetChatResponse)
async def answer_sheet_chat(
    subject: str = Form(default=""),
    questions: str = Form(...),
    messages: str = Form(default="[]"),
    target_question: str = Form(default=""),
    images: list[UploadFile] = File(default=[]),
):
    """Chat endpoint for answer-sheet grading and follow-up discussion.

    `questions` is the full question paper JSON (context for every turn);
    `messages` is the prior thread as [{role, content}]; `target_question`
    optionally pins the q_no the attached pages answer; `images` are the
    attached answer-sheet page photos (0..n).

    The model always returns JSON: {"kind": "grading", ...} when it grades
    an answer (marks clamped to the question's max) or {"kind": "chat",
    "reply", "suggestions"} when conversing about the marks it gave.
    """
    import base64 as _b64
    import json as _json

    try:
        questions_obj = _json.loads(questions or "[]")
    except Exception:
        raise HTTPException(status_code=422, detail="questions must be valid JSON")
    if not isinstance(questions_obj, list) or not questions_obj:
        raise HTTPException(status_code=422, detail="questions must be a non-empty JSON array")

    try:
        history_raw = _json.loads(messages or "[]")
    except Exception:
        raise HTTPException(status_code=422, detail="messages must be valid JSON")
    if not isinstance(history_raw, list):
        raise HTTPException(status_code=422, detail="messages must be a JSON array")
    history: list[dict] = []
    for m in history_raw:
        if (
            isinstance(m, dict)
            and m.get("role") in ("user", "assistant")
            and isinstance(m.get("content"), str)
            and m["content"].strip()
        ):
            history.append({"role": m["role"], "content": m["content"].strip()[:4000]})

    # Downscale + inline every attached page as a data URI for the vision call.
    image_uris: list[str] = []
    for f in images:
        ctype = (f.content_type or "").lower()
        if not ctype.startswith("image/"):
            raise HTTPException(status_code=415, detail=f"not an image: {f.content_type}")
        raw = await f.read()
        if not raw:
            raise HTTPException(status_code=422, detail="empty image")
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="image larger than 10 MB")
        small, small_type = _downscale_image(raw, ctype)
        image_uris.append(f"data:{small_type};base64,{_b64.b64encode(small).decode('ascii')}")

    subject_label = (subject or "").strip() or "General"
    system = (
        f"You are the AI grading assistant for the exam '{subject_label}'. The teacher "
        "sends you photos of a student's handwritten answer-sheet pages and discusses "
        "the marks with you. Below is the question paper as JSON (each entry has q_no, "
        "text, marks and nested sub_questions).\n"
        f"{_json.dumps(questions_obj)}\n\n"
        "Rules:\n"
        "- ALWAYS reply with a single JSON object, no prose around it.\n"
        "- When the user's turn contains answer-sheet page photos to grade, reply with: "
        '{"kind": "grading", "matched_question": "<q_no>", "max_marks": <number>, '
        '"awarded_marks": <number>, "expected_answer": "...", "strengths": "...", '
        '"improvements": "...", "reply": "<one-sentence summary of the marks>", '
        '"suggestions": []}. max_marks must be the marks that question carries per '
        "the paper; awarded_marks must be between 0 and max_marks.\n"
        "- If a specific target question is given below, grade ONLY that question.\n"
        "- If the pages clearly answer a different question, use that one instead.\n"
        "- A turn with NO photos is a discussion turn, not a grading request: answer "
        "from the thread. Assistant messages may carry markers like '[You graded this "
        "answer: question X, awarded N of M marks.]' — use those marks and question "
        "numbers when explaining. NEVER ask the user to re-upload pages when a grading "
        "marker is already in the thread. Reply with: {\"kind\": \"chat\", "
        '"reply": "...", "suggestions": ["<short follow-up>", "..."]}.\n'
        "- Only ask for the photos if the thread contains no grading marker at all.\n"
        "- Never invent questions that are not in the paper JSON.\n"
        "- expected_answer = what a full-marks answer should contain (2-5 sentences); "
        "strengths = what is good in this answer; improvements = what is missing or "
        "wrong and would gain marks."
    )
    if (target_question or "").strip():
        system += (
            f"\n\nTARGET QUESTION: the user has pinned q_no '{target_question.strip()}' — "
            "grade ONLY that question from the attached pages."
        )

    user_text = "Please grade the attached answer-sheet page(s)."
    if (target_question or "").strip():
        user_text = f"Grade the attached answer-sheet page(s) for question '{target_question.strip()}'."

    if not image_uris:
        user_text = (
            "(No photos in this message — this is a discussion turn. Use the grading "
            "markers and marks from the thread; do NOT ask for photos again.)"
        )
    content: list[dict] = [{"type": "text", "text": user_text}]
    for uri in image_uris:
        content.append({"type": "image_url", "image_url": {"url": uri}})

    chat_messages: list[dict] = [{"role": "system", "content": system}]
    # Keep the thread focused: recent history only (system carries the paper).
    for m in history[-12:]:
        chat_messages.append({"role": m["role"], "content": m["content"]})
    if not image_uris and any(
        "[You graded this answer" in m["content"] for m in history[-12:]
    ):
        # Reinforce the discussion framing right before the question — some
        # models still ask for photos otherwise.
        chat_messages.append(
            {
                "role": "assistant",
                "content": (
                    "Understood — no photos needed for this turn; I will answer from "
                    "the grades already in this thread."
                ),
            }
        )
    chat_messages.append({"role": "user", "content": content})

    client = get_async_openai_client()
    try:
        completion = await client.chat.completions.create(
            model=LUNA_MODEL,
            messages=chat_messages,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ai chat failed: {exc}")
    try:
        reply = (completion.choices[0].message.content or "").strip()
    except (IndexError, AttributeError):
        reply = ""
    if not reply:
        raise HTTPException(status_code=502, detail="ai returned an empty reply")

    try:
        obj = _extract_json_object(reply)
    except HTTPException:
        # Model ignored the JSON instruction — degrade to a plain chat reply
        # rather than failing the whole turn.
        obj = {"kind": "chat", "reply": reply}

    kind = obj.get("kind") if obj.get("kind") in ("grading", "chat") else "chat"

    # Deterministic guard: on a no-photo discussion turn, some models ignore
    # the thread and ask for photos anyway. Rewrite the reply from the
    # grading markers in the thread so the conversation stays useful.
    _ask_for_photos = (
        not image_uris
        and kind == "chat"
        and ("upload" in reply.lower() or "attach" in reply.lower() or "photo" in reply.lower())
    )
    if _ask_for_photos:
        import re as _re

        grades = _re.findall(
            r"\[You graded this answer: question ([^,]+), awarded ([\d.]+) of ([\d.]+) marks\.\]",
            " ".join(m["content"] for m in history if m["role"] == "assistant"),
        )
        if grades:
            q, got, out_of = grades[-1]
            obj = {
                "kind": "chat",
                "reply": (
                    f"Earlier I graded question {q}: {got} out of {out_of} marks. "
                    "Ask me anything about that grading — for example why marks "
                    "were deducted or how the answer could reach full marks."
                ),
                "suggestions": [
                    f"Why not the full {out_of} marks?",
                    f"How could the answer earn all {out_of} marks?",
                ],
            }
            kind = "chat"

    def _to_float(v) -> float:
        try:
            return float(v)
        except (ValueError, TypeError):
            return 0

    max_marks = _to_float(obj.get("max_marks"))
    awarded = _to_float(obj.get("awarded_marks"))
    if max_marks and awarded > max_marks:
        awarded = max_marks
    if awarded < 0:
        awarded = 0

    def _str(v) -> str:
        return str(v) if v is not None else ""

    suggestions_raw = obj.get("suggestions")
    suggestions = (
        [str(s) for s in suggestions_raw if isinstance(s, (str, int, float))][:4]
        if isinstance(suggestions_raw, list)
        else []
    )
    return AnswerSheetChatResponse(
        model=LUNA_MODEL,
        kind=kind,
        reply=_str(obj.get("reply")) or (
            f"Graded as Q{_str(obj.get('matched_question'))}: {awarded}/{max_marks}."
            if kind == "grading"
            else ""
        ),
        matched_question=_str(obj.get("matched_question")),
        max_marks=max_marks,
        awarded_marks=awarded,
        expected_answer=_str(obj.get("expected_answer")),
        strengths=_str(obj.get("strengths")),
        improvements=_str(obj.get("improvements")),
        suggestions=suggestions,
    )


class QuestionMarkItem(BaseModel):
    q_no: str = ""
    max_marks: float = 0
    obtained: float = 0


class StudentMarksUpsert(BaseModel):
    exam_id: int
    student_dataset_id: int
    row_index: int
    student_name: str = ""
    marks: list[QuestionMarkItem] = Field(default_factory=list)
    total_obtained: float = 0


@app.put("/exam/marks")
async def upsert_student_marks(body: StudentMarksUpsert):
    """Save teacher-entered per-question marks for one student (upsert).

    Per-item obtained values are clamped to [0, max_marks] and the total
    is recomputed server-side so the stored total always matches the items.
    """
    import json as _json

    items = []
    total = 0.0
    for m in body.marks:
        try:
            mx = float(m.max_marks or 0)
        except (ValueError, TypeError):
            mx = 0
        try:
            ob = float(m.obtained or 0)
        except (ValueError, TypeError):
            ob = 0
        if ob < 0:
            ob = 0
        if mx > 0 and ob > mx:
            ob = mx
        items.append({"q_no": m.q_no or "", "max_marks": mx, "obtained": ob})
        total += ob
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "INSERT INTO student_marks"
                " (exam_id, student_dataset_id, row_index, student_name,"
                "  marks_json, total_obtained, updated_at)"
                " VALUES (%s,%s,%s,%s,%s::jsonb,%s, now())"
                " ON CONFLICT (exam_id, student_dataset_id, row_index)"
                " DO UPDATE SET student_name = EXCLUDED.student_name,"
                "  marks_json = EXCLUDED.marks_json,"
                "  total_obtained = EXCLUDED.total_obtained,"
                "  updated_at = now()"
                " RETURNING exam_id, student_dataset_id, row_index,"
                "  student_name, marks_json AS marks, total_obtained,"
                "  updated_at",
                (
                    body.exam_id,
                    body.student_dataset_id,
                    body.row_index,
                    body.student_name.strip(),
                    _json.dumps(items),
                    total,
                ),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    d = dict(row)
    d["updated_at"] = str(d.get("updated_at"))
    return d


@app.get("/exam/marks")
async def list_exam_marks(exam_id: int, student_dataset_id: int):
    """All saved teacher marks for one exam + student dataset."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT exam_id, student_dataset_id, row_index, student_name,"
                " marks_json AS marks, total_obtained, updated_at"
                " FROM student_marks WHERE exam_id = %s AND student_dataset_id = %s"
                " ORDER BY row_index",
                (exam_id, student_dataset_id),
            ).fetchall()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    out = []
    for r in rows:
        d = dict(r)
        d["updated_at"] = str(d.get("updated_at"))
        out.append(d)
    return {"marks": out}


class StudentUploadResponse(BaseModel):
    id: int
    branch: str
    semester: str
    assigned_teacher: str
    subject_name: str
    original_filename: str
    s3_url: str
    s3_key: str
    columns: list[str]
    mapping: dict
    row_count: int
    preview: list[dict]
    created_at: str


def _validate_csv_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    if name and not name.endswith(".csv"):
        raise HTTPException(status_code=415, detail="file must be a .csv")
    if ctype and "csv" not in ctype and "text" not in ctype and "excel" not in ctype and "octet" not in ctype:
        raise HTTPException(status_code=415, detail=f"not a csv: {file.content_type}")


def _parse_csv_preview(csv_text: str, max_rows: int = 10) -> tuple[list[str], list[dict], int]:
    """Parse CSV text -> (columns, preview_rows, total_data_rows)."""
    import csv as _csv

    # strip BOM, normalise newlines
    text = csv_text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln for ln in text.split("\n") if ln.strip() != ""]
    if not lines:
        raise HTTPException(status_code=422, detail="csv is empty")
    try:
        reader = _csv.DictReader(lines)
        columns = [c.strip() if isinstance(c, str) else c for c in (reader.fieldnames or [])]
        if not columns:
            raise HTTPException(status_code=422, detail="csv has no header row")
        rows: list[dict] = []
        total = 0
        for row in reader:
            total += 1
            if len(rows) < max_rows:
                rows.append({c: (row.get(c, "") or "") for c in columns})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"cannot parse csv: {exc}")
    return columns, rows, total


@app.post("/exam/students/upload", response_model=StudentUploadResponse)
async def upload_student_csv(
    branch: str = Form(...),
    semester: str = Form(...),
    assigned_teacher: str = Form(...),
    subject_name: str = Form(...),
    mapping: str = Form(...),
    file: UploadFile = File(...),
):
    """Save a student CSV: upload raw file to S3, store metadata+mapping in examdb."""
    import json as _json

    branch, semester = branch.strip(), semester.strip()
    assigned_teacher, subject_name = assigned_teacher.strip(), subject_name.strip()
    if not branch or not semester or not assigned_teacher or not subject_name:
        raise HTTPException(
            status_code=422,
            detail="branch, semester, assigned_teacher and subject_name are all required",
        )
    try:
        mapping_obj = _json.loads(mapping or "{}")
    except Exception:
        raise HTTPException(status_code=422, detail="mapping must be valid JSON")
    # unique_field is the public /results search key; default to the name
    # column so older clients that don't send it keep working.
    if not mapping_obj.get("unique_field"):
        mapping_obj["unique_field"] = mapping_obj.get("student_name", "")
    required_keys = ("student_name", "total_marks", "obtained_marks", "attendance", "unique_field")
    missing = [k for k in required_keys if not mapping_obj.get(k)]
    if missing:
        raise HTTPException(
            status_code=422, detail=f"mapping missing: {', '.join(missing)}"
        )

    _validate_csv_upload(file)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="empty csv")
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="csv larger than 10 MB")
    try:
        csv_text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            csv_text = raw.decode("latin-1")
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"cannot decode csv: {exc}")

    columns, preview, row_count = _parse_csv_preview(csv_text)
    for key in required_keys:
        if mapping_obj[key] not in columns:
            raise HTTPException(
                status_code=422,
                detail=f"mapped column '{mapping_obj[key]}' for '{key}' not in csv header",
            )

    # raw csv -> S3 (public bucket, same as syllabus images)
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    key = f"students/{day}/{uuid.uuid4().hex}.csv"
    s3 = get_s3_client()
    try:
        s3.upload_fileobj(
            BytesIO(raw), S3_BUCKET, key, ExtraArgs={"ContentType": "text/csv"}
        )
    except (ClientError, BotoCoreError) as exc:
        raise HTTPException(status_code=502, detail=f"s3 upload failed: {exc}")

    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "INSERT INTO student_datasets"
                " (branch, semester, assigned_teacher, subject_name,"
                "  original_filename, s3_url, s3_key, columns_json,"
                "  mapping_json, row_count, preview_json)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s::jsonb)"
                " RETURNING id, created_at",
                (
                    branch, semester, assigned_teacher, subject_name,
                    file.filename or "students.csv", public_s3_url(key), key,
                    _json.dumps(columns), _json.dumps(mapping_obj),
                    row_count, _json.dumps(preview),
                ),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    return StudentUploadResponse(
        id=row["id"], branch=branch, semester=semester,
        assigned_teacher=assigned_teacher, subject_name=subject_name,
        original_filename=file.filename or "students.csv",
        s3_url=public_s3_url(key), s3_key=key, columns=columns,
        mapping=mapping_obj, row_count=row_count, preview=preview,
        created_at=str(row["created_at"]),
    )


@app.get("/exam/students")
async def list_student_datasets():
    """List saved student CSV uploads (newest first)."""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT id, branch, semester, assigned_teacher, subject_name,"
                " original_filename, s3_url, s3_key, columns_json AS columns,"
                " mapping_json AS mapping, row_count, preview_json AS preview,"
                " created_at FROM student_datasets ORDER BY created_at DESC"
            ).fetchall()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    out = []
    for r in rows:
        d = dict(r)
        d["created_at"] = str(d.get("created_at"))
        out.append(d)
    return {"datasets": out}


def _get_dataset_or_404(dataset_id: int) -> dict:
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT id, branch, semester, assigned_teacher, subject_name,"
                " original_filename, s3_url, s3_key, columns_json AS columns,"
                " mapping_json AS mapping, row_count, preview_json AS preview,"
                " created_at FROM student_datasets WHERE id = %s",
                (dataset_id,),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    if row is None:
        raise HTTPException(status_code=404, detail="student dataset not found")
    d = dict(row)
    d["created_at"] = str(d.get("created_at"))
    return d


@app.get("/exam/students/{dataset_id}")
async def get_student_dataset(dataset_id: int):
    """Get one saved student CSV dataset."""
    return _get_dataset_or_404(dataset_id)


class StudentUpdateRequest(BaseModel):
    branch: str = Field(min_length=1, max_length=200)
    semester: str = Field(min_length=1, max_length=50)
    assigned_teacher: str = Field(min_length=1, max_length=200)
    subject_name: str = Field(min_length=1, max_length=200)
    mapping: dict = Field(default_factory=dict)


@app.put("/exam/students/{dataset_id}")
async def update_student_dataset(dataset_id: int, body: StudentUpdateRequest):
    """Edit metadata + column mapping of a saved student dataset."""
    current = _get_dataset_or_404(dataset_id)
    columns = current.get("columns") or []
    mapping_obj = body.mapping or {}
    if not mapping_obj.get("unique_field"):
        mapping_obj["unique_field"] = mapping_obj.get("student_name", "")
    required_keys = ("student_name", "total_marks", "obtained_marks", "attendance", "unique_field")
    missing = [k for k in required_keys if not mapping_obj.get(k)]
    if missing:
        raise HTTPException(
            status_code=422, detail=f"mapping missing: {', '.join(missing)}"
        )
    for key in required_keys:
        if mapping_obj[key] not in columns:
            raise HTTPException(
                status_code=422,
                detail=f"mapped column '{mapping_obj[key]}' for '{key}' not in csv header",
            )
    import json as _json

    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "UPDATE student_datasets SET branch=%s, semester=%s,"
                " assigned_teacher=%s, subject_name=%s, mapping_json=%s::jsonb"
                " WHERE id=%s RETURNING id",
                (
                    body.branch.strip(), body.semester.strip(),
                    body.assigned_teacher.strip(), body.subject_name.strip(),
                    _json.dumps(mapping_obj), dataset_id,
                ),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    if row is None:
        raise HTTPException(status_code=404, detail="student dataset not found")
    return _get_dataset_or_404(dataset_id)


@app.get("/exam/students/{dataset_id}/rows")
async def get_student_rows(dataset_id: int, limit: int = 2000):
    """Return ALL data rows of a dataset (re-read from S3, fallback to preview)."""
    ds = _get_dataset_or_404(dataset_id)
    s3_key = ds.get("s3_key") or ""
    limit = max(1, min(limit, 5000))
    if s3_key:
        try:
            s3 = get_s3_client()
            buf = BytesIO()
            s3.download_fileobj(S3_BUCKET, s3_key, buf)
            raw = buf.getvalue()
            try:
                csv_text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                csv_text = raw.decode("latin-1")
            columns, preview, total = _parse_csv_preview(csv_text, max_rows=limit)
            # return the full set, not just the preview slice
            import csv as _csv

            text = csv_text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
            lines = [ln for ln in text.split("\n") if ln.strip() != ""]
            reader = _csv.DictReader(lines)
            cols = [c.strip() if isinstance(c, str) else c for c in (reader.fieldnames or [])]
            rows: list[dict] = []
            for row in reader:
                if len(rows) >= limit:
                    break
                rows.append({c: (row.get(c, "") or "") for c in cols})
                _ = preview, total  # keep linters quiet about reuse
            return {"columns": cols, "rows": rows, "total": total, "truncated": total > len(rows)}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"could not read csv from s3: {exc}")
    # no S3 copy (local-only dataset) — return stored preview
    return {
        "columns": ds.get("columns") or [],
        "rows": ds.get("preview") or [],
        "total": ds.get("row_count") or 0,
        "truncated": False,
    }


@app.get("/exam/health")
async def exam_db_health():
    try:
        with psycopg.connect(EXAM_DATABASE_URL) as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "db_ok": db_ok, "db_name": _exam_db_name()}
