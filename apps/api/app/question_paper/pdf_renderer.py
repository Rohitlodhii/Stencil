"""PDF rendering (spec section 4) — each PDF page to PNG image bytes."""

from __future__ import annotations


def render_pdf_pages(pdf_bytes: bytes, dpi: int = 150, max_pages: int = 50) -> list[dict]:
    """Return [{page_number, png, width, height}]. No cropping of originals."""
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        raise RuntimeError("pdf rendering library missing: install pymupdf") from exc
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"cannot parse pdf: {exc}") from exc
    if doc.page_count == 0:
        raise ValueError("pdf has no pages")
    if doc.page_count > max_pages:
        raise ValueError(f"pdf has {doc.page_count} pages, max is {max_pages}")
    out: list[dict] = []
    try:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(dpi=dpi)
            out.append(
                {
                    "page_number": i,
                    "png": pix.tobytes("png"),
                    "width": pix.width,
                    "height": pix.height,
                }
            )
    finally:
        doc.close()
    return out
