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
from urllib.request import urlopen

import boto3
import psycopg
from botocore.exceptions import BotoCoreError, ClientError
from psycopg.rows import dict_row
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from botocore.config import Config
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
STENCIL_DEMO_MODE = os.getenv("STENCIL_DEMO_MODE", "").strip().lower() in {"1", "true", "yes", "on"}
DEMO_PUBLIC_BASE_URL = os.getenv("STENCIL_DEMO_PUBLIC_BASE_URL", "").rstrip("/")
SCANNER_SERVICE_URL = os.getenv("SCANNER_URL", "http://127.0.0.1:8000").rstrip("/")

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


def analyze_image_quality(data: bytes) -> dict:
    """Apply small, explainable document-image checks; no learned model is used."""
    import cv2
    import numpy as np

    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise HTTPException(status_code=415, detail="unsupported or unreadable image data")
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast_score = float(gray.std())
    margin = max(2, int(min(height, width) * 0.025))
    ink = gray < max(90, float(gray.mean()) - 35)
    border = np.concatenate(
        [
            ink[:margin, :].ravel(),
            ink[-margin:, :].ravel(),
            ink[:, :margin].ravel(),
            ink[:, -margin:].ravel(),
        ]
    )
    border_ink_ratio = float(border.mean())
    page_ratio = min(width, height) / max(width, height)
    warnings: list[dict] = []
    if blur_score < 65:
        warnings.append({"code": "BLURRY_IMAGE", "severity": "error", "message": "Image appears blurry; retake it with the page in focus.", "confidence": "high" if blur_score < 35 else "medium"})
    if contrast_score < 22:
        warnings.append({"code": "VERY_LOW_CONTRAST", "severity": "error", "message": "Image has very low contrast; use brighter, even lighting.", "confidence": "high" if contrast_score < 14 else "medium"})
    if border_ink_ratio > 0.08 or page_ratio < 0.5:
        warnings.append({"code": "CROPPED_OR_INCOMPLETE_PAGE", "severity": "error", "message": "Content may touch the image edge or part of the page may be cropped.", "confidence": "medium"})
    if width < 900 or height < 900:
        warnings.append({"code": "LOW_RESOLUTION", "severity": "warning", "message": "Image resolution is below 900 x 900 pixels.", "confidence": "high"})
    return {
        "passed": not any(item["severity"] == "error" for item in warnings),
        "width": width,
        "height": height,
        "blur_score": round(blur_score, 1),
        "contrast_score": round(contrast_score, 1),
        "border_ink_ratio": round(border_ink_ratio, 3),
        "warnings": warnings,
    }

app = FastAPI(title="MPOnline API — Luna + S3")

DEMO_EXAM_ID = 900001
DEMO_DATASET_ID = 900001
DEMO_UPLOAD_DIR = _HERE.parents[1] / ".demo-uploads"
DEMO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/demo-uploads", StaticFiles(directory=DEMO_UPLOAD_DIR), name="demo-uploads")

DEMO_QUESTIONS = [
    {"q_no": "1", "section": "A", "text": "Explain the difference between a compiler and an interpreter.", "marks": 5, "page": 1, "sub_questions": []},
    {"q_no": "2", "section": "A", "text": "Trace a binary search for 23 in the given sorted list.", "marks": 5, "page": 1, "sub_questions": []},
    {"q_no": "3", "section": "B", "text": "Design an algorithm to find duplicate values in an array and discuss its complexity.", "marks": 10, "page": 2, "sub_questions": []},
]
DEMO_STUDENTS = [
    {"Student Name": "Aarav Sharma", "Total Marks": "20", "Obtained Marks": "", "Attendance": "Present"},
    {"Student Name": "Diya Patel", "Total Marks": "20", "Obtained Marks": "", "Attendance": "Present"},
    {"Student Name": "Kabir Singh", "Total Marks": "20", "Obtained Marks": "", "Attendance": "Present"},
]
DEMO_MARKS: dict[tuple[int, int], dict] = {}


def _demo_exam_detail() -> dict:
    return {
        "id": DEMO_EXAM_ID,
        "subject_name": "Computer Science - Demo Examination",
        "syllabus_exam_id": None,
        "syllabus_summary": "Seeded local demonstration covering language translation, searching, and algorithm design.",
        "questions": DEMO_QUESTIONS,
        "total_marks": 20,
        "total_questions": len(DEMO_QUESTIONS),
        "question_pages": [],
        "assigned_teacher": "Demo Teacher",
        "student_dataset_id": DEMO_DATASET_ID,
        "student_label": f"MVP Demo Class ({len(DEMO_STUDENTS)} students)",
        "created_at": "2026-01-01T09:00:00+00:00",
        "demo": True,
    }


