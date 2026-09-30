"""AIClient abstraction (spec section 27) — analysis AI calls in one place.

Only this module talks to the analysis AI for the
question-paper engine, so the model can be swapped without rewriting
the pipeline.

Provider: Luna everywhere (for now).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

_HERE = Path(__file__).resolve()
_ROOT_ENV = _HERE.parents[4] / ".env"
load_dotenv(_HERE.parents[2] / ".env", override=False)
load_dotenv(_ROOT_ENV, override=False)

LUNA_API_KEY = os.getenv("LUNA_API_KEY", "")
LUNA_BASE_URL = os.getenv("LUNA_BASE_URL", "https://api.apinex.bond/v1")
LUNA_MODEL = os.getenv("LUNA_MODEL", "free/gpt-6-luna")

# Analysis AI provider: Luna everywhere (for now).

from .prompts import (
    PAGE_ANALYSIS_JSON_HINT,
    PAGE_ANALYSIS_SYSTEM,
    QUESTION_EXTRACTION_SYSTEM,
)
from .structured_output import StructuredOutputError, extract_json_object


@dataclass
class AILogEntry:
    exam_id: str
    operation: str
    model: str
    page_number: int | None = None
    question_id: str | None = None
    started_at: float = 0.0
    ended_at: float = 0.0
    retry: int = 0
    success: bool = False
    error: str = ""
    raw_output: str = ""


@dataclass
class AIClient:
    """Thin wrapper over the Luna chat-completions API with image input."""

    api_key: str = ""
    base_url: str = ""
    model: str = ""
    log: list[AILogEntry] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Luna everywhere (for now) — resolve defaults at instantiation
        # time so env loading order doesn't freeze empty values.
        if not self.api_key:
            self.api_key = LUNA_API_KEY
        if not self.base_url:
            self.base_url = LUNA_BASE_URL
        if not self.model:
            self.model = LUNA_MODEL

    def _require_key(self) -> None:
        if not self.api_key:
            raise RuntimeError("LUNA_API_KEY is not configured")

    def _client(self):
        from openai import AsyncOpenAI

        self._require_key()
        # Timeout so a stuck vision call fails fast instead of hanging the
        # whole pipeline (and the UI) forever. Per-page/per-question retry
        # logic + retry endpoints decide what happens next.
        return AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, timeout=90.0)

    async def _chat_vision(
        self,
        image_urls: list[str],
        system: str,
        user_text: str,
    ) -> str:
        client = self._client()
        content: list[dict] = [{"type": "text", "text": user_text}]
        for url in image_urls:
            content.append({"type": "image_url", "image_url": {"url": url}})
        completion = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
        )
        try:
            reply = (completion.choices[0].message.content or "").strip()
        except (IndexError, AttributeError):
            reply = ""
        if not reply:
            raise StructuredOutputError("ai returned an empty response")
        return reply

    async def analyze_page(
        self,
        image_url: str,
        page_number: int,
        exam_id: str = "",
        retries: int = 1,
    ) -> dict:
        """Per-page structural analysis (spec section 5). Never the final exam JSON."""
        entry = AILogEntry(
            exam_id=exam_id, operation="analyze_page", model=self.model,
            page_number=page_number, started_at=time.time(),
        )
        self.log.append(entry)
        last_err = ""
        for attempt in range(retries + 1):
            entry.retry = attempt
            try:
                raw = await self._chat_vision(
                    [image_url],
                    PAGE_ANALYSIS_SYSTEM,
                    f"Analyze question-paper page {page_number}. {PAGE_ANALYSIS_JSON_HINT}",
                )
                entry.raw_output = raw[:4000]
                out = extract_json_object(raw)
                entry.success = True
                entry.ended_at = time.time()
                return out
            except Exception as exc:
                last_err = str(exc)[:300]
                entry.error = last_err
                entry.ended_at = time.time()
        raise RuntimeError(f"page {page_number} analysis failed: {last_err}")

    async def extract_structured(
        self,
        page_images: list[str],
        page_context: dict,
        exam_id: str = "",
        question_id: str = "",
        retries: int = 1,
    ) -> dict:
        """Targeted canonical extraction for ONE logical question (spec sec 8-9)."""
        import json as _json

        entry = AILogEntry(
            exam_id=exam_id, operation="extract_question", model=self.model,
            question_id=question_id, started_at=time.time(),
        )
        self.log.append(entry)
        ctx = _json.dumps(page_context)[:6000]
        hint = (
            'Return ONLY this JSON, no prose: {"id": "...", "question_number": "...", '
            '"section_id": "", "section_title": "", "question_text": "...", '
            '"marks": null, "question_type": "text", "selection_rule": null, '
            '"word_limit": null, "source": {"pages": [], "regions": []}, '
            '"supporting_material": [], "visual_context": [], '
            '"subquestions": [], "alternatives": [], "confidence": 0.9, '
            '"uncertain": ""}'
        )
        last_err = ""
        for attempt in range(retries + 1):
            entry.retry = attempt
            try:
                raw = await self._chat_vision(
                    page_images,
                    QUESTION_EXTRACTION_SYSTEM,
                    f"Extract ONE logical question.\nContext:\n{ctx}\n{hint}",
                )
                entry.raw_output = raw[:4000]
                out = extract_json_object(raw)
                entry.success = True
                entry.ended_at = time.time()
                return out
            except Exception as exc:
                last_err = str(exc)[:300]
                entry.error = last_err
                entry.ended_at = time.time()
        raise RuntimeError(f"question {question_id} extraction failed: {last_err}")

    # Back-compat alias used by older call sites.
    async def analyze_question(self, *args, **kwargs) -> dict:
        return await self.extract_structured(*args, **kwargs)
