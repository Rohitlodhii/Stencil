"""PageAnalysisService (spec section 5) — one small structured call per page."""

from __future__ import annotations

from app.ai.client import AIClient
from .schemas import PageAnalysis


def coerce_page_analysis(raw: dict, page_number: int) -> PageAnalysis:
    raw = dict(raw or {})
    raw["page_number"] = int(raw.get("page_number") or page_number)
    # normalise block types / numbers to strings so resolver is deterministic
    blocks = []
    for b in raw.get("question_blocks", []) or []:
        if not isinstance(b, dict):
            continue
        bt = str(b.get("block_type", "start")).lower()
        b["block_type"] = "continuation" if "continu" in bt else "start"
        b["question_number"] = str(b.get("question_number", "") or "").strip()
        subs = []
        for s in b.get("subquestions", []) or []:
            if isinstance(s, dict):
                subs.append({"number": str(s.get("number", "") or ""), "bbox": s.get("bbox") or [0, 0, 0, 0]})
            else:
                subs.append({"number": str(s), "bbox": [0, 0, 0, 0]})
        b["subquestions"] = subs
        blocks.append(b)
    raw["question_blocks"] = blocks
    try:
        return PageAnalysis.model_validate(raw)
    except Exception:
        # minimal safe fallback — keeps per-page retry semantics (spec 23)
        return PageAnalysis(page_number=page_number, page_text=str(raw.get("page_text", "")))


class PageAnalysisService:
    def __init__(self, ai: AIClient | None = None):
        self.ai = ai or AIClient()

    async def analyze(self, image_url: str, page_number: int, exam_id: str = "") -> PageAnalysis:
        raw = await self.ai.analyze_page(image_url, page_number, exam_id=exam_id)
        return coerce_page_analysis(raw, page_number)