def _demo_dataset() -> dict:
    return {
        "id": DEMO_DATASET_ID,
        "branch": "Computer Science",
        "semester": "MVP Demo",
        "assigned_teacher": "Demo Teacher",
        "subject_name": "Computer Science - Demo Examination",
        "original_filename": "seeded-demo-students.csv",
        "s3_url": "",
        "s3_key": "",
        "columns": ["Student Name", "Total Marks", "Obtained Marks", "Attendance"],
        "mapping": {"student_name": "Student Name", "total_marks": "Total Marks", "obtained_marks": "Obtained Marks", "attendance": "Attendance"},
        "row_count": len(DEMO_STUDENTS),
        "preview": DEMO_STUDENTS,
        "created_at": "2026-01-01T09:00:00+00:00",
        "demo": True,
    }

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
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
            CREATE TABLE IF NOT EXISTS student_marks (
                id SERIAL PRIMARY KEY,
                final_exam_id INTEGER NOT NULL REFERENCES final_exams(id) ON DELETE CASCADE,
                student_index INTEGER NOT NULL,
                student_name TEXT NOT NULL DEFAULT '',
                answer_sheet_urls JSONB NOT NULL DEFAULT '[]',
                evaluations_json JSONB NOT NULL DEFAULT '[]',
                awarded_marks NUMERIC NOT NULL DEFAULT 0,
                max_marks NUMERIC NOT NULL DEFAULT 0,
                feedback TEXT NOT NULL DEFAULT '',
                updated_by TEXT NOT NULL DEFAULT '',
                moderation_status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (final_exam_id, student_index)
            );
            ALTER TABLE student_marks
                ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'pending';
            """
        )


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
    """Send one syllabus page image URL to the Luna chat-completion model."""
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
        "s3_bucket": S3_BUCKET,
        "aws_region": AWS_REGION,
    }


def _service_status() -> dict:
    database_available = False
    database_error = ""
    try:
        with psycopg.connect(EXAM_DATABASE_URL, connect_timeout=1) as conn:
            conn.execute("SELECT 1")
        database_available = True
    except Exception as exc:
        database_error = str(exc).strip().splitlines()[0][:200]

    storage_available = False
    storage_error = ""
    try:
        boto3.client(
            "s3",
            region_name=AWS_REGION,
            config=Config(connect_timeout=1, read_timeout=1, retries={"max_attempts": 0}),
        ).head_bucket(Bucket=S3_BUCKET)
        storage_available = True
    except Exception as exc:
        storage_error = str(exc).strip().splitlines()[0][:200]

    scanner_available = False
    scanner_error = ""
    try:
        with urlopen(f"{SCANNER_SERVICE_URL}/health", timeout=0.75) as response:
            scanner_available = response.status < 500
    except Exception as exc:
        scanner_error = str(exc).strip().splitlines()[0][:200]

    return {
        "status": "ok" if STENCIL_DEMO_MODE or (database_available and storage_available) else "degraded",
        "demo_mode": STENCIL_DEMO_MODE,
        "ai": {"available": bool(LUNA_API_KEY), "model": LUNA_MODEL},
        "scanner": {
            "available": scanner_available,
            "url": SCANNER_SERVICE_URL,
            "error": scanner_error,
        },
        "database": {"available": database_available, "error": database_error},
        "storage": {
            "available": STENCIL_DEMO_MODE or storage_available,
            "s3_available": storage_available,
            "mode": "local" if STENCIL_DEMO_MODE else "s3",
            "local_demo_available": STENCIL_DEMO_MODE,
            "bucket": S3_BUCKET,
            "error": storage_error,
        },
    }


@app.get("/health")
async def health():
    return _service_status()


@app.get("/status")
async def status():
    """Report demo, AI, database, and storage readiness without exposing secrets."""
    return _service_status()


@app.get("/config")
async def config():
    """Non-secret runtime config (never leaks the API key)."""
    return {
        "luna_model": LUNA_MODEL,
        "luna_base_url": LUNA_BASE_URL,
        "luna_key_configured": bool(LUNA_API_KEY),
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
async def upload_image(request: Request, file: UploadFile = File(...)):
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
    quality = analyze_image_quality(data)

    if STENCIL_DEMO_MODE:
        filename = f"{uuid.uuid4().hex}{ext}"
        target = DEMO_UPLOAD_DIR / filename
        target.write_bytes(data)
        return {
            "url": f"{DEMO_PUBLIC_BASE_URL or str(request.base_url).rstrip('/')}/demo-uploads/{filename}",
            "key": f"demo-uploads/{filename}",
            "bucket": "local-demo",
            "region": "local",
            "content_type": file.content_type,
            "size_bytes": len(data),
            "quality": quality,
            "demo": True,
        }

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
        raise HTTPException(
            status_code=503,
            detail=f"Demo mode is disabled and storage is unavailable: {exc}",
        )

    return {
        "url": public_s3_url(key),
        "key": key,
        "bucket": S3_BUCKET,
        "region": AWS_REGION,
        "content_type": content_type,
        "size_bytes": len(data),
        "quality": quality,
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
    """Full pipeline: question-paper pdf -> page PNGs -> S3 -> structured AI extraction.

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
    if STENCIL_DEMO_MODE and (not teacher or teacher == "Demo Teacher"):
        exam = _demo_exam_detail()
        return {"exams": [{key: exam[key] for key in ("id", "subject_name", "total_marks", "total_questions", "assigned_teacher", "student_dataset_id", "student_label", "created_at")} ]}
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            if teacher:
                rows = conn.execute(
                    "SELECT id, subject_name, total_marks, total_questions,"
                    " assigned_teacher, student_dataset_id, student_label,"
                    " created_at FROM final_exams"
                    " WHERE assigned_teacher = %s ORDER BY created_at DESC",
                    (teacher,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, subject_name, total_marks, total_questions,"
                    " assigned_teacher, student_dataset_id, student_label,"
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
                "created_at": str(r["created_at"]),
            }
            for r in rows
        ]
    }


