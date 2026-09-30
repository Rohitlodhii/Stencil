"""Visual extraction helpers (spec sections 11-13).

The visual image is the source of truth; description is supplemental.
Tables keep both the region and structured_data (null when uncertain).
Passages spanning pages stay ONE logical supporting-material object.
"""

from __future__ import annotations

from .schemas import SourceRegion, SupportingMaterial, VisualElement

VISUAL_TYPES = {
    "diagram", "table", "graph", "chart", "image", "figure", "map",
    "flowchart", "formula", "equation", "circuit", "geometry",
    "chemical", "expression", "passage",
}


def normalize_visual(raw: dict, page: int, image_url: str = "") -> VisualElement:
    raw = dict(raw or {})
    vtype = str(raw.get("type", "image") or "image").lower()
    if vtype == "figure":
        vtype = "image"
    bbox = raw.get("bbox") or [0, 0, 0, 0]
    sd = raw.get("structured_data")
    conf = raw.get("extraction_confidence")
    try:
        conf_f = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        conf_f = None
    if vtype == "table" and sd is not None and not isinstance(sd, dict):
        sd, conf_f = None, 0.61 if conf_f is None else conf_f
    return VisualElement(
        id=str(raw.get("id", "") or f"visual_p{page}"),
        type=vtype,
        bbox=list(bbox)[:4] if isinstance(bbox, list) else [0, 0, 0, 0],
        description=str(raw.get("description", "") or ""),
        visible_text=str(raw.get("visible_text", "") or ""),
        page=int(raw.get("page", page) or page),
        image_url=image_url,
        ocr_text=str(raw.get("ocr_text", "") or raw.get("visible_text", "") or ""),
        structured_data=sd,
        extraction_confidence=conf_f,
    )


def passage_material(
    passage_id: str, pages: list[int], regions: list[dict], text: str
) -> SupportingMaterial:
    return SupportingMaterial(
        id=passage_id,
        type="passage",
        pages=list(pages),
        regions=[SourceRegion(page=int(r.get("page", 0)), bbox=list(r.get("bbox") or [0, 0, 0, 0])[:4]) for r in regions],
        text=text,
    )
