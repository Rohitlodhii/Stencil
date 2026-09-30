"""Targeted question extraction (spec section 8) — only relevant pages/regions."""

from __future__ import annotations

from app.ai.client import AIClient
from .schemas import (
    Alternative,
    CanonicalQuestion,
    Confidence,
    PageAnalysis,
    PageManifest,
    QuestionRange,
    QuestionSource,
    SelectionRule,
    SourceRegion,
    SubQuestion,
    SupportingMaterial,
    VisualElement,
)
from .visual_extractor import normalize_visual


def _num(v) -> float | None:
    try:
        if v is None or (isinstance(v, str) and v.strip() == ""):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _bbox_ok(b) -> bool:
    return isinstance(b, list) and len(b) == 4 and all(isinstance(x, (int, float)) for x in b)


def coerce_question(raw: dict, fallback_number: str, pages: list[int]) -> CanonicalQuestion:
    raw = dict(raw or {})
    qn = str(raw.get("question_number", "") or fallback_number)
    src = raw.get("source") or {}
    regions = []
    for r in src.get("regions", []) or []:
        if isinstance(r, dict) and isinstance(r.get("page"), int):
            regions.append(SourceRegion(page=r["page"], bbox=r.get("bbox") or [0, 0, 0, 0]))
    if not regions:
        # default: full relevant pages as regions (spec 29 traceability)
        regions = [SourceRegion(page=p, bbox=[0, 0, 2480, 3508]) for p in pages]
    sel = raw.get("selection_rule")
    selection = None
    if isinstance(sel, dict) and sel.get("type"):
        try:
            selection = SelectionRule(type=str(sel["type"]), count=int(sel.get("count", 1)))
        except (TypeError, ValueError):
            selection = None
    conf = raw.get("confidence")
    confidence = Confidence(overall=0.9)
    if isinstance(conf, dict):
        try:
            confidence = Confidence.model_validate(conf)
        except Exception:
            try:
                confidence = Confidence(overall=float(raw.get("confidence", 0.9)))
            except (TypeError, ValueError):
                pass
    subs = []
    for i, s in enumerate(raw.get("subquestions", []) or []):
        if not isinstance(s, dict):
            continue
        ss = s.get("source") or {}
        sregs = [SourceRegion(page=r["page"], bbox=r.get("bbox") or [0, 0, 0, 0])
                 for r in ss.get("regions", []) or [] if isinstance(r, dict) and isinstance(r.get("page"), int)]
        subs.append(
            SubQuestion(
                id=str(s.get("id", "") or f"q{qn}-{i}"),
                number=str(s.get("number", "") or ""),
                text=str(s.get("text", "") or ""),
                marks=_num(s.get("marks")),
                source=QuestionSource(pages=ss.get("pages", pages) or pages, regions=sregs or regions),
                references=list(s.get("references", []) or []),
            )
        )
    alts = []
    for a in raw.get("alternatives", []) or []:
        if isinstance(a, dict):
            alts.append(Alternative(id=str(a.get("id", "") or ""), label=str(a.get("label", "") or ""),
                                    text=str(a.get("text", "") or ""), marks=_num(a.get("marks"))))
    mats = []
    for m in raw.get("supporting_material", []) or []:
        if isinstance(m, dict):
            mregs = [SourceRegion(page=r["page"], bbox=r.get("bbox") or [0, 0, 0, 0])
                     for r in m.get("regions", []) or [] if isinstance(r, dict) and isinstance(r.get("page"), int)]
            mats.append(SupportingMaterial(id=str(m.get("id", "") or ""), type=str(m.get("type", "passage") or "passage"),
                                           pages=list(m.get("pages", pages) or pages), regions=mregs or regions,
                                           text=str(m.get("text", "") or ""),
                                           structured_data=m.get("structured_data") if isinstance(m.get("structured_data"), dict) else None))
    visuals = []
    for v in raw.get("visual_context", []) or []:
        if isinstance(v, dict):
            visuals.append(normalize_visual(v, int(v.get("page", pages[0] if pages else 0) or 0)))
    return CanonicalQuestion(
        id=str(raw.get("id", "") or f"q{qn}"),
        question_number=qn,
        section_id=str(raw.get("section_id", "") or ""),
        section_title=str(raw.get("section_title", "") or ""),
        question_text=str(raw.get("question_text", "") or raw.get("text", "") or ""),
        marks=_num(raw.get("marks")),
        question_type=str(raw.get("question_type", "text") or "text"),
        selection_rule=selection,
        marks_per_item=_num(raw.get("marks_per_item")),
        total_marks=_num(raw.get("total_marks")),
        word_limit=(str(raw.get("word_limit")) if raw.get("word_limit") not in (None, "") else None),
        source=QuestionSource(pages=list(src.get("pages", pages) or pages), regions=regions),
        supporting_material=mats,
        visual_context=visuals,
        subquestions=subs,
        alternatives=alts,
        confidence=confidence,
        uncertain=str(raw.get("uncertain", "") or ""),
    )


class QuestionExtractorService:
    def __init__(self, ai: AIClient | None = None):
        self.ai = ai or AIClient()

    def _context_for(self, qr: QuestionRange, manifest: PageManifest, analyses: dict[int, PageAnalysis]) -> dict:
        blocks, sections, visuals = [], [], []
        for p in qr.pages:
            a = analyses.get(p)
            if not a:
                continue
            blocks += [b.model_dump() for b in a.question_blocks if b.question_number == qr.question_number or not b.question_number]
            sections += [s.model_dump() for s in a.sections]
            visuals += [{**v.model_dump(), "page": p} for v in a.visual_elements]
        return {"question_number": qr.question_number, "pages": qr.pages,
                "blocks": blocks, "sections": sections, "visual_elements": visuals}

    async def extract(
        self,
        qr: QuestionRange,
        manifest: PageManifest,
        analyses: dict[int, PageAnalysis],
        page_images: dict[int, str],
        exam_id: str = "",
    ) -> CanonicalQuestion:
        # DO NOT send unrelated pages (spec 8): only this question's pages.
        images = [page_images[p] for p in qr.pages if p in page_images]
        ctx = self._context_for(qr, manifest, analyses)
        raw = await self.ai.extract_structured(images, ctx, exam_id=exam_id, question_id=f"q{qr.question_number}")
        q = coerce_question(raw, qr.question_number, qr.pages)
        # attach page-analysis visuals that the model may have omitted
        seen = {(v.page, v.id) for v in q.visual_context}
        for v in ctx["visual_elements"]:
            key = (v.get("page", 0), v.get("id", ""))
            if key not in seen:
                q.visual_context.append(normalize_visual(v, v.get("page", 0)))
        return q