@app.get("/exam/final/{exam_id}")
async def get_final_exam(exam_id: int):
    """Full detail for one exam: questions, pages, syllabus + linked students."""
    if exam_id == DEMO_EXAM_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; the seeded demo examination is unavailable.")
        return _demo_exam_detail()
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            r = conn.execute(
                "SELECT id, subject_name, syllabus_exam_id, syllabus_summary,"
                " question_json, total_marks, total_questions, question_pages,"
                " assigned_teacher, student_dataset_id, student_label,"
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
        "created_at": str(r["created_at"]),
    }


class AnswerSheetAnalyzeRequest(BaseModel):
    final_exam_id: int
    student_index: int = Field(ge=0)
    student_name: str = ""
    image_urls: list[str] = Field(default_factory=list, min_length=1)


class AnswerEvaluationItem(BaseModel):
    q_no: str
    question_text: str = ""
    association: str = ""
    max_marks: float
    suggested_marks: float
    final_marks: float | None = None
    override_reason: str = ""
    confidence: float = Field(default=0, ge=0, le=1)
    reason: str = ""
    strengths: str = ""
    improvements: str = ""
    unchecked: bool = False
    flags: list[str] = Field(default_factory=list)
    feedback: str = ""


class AnswerSheetAnalyzeResponse(BaseModel):
    model: str
    mode: Literal["ai", "demo"]
    notice: str
    final_exam_id: int
    student_index: int
    student_name: str
    max_marks: float
    suggested_marks: float
    expected_answer: str
    strengths: str
    improvements: str
    evaluations: list[AnswerEvaluationItem]
    warnings: list[dict] = Field(default_factory=list)


def _demo_answer_analysis(rubric: list[dict]) -> list[AnswerEvaluationItem]:
    """Return deterministic sample data without pretending an image was assessed."""
    items: list[AnswerEvaluationItem] = []
    for index, question in enumerate(rubric):
        max_marks = max(0.0, float(question.get("marks") or 0))
        unchecked = index == len(rubric) - 1 or index % 4 == 3
        suggested = 0.0 if unchecked else round(max_marks * (0.6 if index % 2 == 0 else 0.75), 1)
        items.append(
            AnswerEvaluationItem(
                q_no=str(question.get("q_no") or index + 1),
                question_text=str(question.get("text") or ""),
                association="DEMO association based on the stored question number",
                max_marks=max_marks,
                suggested_marks=suggested,
                final_marks=suggested,
                confidence=0 if unchecked else 0.55,
                reason=(
                    "DEMO: no response was associated, so examiner review is required."
                    if unchecked
                    else "DEMO: illustrative score for the MVP workflow; no answer content was assessed."
                ),
                strengths="DEMO: shows a concise, relevant response." if not unchecked else "",
                improvements="DEMO: add supporting steps and clearer justification.",
                unchecked=unchecked,
                flags=["UNCHECKED_ANSWER"] if unchecked else [],
                feedback="DEMO result - replace with examiner judgement.",
            )
        )
    return items


class MarksSaveRequest(BaseModel):
    final_exam_id: int
    student_index: int = Field(ge=0)
    student_name: str = ""
    answer_sheet_urls: list[str] = Field(default_factory=list)
    evaluations: list[AnswerEvaluationItem] = Field(default_factory=list)
    awarded_marks: float
    max_marks: float = Field(ge=0)
    feedback: str = ""
    updated_by: str = ""


def _get_final_exam_row(exam_id: int) -> dict:
    if exam_id == DEMO_EXAM_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; the seeded demo examination is unavailable.")
        exam = _demo_exam_detail()
        return {
            "id": exam["id"],
            "subject_name": exam["subject_name"],
            "question_json": exam["questions"],
            "total_marks": exam["total_marks"],
            "total_questions": exam["total_questions"],
        }
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT id, subject_name, question_json, total_marks, total_questions"
                " FROM final_exams WHERE id = %s",
                (exam_id,),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    if row is None:
        raise HTTPException(status_code=404, detail="exam not found")
    return dict(row)


def _flatten_question_marks(questions: list[dict]) -> list[dict]:
    flattened: list[dict] = []

    def walk(q: dict, parent: str = "") -> None:
        q_no = str(q.get("q_no") or "")
        label = q_no if not parent else f"{parent}.{q_no}" if q_no else parent
        subs = q.get("sub_questions") or []
        if q.get("marks") is not None or not subs:
            try:
                marks = float(q.get("marks") or 0)
            except (TypeError, ValueError):
                marks = 0.0
            flattened.append(
                {
                    "q_no": label or str(len(flattened) + 1),
                    "text": str(q.get("text") or ""),
                    "marks": marks,
                }
            )
        for sub in subs:
            if isinstance(sub, dict):
                walk(sub, label)

    for q in questions:
        if isinstance(q, dict):
            walk(q)
    return flattened


