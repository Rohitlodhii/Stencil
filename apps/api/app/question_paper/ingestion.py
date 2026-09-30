"""QuestionPaperIngestionService (spec section 4)."""

from __future__ import annotations

from .pdf_renderer import render_pdf_pages
from .schemas import PageRecord


class QuestionPaperIngestionService:
    """Validate PDF, render pages, upload images via provided uploader."""

    def __init__(self, dpi: int = 150, max_pages: int = 50, max_bytes: int = 25 * 1024 * 1024):
        self.dpi = dpi
        self.max_pages = max_pages
        self.max_bytes = max_bytes

    def validate(self, filename: str, content_type: str, pdf_bytes: bytes) -> None:
        name = (filename or "").lower()
        ctype = (content_type or "").lower()
        if ctype and ctype != "application/pdf" and "pdf" not in ctype:
            raise ValueError(f"not a pdf: {content_type}")
        if name and not name.endswith(".pdf"):
            raise ValueError("file must be a .pdf")
        if not pdf_bytes:
            raise ValueError("empty pdf")
        if len(pdf_bytes) > self.max_bytes:
            raise ValueError("pdf larger than 25 MB")

    def ingest(self, pdf_bytes: bytes, uploader) -> tuple[list[PageRecord], list[bytes]]:
        """Render + upload. uploader(png, page_no) -> {url,...}. No cropping."""
        rendered = render_pdf_pages(pdf_bytes, dpi=self.dpi, max_pages=self.max_pages)
        records: list[PageRecord] = []
        pngs: list[bytes] = []
        for r in rendered:
            meta = uploader(r["png"], r["page_number"])
            records.append(
                PageRecord(
                    page_number=r["page_number"],
                    image_url=meta.get("url", ""),
                    width=r["width"],
                    height=r["height"],
                    status="pending",
                )
            )
            pngs.append(r["png"])
        return records, pngs
