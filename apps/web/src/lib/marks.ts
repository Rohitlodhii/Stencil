/** Typed client for teacher-entered per-student marks (exam backend, /exam/marks). */

import { API_URL } from "@/lib/exam";

export type QuestionMarkItem = {
  q_no: string;
  max_marks: number;
  obtained: number;
};

export type StudentMarks = {
  exam_id: number;
  student_dataset_id: number;
  row_index: number;
  student_name: string;
  marks: QuestionMarkItem[];
  total_obtained: number;
  updated_at: string;
};

async function parseError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail ?? `Request failed with status ${res.status}`;
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

export async function saveStudentMarks(input: {
  exam_id: number;
  student_dataset_id: number;
  row_index: number;
  student_name: string;
  marks: QuestionMarkItem[];
  total_obtained: number;
}): Promise<StudentMarks> {
  const res = await fetch(`${API_URL}/exam/marks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as StudentMarks;
}

export async function fetchExamMarks(
  examId: number,
  datasetId: number,
): Promise<StudentMarks[]> {
  const res = await fetch(
    `${API_URL}/exam/marks?exam_id=${examId}&student_dataset_id=${datasetId}`,
  );
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  return (body.marks ?? []) as StudentMarks[];
}