def validate_evaluations(
    evaluations: list[AnswerEvaluationItem], rubric: list[dict], submitted_total: float
) -> tuple[float, list[dict]]:
    """Validate examiner marks against the canonical rubric and recompute the total."""
    expected = {str(item.get("q_no") or "").strip(): float(item.get("marks") or 0) for item in rubric}
    seen: set[str] = set()
    issues: list[dict] = []
    total = 0.0
    for item in evaluations:
        q_no = item.q_no.strip()
        if q_no in seen:
            issues.append({"code": "DUPLICATE_QUESTION_ASSOCIATION", "severity": "error", "q_no": q_no, "message": f"Question {q_no} is associated more than once."})
            continue
        seen.add(q_no)
        if q_no not in expected:
            issues.append({"code": "UNEXPECTED_QUESTION", "severity": "error", "q_no": q_no, "message": f"Question {q_no} is not in the examination marking scheme."})
            continue
        canonical_max = expected[q_no]
        final_marks = item.suggested_marks if item.final_marks is None else item.final_marks
        if item.unchecked:
            issues.append({"code": "UNANSWERED_QUESTION", "severity": "warning", "q_no": q_no, "message": f"Question {q_no} is marked as unanswered."})
            if final_marks != 0:
                issues.append({"code": "UNANSWERED_WITH_MARKS", "severity": "error", "q_no": q_no, "message": f"Unanswered question {q_no} must have 0 final marks."})
        if final_marks < 0:
            issues.append({"code": "NEGATIVE_MARKS", "severity": "error", "q_no": q_no, "message": f"Question {q_no} cannot have negative marks."})
        if final_marks > canonical_max:
            issues.append({"code": "MARKS_ABOVE_MAXIMUM", "severity": "error", "q_no": q_no, "message": f"Question {q_no} cannot exceed {canonical_max:g} marks."})
        total += final_marks
    for q_no in expected.keys() - seen:
        issues.append({"code": "MISSING_EXPECTED_QUESTION", "severity": "error", "q_no": q_no, "message": f"Expected question {q_no} is missing from the evaluation."})
    total = round(total, 4)
    if abs(total - submitted_total) > 0.001:
        issues.append({"code": "TOTAL_MISMATCH", "severity": "error", "q_no": "", "message": f"Submitted total {submitted_total:g} does not match backend total {total:g}."})
    return total, issues


@app.post("/exam/analyze-answer-sheet", response_model=AnswerSheetAnalyzeResponse)
async def analyze_answer_sheet(body: AnswerSheetAnalyzeRequest):
    """Use the vision model to suggest marks for uploaded answer-sheet images."""
    import json as _json

    exam = _get_final_exam_row(body.final_exam_id)
    questions = exam.get("question_json") or []
    max_marks = float(exam.get("total_marks") or 0)
    rubric = _flatten_question_marks(questions)
    if not rubric:
        raise HTTPException(status_code=422, detail="exam has no stored questions")

    if not LUNA_API_KEY and STENCIL_DEMO_MODE:
        items = _demo_answer_analysis(rubric)
        return AnswerSheetAnalyzeResponse(
            model="demo",
            mode="demo",
            notice="Demo analysis - replace with live AI. Results are deterministic and were not derived from the uploaded answer sheet.",
            final_exam_id=body.final_exam_id,
            student_index=body.student_index,
            student_name=body.student_name,
            max_marks=max_marks,
            suggested_marks=sum(item.suggested_marks for item in items),
            expected_answer="DEMO only - use the stored question paper and examiner judgement.",
            strengths="DEMO strengths are illustrative.",
            improvements="DEMO improvements are illustrative.",
            evaluations=items,
            warnings=[
                {"code": flag, "severity": "warning", "q_no": item.q_no, "message": f"Question {item.q_no} requires examiner review."}
                for item in items
                for flag in item.flags
            ],
        )
    if not LUNA_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Demo mode is disabled and AI analysis is unavailable because LUNA_API_KEY is not configured.",
        )

    prompt = (
        "You are assisting a teacher with exam evaluation. The teacher makes the final decision.\n"
        f"Subject: {exam.get('subject_name')}\n"
        f"Student: {body.student_name or f'Student {body.student_index + 1}'}\n"
        f"Maximum marks: {max_marks}\n\n"
        "Question rubric JSON:\n"
        f"{_json.dumps(rubric, ensure_ascii=False)}\n\n"
        "Read the handwritten answer-sheet images. Match visible answers to the closest "
        "question numbers. Return ONLY valid JSON with keys: expected_answer, strengths, "
        "improvements, suggested_marks, evaluations. evaluations must be an array of "
        "{q_no, association, suggested_marks, confidence, reason, strengths, improvements, "
        "unchecked, feedback}. Include every rubric question. Set unchecked=true when no answer "
        "can be associated. confidence must be between 0 and 1."
    )
    content = [{"type": "text", "text": prompt}]
    content.extend({"type": "image_url", "image_url": {"url": url}} for url in body.image_urls)
    client = get_async_openai_client()
    try:
        completion = await client.chat.completions.create(
            model=LUNA_MODEL,
            messages=[{"role": "user", "content": content}],
            response_format={"type": "json_object"},
        )
        raw = (completion.choices[0].message.content or "").strip()
        parsed = _json.loads(raw)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"answer analysis failed: {exc}")

    parsed_by_q = {
        str(item.get("q_no") or "").strip(): item
        for item in (parsed.get("evaluations", []) or [])
        if isinstance(item, dict)
    }
    items: list[AnswerEvaluationItem] = []
    for rubric_item in rubric:
        q_no = str(rubric_item.get("q_no") or "").strip()
        item = parsed_by_q.get(q_no, {})
        try:
            item_max = max(0.0, float(rubric_item.get("marks") or 0))
            raw_suggested = float(item.get("suggested_marks") or 0)
            confidence = max(0.0, min(1.0, float(item.get("confidence") or 0)))
        except (TypeError, ValueError):
            item_max, raw_suggested, confidence = 0.0, 0.0, 0.0
        unchecked = bool(item.get("unchecked", not item))
        flags: list[str] = []
        if unchecked:
            flags.append("UNCHECKED_ANSWER")
        if raw_suggested > item_max:
            flags.append("MARKS_ABOVE_MAXIMUM")
        suggested = max(0.0, min(item_max, raw_suggested))
        items.append(
            AnswerEvaluationItem(
                q_no=q_no,
                question_text=str(rubric_item.get("text") or ""),
                association=str(item.get("association") or ""),
                max_marks=item_max,
                suggested_marks=suggested,
                final_marks=suggested,
                confidence=confidence,
                reason=str(item.get("reason") or ""),
                strengths=str(item.get("strengths") or ""),
                improvements=str(item.get("improvements") or ""),
                unchecked=unchecked,
                flags=flags,
                feedback=str(item.get("feedback") or ""),
            )
        )
    suggested_total = sum(i.suggested_marks for i in items)
    if not items:
        suggested_total = max(0.0, min(max_marks, float(parsed.get("suggested_marks") or 0)))
    return AnswerSheetAnalyzeResponse(
        model=LUNA_MODEL,
        mode="ai",
        notice="AI-assisted analysis. Examiner review is required before saving final marks.",
        final_exam_id=body.final_exam_id,
        student_index=body.student_index,
        student_name=body.student_name,
        max_marks=max_marks,
        suggested_marks=max(0.0, min(max_marks, suggested_total)),
        expected_answer=str(parsed.get("expected_answer") or ""),
        strengths=str(parsed.get("strengths") or ""),
        improvements=str(parsed.get("improvements") or ""),
        evaluations=items,
        warnings=[
            {"code": flag, "severity": "warning", "q_no": item.q_no, "message": f"Question {item.q_no} requires examiner review."}
            for item in items
            for flag in item.flags
        ],
    )


