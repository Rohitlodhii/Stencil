"""Stencil orchestrator (spec sections 2, 22, 23, 28).

States: UPLOADED -> RENDERING -> ANALYZING_PAGES -> BUILDING_PAGE_MANIFEST
-> RESOLVING_QUESTIONS -> EXTRACTING_QUESTIONS -> VALIDATING
-> NEEDS_REVIEW -> READY_FOR_EVALUATION (+ FAILED).

Retry is per-page / per-question, never a full restart.
Every AI operation is logged (no API keys).
"""

from __future__ import annotations

import time
import uuid

from app.ai.client import AIClient
from . import repository as repo
from .boundary_resolver import QuestionBoundaryResolver
from .confidence import exam_warnings
from .ingestion import QuestionPaperIngestionService
from .page_analyzer import PageAnalysisService, coerce_page_analysis
from .page_manifest import build_manifest
from .question_extractor import QuestionExtractorService
from .schemas import (
    CanonicalExam,
    ExamMetadata,
    PageAnalysis,
    PageRecord,
)
from .validator import validate_exam

STATES = [
    "UPLOADED", "RENDERING", "ANALYZING_PAGES", "BUILDING_PAGE_MANIFEST",
    "RESOLVING_QUESTIONS", "EXTRACTING_QUESTIONS", "VALIDATING",
    "NEEDS_REVIEW", "READY_FOR_EVALUATION", "FAILED",
]


def _new_state(title: str, subject: str) -> dict:
    return {
        "exam_id": uuid.uuid4().hex[:12],
        "title": title, "subject": subject,
        "status": "UPLOADED", "error": "",
        "max_marks": 0, "page_count": 0,
        "manifest": {"pages": []}, "ranges": [], "page_to_questions": {},
        "canonical": {}, "questions": [], "warnings": [],
        "ai_log": [], "progress": {"done_pages": 0, "total_pages": 0},
        "created_at": time.time(),
    }


def _log(exam_id: str, msg: str) -> None:
    # Visible in the uvicorn terminal so coordinators can see progress.
    print(f"[stencil:{exam_id}] {msg}", flush=True)


