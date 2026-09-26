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


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "luna_model": LUNA_MODEL,
        "luna_configured": bool(LUNA_API_KEY),
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