@app.get("/exam/marks")
async def get_student_marks(final_exam_id: int, student_index: int):
    if final_exam_id == DEMO_EXAM_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; demo marks are unavailable.")
        return {"mark": DEMO_MARKS.get((final_exam_id, student_index))}
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT * FROM student_marks WHERE final_exam_id=%s AND student_index=%s",
                (final_exam_id, student_index),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    if row is None:
        return {"mark": None}
    d = dict(row)
    d["created_at"] = str(d["created_at"])
    d["updated_at"] = str(d["updated_at"])
    return {"mark": d}


@app.put("/exam/marks")
async def save_student_marks(body: MarksSaveRequest):
    """Persist final teacher-approved marks for one student/exam pair."""
    import json as _json

    exam = _get_final_exam_row(body.final_exam_id)
    exam_max = float(exam.get("total_marks") or body.max_marks or 0)
    max_marks = float(body.max_marks or exam_max)
    if max_marks != exam_max:
        raise HTTPException(status_code=422, detail=f"maximum marks must equal exam maximum ({exam_max:g})")
    rubric = _flatten_question_marks(exam.get("question_json") or [])
    awarded, validation_issues = validate_evaluations(
        body.evaluations, rubric, float(body.awarded_marks)
    )
    errors = [item for item in validation_issues if item["severity"] == "error"]
    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Final marks were not saved because validation failed.",
                "computed_total": awarded,
                "issues": validation_issues,
            },
        )
    if body.final_exam_id == DEMO_EXAM_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; demo marks cannot be saved.")
        now = datetime.now(timezone.utc).isoformat()
        previous = DEMO_MARKS.get((body.final_exam_id, body.student_index))
        row = {
            "id": body.student_index + 1,
            "final_exam_id": body.final_exam_id,
            "student_index": body.student_index,
            "student_name": body.student_name.strip(),
            "answer_sheet_urls": body.answer_sheet_urls,
            "evaluations_json": [item.model_dump() for item in body.evaluations],
            "awarded_marks": awarded,
            "max_marks": max_marks,
            "feedback": body.feedback.strip(),
            "updated_by": body.updated_by.strip() or "Demo Teacher",
            "moderation_status": "pending",
            "created_at": previous["created_at"] if previous else now,
            "updated_at": now,
            "validation_warnings": validation_issues,
            "demo": True,
        }
        DEMO_MARKS[(body.final_exam_id, body.student_index)] = row
        return {"mark": row}
    evaluations_json = _json.dumps([e.model_dump() for e in body.evaluations])
    urls_json = _json.dumps(body.answer_sheet_urls)
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                """
                INSERT INTO student_marks (
                    final_exam_id, student_index, student_name, answer_sheet_urls,
                    evaluations_json, awarded_marks, max_marks, feedback, updated_by
                )
                VALUES (%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,%s)
                ON CONFLICT (final_exam_id, student_index) DO UPDATE SET
                    student_name = EXCLUDED.student_name,
                    answer_sheet_urls = EXCLUDED.answer_sheet_urls,
                    evaluations_json = EXCLUDED.evaluations_json,
                    awarded_marks = EXCLUDED.awarded_marks,
                    max_marks = EXCLUDED.max_marks,
                    feedback = EXCLUDED.feedback,
                    updated_by = EXCLUDED.updated_by,
                    moderation_status = 'pending',
                    updated_at = now()
                RETURNING *
                """,
                (
                    body.final_exam_id,
                    body.student_index,
                    body.student_name.strip(),
                    urls_json,
                    evaluations_json,
                    awarded,
                    max_marks,
                    body.feedback.strip(),
                    body.updated_by.strip(),
                ),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    d = dict(row)
    d["created_at"] = str(d["created_at"])
    d["updated_at"] = str(d["updated_at"])
    d["validation_warnings"] = validation_issues
    return {"mark": d}


