/** Typed client for student CSV datasets (exam backend on :8001, via /exam/students). */

import { API_URL } from "@/lib/exam";

export type StudentMapping = {
  student_name: string;
  total_marks: string;
  obtained_marks: string;
  attendance: string;
};

export type StudentDataset = {
  id: number;
  branch: string;
  semester: string;
  assigned_teacher: string;
  subject_name: string;
  original_filename: string;
  s3_url: string;
  s3_key: string;
  columns: string[];
  mapping: StudentMapping;
  row_count: number;
  preview: Record<string, string>[];
  created_at: string;
};

async function parseError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail ?? `Request failed with status ${res.status}`;
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

export async function fetchStudentDatasets(): Promise<StudentDataset[]> {
  const res = await fetch(`${API_URL}/exam/students`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  return (body.datasets ?? []) as StudentDataset[];
}

export async function uploadStudentDataset(input: {
  branch: string;
  semester: string;
  assigned_teacher: string;
  subject_name: string;
  mapping: StudentMapping;
  file: File;
}): Promise<StudentDataset> {
  const form = new FormData();
  form.append("branch", input.branch);
  form.append("semester", input.semester);
  form.append("assigned_teacher", input.assigned_teacher);
  form.append("subject_name", input.subject_name);
  form.append("mapping", JSON.stringify(input.mapping));
  form.append("file", input.file);
  const res = await fetch(`${API_URL}/exam/students/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as StudentDataset;
}

// ---- offline fallback (localStorage) so the page works when the API is down ----
const LS_KEY = "mponline_student_datasets";

export function loadLocalDatasets(): StudentDataset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalDataset(ds: StudentDataset) {
  const list = loadLocalDatasets();
  list.unshift(ds);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage full — ignore
  }
}

export async function fetchStudentDataset(id: number): Promise<StudentDataset> {
  const res = await fetch(`${API_URL}/exam/students/${id}`);
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as StudentDataset;
}

export function loadLocalDataset(id: number): StudentDataset | null {
  return loadLocalDatasets().find((d) => d.id === id) ?? null;
}

export async function fetchStudentRows(id: number): Promise<{
  columns: string[];
  rows: Record<string, string>[];
  total: number;
  truncated: boolean;
}> {
  const res = await fetch(`${API_URL}/exam/students/${id}/rows`);
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as {
    columns: string[];
    rows: Record<string, string>[];
    total: number;
    truncated: boolean;
  };
}

export async function updateStudentDataset(
  id: number,
  input: {
    branch: string;
    semester: string;
    assigned_teacher: string;
    subject_name: string;
    mapping: StudentMapping;
  },
): Promise<StudentDataset> {
  const res = await fetch(`${API_URL}/exam/students/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as StudentDataset;
}

export function updateLocalDataset(
  id: number,
  patch: Partial<StudentDataset>,
): StudentDataset | null {
  const list = loadLocalDatasets();
  const idx = list.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage full — ignore
  }
  return list[idx];
}

// ---- tiny client-side CSV parser (for instant preview + column mapping) ----
export function parseCsvLocal(
  text: string,
  maxRows = 50,
): { columns: string[]; rows: Record<string, string>[]; total: number } {
  const clean = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("CSV is empty.");

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  // support semicolon-separated CSVs too
  const first = lines[0];
  const delimiter =
    (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length
      ? ";"
      : ",";
  const split = (line: string) =>
    delimiter === ";" ? line.split(";").map((s) => s.trim()) : splitLine(line);

  const columns = split(lines[0]).map((c) =>
    c.replace(/^"|"$/g, "").trim(),
  );
  if (columns.length === 0 || columns.every((c) => c === "")) {
    throw new Error("CSV has no header row.");
  }
  const rows: Record<string, string>[] = [];
  let total = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (cells.every((c) => c === "")) continue;
    total++;
    if (rows.length < maxRows) {
      const row: Record<string, string> = {};
      columns.forEach((c, idx) => {
        row[c] = (cells[idx] ?? "").replace(/^"|"$/g, "");
      });
      rows.push(row);
    }
  }
  return { columns, rows, total };
}

/** Guess which CSV column matches each required field. */
export function guessMapping(columns: string[]): StudentMapping {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const find = (needles: string[], exclude: string[] = []) =>
    columns.find((c) => {
      const n = norm(c);
      return (
        needles.some((k) => n.includes(k)) &&
        !exclude.some((k) => n.includes(k))
      );
    }) ?? "";

  const total =
    find(["total", "max", "fullmarks", "outof"]) ||
    find(["marks"], ["obtain", "score", "get"]) ||
    "";
  const obtained =
    find(["obtain", "score", "secured", "get"]) ||
    (columns.find((c) => {
      const n = norm(c);
      return n.includes("mark") && c !== total;
    }) ?? "") ||
    "";
  return {
    student_name:
      find(["studentname", "name", "student", "candidate"]) || columns[0] || "",
    total_marks: total,
    obtained_marks: obtained,
    attendance:
      find(["attend", "present", "absent", "percentage"]) || "",
  };
}