class StencilService:
    def __init__(self, ai: AIClient | None = None, uploader=None):
        self.ai = ai or AIClient()
        self.uploader = uploader  # (png_bytes, page_no) -> {url,...}
        self.ingest = QuestionPaperIngestionService()
        self.page_svc = PageAnalysisService(self.ai)
        self.extract_svc = QuestionExtractorService(self.ai)
        self.resolver = QuestionBoundaryResolver()

    def _set(self, state: dict, status: str, **kw) -> None:
        state["status"] = status
        state.update(kw)
        repo.save_exam_state(state["exam_id"], state)

    def new_exam(self, title: str, subject_hint: str) -> dict:
        """Create + persist an exam shell immediately (for async/background runs)."""
        state = _new_state(title, subject_hint)
        repo.save_exam_state(state["exam_id"], state)
        _log(state["exam_id"], f"created '{title}' subject='{subject_hint}'")
        return state

    async def analyze_pdf(
        self,
        pdf_bytes: bytes,
        filename: str = "paper.pdf",
        content_type: str = "application/pdf",
        title: str = "",
        subject_hint: str = "",
    ) -> dict:
        state = self.new_exam(title or filename, subject_hint)
        return await self.run_pipeline(state, pdf_bytes, filename, content_type)

    async def run_pipeline(
        self,
        state: dict,
        pdf_bytes: bytes,
        filename: str = "paper.pdf",
        content_type: str = "application/pdf",
    ) -> dict:
        exam_id = state["exam_id"]
        title = state.get("title", filename)
        subject_hint = state.get("subject", "")
        try:
            self._set(state, "UPLOADED")
            self.ingest.validate(filename, content_type, pdf_bytes)
            _log(exam_id, f"upload ok ({len(pdf_bytes) // 1024} KB), rendering pages…")
            self._set(state, "RENDERING")
            if self.uploader is None:
                from app.storage.images import upload_bytes_to_s3

                def _up(png: bytes, _pn: int):
                    return upload_bytes_to_s3(png, "image/png", ".png", prefix="stencil-pages")

                self.uploader = _up
            records, _pngs = self.ingest.ingest(pdf_bytes, self.uploader)
            state["page_count"] = len(records)
            state["progress"] = {"done_pages": 0, "total_pages": len(records)}
            _log(exam_id, f"rendered + uploaded {len(records)} pages")

            # ANALYZING_PAGES — one small call per page, retry only that page.
            self._set(state, "ANALYZING_PAGES")
            analyses: dict[int, PageAnalysis] = {}
            errors: dict[int, str] = {}
            page_images: dict[int, str] = {}
            for rec in records:
                page_images[rec.page_number] = rec.image_url
                _log(exam_id, f"analyzing page {rec.page_number}/{len(records)}…")
                try:
                    analyses[rec.page_number] = await self.page_svc.analyze(
                        rec.image_url, rec.page_number, exam_id=state["exam_id"]
                    )
                    _log(exam_id, f"page {rec.page_number} ok")
                except Exception as exc:
                    # keep raw-text fallback so one bad page != whole job failed
                    errors[rec.page_number] = str(exc)[:300]
                    _log(exam_id, f"page {rec.page_number} FAILED: {errors[rec.page_number]}")
                    analyses[rec.page_number] = coerce_page_analysis({}, rec.page_number)
                state["progress"] = {"done_pages": len(analyses), "total_pages": len(records)}

            self._set(state, "BUILDING_PAGE_MANIFEST")
            manifest = build_manifest(records, analyses, errors)

            self._set(state, "RESOLVING_QUESTIONS")
            ranges = self.resolver.resolve(manifest)
            page_to_q = self.resolver.page_to_questions(ranges)
            _log(exam_id, f"resolved {len(ranges)} questions: " +
                 ", ".join(f"Q{r.question_number}->p{r.pages}" for r in ranges))

            # EXTRACTING_QUESTIONS — targeted, only relevant pages; retry only that Q.
            self._set(state, "EXTRACTING_QUESTIONS")
            questions = []
            for qr in ranges:
                _log(exam_id, f"extracting Q{qr.question_number} (pages {qr.pages})…")
                try:
                    q = await self.extract_svc.extract(
                        qr, manifest, analyses, page_images, exam_id=state["exam_id"]
                    )
                    _log(exam_id, f"Q{qr.question_number} ok")
                except Exception as exc:
                    from .schemas import CanonicalQuestion, Confidence, QuestionSource, SourceRegion

                    q = CanonicalQuestion(
                        id=f"q{qr.question_number}", question_number=qr.question_number,
                        question_text="", marks=None,
                        source=QuestionSource(
                            pages=list(qr.pages),
                            regions=[SourceRegion(page=p, bbox=[0, 0, 2480, 3508]) for p in qr.pages],
                        ),
                        confidence=Confidence(overall=0.3, question_text=0.3, marks=0.3,
                                              page_mapping=0.5, visual_detection=0.3),
                        uncertain=f"extraction failed, retry this question: {str(exc)[:200]}",
                    )
                questions.append(q)

            self._set(state, "VALIDATING")
            # metadata from page-1 exam_info when visible
            meta = ExamMetadata(title=title or filename, subject=subject_hint,
                                page_count=len(records))
            for entry in sorted(manifest.pages, key=lambda p: p.page_number):
                a = analyses.get(entry.page_number)
                info = (a.exam_info if a else {}) or {}
                if info.get("subject") and not meta.subject:
                    meta.subject = str(info["subject"])
                if info.get("title") and meta.title in ("", filename):
                    meta.title = str(info["title"])
                if info.get("max_marks") is not None and not meta.maximum_marks:
                    try:
                        meta.maximum_marks = int(info["max_marks"])
                    except (TypeError, ValueError):
                        pass
                if info.get("declared_question_count") is not None and not meta.declared_question_count:
                    try:
                        meta.declared_question_count = int(info["declared_question_count"])
                    except (TypeError, ValueError):
                        pass
            if not meta.maximum_marks:
                meta.maximum_marks = 0
            if meta.declared_question_count is None:
                meta.declared_question_count = len(questions)

            sections = []
            for entry in manifest.pages:
                for s in entry.sections:
                    if not any(x.get("section_id") == s.section_id for x in sections):
                        sections.append({"section_id": s.section_id, "title": s.title})

            canonical = CanonicalExam(
                exam=meta, sections=sections, questions=questions,
                global_instructions=[i for p in manifest.pages for a in [analyses.get(p.page_number)]
                                     for i in (a.instructions if a else [])],
            )
            canonical.validation = validate_exam(canonical)
            if not meta.maximum_marks:
                meta.maximum_marks = int(canonical.validation.marks_total)
            canonical.validation = validate_exam(canonical)

            state["manifest"] = manifest.model_dump()
            # embed per-page analysis for the pages endpoint + debugging
            for e in state["manifest"]["pages"]:
                a = analyses.get(e["page_number"])
                e["analysis"] = a.model_dump() if a else {}
            state["ranges"] = [r.model_dump() for r in ranges]
            state["page_to_questions"] = {str(k): v for k, v in page_to_q.items()}
            state["canonical"] = canonical.model_dump()
            state["questions"] = canonical.model_dump()["questions"]
            state["warnings"] = exam_warnings(questions) + [
                f"page {pn} analysis failed: {msg}" for pn, msg in errors.items()
            ]
            state["max_marks"] = meta.maximum_marks
            state["subject"] = meta.subject
            state["title"] = meta.title
            state["ai_log"] = [
                {"operation": e.operation, "page": e.page_number, "question": e.question_id,
                 "retry": e.retry, "success": e.success, "error": e.error}
                for e in self.ai.log if e.exam_id == state["exam_id"]
            ]
            self._set(state, "NEEDS_REVIEW")
            _log(exam_id, f"done: {len(questions)} questions, marks_total="
                 f"{canonical.validation.marks_total:g}, marks_match="
                 f"{canonical.validation.marks_match}, warnings={len(state['warnings'])}")
            return state
        except Exception as exc:
            self._set(state, "FAILED", error=str(exc)[:500])
            _log(exam_id, f"FAILED: {str(exc)[:300]}")
            raise