@app.get("/exam/marks/progress")
async def get_marks_progress(final_exam_id: int):
    if final_exam_id == DEMO_EXAM_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; demo progress is unavailable.")
        evaluated = sum(1 for exam_id, _ in DEMO_MARKS if exam_id == final_exam_id)
        total = len(DEMO_STUDENTS)
        return {
            "total_students": total,
            "evaluated_students": evaluated,
            "remaining_students": total - evaluated,
            "percent": round((evaluated / total) * 100, 1),
            "demo": True,
        }
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                """
                SELECT f.id, COALESCE(d.row_count, 0) AS total_students,
                       COUNT(m.id) AS evaluated_students
                FROM final_exams f
                LEFT JOIN student_datasets d ON d.id = f.student_dataset_id
                LEFT JOIN student_marks m ON m.final_exam_id = f.id
                WHERE f.id = %s
                GROUP BY f.id, d.row_count
                """,
                (final_exam_id,),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"examdb unreachable: {str(exc).strip().splitlines()[0][:200]}",
        )
    if row is None:
        raise HTTPException(status_code=404, detail="exam not found")
    total = int(row["total_students"] or 0)
    evaluated = int(row["evaluated_students"] or 0)
    return {
        "total_students": total,
        "evaluated_students": evaluated,
        "remaining_students": max(0, total - evaluated),
        "percent": round((evaluated / total) * 100, 1) if total else 0,
    }


def _seed_demo_dashboard_marks() -> None:
    now = datetime.now(timezone.utc).isoformat()
    samples = [
        (0, "Aarav Sharma", [2, 3, 5], [5, 5, 8]),
        (1, "Diya Patel", [2, 3, 5], [0, 0, 0]),
    ]
    for student_index, student_name, suggested, final in samples:
        if (DEMO_EXAM_ID, student_index) in DEMO_MARKS:
            continue
        evaluations = []
        for question, suggested_marks, final_marks in zip(DEMO_QUESTIONS, suggested, final):
            evaluations.append(
                {
                    "q_no": question["q_no"],
                    "question_text": question["text"],
                    "association": "Seeded demo association",
                    "max_marks": question["marks"],
                    "suggested_marks": suggested_marks,
                    "final_marks": final_marks,
                    "override_reason": "Examiner review of the written working" if final_marks != suggested_marks else "",
                    "confidence": 0.65,
                    "reason": "Seeded demonstration result",
                    "strengths": "",
                    "improvements": "",
                    "unchecked": False,
                    "flags": [],
                    "feedback": "Seeded demo evaluation",
                }
            )
        DEMO_MARKS[(DEMO_EXAM_ID, student_index)] = {
            "id": student_index + 1,
            "final_exam_id": DEMO_EXAM_ID,
            "student_index": student_index,
            "student_name": student_name,
            "answer_sheet_urls": [],
            "evaluations_json": evaluations,
            "awarded_marks": float(sum(final)),
            "max_marks": 20.0,
            "feedback": "Seeded demo evaluation",
            "updated_by": "Demo Teacher",
            "moderation_status": "pending",
            "created_at": now,
            "updated_at": now,
            "demo": True,
        }


