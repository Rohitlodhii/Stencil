/** Typed client for the exam/syllabus backend (FastAPI on :8001). */

import { localServiceUrl } from "@/lib/service-url";

export const API_URL =
  import.meta.env.VITE_API_URL ?? localServiceUrl(8001);

export type StencilStatus = {
  status: "ok" | "degraded";
  demo_mode: boolean;
  ai: { available: boolean; model: string };
  scanner: { available: boolean; url: string; error: string };
  database: { available: boolean; error: string };
  storage: {
    available: boolean;
    s3_available: boolean;
    mode: "local" | "s3";
    local_demo_available: boolean;
    bucket: string;
    error: string;
  };
};

export async function fetchStencilStatus(): Promise<StencilStatus> {
  const res = await fetch(`${API_URL}/status`);
  if (!res.ok) {
    throw new Error(`Status service failed with HTTP ${res.status}.`);
  }
  return res.json() as Promise<StencilStatus>;
}

export type DemoMetric = {
  value: number | null;
  display: string;
  note: string;
};

export type DemoReport = {
  generated_at: string;
  scope: string;
  metrics: {
    test_pages: DemoMetric;
    successful_captures: DemoMetric;
    rejected_images: DemoMetric;
    question_matching: DemoMetric;
    validation_warnings: DemoMetric;
    saved_evaluations: DemoMetric;
  };
  sequence: Array<{
    key: string;
    label: string;
    status: "complete" | "ready" | "available" | "live_ai" | "demo";
    detail: string;
  }>;
  dashboard: EvaluationDashboard;
  measurement_notes: string[];
};

export async function fetchDemoReport(): Promise<DemoReport> {
  const res = await fetch(`${API_URL}/demo/report`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Demo report failed with HTTP ${res.status}.`);
  }
  return res.json() as Promise<DemoReport>;
}

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
  quality?: {
    passed: boolean;
    width: number;
    height: number;
    blur_score: number;
    contrast_score: number;
    border_ink_ratio: number;
    warnings: EvaluationWarning[];
  };
};

export type EvaluationWarning = {
  code: string;
  severity: "warning" | "error";
  message: string;
  q_no?: string;
  confidence?: "low" | "medium" | "high";
};

export type AnswerEvaluationItem = {
  q_no: string;
  question_text: string;
  association: string;
  max_marks: number;
  suggested_marks: number;
  final_marks: number | null;
  override_reason: string;
  confidence: number;
  reason: string;
  strengths: string;
  improvements: string;
  unchecked: boolean;
  flags: string[];
  feedback: string;
};

export type AnswerSheetAnalysis = {
  model: string;
  mode: "ai" | "demo";
  notice: string;
  final_exam_id: number;
  student_index: number;
  student_name: string;
  max_marks: number;
  suggested_marks: number;
  expected_answer: string;
  strengths: string;
  improvements: string;
  evaluations: AnswerEvaluationItem[];
  warnings: EvaluationWarning[];
};

export type MarksProgress = {
  total_students: number;
  evaluated_students: number;
  remaining_students: number;
  percent: number;
};

export type ModerationStatus = "pending" | "reviewed" | "resolved";

export type EvaluationDashboard = {
  summary: {
    total_assigned_students: number;
    completed_evaluations: number;
    pending_evaluations: number;
    evaluations_with_warnings: number;
    average_awarded_marks: number;
    scripts_needing_review: number;
  };
  examiner_progress: Array<{
    examiner: string;
    assigned: number;
    completed: number;
    pending: number;
    percent: number;
  }>;
  moderation: Array<{
    final_exam_id: number;
    student_index: number;
    student_session_id: string;
    student_name: string;
    subject_name: string;
    final_marks: number;
    maximum_marks: number;
    warning_types: string[];
    warning_details: Array<{ code: string; message: string }>;
    examiner: string;
    status: ModerationStatus;
    override_count: number;
    updated_at: string;
  }>;
  notice: string;
};

export async function fetchEvaluationDashboard(
  teacher = "",
): Promise<EvaluationDashboard> {
  const query = teacher ? `?teacher=${encodeURIComponent(teacher)}` : "";
  const res = await fetch(`${API_URL}/exam/dashboard${query}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Dashboard request failed with HTTP ${res.status}.`);
  }
  return res.json() as Promise<EvaluationDashboard>;
}

export async function updateModerationStatus(
  finalExamId: number,
  studentIndex: number,
  status: ModerationStatus,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/exam/moderation/${finalExamId}/${studentIndex}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Moderation update failed with HTTP ${res.status}.`);
  }
}

export type SavedStudentMark = {
  id: number;
  final_exam_id: number;
  student_index: number;
  student_name: string;
  answer_sheet_urls: string[];
  evaluations_json: AnswerEvaluationItem[];
  awarded_marks: number;
  max_marks: number;
  feedback: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  validation_warnings?: EvaluationWarning[];
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

export async function analyzeAnswerSheet(input: {
  final_exam_id: number;
  student_index: number;
  student_name: string;
  image_urls: string[];
}): Promise<AnswerSheetAnalysis> {
  const res = await fetch(`${API_URL}/exam/analyze-answer-sheet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    if (detail && typeof detail === "object" && Array.isArray(detail.issues)) {
      throw new Error(detail.issues.map((issue: EvaluationWarning) => issue.message).join(" "));
    }
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<AnswerSheetAnalysis>;
}

export async function fetchStudentMark(
  finalExamId: number,
  studentIndex: number,
): Promise<SavedStudentMark | null> {
  const res = await fetch(
    `${API_URL}/exam/marks?final_exam_id=${finalExamId}&student_index=${studentIndex}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    if (detail && typeof detail === "object" && Array.isArray(detail.issues)) {
      throw new Error(detail.issues.map((issue: EvaluationWarning) => issue.message).join(" "));
    }
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  const body = await res.json();
  return (body.mark ?? null) as SavedStudentMark | null;
}

export async function fetchMarksProgress(
  finalExamId: number,
): Promise<MarksProgress> {
  const res = await fetch(
    `${API_URL}/exam/marks/progress?final_exam_id=${finalExamId}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json() as Promise<MarksProgress>;
}

export async function saveStudentMark(input: {
  final_exam_id: number;
  student_index: number;
  student_name: string;
  answer_sheet_urls: string[];
  evaluations: AnswerEvaluationItem[];
  awarded_marks: number;
  max_marks: number;
  feedback: string;
  updated_by: string;
}): Promise<SavedStudentMark> {
  const res = await fetch(`${API_URL}/exam/marks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `Request failed with status ${res.status}`;
    if (detail && typeof detail === "object" && Array.isArray(detail.issues)) {
      throw new Error(detail.issues.map((issue: EvaluationWarning) => issue.message).join(" "));
    }
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  const body = await res.json();
  return body.mark as SavedStudentMark;
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
