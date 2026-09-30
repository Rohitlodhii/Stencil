"""QuestionBoundaryResolver (spec section 7).

Converts the page manifest into logical question ranges:

    Q1 -> pages [2,3,4]
    Q2 -> pages [4,5,6]

A page may belong to more than one question: question -> many pages
AND page -> many questions. Never assume one page = one question.
"""

from __future__ import annotations

from .schemas import PageManifest, QuestionRange


class QuestionBoundaryResolver:
    def resolve(self, manifest: PageManifest) -> list[QuestionRange]:
        order: list[str] = []
        pages_of: dict[str, list[int]] = {}
        current: str | None = None

        for entry in sorted(manifest.pages, key=lambda p: p.page_number):
            pn = entry.page_number
            blocks = sorted(entry.question_blocks, key=lambda b: (b.block_type != "start", b.question_number))
            if not blocks:
                # no markers: page continues whatever was open (e.g. long passage)
                if current and pn not in pages_of.get(current, []):
                    pages_of[current].append(pn)
                continue
            for b in blocks:
                qn = (b.question_number or "").strip()
                if not qn:
                    continue
                if b.block_type == "start":
                    current = qn
                    if qn not in pages_of:
                        pages_of[qn] = []
                        order.append(qn)
                    if pn not in pages_of[qn]:
                        pages_of[qn].append(pn)
                else:  # continuation
                    if qn not in pages_of:
                        pages_of[qn] = []
                        order.append(qn)
                    if pn not in pages_of[qn]:
                        pages_of[qn].append(pn)
                    current = qn
            # a page with [Q1 continuation, Q2 start] belongs to BOTH
        return [QuestionRange(question_number=qn, pages=pages_of[qn]) for qn in order]

    def page_to_questions(self, ranges: list[QuestionRange]) -> dict[int, list[str]]:
        out: dict[int, list[str]] = {}
        for r in ranges:
            for p in r.pages:
                out.setdefault(p, []).append(r.question_number)
        return out