def _build_dashboard(rows: list[dict], assigned_by_examiner: dict[str, int]) -> dict:
    repeated: dict[tuple[str, str], int] = {}
    for row in rows:
        examiner = str(row.get("updated_by") or row.get("assigned_teacher") or "Unassigned")
        awarded = float(row.get("awarded_marks") or 0)
        maximum = float(row.get("max_marks") or 0)
        if awarded == 0:
            repeated[(examiner, "zero")] = repeated.get((examiner, "zero"), 0) + 1
        if maximum > 0 and awarded == maximum:
            repeated[(examiner, "full")] = repeated.get((examiner, "full"), 0) + 1

    moderation: list[dict] = []
    completed_by_examiner: dict[str, int] = {}
    for row in rows:
        examiner = str(row.get("updated_by") or row.get("assigned_teacher") or "Unassigned")
        completed_by_examiner[examiner] = completed_by_examiner.get(examiner, 0) + 1
        awarded = float(row.get("awarded_marks") or 0)
        maximum = float(row.get("max_marks") or 0)
        evaluations = row.get("evaluations_json") or []
        flags: list[dict] = []

        def add_flag(code: str, message: str) -> None:
            if not any(item["code"] == code for item in flags):
                flags.append({"code": code, "message": message})

        ratio = awarded / maximum if maximum else 0
        if maximum and ratio >= 0.9:
            add_flag("UNUSUALLY_HIGH_SCORE", "Score is at least 90% of the marking scheme maximum.")
        if maximum and ratio <= 0.2:
            add_flag("UNUSUALLY_LOW_SCORE", "Score is at most 20% of the marking scheme maximum.")

        suggested_total = 0.0
        override_count = 0
        for item in evaluations:
            suggested = float(item.get("suggested_marks") or 0)
            final_marks = float(item.get("final_marks") if item.get("final_marks") is not None else suggested)
            suggested_total += suggested
            if abs(final_marks - suggested) > 0.001:
                override_count += 1
            if item.get("unchecked"):
                add_flag("UNANSWERED_QUESTION", "At least one expected answer is marked unanswered.")
            for code in item.get("flags") or []:
                add_flag(str(code), "The evaluation contains a validation warning requiring review.")
        if maximum and abs(awarded - suggested_total) >= max(3.0, maximum * 0.25):
            add_flag("LARGE_AI_EXAMINER_DIFFERENCE", "Examiner total differs substantially from the AI suggestion.")
        if override_count >= max(2, (len(evaluations) + 1) // 2):
            add_flag("HIGH_OVERRIDE_COUNT", "Final marks override the suggestion on many questions.")
        if repeated.get((examiner, "full"), 0) >= 3 and awarded == maximum:
            add_flag("REPEATED_FULL_MARKS", "This examiner has awarded full marks on at least three scripts.")
        if repeated.get((examiner, "zero"), 0) >= 3 and awarded == 0:
            add_flag("REPEATED_ZERO_MARKS", "This examiner has awarded zero marks on at least three scripts.")

        moderation.append(
            {
                "final_exam_id": int(row["final_exam_id"]),
                "student_index": int(row["student_index"]),
                "student_session_id": f"{row['final_exam_id']}-{int(row['student_index']) + 1}",
                "student_name": str(row.get("student_name") or ""),
                "subject_name": str(row.get("subject_name") or ""),
                "final_marks": awarded,
                "maximum_marks": maximum,
                "warning_types": [item["code"] for item in flags],
                "warning_details": flags,
                "examiner": examiner,
                "status": str(row.get("moderation_status") or "pending"),
                "override_count": override_count,
                "updated_at": str(row.get("updated_at") or ""),
            }
        )

    total_assigned = sum(assigned_by_examiner.values())
    completed = len(rows)
    warning_count = sum(1 for row in moderation if row["warning_types"])
    needs_review = sum(
        1 for row in moderation if row["warning_types"] and row["status"] != "resolved"
    )
    examiners = sorted(set(assigned_by_examiner) | set(completed_by_examiner))
    return {
        "summary": {
            "total_assigned_students": total_assigned,
            "completed_evaluations": completed,
            "pending_evaluations": max(0, total_assigned - completed),
            "evaluations_with_warnings": warning_count,
            "average_awarded_marks": round(sum(row["final_marks"] for row in moderation) / completed, 2) if completed else 0,
            "scripts_needing_review": needs_review,
        },
        "examiner_progress": [
            {
                "examiner": examiner,
                "assigned": assigned_by_examiner.get(examiner, 0),
                "completed": completed_by_examiner.get(examiner, 0),
                "pending": max(0, assigned_by_examiner.get(examiner, 0) - completed_by_examiner.get(examiner, 0)),
                "percent": round((completed_by_examiner.get(examiner, 0) / assigned_by_examiner[examiner]) * 100, 1) if assigned_by_examiner.get(examiner, 0) else 0,
            }
            for examiner in examiners
        ],
        "moderation": sorted(moderation, key=lambda row: (not bool(row["warning_types"]), row["status"], row["student_session_id"])),
        "notice": "Flags are explainable routing signals for human review only. They do not accuse or penalize an examiner.",
    }


def _build_demo_report() -> dict:
    """Summarize only persisted or directly observable demo evidence."""
    _seed_demo_dashboard_marks()
    rows = [
        row
        for (exam_id, _), row in DEMO_MARKS.items()
        if exam_id == DEMO_EXAM_ID
    ]
    upload_files = [
        path
        for path in DEMO_UPLOAD_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTS
    ]
    expected_questions = {str(question["q_no"]) for question in DEMO_QUESTIONS}
    expected_associations = len(rows) * len(expected_questions)
    associated_answers = 0
    warning_codes: list[str] = []
    override_count = 0

    for row in rows:
        for item in row.get("evaluations_json") or []:
            q_no = str(item.get("q_no") or "").strip()
            if q_no in expected_questions and str(item.get("association") or "").strip():
                associated_answers += 1
            suggested = float(item.get("suggested_marks") or 0)
            final_marks = float(
                item.get("final_marks")
                if item.get("final_marks") is not None
                else suggested
            )
            if abs(final_marks - suggested) > 0.001:
                override_count += 1
            warning_codes.extend(str(code) for code in item.get("flags") or [])
        warning_codes.extend(
            str(item.get("code") or "UNKNOWN_WARNING")
            for item in row.get("validation_warnings") or []
        )

    dashboard_rows = []
    for row in rows:
        item = dict(row)
        item["subject_name"] = _demo_exam_detail()["subject_name"]
        item["assigned_teacher"] = "Demo Teacher"
        dashboard_rows.append(item)
    dashboard = _build_dashboard(
        dashboard_rows, {"Demo Teacher": len(DEMO_STUDENTS)}
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "Current local demo data",
        "metrics": {
            "test_pages": {
                "value": len(upload_files),
                "display": str(len(upload_files)),
                "note": "Answer-sheet image pages currently stored in the local demo upload directory.",
            },
            "successful_captures": {
                "value": len(upload_files),
                "display": str(len(upload_files)),
                "note": "Browser captures/uploads accepted and stored by the demo API.",
            },
            "rejected_images": {
                "value": None,
                "display": "not measured",
                "note": "Rejected browser selections are not persisted by the current MVP.",
            },
            "question_matching": {
                "value": associated_answers,
                "display": f"{associated_answers} / {expected_associations}",
                "note": "Saved question associations. Ground-truth matching accuracy is not measured.",
            },
            "validation_warnings": {
                "value": len(warning_codes),
                "display": str(len(warning_codes)),
                "note": "Validation warning instances stored with saved evaluations.",
            },
            "saved_evaluations": {
                "value": len(rows),
                "display": str(len(rows)),
                "note": "Student evaluations currently saved in demo memory.",
            },
        },
        "sequence": [
            {
                "key": "upload",
                "label": "Upload image",
                "status": "complete" if upload_files else "ready",
                "detail": f"{len(upload_files)} locally stored answer-sheet page(s).",
            },
            {
                "key": "quality",
                "label": "Quality warning or pass",
                "status": "available",
                "detail": "Explainable blur, contrast, crop, file type, and empty-file checks run before upload.",
            },
            {
                "key": "matching",
                "label": "Question matching",
                "status": "complete" if associated_answers else "ready",
                "detail": f"{associated_answers} of {expected_associations} saved question associations are populated.",
            },
            {
                "key": "suggestion",
                "label": "AI/demo suggestion",
                "status": "live_ai" if LUNA_API_KEY else "demo",
                "detail": "Live AI is configured." if LUNA_API_KEY else "Demo analysis - replace with live AI.",
            },
            {
                "key": "override",
                "label": "Examiner override",
                "status": "complete" if override_count else "ready",
                "detail": f"{override_count} saved question mark override(s).",
            },
            {
                "key": "save",
                "label": "Saved final marks",
                "status": "complete" if rows else "ready",
                "detail": f"{len(rows)} saved student evaluation(s).",
            },
            {
                "key": "dashboard",
                "label": "Dashboard update",
                "status": "complete" if dashboard["summary"]["completed_evaluations"] else "ready",
                "detail": f"Dashboard reports {dashboard['summary']['completed_evaluations']} completed evaluation(s).",
            },
        ],
        "dashboard": dashboard,
        "measurement_notes": [
            "No latency, throughput, model accuracy, or rejection-rate claim is made.",
            "Demo records are local evidence and are not production records.",
        ],
    }


@app.get("/exam/dashboard")
async def get_evaluation_dashboard(teacher: str = ""):
    teacher = teacher.strip()
    if STENCIL_DEMO_MODE and (not teacher or teacher == "Demo Teacher"):
        _seed_demo_dashboard_marks()
        rows = []
        for row in DEMO_MARKS.values():
            item = dict(row)
            item["subject_name"] = _demo_exam_detail()["subject_name"]
            item["assigned_teacher"] = "Demo Teacher"
            rows.append(item)
        return _build_dashboard(rows, {"Demo Teacher": len(DEMO_STUDENTS)})

    where = " WHERE f.assigned_teacher = %s" if teacher else ""
    params = (teacher,) if teacher else ()
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            mark_rows = conn.execute(
                "SELECT m.*, f.subject_name, f.assigned_teacher FROM student_marks m "
                "JOIN final_exams f ON f.id = m.final_exam_id" + where,
                params,
            ).fetchall()
            assigned_rows = conn.execute(
                "SELECT f.assigned_teacher, SUM(COALESCE(d.row_count, 0)) AS assigned "
                "FROM final_exams f LEFT JOIN student_datasets d ON d.id = f.student_dataset_id"
                + where
                + " GROUP BY f.assigned_teacher",
                params,
            ).fetchall()
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Demo mode is disabled and dashboard data is unavailable: {str(exc).strip().splitlines()[0][:200]}")
    return _build_dashboard(
        [dict(row) for row in mark_rows],
        {str(row["assigned_teacher"] or "Unassigned"): int(row["assigned"] or 0) for row in assigned_rows},
    )


@app.get("/demo/report")
async def get_demo_report():
    """Presentation-ready evidence from the current demo process and local uploads."""
    if not STENCIL_DEMO_MODE:
        raise HTTPException(
            status_code=404,
            detail="Demo mode is disabled; no demo report is available.",
        )
    return _build_demo_report()


class ModerationStatusRequest(BaseModel):
    status: Literal["pending", "reviewed", "resolved"]


@app.patch("/exam/moderation/{final_exam_id}/{student_index}")
async def update_moderation_status(
    final_exam_id: int, student_index: int, body: ModerationStatusRequest
):
    if final_exam_id == DEMO_EXAM_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; demo moderation is unavailable.")
        _seed_demo_dashboard_marks()
        row = DEMO_MARKS.get((final_exam_id, student_index))
        if row is None:
            raise HTTPException(status_code=404, detail="evaluation not found")
        row["moderation_status"] = body.status
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        return {"status": body.status}
    try:
        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "UPDATE student_marks SET moderation_status=%s, updated_at=now() "
                "WHERE final_exam_id=%s AND student_index=%s RETURNING id",
                (body.status, final_exam_id, student_index),
            ).fetchone()
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"moderation database unavailable: {str(exc).strip().splitlines()[0][:200]}")
    if row is None:
        raise HTTPException(status_code=404, detail="evaluation not found")
    return {"status": body.status}


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
    required_keys = ("student_name", "total_marks", "obtained_marks", "attendance")
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
    if STENCIL_DEMO_MODE:
        return {"datasets": [_demo_dataset()]}
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
    if dataset_id == DEMO_DATASET_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; the seeded student dataset is unavailable.")
        return _demo_dataset()
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
    required_keys = ("student_name", "total_marks", "obtained_marks", "attendance")
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
    if dataset_id == DEMO_DATASET_ID:
        if not STENCIL_DEMO_MODE:
            raise HTTPException(status_code=404, detail="Demo mode is disabled; seeded students are unavailable.")
        rows = DEMO_STUDENTS[: max(1, min(limit, 5000))]
        return {
            "columns": _demo_dataset()["columns"],
            "rows": rows,
            "total": len(DEMO_STUDENTS),
            "truncated": len(rows) < len(DEMO_STUDENTS),
            "demo": True,
        }
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
