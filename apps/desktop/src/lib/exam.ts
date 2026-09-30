/** Typed client for the exam/syllabus backend (FastAPI on :8001). */

export const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:8001";

export type SummaryPageImage = {
  page: number;
  image_url: string;
  key: string;
};

export type SummarizeSyllabusResult = {
  model: string;
  subject: string;
  num_pages: number;
  pages: SummaryPageImage[];
  summary_md: string;
};

export type SaveExamResult = {
  id: number;
  name: string;
  num_images: number;
  created_at: string;
};

export type SavedExam = {
  id: number;
  name: string;
  num_images: number;
  created_at: string;
};

export async function fetchSavedExams(): Promise<SavedExam[]> {
  const res = await fetch(`${API_URL}/exam/list`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  const body = await res.json();
  return (body.exams ?? []) as SavedExam[];
}

// ---- question paper + final exam ----
export type QPQuestion = {
  q_no: string;
  section: string;
  text: string;
  marks: number | null;
  page: number | null;
  sub_questions: QPQuestion[];
};

export type QPPage = {
  page: number;
  url: string;
  key: string;
};

export type QuestionPaperResult = {
  model: string;
  subject_name: string;
  total_marks: number;
  total_questions: number;
  questions: QPQuestion[];
  pages: QPPage[];
};

export type FinalExam = {
  id: number;
  subject_name: string;
  total_marks: number;
  total_questions: number;
  assigned_teacher: string;
  student_dataset_id: number | null;
  student_label: string;
  created_at: string;
};

export type FinalExamCreated = {
  id: number;
  subject_name: string;
  total_marks: number;
  total_questions: number;
  assigned_teacher: string;
  created_at: string;
};

export async function analyzeQuestionPaper(
  file: File,
  subject = "",
): Promise<QuestionPaperResult> {
  const form = new FormData();
  form.append("subject", subject);
  form.append("file", file);
  const res = await fetch(`${API_URL}/exam/analyze-question-paper`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<QuestionPaperResult>;
}

// ---- Stencil canonical question-paper analysis (page-aware JSON) ----
export type CanonicalSourceRegion = { page: number; bbox: number[] };
export type CanonicalSource = {
  pages: number[];
  regions: CanonicalSourceRegion[];
};
export type CanonicalSelectionRule = { type: string; count: number };
export type CanonicalConfidence = {
  overall: number;
  question_text: number;
  marks: number;
  page_mapping: number;
  visual_detection: number;
};
export type CanonicalVisual = {
  id: string;
  type: string;
  page: number;
  bbox: number[];
  image_url: string;
  description: string;
  ocr_text: string;
  structured_data?: Record<string, unknown> | null;
};
export type CanonicalSubQuestion = {
  id: string;
  number: string;
  text: string;
  marks: number | null;
  source: CanonicalSource;
  references: string[];
};
export type CanonicalAlternative = {
  id: string;
  label: string;
  text: string;
  marks: number | null;
};
export type CanonicalQuestion = {
  id: string;
  question_number: string;
  section_id: string;
  section_title: string;
  question_text: string;
  marks: number | null;
  question_type: string;
  selection_rule: CanonicalSelectionRule | null;
  marks_per_item: number | null;
  total_marks: number | null;
  word_limit: string | null;
  source: CanonicalSource;
  supporting_material: unknown[];
  visual_context: CanonicalVisual[];
  subquestions: CanonicalSubQuestion[];
  alternatives: CanonicalAlternative[];
  confidence: CanonicalConfidence;
  uncertain: string;
  status: string;
};

export type CanonicalAnalysis = {
  exam_id: string;
  status: string;
  progress: { done_pages: number; total_pages: number };
  subject: string;
  title: string;
  pages: number;
  detected_questions: number;
  maximum_marks: number;
  validation: {
    marks_total: number;
    question_count: number;
    marks_match: boolean;
    question_count_match: boolean;
    issues: string[];
  };
  warnings: string[];
  error: string;
};

export type CanonicalPageEntry = {
  page_number: number;
  image_url: string;
  width: number;
  height: number;
  status: string;
  error: string;
  question_blocks: {
    question_number: string;
    block_type: string;
    bbox: number[];
    subquestions: { number: string; bbox: number[] }[];
    marks: number | null;
  }[];
  sections: { section_id: string; title: string; bbox: number[] }[];
  visual_elements: CanonicalVisual[];
};

async function stencilFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json();
}

export async function analyzeCanonicalPaper(
  file: File,
  subject = "",
): Promise<{ exam_id: string; status: string }> {
  const form = new FormData();
  form.append("subject", subject);
  form.append("file", file);
  return stencilFetch("/api/exams/analyze", { method: "POST", body: form });
}

export function fetchCanonicalAnalysis(
  examId: string,
): Promise<CanonicalAnalysis> {
  return stencilFetch(`/api/exams/${examId}/analysis`);
}

export function fetchCanonicalPages(
  examId: string,
): Promise<{
  exam_id: string;
  pages: CanonicalPageEntry[];
  ranges: { question_number: string; pages: number[] }[];
  page_to_questions: Record<string, string[]>;
}> {
  return stencilFetch(`/api/exams/${examId}/pages`);
}

export function fetchCanonicalQuestions(
  examId: string,
): Promise<{ exam_id: string; questions: CanonicalQuestion[] }> {
  return stencilFetch(`/api/exams/${examId}/questions`);
}

export function patchCanonicalQuestion(
  examId: string,
  questionId: string,
  patch: Record<string, unknown>,
): Promise<{ exam_id: string; status: string }> {
  return stencilFetch(`/api/exams/${examId}/questions/${questionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function confirmCanonicalExam(
  examId: string,
): Promise<{ exam_id: string; status: string }> {
  return stencilFetch(`/api/exams/${examId}/confirm`, { method: "POST" });
}

/** Canonical -> legacy QPQuestion tree (keeps final-exam creation working). */
export function canonicalToQp(q: CanonicalQuestion): QPQuestion {
  const subs: QPQuestion[] = [
    ...(q.subquestions ?? []).map((s) => ({
      q_no: s.number || s.id,
      section: q.section_id,
      text: s.text,
      marks: s.marks,
      page: s.source?.pages?.[0] ?? q.source?.pages?.[0] ?? null,
      sub_questions: [],
    })),
    ...(q.alternatives ?? []).map((a) => ({
      q_no: `${q.question_number}${a.label ? `-${a.label}` : "-or"}`,
      section: q.section_id,
      text: `OR: ${a.text}`,
      marks: a.marks,
      page: q.source?.pages?.[0] ?? null,
      sub_questions: [],
    })),
  ];
  const sel = q.selection_rule
    ? ` [${q.selection_rule.type} ${q.selection_rule.count}]`
    : "";
  return {
    q_no: q.question_number,
    section: q.section_id,
    text: `${q.question_text}${sel}`,
    marks: q.marks ?? q.total_marks ?? null,
    page: q.source?.pages?.[0] ?? null,
    sub_questions: subs,
  };
}

export async function createFinalExam(input: {
  subject_name: string;
  syllabus_exam_id?: number | null;
  syllabus_summary?: string;
  questions: QPQuestion[];
  total_marks: number;
  total_questions: number;
  question_pages: QPPage[];
  assigned_teacher: string;
  student_dataset_id?: number | null;
  student_label?: string;
}): Promise<FinalExamCreated> {
  const res = await fetch(`${API_URL}/exam/final/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<FinalExamCreated>;
}

export type FinalExamDetail = {
  id: number;
  subject_name: string;
  syllabus_exam_id: number | null;
  syllabus_summary: string;
  questions: QPQuestion[];
  total_marks: number;
  total_questions: number;
  question_pages: QPPage[];
  assigned_teacher: string;
  student_dataset_id: number | null;
  student_label: string;
  created_at: string;
};

export type UploadedImage = {
  url: string;
  key: string;
  bucket: string;
  region: string;
  content_type: string;
  size_bytes: number;
};

export async function uploadImage(file: File): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/upload-image`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<UploadedImage>;
}

export type AnswerSheetAnalysis = {
  model: string;
  matched_question: string;
  max_marks: number;
  awarded_marks: number;
  expected_answer: string;
  strengths: string;
  improvements: string;
};

export type AnswerSheetChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AnswerSheetChatResponse = {
  model: string;
  /** "grading" = marks card for an answer; "chat" = conversational reply. */
  kind: "grading" | "chat";
  reply: string;
  matched_question: string;
  max_marks: number;
  awarded_marks: number;
  expected_answer: string;
  strengths: string;
  improvements: string;
  suggestions: string[];
};

export async function chatAnswerSheet(input: {
  subject?: string;
  questions: QPQuestion[];
  messages: AnswerSheetChatMessage[];
  targetQuestion?: string;
  images: File[];
}): Promise<AnswerSheetChatResponse> {
  const form = new FormData();
  form.append("subject", input.subject ?? "");
  form.append("questions", JSON.stringify(input.questions ?? []));
  form.append("messages", JSON.stringify(input.messages ?? []));
  form.append("target_question", input.targetQuestion ?? "");
  input.images.forEach((f) => form.append("images", f));
  const res = await fetch(`${API_URL}/exam/answer-sheet/chat`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<AnswerSheetChatResponse>;
}

export async function analyzeAnswerSheet(input: {
  file: File;
  subject?: string;
  questions: QPQuestion[];
}): Promise<AnswerSheetAnalysis> {
  const form = new FormData();
  form.append("subject", input.subject ?? "");
  form.append("questions", JSON.stringify(input.questions ?? []));
  form.append("file", input.file);
  const res = await fetch(`${API_URL}/exam/analyze-answer-sheet`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<AnswerSheetAnalysis>;
}

export async function fetchFinalExamDetail(id: number): Promise<FinalExamDetail> {
  const res = await fetch(`${API_URL}/exam/final/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<FinalExamDetail>;
}

export async function fetchFinalExams(teacher = ""): Promise<FinalExam[]> {
  const url = teacher
    ? `${API_URL}/exam/final/list?teacher=${encodeURIComponent(teacher)}`
    : `${API_URL}/exam/final/list`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  const body = await res.json();
  return (body.exams ?? []) as FinalExam[];
}

export async function summarizeSyllabus(
  subject: string,
  file: File,
): Promise<SummarizeSyllabusResult> {
  const form = new FormData();
  form.append("subject", subject);
  form.append("file", file);
  const res = await fetch(`${API_URL}/exam/summarize-syllabus`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<SummarizeSyllabusResult>;
}

export async function saveExamSummary(input: {
  name: string;
  image_urls: string[];
  summary_md: string;
}): Promise<SaveExamResult> {
  const res = await fetch(`${API_URL}/exam/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<SaveExamResult>;
}
