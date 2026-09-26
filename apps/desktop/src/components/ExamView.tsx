import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CodeXml, Eye, FilePlus2, FileText, Loader2, Pencil, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  analyzeQuestionPaper,
  createFinalExam,
  saveExamSummary,
  summarizeSyllabus,
  type FinalExamCreated,
  type QPQuestion,
  type QuestionPaperResult,
  type SaveExamResult,
  type SummarizeSyllabusResult,
} from "@/lib/exam";
import { fetchTeacherRequests } from "@/lib/auth";
import {
  fetchStudentDatasets,
  type StudentDataset,
} from "@/lib/students";
import { FieldSelect } from "@/components/FieldSelect";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCached, hashFile, setCached } from "@/lib/analysisCache";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function qpMeta(q: QPQuestion): string {
  return (
    [
      q.section ? `Section ${q.section}` : null,
      q.marks !== null && q.marks !== undefined ? `${q.marks} marks` : null,
      q.page ? `Page ${q.page}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  );
}

function qpLabel(q: QPQuestion, depth: number, index: number): string {
  const n = q.q_no || String(index + 1);
  return depth === 0 ? `Q${n}` : `(${n})`;
}

/** Read-only nested question tree for the preview. */
function QpPreviewNode({
  q,
  depth,
  index,
}: {
  q: QPQuestion;
  depth: number;
  index: number;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex gap-3">
        <span className="shrink-0 font-semibold">{qpLabel(q, depth, index)}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="leading-relaxed">{q.text || "—"}</p>
          <p className="text-xs text-muted-foreground">{qpMeta(q)}</p>
        </div>
      </div>
      {(q.sub_questions ?? []).length > 0 && (
        <div className="ml-6 flex flex-col gap-3 border-l py-3 pl-4">
          {q.sub_questions.map((s, si) => (
            <QpPreviewNode key={si} q={s} depth={depth + 1} index={si} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One question as a text card with icon-only edit/delete (edit mode, no inputs). */
function QpQuestionCard({
  q,
  depth,
  index,
  path,
  onEdit,
  onDelete,
}: {
  q: QPQuestion;
  depth: number;
  index: number;
  path: number[];
  onEdit: (path: number[]) => void;
  onDelete: (path: number[]) => void;
}) {
  const meta = qpMeta(q);
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-center gap-1">
        <span className="font-semibold">{qpLabel(q, depth, index)}</span>
        {meta !== "—" && (
          <span className="text-xs text-muted-foreground">{meta}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(path)}
            aria-label="Edit question"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(path)}
            aria-label="Remove question"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{q.text || "—"}</p>
      {(q.sub_questions ?? []).length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {(q.sub_questions ?? []).map((s, si) => (
            <QpQuestionCard
              key={si}
              q={s}
              depth={depth + 1}
              index={si}
              path={[...path, si]}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExamView({ token }: { token?: string }) {
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummarizeSyllabusResult | null>(null);
  const [saved, setSaved] = useState<SaveExamResult | null>(null);
  const [editedMd, setEditedMd] = useState("");
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [qpPaperOpen, setQpPaperOpen] = useState(false);
  const [qpEditing, setQpEditing] = useState(false);
  const [syllabusCached, setSyllabusCached] = useState(false);
  const [qpCached, setQpCached] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- question paper phase ----
  const [qpFile, setQpFile] = useState<File | null>(null);
  const [qpDragging, setQpDragging] = useState(false);
  const [qpLoading, setQpLoading] = useState(false);
  const [qpResult, setQpResult] = useState<QuestionPaperResult | null>(null);
  const [qpSubject, setQpSubject] = useState("");
  const [qpTotalMarks, setQpTotalMarks] = useState("");
  const [qpTotalQ, setQpTotalQ] = useState("");
  const [qpQuestions, setQpQuestions] = useState<QPQuestion[]>([]);
  const [qpAccepted, setQpAccepted] = useState(false);
  const qpInputRef = useRef<HTMLInputElement | null>(null);

  // ---- assign + create phase ----
  const [teachers, setTeachers] = useState<string[]>([]);
  const [assignTeacher, setAssignTeacher] = useState("");
  const [datasets, setDatasets] = useState<StudentDataset[]>([]);
  const [assignDatasetId, setAssignDatasetId] = useState("");
  const [creating, setCreating] = useState(false);
  const [finalCreated, setFinalCreated] =
    useState<FinalExamCreated | null>(null);

  const MAX_PDF_BYTES = 5 * 1024 * 1024;
  const MAX_QP_BYTES = 10 * 1024 * 1024;

  const pickPdf = (picked: File | null | undefined) => {
    setError(null);
    if (!picked) return;
    const isPdf =
      picked.type === "application/pdf" ||
      picked.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setError("Only PDF files are allowed.");
      return;
    }
    if (picked.size > MAX_PDF_BYTES) {
      setError("PDF must be 5 MB or smaller.");
      return;
    }
    setFile(picked);
  };

  const clearFile = () => {
    setFile(null);
    setPreviewOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetAll = () => {
    setSubject("");
    clearFile();
    setSummary(null);
    setSaved(null);
    setEditedMd("");
    setEditing(false);
    setError(null);
    setQpFile(null);
    setQpResult(null);
    setQpSubject("");
    setQpTotalMarks("");
    setQpTotalQ("");
    setQpQuestions([]);
    setQpAccepted(false);
    setAssignTeacher("");
    setAssignDatasetId("");
    setFinalCreated(null);
    setSyllabusCached(false);
    setQpCached(false);
    setQpEditing(false);
    if (qpInputRef.current) qpInputRef.current.value = "";
  };

  // load teacher + student options once the assign step is reached
  useEffect(() => {
    if (!qpAccepted || !saved) return;
    if (token) {
      fetchTeacherRequests(token, "approved")
        .then((d) => setTeachers(d.requests.map((r) => r.name)))
        .catch(() => setTeachers([]));
    }
    fetchStudentDatasets()
      .then(setDatasets)
      .catch(() => setDatasets([]));
  }, [qpAccepted, saved, token]);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const qpObjectUrl = useMemo(
    () => (qpFile ? URL.createObjectURL(qpFile) : null),
    [qpFile],
  );

  useEffect(() => {
    return () => {
      if (qpObjectUrl) URL.revokeObjectURL(qpObjectUrl);
    };
  }, [qpObjectUrl]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSummary(null);
    setSaved(null);
    setSyllabusCached(false);
    if (!subject.trim()) {
      setError("Please type a subject name.");
      return;
    }
    if (!file) {
      setError("Please upload the syllabus PDF.");
      return;
    }
    setLoading(true);
    try {
      // same file as before? reuse the previous AI result, skip S3 + AI.
      const hash = await hashFile(file);
      const hit = getCached<SummarizeSyllabusResult>("syllabus", hash, file.name);
      if (hit) {
        setSummary(hit.result);
        setEditedMd(hit.result.summary_md);
        setSyllabusCached(true);
        return;
      }
      const res = await summarizeSyllabus(subject.trim(), file);
      setCached("syllabus", file, hash, res);
      setSummary(res);
      setEditedMd(res.summary_md);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const onAccept = async () => {
    if (!summary) return;
    setError(null);
    setAccepting(true);
    try {
      const res = await saveExamSummary({
        name: summary.subject,
        image_urls: summary.pages.map((p) => p.image_url),
        summary_md: editedMd,
      });
      setSaved(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the exam.");
    } finally {
      setAccepting(false);
    }
  };

  // ---- question paper handlers ----
  const pickQpPdf = (picked: File | null | undefined) => {
    setError(null);
    if (!picked) return;
    const isPdf =
      picked.type === "application/pdf" ||
      picked.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setError("Only PDF files are allowed.");
      return;
    }
    if (picked.size > MAX_QP_BYTES) {
      setError("Question paper must be 10 MB or smaller.");
      return;
    }
    setQpFile(picked);
  };

  const clearQpFile = () => {
    setQpFile(null);
    if (qpInputRef.current) qpInputRef.current.value = "";
  };

  const onAnalyzeQp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qpFile || !saved) return;
    setError(null);
    setQpResult(null);
    setQpCached(false);
    setQpLoading(true);
    try {
      // same file as before? reuse the previous AI result, skip S3 + AI.
      const hash = await hashFile(qpFile);
      const hit = getCached<QuestionPaperResult>("question-paper", hash, qpFile.name);
      const res = hit
        ? hit.result
        : await analyzeQuestionPaper(qpFile, saved.name);
      if (!hit) setCached("question-paper", qpFile, hash, res);
      else setQpCached(true);
      setQpEditing(false);
      setQpResult(res);
      setQpSubject(res.subject_name || saved.name);
      setQpTotalMarks(String(res.total_marks ?? 0));
      setQpTotalQ(String(res.total_questions || res.questions.length));
      setQpQuestions((res.questions ?? []).map(normalizeQ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setQpLoading(false);
    }
  };

  const normalizeQ = (q: QPQuestion): QPQuestion => ({
    q_no: q.q_no ?? "",
    section: q.section ?? "",
    text: q.text ?? "",
    marks: q.marks ?? null,
    page: q.page ?? null,
    sub_questions: Array.isArray(q.sub_questions)
      ? q.sub_questions.map(normalizeQ)
      : [],
  });

  const mapAtPath = (
    qs: QPQuestion[],
    path: number[],
    fn: (q: QPQuestion) => QPQuestion,
  ): QPQuestion[] =>
    qs.map((q, i) => {
      if (i !== path[0]) return q;
      if (path.length === 1) return fn(q);
      return { ...q, sub_questions: mapAtPath(q.sub_questions, path.slice(1), fn) };
    });

  const updateQAt = (path: number[], patch: Partial<QPQuestion>) => {
    setQpQuestions((qs) => mapAtPath(qs, path, (q) => ({ ...q, ...patch })));
  };

  const removeQAt = (path: number[]) => {
    setQpQuestions((qs) => {
      const rec = (list: QPQuestion[], depth: number): QPQuestion[] =>
        list.filter((_, i) => i !== path[depth]).map((q) => ({
          ...q,
          sub_questions:
            depth + 1 < path.length ? rec(q.sub_questions, depth + 1) : q.sub_questions,
        }));
      // only recount top-level total when a top-level question is removed
      const next = rec(qs, 0);
      if (path.length === 1) setQpTotalQ(String(next.length));
      return next;
    });
  };

  // single-question edit dialog
  const [editingPath, setEditingPath] = useState<number[] | null>(null);
  const [editDraft, setEditDraft] = useState({
    q_no: "",
    section: "",
    text: "",
    marks: "",
  });

  const getNode = (qs: QPQuestion[], path: number[]): QPQuestion | null => {
    let list = qs;
    let node: QPQuestion | null = null;
    for (const i of path) {
      node = list[i] ?? null;
      if (!node) return null;
      list = node.sub_questions ?? [];
    }
    return node;
  };

  const openEdit = (path: number[]) => {
    const node = getNode(qpQuestions, path);
    if (!node) return;
    setEditDraft({
      q_no: node.q_no,
      section: node.section,
      text: node.text,
      marks:
        node.marks === null || node.marks === undefined
          ? ""
          : String(node.marks),
    });
    setEditingPath(path);
  };

  const saveEdit = () => {
    if (!editingPath) return;
    updateQAt(editingPath, {
      q_no: editDraft.q_no,
      section: editDraft.section,
      text: editDraft.text,
      marks: editDraft.marks === "" ? null : Number(editDraft.marks),
    });
    setEditingPath(null);
  };

  const editingLabel = (): string => {
    if (!editingPath) return "question";
    const node = getNode(qpQuestions, editingPath);
    if (!node) return "question";
    const depth = editingPath.length - 1;
    return qpLabel(node, depth, editingPath[editingPath.length - 1]);
  };


  const addQ = () => {
    setQpQuestions((qs) => {
      const next = [
        ...qs,
        { q_no: String(qs.length + 1), section: "", text: "", marks: null, page: null, sub_questions: [] },
      ];
      setQpTotalQ(String(next.length));
      return next;
    });
  };

  const onCreateFinal = async () => {
    if (!saved || qpQuestions.length === 0) return;
    if (!assignTeacher.trim()) {
      setError("Please select a teacher.");
      return;
    }
    if (!assignDatasetId) {
      setError("Please select a student list.");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const ds = datasets.find((d) => String(d.id) === assignDatasetId);
      const res = await createFinalExam({
        subject_name: qpSubject.trim() || saved.name,
        syllabus_exam_id: saved.id,
        syllabus_summary: editedMd,
        questions: qpQuestions,
        total_marks: Number(qpTotalMarks) || 0,
        total_questions: Number(qpTotalQ) || qpQuestions.length,
        question_pages: qpResult?.pages ?? [],
        assigned_teacher: assignTeacher.trim(),
        student_dataset_id: ds ? ds.id : null,
        student_label: ds
          ? `${ds.subject_name} · ${ds.branch} Sem ${ds.semester} (${ds.row_count} students)`
          : "",
      });
      setFinalCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the exam.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <FilePlus2 className="size-7" />
        <h1 className="font-title text-3xl font-bold leading-none tracking-tight">
          Create exam
        </h1>
      </div>

      {!summary && (
      <div className="flex w-full flex-1 items-center justify-center">
      <div className="flex w-full flex-col gap-6">

        <Card className="border-0 bg-sidebar shadow-none">
          <CardHeader>
            <CardTitle className="font-title text-xl font-bold tracking-tight">
              Syllabus upload
            </CardTitle>
            <CardDescription>
              Upload the syllabus related to exam in the pdf format
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Subject name</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Mathematics"
                className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Syllabus PDF</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => pickPdf(e.target.files?.[0])}
                className="hidden"
              />
              {file ? (
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                    >
                      <span className="rounded-sm bg-secondary p-2 text-secondary-foreground">
                        <FileText className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {file.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB · Click to preview
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={clearFile}
                      aria-label="Remove file"
                      className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </Card>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      fileInputRef.current?.click();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    pickPdf(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex h-48 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 text-center transition-colors ${
                    dragging
                      ? "border-primary bg-accent"
                      : "text-muted-foreground hover:border-ring hover:bg-accent/50"
                  }`}
                >
                  <span className="flex aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                    <Upload className="size-5" />
                  </span>
                  <p className="text-sm">
                    Drop syllabus in PDF format · max size 5 MB
                  </p>
                  <p className="text-xs">or click to browse</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={loading} className="p-1 pr-4 cursor-pointer">
                <span className="flex h-full justify-center aspect-square items-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                </span>
                {loading ? "Uploading & analysing…" : "Create exam"}
                <Kbd className="h-4 border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] text-primary-foreground">
                  Enter
                </Kbd>
              </Button>
            </div>
            {loading && (
              <p className="text-sm text-muted-foreground">
                This can take a while: PDF → page images → S3 → AI analysis
                per page → summary.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          </CardContent>
        </Card>
        </div>
      </div>
      )}

      {summary && !saved && (
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-0 bg-sidebar pt-0 shadow-none">
            <CardHeader
              className="flex shrink-0 items-center border-b bg-accent px-4"
              style={{ height: 48, paddingTop: 0, paddingBottom: 0 }}
            >
              <div className="flex h-full w-full items-center gap-2">
                <CardTitle className="font-title flex items-center text-sm font-bold tracking-tight">
                  Summary for {summary.subject}
                  {syllabusCached && (
                    <span className="ml-2 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Previous analysis — skipped re-upload
                    </span>
                  )}
                </CardTitle>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPreviewOpen(true)}
                  className="ml-auto h-7 cursor-pointer text-xs"
                >
                  <FileText className="size-3.5" />
                  View Syllabus
                </Button>
                <div className="flex items-center rounded-md border border-input p-0.5">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    aria-pressed={!editing}
                    title="Preview"
                    className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium transition-colors ${
                      !editing
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Eye className="size-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-pressed={editing}
                    title="Edit"
                    className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium transition-colors ${
                      editing
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <CodeXml className="size-3" />
                    Edit
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="no-scrollbar min-h-0 flex-1 overflow-y-auto pt-6">
              {editing ? (
                <MarkdownEditor initialMd={editedMd} onChange={setEditedMd} />
              ) : (
                <div className="md-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editedMd}
                  </ReactMarkdown>
                </div>
              )}
            </CardContent>
          </Card>
          {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}
          <div className="flex shrink-0 items-center justify-between">
            <Button
              type="button"
              variant="secondary"
              onClick={resetAll}
              className="cursor-pointer"
            >
              ← Start over
            </Button>
            <Button
              type="button"
              onClick={onAccept}
              disabled={accepting}
              className="cursor-pointer"
            >
              <span className="flex aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                {accepting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
              </span>
              {accepting ? "Saving…" : "Accept summary"}
              <Kbd className="h-4 border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] text-primary-foreground">
                Enter
              </Kbd>
            </Button>
          </div>
        </section>
      )}

      {summary && saved && !qpResult && (
        <section className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Syllabus “{saved.name}” saved (id #{saved.id}) — next, upload the
            question paper.
          </p>
          <Card className="border-0 bg-sidebar shadow-none">
            <CardHeader>
              <CardTitle className="font-title text-xl font-bold tracking-tight">
                Question paper upload
              </CardTitle>
              <CardDescription>
                Upload the question paper in PDF format — it will be converted
                to images, stored on S3 and analysed by AI into structured data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onAnalyzeQp} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Question paper PDF</span>
                  <input
                    ref={qpInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => pickQpPdf(e.target.files?.[0])}
                    className="hidden"
                  />
                  {qpFile ? (
                    <Card className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="rounded-sm bg-secondary p-2 text-secondary-foreground">
                            <FileText className="size-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {qpFile.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {(qpFile.size / 1024).toFixed(1)} KB
                            </span>
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={clearQpFile}
                          aria-label="Remove file"
                          className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    </Card>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => qpInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          qpInputRef.current?.click();
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setQpDragging(true);
                      }}
                      onDragLeave={() => setQpDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setQpDragging(false);
                        pickQpPdf(e.dataTransfer.files?.[0]);
                      }}
                      className={`flex h-48 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 text-center transition-colors ${
                        qpDragging
                          ? "border-primary bg-accent"
                          : "text-muted-foreground hover:border-ring hover:bg-accent/50"
                      }`}
                    >
                      <span className="flex aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                        <Upload className="size-5" />
                      </span>
                      <p className="text-sm">
                        Drop question paper in PDF format · max size 10 MB
                      </p>
                      <p className="text-xs">or click to browse</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={resetAll}
                    className="cursor-pointer"
                  >
                    ← Start over
                  </Button>
                  <Button
                    type="submit"
                    disabled={qpLoading || !qpFile}
                    className="cursor-pointer p-1 pr-4"
                  >
                    <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                      {qpLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                    </span>
                    {qpLoading ? "Uploading & analysing…" : "Analyse paper"}
                    <Kbd className="h-4 border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] text-primary-foreground">
                      Enter
                    </Kbd>
                  </Button>
                </div>
                {qpLoading && (
                  <p className="text-sm text-muted-foreground">
                    This can take a while: PDF → page images → S3 → AI reads
                    each page with previous pages as context → merged structure.
                  </p>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </form>
            </CardContent>
          </Card>
        </section>
      )}

      {summary && saved && qpResult && !qpAccepted && (
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-0 bg-sidebar pt-0 shadow-none">
            <CardHeader
              className="flex shrink-0 items-center border-b bg-accent px-4"
              style={{ height: 48, paddingTop: 0, paddingBottom: 0 }}
            >
              <div className="flex h-full w-full items-center gap-2">
                <CardTitle className="font-title flex items-center text-sm font-bold tracking-tight">
                  Check extracted paper
                  {qpCached && (
                    <span className="ml-2 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Previous analysis
                    </span>
                  )}
                </CardTitle>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setQpPaperOpen(true)}
                  className="ml-auto h-7 cursor-pointer text-xs"
                >
                  <FileText className="size-3.5" />
                  View Paper
                </Button>
                <div className="flex items-center rounded-md border border-input p-0.5">
                  <button
                    type="button"
                    onClick={() => setQpEditing(false)}
                    aria-pressed={!qpEditing}
                    title="Preview"
                    className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium transition-colors ${
                      !qpEditing
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Eye className="size-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setQpEditing(true)}
                    aria-pressed={qpEditing}
                    title="Edit"
                    className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium transition-colors ${
                      qpEditing
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <CodeXml className="size-3" />
                    Edit
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="no-scrollbar min-h-0 flex-1 overflow-y-auto pt-6">
              {!qpEditing ? (
                <div className="flex flex-col gap-5 text-sm">
                  <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                    <div className="flex gap-2">
                      <dt className="shrink-0 font-medium">Subject Name</dt>
                      <dd className="text-muted-foreground">
                        – {qpSubject || "—"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 font-medium">Total Marks</dt>
                      <dd className="text-muted-foreground">
                        – {qpTotalMarks || "—"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 font-medium">Total Questions</dt>
                      <dd className="text-muted-foreground">
                        – {qpTotalQ || qpQuestions.length}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 font-medium">Pages</dt>
                      <dd className="text-muted-foreground">
                        – {qpResult.pages.length}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-col">
                    {qpQuestions.map((q, i) => (
                      <div
                        key={i}
                        className="border-t py-3 first:border-t-0 first:pt-0"
                      >
                        <QpPreviewNode q={q} depth={0} index={i} />
                      </div>
                    ))}
                    {qpQuestions.length === 0 && (
                      <p className="text-muted-foreground">
                        No questions extracted.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Subject name</span>
                      <input
                        type="text"
                        value={qpSubject}
                        onChange={(e) => setQpSubject(e.target.value)}
                        className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Total marks</span>
                      <input
                        type="number"
                        min={0}
                        value={qpTotalMarks}
                        onChange={(e) => setQpTotalMarks(e.target.value)}
                        className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Total questions</span>
                      <input
                        type="number"
                        min={0}
                        value={qpTotalQ}
                        onChange={(e) => setQpTotalQ(e.target.value)}
                        className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-3">
                    {qpQuestions.map((q, i) => (
                      <QpQuestionCard
                        key={i}
                        q={q}
                        depth={0}
                        index={i}
                        path={[i]}
                        onEdit={openEdit}
                        onDelete={removeQAt}
                      />
                    ))}
                    {qpQuestions.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No questions — add one below.
                      </p>
                    )}
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const idx = qpQuestions.length;
                        addQ();
                        setEditDraft({
                          q_no: String(idx + 1),
                          section: "",
                          text: "",
                          marks: "",
                        });
                        setEditingPath([idx]);
                      }}
                      className="h-8 cursor-pointer text-xs"
                    >
                      + Add question
                    </Button>
                  </div>

                  <Dialog
                    open={editingPath !== null}
                    onOpenChange={(open) => {
                      if (!open) setEditingPath(null);
                    }}
                  >
                    <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
                      <div className="bg-accent px-6 pt-6 pr-12 pb-4">
                        <DialogTitle>Edit {editingLabel()}</DialogTitle>
                      </div>
                      <div className="flex flex-col gap-4 px-6 py-4">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium">
                            Question no.
                          </span>
                          <input
                            type="text"
                            value={editDraft.q_no}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, q_no: e.target.value }))
                            }
                            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium">Section</span>
                          <input
                            type="text"
                            value={editDraft.section}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, section: e.target.value }))
                            }
                            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium">Marks</span>
                          <input
                            type="number"
                            min={0}
                            value={editDraft.marks}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, marks: e.target.value }))
                            }
                            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">Question text</span>
                        <textarea
                          value={editDraft.text}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, text: e.target.value }))
                          }
                          rows={4}
                          className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </label>
                      </div>
                      <div className="bg-accent flex items-center justify-between px-6 py-4">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditingPath(null)}
                          className="cursor-pointer"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={saveEdit}
                          className="cursor-pointer p-1 pr-4"
                        >
                          <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                            <Check className="size-4" />
                          </span>
                          Save
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>
          {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}
          <div className="flex shrink-0 items-center justify-between">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQpResult(null);
                clearQpFile();
              }}
              className="cursor-pointer"
            >
              ← Re-upload paper
            </Button>
            <Button
              type="button"
              onClick={() => setQpAccepted(true)}
              disabled={qpQuestions.length === 0}
              className="cursor-pointer p-1 pr-4"
            >
              <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                <Check className="size-4" />
              </span>
              Accept paper
                </Button>
              </div>
          <Sheet open={qpPaperOpen} onOpenChange={setQpPaperOpen}>
            <SheetContent
              side="right"
              overlayStyle={{ top: "2rem" }}
              style={{
                top: "calc(2rem + 12px)",
                bottom: 12,
                right: 12,
                height: "auto",
                borderWidth: 1,
                borderRadius: 12,
              }}
              className="w-[780px] sm:max-w-[780px]"
            >
              <SheetHeader className="pr-10">
                <SheetTitle className="truncate">
                  {qpFile?.name ?? "Question paper"}
                </SheetTitle>
                <SheetDescription>
                  {qpFile
                    ? `${(qpFile.size / 1024).toFixed(1)} KB · Question paper PDF preview`
                    : "Question paper PDF preview"}
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
                {qpObjectUrl ? (
                  <iframe
                    src={qpObjectUrl}
                    title="Question paper PDF preview"
                    className="min-h-0 w-full flex-1 rounded-md border"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No file selected.</p>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </section>
      )}

      {summary && saved && qpResult && qpAccepted && !finalCreated && (
        <section className="flex flex-col gap-4">
          <Card className="border-0 bg-sidebar shadow-none">
            <CardHeader>
              <CardTitle className="font-title text-xl font-bold tracking-tight">
                Assign exam
              </CardTitle>
              <CardDescription>
                “{qpSubject || saved.name}” · {qpTotalQ || qpQuestions.length}{" "}
                questions · {qpTotalMarks} marks — pick the teacher and the
                student list
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Teacher</span>
                  {teachers.length > 0 ? (
                    <FieldSelect
                      value={assignTeacher}
                      onChange={setAssignTeacher}
                      placeholder="Select teacher…"
                      options={teachers}
                      ariaLabel="Teacher"
                    />
                  ) : (
                    <input
                      type="text"
                      value={assignTeacher}
                      onChange={(e) => setAssignTeacher(e.target.value)}
                      placeholder="e.g. Prof. Sharma"
                      className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Student list</span>
                  {datasets.length > 0 ? (
                    <FieldSelect
                      value={assignDatasetId}
                      onChange={setAssignDatasetId}
                      placeholder="Select student list…"
                      options={datasets.map((d) => ({
                        value: String(d.id),
                        label: `${d.subject_name} · ${d.branch} Sem ${d.semester} (${d.row_count})`,
                      }))}
                      ariaLabel="Student list"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No saved student lists — upload one from the Students
                      section first.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setQpAccepted(false)}
                  className="cursor-pointer"
                >
                  ← Back to paper
                </Button>
                <Button
                  type="button"
                  onClick={onCreateFinal}
                  disabled={creating}
                  className="cursor-pointer p-1 pr-4"
                >
                  <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                    {creating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                  </span>
                  {creating ? "Creating…" : "Create exam"}
                </Button>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>
        </section>
      )}

      {summary && saved && finalCreated && (
        <section className="flex flex-col gap-4">
          <Card className="border-0 bg-sidebar shadow-none">
            <CardHeader>
              <CardTitle className="font-title text-xl font-bold tracking-tight">
                Exam created
              </CardTitle>
              <CardDescription>
                “{finalCreated.subject_name}” · {finalCreated.total_questions}{" "}
                questions · {finalCreated.total_marks} marks · assigned to{" "}
                {finalCreated.assigned_teacher} (id #{finalCreated.id}) — visible
                on the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-start">
                <Button type="button" onClick={resetAll} className="cursor-pointer">
                  Create another exam
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent
          side="right"
          overlayStyle={{ top: "2rem" }}
          style={{
            top: "calc(2rem + 12px)",
            bottom: 12,
            right: 12,
            height: "auto",
            borderWidth: 1,
            borderRadius: 12,
          }}
          className="w-[780px] sm:max-w-[780px]"
        >
          <SheetHeader className="pr-10">
            <SheetTitle className="truncate">{file?.name ?? "Preview"}</SheetTitle>
            <SheetDescription>
              {file
                ? `${(file.size / 1024).toFixed(1)} KB · Syllabus PDF preview`
                : "Syllabus PDF preview"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            {objectUrl ? (
              <iframe
                src={objectUrl}
                title="Syllabus PDF preview"
                className="min-h-0 w-full flex-1 rounded-md border"
              />
            ) : (
              <p className="text-sm text-muted-foreground">No file selected.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

    </main>
  );
}
