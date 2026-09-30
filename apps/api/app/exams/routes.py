"""Stencil exam API (spec section 21).

POST   /api/exams/analyze                        PDF -> {exam_id, status}
GET    /api/exams/{exam_id}/analysis              current analysis state
GET    /api/exams/{exam_id}/pages                 page manifest
GET    /api/exams/{exam_id}/questions             canonical question JSON
GET    /api/exams/{exam_id}/questions/{qid}       one question + source + visuals
PATCH  /api/exams/{exam_id}/questions/{qid}       human correction
POST   /api/exams/{exam_id}/confirm               READY_FOR_EVALUATION
POST   /api/exams/{exam_id}/pages/{page}/retry    retry one page
POST   /api/exams/{exam_id}/questions/{qid}/retry retry one question
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.question_paper import repository as repo
from app.question_paper.confidence import exam_warnings
from app.question_paper.schemas import CanonicalExam, CanonicalQuestion
from app.question_paper.service import StencilService
from app.question_paper.validator import validate_exam

router = APIRouter(prefix="/api/exams", tags=["stencil-exams"])
_service: StencilService | None = None


def get_service() -> StencilService:
    global _service
    if _service is None:
        _service = StencilService()
    return _service


def _state_or_404(exam_id: str) -> dict:
    st = repo.load_exam_state(exam_id)
    if st is None:
        raise HTTPException(status_code=404, detail="exam not found")
    return st


@router.post("/analyze")
async def analyze_exam(
    file: UploadFile = File(...),
    subject: str = Form(default=""),
    title: str = Form(default=""),
):
    """Start analysis in the background; poll GET .../analysis for progress.

    Returns immediately with {exam_id, status: processing} — a full paper
    needs one AI call per page plus one per question, which takes minutes.
    """
    data = await file.read()
    filename = file.filename or "paper.pdf"
    content_type = file.content_type or "application/pdf"
    svc = get_service()
    try:
        from app.question_paper.ingestion import QuestionPaperIngestionService

        QuestionPaperIngestionService().validate(filename, content_type, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    state = svc.new_exam(title.strip() or filename, subject.strip())

    async def _run() -> None:
        try:
            await svc.run_pipeline(state, data, filename, content_type)
        except Exception:
            pass  # state already marked FAILED with error text

    asyncio.create_task(_run())
    return {"exam_id": state["exam_id"], "status": "processing"}


@router.get("/{exam_id}/analysis")
async def get_analysis(exam_id: str):
    st = _state_or_404(exam_id)
    canon = st.get("canonical") or {}
    exam = (canon or {}).get("exam") or {}
    validation = (canon or {}).get("validation") or {}
    ai_log = st.get("ai_log", []) or []
    page_calls = sum(1 for e in ai_log if e.get("operation") == "analyze_page")
    question_calls = sum(1 for e in ai_log if e.get("operation") == "extract_question")
    failed = sum(1 for e in ai_log if not e.get("success"))
    return {
        "exam_id": exam_id,
        "status": st.get("status"),
        "progress": st.get("progress", {}),
        "subject": exam.get("subject", st.get("subject", "")),
        "title": exam.get("title", st.get("title", "")),
        "pages": st.get("page_count", 0),
        "detected_questions": len(st.get("questions", []) or []),
        "maximum_marks": exam.get("maximum_marks", st.get("max_marks", 0)),
        "validation": validation,
        "warnings": st.get("warnings", []),
        "error": st.get("error", ""),
        "ai_calls": {
            "total": len(ai_log),
            "page_analysis": page_calls,
            "question_extraction": question_calls,
            "failed": failed,
        },
    }


@router.get("/{exam_id}/pages")
async def get_pages(exam_id: str):
    st = _state_or_404(exam_id)
    return {
        "exam_id": exam_id,
        "pages": (st.get("manifest") or {}).get("pages", []),
        "ranges": st.get("ranges", []),
        "page_to_questions": st.get("page_to_questions", {}),
    }


@router.get("/{exam_id}/questions")
async def get_questions(exam_id: str):
    st = _state_or_404(exam_id)
    return {"exam_id": exam_id, "questions": st.get("questions", [])}


@router.get("/{exam_id}/questions/{question_id}")
async def get_question(exam_id: str, question_id: str):
    st = _state_or_404(exam_id)
    for q in st.get("questions", []) or []:
        if q.get("id") == question_id or q.get("question_number") == question_id:
            return q
    raise HTTPException(status_code=404, detail="question not found")


class QuestionPatch(BaseModel):
    question_number: str | None = None
    question_text: str | None = None
    marks: float | None = None
    section_id: str | None = None
    section_title: str | None = None
    word_limit: str | None = None
    selection_rule: dict | None = None
    source: dict | None = None
    subquestions: list[dict] | None = None
    alternatives: list[dict] | None = None


@router.patch("/{exam_id}/questions/{question_id}")
async def patch_question(exam_id: str, question_id: str, body: QuestionPatch):
    st = _state_or_404(exam_id)
    if st.get("status") == "READY_FOR_EVALUATION":
        raise HTTPException(status_code=409, detail="exam already confirmed; create a new analysis to edit")
    found = False
    for q in st.get("questions", []) or []:
        if q.get("id") == question_id or q.get("question_number") == question_id:
            patch = body.model_dump(exclude_unset=True)
            for k, v in patch.items():
                if v is not None:
                    q[k] = v
            # re-validate + refresh warnings deterministically
            try:
                canon = CanonicalExam.model_validate(st.get("canonical") or {})
                canon.questions = [CanonicalQuestion.model_validate(x) for x in st["questions"]]
                canon.validation = validate_exam(canon)
                st["canonical"] = canon.model_dump()
                st["warnings"] = exam_warnings(canon.questions)
            except Exception:
                pass
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="question not found")
    repo.save_exam_state(exam_id, st)
    return {"exam_id": exam_id, "status": st.get("status")}


@router.post("/{exam_id}/confirm")
async def confirm_exam(exam_id: str):
    st = _state_or_404(exam_id)
    if not (st.get("questions") or []):
        raise HTTPException(status_code=422, detail="no questions to confirm")
    st["status"] = "READY_FOR_EVALUATION"
    for q in st.get("questions", []) or []:
        q["status"] = "confirmed"
    try:
        canon = CanonicalExam.model_validate(st.get("canonical") or {})
        canon.questions = [CanonicalQuestion.model_validate(x) for x in st["questions"]]
        canon.validation = validate_exam(canon)
        st["canonical"] = canon.model_dump()
    except Exception:
        pass
    repo.save_exam_state(exam_id, st)
    return {"exam_id": exam_id, "status": "READY_FOR_EVALUATION"}


@router.post("/{exam_id}/pages/{page_no}/retry")
async def retry_page(exam_id: str, page_no: int):
    """Retry a single failed page analysis (spec 23)."""
    st = _state_or_404(exam_id)
    pages = (st.get("manifest") or {}).get("pages", []) or []
    target = next((p for p in pages if p.get("page_number") == page_no), None)
    if target is None:
        raise HTTPException(status_code=404, detail="page not found")
    image_url = target.get("image_url", "")
    if not image_url:
        raise HTTPException(status_code=422, detail="page has no image url")
    from app.question_paper.page_analyzer import PageAnalysisService

    try:
        analysis = await PageAnalysisService(get_service().ai).analyze(image_url, page_no, exam_id=exam_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"page retry failed: {exc}")
    target["analysis"] = analysis.model_dump()
    target["question_blocks"] = analysis.model_dump()["question_blocks"]
    target["sections"] = analysis.model_dump()["sections"]
    target["visual_elements"] = analysis.model_dump()["visual_elements"]
    target["status"] = "done"
    # rebuild manifest + ranges deterministically (no full restart of other pages)
    from app.question_paper.boundary_resolver import QuestionBoundaryResolver
    from app.question_paper.schemas import PageManifest

    manifest = PageManifest.model_validate({"pages": [
        {k: p.get(k) for k in ("page_number", "image_url", "width", "height", "status", "error",
                               "question_blocks", "sections", "visual_elements") if k in p}
        for p in pages
    ]})
    st["ranges"] = [r.model_dump() for r in QuestionBoundaryResolver().resolve(manifest)]
    repo.save_exam_state(exam_id, st)
    return {"exam_id": exam_id, "page": page_no, "status": "done"}


@router.post("/{exam_id}/questions/{question_id}/retry")
async def retry_question(exam_id: str, question_id: str):
    """Retry extraction for a single question only (spec 23)."""
    st = _state_or_404(exam_id)
    rng = next((r for r in st.get("ranges", []) or []
                if f"q{r.get('question_number')}" == question_id or r.get("question_number") == question_id), None)
    if rng is None:
        raise HTTPException(status_code=404, detail="question range not found")
    from app.question_paper.page_analyzer import coerce_page_analysis
    from app.question_paper.schemas import PageManifest, QuestionRange

    pages = (st.get("manifest") or {}).get("pages", []) or []
    manifest = PageManifest.model_validate({"pages": [
        {k: p.get(k) for k in ("page_number", "image_url", "width", "height", "status", "error",
                               "question_blocks", "sections", "visual_elements") if k in p}
        for p in pages
    ]})
    analyses = {}
    for p in pages:
        a = p.get("analysis") or {}
        try:
            analyses[p["page_number"]] = coerce_page_analysis(a, p["page_number"])
        except Exception:
            pass
    page_images = {p["page_number"]: p.get("image_url", "") for p in pages}
    qr = QuestionRange.model_validate(rng)
    try:
        q = await get_service().extract_svc.extract(qr, manifest, analyses, page_images, exam_id=exam_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"question retry failed: {exc}")
    dumped = q.model_dump()
    replaced = False
    for i, old in enumerate(st.get("questions", []) or []):
        if old.get("id") == dumped["id"] or old.get("question_number") == dumped["question_number"]:
            st["questions"][i] = dumped
            replaced = True
    if not replaced:
        st["questions"].append(dumped)
    st["canonical"]["questions"] = st["questions"]
    repo.save_exam_state(exam_id, st)
    return {"exam_id": exam_id, "question_id": dumped["id"], "status": "done"}
