"""Canonical Stencil schemas (spec sections 10-16, 20).

Physical page != logical question. Every extracted object keeps source
page + bbox so the examiner can click "View source".
"""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field

BBox = list[int]  # [x1, y1, x2, y2] pixel coordinates


class PageRecord(BaseModel):
    page_number: int
    image_url: str = ""
    width: int = 0
    height: int = 0
    status: Literal["pending", "analyzing", "done", "failed"] = "pending"


class SectionRef(BaseModel):
    section_id: str = ""
    title: str = ""
    bbox: BBox = Field(default_factory=lambda: [0, 0, 0, 0])


class SubQuestionRef(BaseModel):
    number: str = ""
    bbox: BBox = Field(default_factory=lambda: [0, 0, 0, 0])


class QuestionBlock(BaseModel):
    question_number: str = ""
    block_type: Literal["start", "continuation"] = "start"
    bbox: BBox = Field(default_factory=lambda: [0, 0, 0, 0])
    subquestions: list[SubQuestionRef] = Field(default_factory=list)
    marks: float | None = None
    word_limit: str | None = None
    or_indicator: bool = False
    attempt_rule: dict | None = None
    instruction_text: str = ""


class VisualElement(BaseModel):
    id: str = ""
    type: str = "image"  # diagram|table|graph|chart|image|map|flowchart|formula|...
    bbox: BBox = Field(default_factory=lambda: [0, 0, 0, 0])
    description: str = ""
    visible_text: str = ""
    page: int = 0
    image_url: str = ""
    ocr_text: str = ""
    structured_data: dict | None = None
    extraction_confidence: float | None = None


class PageAnalysis(BaseModel):
    page_number: int
    page_type: str = "question_content"
    page_text: str = ""
    sections: list[SectionRef] = Field(default_factory=list)
    question_blocks: list[QuestionBlock] = Field(default_factory=list)
    visual_elements: list[VisualElement] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    exam_info: dict = Field(default_factory=dict)


class PageManifestEntry(BaseModel):
    page_number: int
    image_url: str = ""
    width: int = 0
    height: int = 0
    status: str = "done"
    error: str = ""
    question_blocks: list[QuestionBlock] = Field(default_factory=list)
    sections: list[SectionRef] = Field(default_factory=list)
    visual_elements: list[VisualElement] = Field(default_factory=list)


class PageManifest(BaseModel):
    pages: list[PageManifestEntry] = Field(default_factory=list)


class QuestionRange(BaseModel):
    """One logical question -> many physical pages (spec section 7)."""

    question_number: str
    pages: list[int] = Field(default_factory=list)


class SourceRegion(BaseModel):
    page: int
    bbox: BBox = Field(default_factory=lambda: [0, 0, 0, 0])


class QuestionSource(BaseModel):
    pages: list[int] = Field(default_factory=list)
    regions: list[SourceRegion] = Field(default_factory=list)


class SupportingMaterial(BaseModel):
    id: str = ""
    type: str = "passage"  # passage|table|...
    pages: list[int] = Field(default_factory=list)
    regions: list[SourceRegion] = Field(default_factory=list)
    text: str = ""
    structured_data: dict | None = None


class SubQuestion(BaseModel):
    id: str = ""
    number: str = ""
    text: str = ""
    marks: float | None = None
    source: QuestionSource = Field(default_factory=QuestionSource)
    references: list[str] = Field(default_factory=list)


class Alternative(BaseModel):
    id: str = ""
    label: str = ""
    text: str = ""
    marks: float | None = None


class SelectionRule(BaseModel):
    type: str = "choose_one"  # choose_one|choose_n
    count: int = 1


class Confidence(BaseModel):
    overall: float = 0.9
    question_text: float = 0.9
    marks: float = 0.9
    page_mapping: float = 0.9
    visual_detection: float = 0.9


class CanonicalQuestion(BaseModel):
    id: str = ""
    question_number: str = ""
    section_id: str = ""
    section_title: str = ""
    question_text: str = ""
    marks: float | None = None
    question_type: str = "text"
    selection_rule: SelectionRule | None = None
    marks_per_item: float | None = None
    total_marks: float | None = None
    word_limit: str | None = None
    source: QuestionSource = Field(default_factory=QuestionSource)
    supporting_material: list[SupportingMaterial] = Field(default_factory=list)
    visual_context: list[VisualElement] = Field(default_factory=list)
    subquestions: list[SubQuestion] = Field(default_factory=list)
    alternatives: list[Alternative] = Field(default_factory=list)
    confidence: Confidence = Field(default_factory=Confidence)
    uncertain: str = ""
    status: str = "extracted"  # extracted|confirmed


class ExamMetadata(BaseModel):
    title: str = ""
    subject: str = ""
    paper_code: str = ""
    set: str = ""
    duration: str = ""
    maximum_marks: int = 0
    declared_question_count: int | None = None
    page_count: int = 0


class ValidationResult(BaseModel):
    marks_total: float = 0
    question_count: int = 0
    marks_match: bool = False
    question_count_match: bool = False
    issues: list[str] = Field(default_factory=list)


class CanonicalExam(BaseModel):
    exam: ExamMetadata = Field(default_factory=ExamMetadata)
    sections: list[dict] = Field(default_factory=list)
    questions: list[CanonicalQuestion] = Field(default_factory=list)
    global_instructions: list[str] = Field(default_factory=list)
    validation: ValidationResult = Field(default_factory=ValidationResult)
