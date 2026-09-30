"""Persistent entities (spec section 20) — postgres when reachable, else memory.

Tables: stencil_exams, stencil_pages, stencil_sections, stencil_questions,
stencil_visuals, stencil_subquestions. The in-memory store keeps the API
functional when postgres is down; postgres rows are written best-effort.
"""

from __future__ import annotations

import json as _json
import os
from pathlib import Path

from dotenv import load_dotenv

_HERE = Path(__file__).resolve()
load_dotenv(_HERE.parents[2] / ".env", override=False)
load_dotenv(_HERE.parents[3] / ".env", override=False)

EXAM_DATABASE_URL = os.getenv(
    "EXAM_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/examdb"),
)

DDL = """
CREATE TABLE IF NOT EXISTS stencil_exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    paper_code TEXT NOT NULL DEFAULT '',
    duration TEXT NOT NULL DEFAULT '',
    max_marks INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 0,
    declared_question_count INTEGER NULL,
    status TEXT NOT NULL DEFAULT 'UPLOADED',
    manifest_json JSONB NOT NULL DEFAULT '{}',
    exam_json JSONB NOT NULL DEFAULT '{}',
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stencil_pages (
    id SERIAL PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES stencil_exams(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    analysis_json JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (exam_id, page_number)
);
CREATE TABLE IF NOT EXISTS stencil_sections (
    id SERIAL PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES stencil_exams(id) ON DELETE CASCADE,
    section_number TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    marks DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stencil_questions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES stencil_exams(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL DEFAULT '',
    parent_question_id TEXT NULL,
    question_number TEXT NOT NULL DEFAULT '',
    question_text TEXT NOT NULL DEFAULT '',
    marks DOUBLE PRECISION NULL,
    question_type TEXT NOT NULL DEFAULT 'text',
    selection_rule_json JSONB NOT NULL DEFAULT '{}',
    source_json JSONB NOT NULL DEFAULT '{}',
    visual_context_json JSONB NOT NULL DEFAULT '[]',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    status TEXT NOT NULL DEFAULT 'extracted'
);
CREATE TABLE IF NOT EXISTS stencil_visuals (
    id SERIAL PRIMARY KEY,
    question_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'image',
    page_number INTEGER NOT NULL DEFAULT 0,
    bbox JSONB NOT NULL DEFAULT '[0,0,0,0]',
    image_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    structured_data_json JSONB NULL
);
CREATE TABLE IF NOT EXISTS stencil_subquestions (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    number TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    marks DOUBLE PRECISION NULL,
    source_json JSONB NOT NULL DEFAULT '{}'
);
"""


def init_stencil_db() -> None:
    try:
        import psycopg
    except ImportError:
        return
    try:
        with psycopg.connect(EXAM_DATABASE_URL, autocommit=True) as conn:
            conn.execute(DDL)
    except Exception as exc:
        print(f"stencil db init skipped: {exc}")


_STORE: dict[str, dict] = {}


def save_exam_state(exam_id: str, state: dict) -> None:
    _STORE[exam_id] = state
    try:
        import psycopg

        with psycopg.connect(EXAM_DATABASE_URL) as conn:
            conn.execute(
                "INSERT INTO stencil_exams (id, title, subject, max_marks, page_count,"
                " status, manifest_json, exam_json, error, updated_at)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s, now())"
                " ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, subject=EXCLUDED.subject,"
                " max_marks=EXCLUDED.max_marks, page_count=EXCLUDED.page_count, status=EXCLUDED.status,"
                " manifest_json=EXCLUDED.manifest_json, exam_json=EXCLUDED.exam_json,"
                " error=EXCLUDED.error, updated_at=now()",
                (
                    exam_id,
                    str(state.get("title", "")),
                    str(state.get("subject", "")),
                    int(state.get("max_marks", 0) or 0),
                    int(state.get("page_count", 0) or 0),
                    str(state.get("status", "")),
                    _json.dumps(state.get("manifest", {"pages": []})),
                    _json.dumps(state.get("canonical", {})),
                    str(state.get("error", "")),
                ),
            )
            for p in (state.get("manifest", {}) or {}).get("pages", []) or []:
                conn.execute(
                    "INSERT INTO stencil_pages (exam_id, page_number, image_url, width, height, analysis_json, status)"
                    " VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s)"
                    " ON CONFLICT (exam_id, page_number) DO UPDATE SET image_url=EXCLUDED.image_url,"
                    " analysis_json=EXCLUDED.analysis_json, status=EXCLUDED.status",
                    (
                        exam_id, int(p.get("page_number", 0)), str(p.get("image_url", "")),
                        int(p.get("width", 0) or 0), int(p.get("height", 0) or 0),
                        _json.dumps(p.get("analysis", {})), str(p.get("status", "done")),
                    ),
                )
    except Exception:
        pass  # memory store is authoritative when postgres is unreachable


def load_exam_state(exam_id: str) -> dict | None:
    if exam_id in _STORE:
        return _STORE[exam_id]
    try:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(EXAM_DATABASE_URL, row_factory=dict_row) as conn:
            r = conn.execute(
                "SELECT id, title, subject, max_marks, page_count, status,"
                " manifest_json, exam_json, error FROM stencil_exams WHERE id=%s",
                (exam_id,),
            ).fetchone()
        if r is None:
            return None
        state = {
            "exam_id": r["id"], "title": r["title"], "subject": r["subject"],
            "max_marks": r["max_marks"], "page_count": r["page_count"],
            "status": r["status"], "manifest": r["manifest_json"] or {"pages": []},
            "canonical": r["exam_json"] or {}, "error": r["error"] or "",
            "questions": ((r["exam_json"] or {}).get("questions", []) or []),
        }
        _STORE[exam_id] = state
        return state
    except Exception:
        return None
