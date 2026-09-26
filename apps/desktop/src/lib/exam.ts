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
