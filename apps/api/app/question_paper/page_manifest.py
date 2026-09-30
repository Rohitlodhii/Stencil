"""Page manifest — first-class object kept after final JSON (spec section 6)."""

from __future__ import annotations

from .schemas import PageAnalysis, PageManifest, PageManifestEntry, PageRecord


def build_manifest(
    records: list[PageRecord],
    analyses: dict[int, PageAnalysis],
    errors: dict[int, str] | None = None,
) -> PageManifest:
    errors = errors or {}
    entries: list[PageManifestEntry] = []
    for rec in sorted(records, key=lambda r: r.page_number):
        a = analyses.get(rec.page_number)
        entries.append(
            PageManifestEntry(
                page_number=rec.page_number,
                image_url=rec.image_url,
                width=rec.width,
                height=rec.height,
                status="failed" if rec.page_number in errors else "done",
                error=errors.get(rec.page_number, ""),
                question_blocks=list(a.question_blocks) if a else [],
                sections=list(a.sections) if a else [],
                visual_elements=list(a.visual_elements) if a else [],
            )
        )
    return PageManifest(pages=entries)
