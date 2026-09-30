import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ClipboardCheck,
  Eye,
  FileText,
  BookOpenText,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  fetchFinalExamDetail,
  type FinalExamDetail,
  type QPQuestion,
} from "@/lib/exam";
import {
  fetchStudentDataset,
  fetchStudentRows,
  type StudentDataset,
} from "@/lib/students";
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

function QpNode({ q, depth, index }: { q: QPQuestion; depth: number; index: number }) {
  const label = q.q_no || String(index + 1);
  return (
    <div className="flex flex-col">
      <div className="flex gap-3">
        <span className="shrink-0 font-semibold">
          {depth === 0 ? `Q${label}` : `(${label})`}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="leading-relaxed">{q.text || "—"}</p>
          <p className="text-xs text-muted-foreground">{qpMeta(q)}</p>
        </div>
      </div>
      {(q.sub_questions ?? []).length > 0 && (
        <div className="ml-6 flex flex-col gap-3 border-l py-3 pl-4">
          {q.sub_questions.map((s, si) => (
            <QpNode key={si} q={s} depth={depth + 1} index={si} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CheckExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const examId = Number(id);

  const [exam, setExam] = useState<FinalExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dataset, setDataset] = useState<StudentDataset | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [total, setTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);

  // right-side sheets
  const [qpSheetOpen, setQpSheetOpen] = useState(false);
  const [syllabusSheetOpen, setSyllabusSheetOpen] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(examId)) {
      setError("Invalid exam id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchFinalExamDetail(examId);
      setExam(detail);

      // linked student dataset -> load its metadata + all rows
      if (detail.student_dataset_id) {
        setRowsLoading(true);
        try {
          const ds = await fetchStudentDataset(detail.student_dataset_id);
          setDataset(ds);
          setRows(ds.preview ?? []);
          setTotal(ds.row_count);
        } catch {
          setDataset(null);
        }
        try {
          if (detail.student_dataset_id) {
            const full = await fetchStudentRows(detail.student_dataset_id);
            setRows(full.rows);
            setTotal(full.total);
          }
        } catch {
          // keep preview
        } finally {
          setRowsLoading(false);
        }
      } else {
        setDataset(null);
        setRows([]);
        setTotal(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load exam.");
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <main className="app-page max-w-6xl">
        <p className="text-sm text-muted-foreground">Loading exam…</p>
      </main>
    );
  }

  if (error || !exam) {
    return (
      <main className="app-page max-w-6xl">
        <button
          type="button"
          onClick={() => navigate("/check-exam")}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Check Exam
        </button>
        <p className="text-sm text-destructive">{error ?? "Not found."}</p>
      </main>
    );
  }

  return (
    <main className="app-page max-w-6xl">
      <button
        type="button"
        onClick={() => navigate("/check-exam")}
        className="flex w-fit cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Check Exam
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-title text-2xl font-semibold leading-tight sm:text-[1.75rem]">
          {exam.subject_name}
        </h1>
        <Badge variant="secondary">#{exam.id}</Badge>
        <Button
          type="button"
          variant="secondary"
          onClick={load}
          className="ml-auto h-7 cursor-pointer text-xs"
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Assigned to {exam.assigned_teacher || "—"} ·{" "}
        {new Date(exam.created_at).toLocaleString()} ·{" "}
        {exam.student_label || "No student list"}
      </p>

      <dl className="grid gap-3 sm:grid-cols-4">
        {[
          { k: "Total questions", v: String(exam.total_questions) },
          { k: "Total marks", v: String(exam.total_marks) },
          { k: "Paper pages", v: String(exam.question_pages.length) },
          { k: "Students", v: total > 0 ? String(total) : exam.student_label || "—" },
        ].map((s) => (
          <Card key={s.k}>
            <CardContent className="flex flex-col gap-1 p-4">
              <span className="text-xs text-muted-foreground">{s.k}</span>
              <span className="truncate text-lg font-bold" title={s.v}>
                {s.v}
              </span>
            </CardContent>
          </Card>
        ))}
      </dl>

      {/* ---- question paper + syllabus shortcut cards ---- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="h-12 flex-row items-center gap-2 px-4 py-0">
          <FileText className="size-5 shrink-0" />
          <span className="font-title min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
            Question paper
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setQpSheetOpen(true)}
            className="h-7 shrink-0 cursor-pointer text-xs"
          >
            <Eye className="size-3.5" />
            Show question paper
          </Button>
        </Card>

        <Card className="h-12 flex-row items-center gap-2 px-4 py-0">
          <BookOpenText className="size-5 shrink-0" />
          <span className="font-title min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
            Syllabus
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setSyllabusSheetOpen(true)}
            className="h-7 shrink-0 cursor-pointer text-xs"
          >
            <Eye className="size-3.5" />
            Show syllabus
          </Button>
        </Card>
      </div>

      {/* ---- right-side sheets ---- */}
      <Sheet open={qpSheetOpen} onOpenChange={setQpSheetOpen}>
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
            <SheetTitle>Question paper — {exam.subject_name}</SheetTitle>
            <SheetDescription>
              {exam.questions.length} questions · {exam.total_marks} marks ·{" "}
              {exam.question_pages.length} scanned pages
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
            {exam.question_pages.length > 0 && (
              <div className="flex flex-col gap-2">
                {exam.question_pages.map((p) => (
                  <a
                    key={p.page}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-md border bg-background"
                  >
                    <img
                      src={p.url}
                      alt={`Question paper page ${p.page}`}
                      loading="lazy"
                      className="w-full object-contain"
                    />
                    <span className="block px-2 py-1 text-xs text-muted-foreground">
                      Page {p.page} · click to open full size
                    </span>
                  </a>
                ))}
              </div>
            )}
            <div className="flex flex-col text-sm">
              {exam.questions.map((q, i) => (
                <div
                  key={i}
                  className="border-t py-3 first:border-t-0 first:pt-0"
                >
                  <QpNode q={q} depth={0} index={i} />
                </div>
              ))}
              {exam.questions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No questions stored.
                </p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={syllabusSheetOpen} onOpenChange={setSyllabusSheetOpen}>
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
            <SheetTitle>Syllabus — {exam.subject_name}</SheetTitle>
            <SheetDescription>
              {exam.syllabus_exam_id
                ? `Linked syllabus #${exam.syllabus_exam_id}`
                : "Syllabus summary saved with this exam"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
            {exam.syllabus_summary ? (
              <div className="md-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {exam.syllabus_summary}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No syllabus summary stored for this exam.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---- students table only (no card, no title) ---- */}
      <section className="flex flex-col gap-3">
        {rowsLoading && (
          <p className="text-sm text-muted-foreground">Loading all rows…</p>
        )}
        {dataset && rows.length > 0 ? (
            <div className="no-scrollbar max-h-[420px] overflow-auto rounded-md border bg-background">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted text-left">
                    <th className="whitespace-nowrap px-3 py-2 font-semibold">
                      Student
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-semibold">
                      Marks obtained
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 font-semibold">
                      Checked
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const obtained = (
                      r[dataset.mapping.obtained_marks] ?? ""
                    ).trim();
                    const checked = obtained !== "";
                    return (
                      <tr key={i} className="border-t align-middle">
                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                          {r[dataset.mapping.student_name] || `Student ${i + 1}`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {obtained || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {checked ? (
                            <Badge className="bg-green-600 text-white">
                              True
                            </Badge>
                          ) : (
                            <Badge variant="destructive">False</Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <Button
                            type="button"
                            onClick={() =>
                              navigate(`/check-exam/${exam.id}/check/${i}`)
                            }
                            className="h-7 cursor-pointer p-1 pr-3 text-xs"
                          >
                            <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                              <ClipboardCheck className="size-3.5" />
                            </span>
                            Check paper
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rowsLoading && rows.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  No rows found.
                </p>
              )}
            </div>
          ) : (
            !rowsLoading && (
              <p className="text-sm text-muted-foreground">
                No student data available for this exam.
              </p>
            )
          )}
      </section>
    </main>
  );
}
