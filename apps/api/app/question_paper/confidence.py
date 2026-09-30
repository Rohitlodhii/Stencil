"""Confidence system (spec section 18)."""

from __future__ import annotations

from .schemas import CanonicalQuestion

LOW_CONFIDENCE_THRESHOLD = 0.8


def low_confidence_flags(q: CanonicalQuestion, threshold: float = LOW_CONFIDENCE_THRESHOLD) -> list[str]:
    flags: list[str] = []
    c = q.confidence
    if c.overall < threshold:
        flags.append(f"Q{q.question_number} overall confidence = {c.overall:.2f}")
    if c.visual_detection < threshold and q.visual_context:
        flags.append(f"Q{q.question_number} visual context confidence = {c.visual_detection:.2f}")
    if c.page_mapping < threshold:
        flags.append(f"Q{q.question_number} page boundary confidence = {c.page_mapping:.2f}")
    if c.marks < threshold:
        flags.append(f"Q{q.question_number} marks confidence = {c.marks:.2f}")
    if q.uncertain:
        flags.append(f"Q{q.question_number} uncertain: {q.uncertain[:120]}")
    if q.visual_context and not c.visual_detection:
        flags.append(f"Q{q.question_number} contains a diagram/table — verify visual region")
    elif q.visual_context:
        types = sorted({v.type for v in q.visual_context})
        if any(t in ("diagram", "graph", "chart", "image", "map") for t in types):
            flags.append(f"Q{q.question_number} contains a {', '.join(types)}")
    return flags


def exam_warnings(questions: list[CanonicalQuestion]) -> list[str]:
    out: list[str] = []
    for q in questions:
        out.extend(low_confidence_flags(q))
    return out
