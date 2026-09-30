import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  FileText,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Sparkles,
  TrendingUp,
  Wand2,
  X,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { QpNode } from "./CheckExamDetailPage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  fetchFinalExamDetail,
  type AnswerSheetAnalysis,
  type FinalExamDetail,
  type QPQuestion,
} from "@/lib/exam";
import { fetchStudentDataset, fetchStudentRows } from "@/lib/students";
import { getAnswerSheets, sheetKey } from "@/lib/answerSheets";
import { fetchExamMarks, saveStudentMarks } from "@/lib/marks";
import { PageLoader } from "@/components/loading";
import {
  AnswerSheetChat,
  type ChatGrading,
  type ChatRequest,
} from "@/components/chat/AnswerSheetChat";

/** Prompts the answer-sheet image menu sends into the chat. */
const CHAT_PROMPTS = {
  attach: "",
  askMarks:
    "Look at the attached answer-sheet page and tell me what marks this answer deserves. Match it against the question paper, explain what is right, what is missing, and justify the marks.",
  increase:
    "I think this answer deserves more marks than it got. Re-read the attached page against the question paper and reassess — which parts earn more credit, and what should the final marks be?",
  analyze:
    "Analyze the attached answer-sheet page in detail against the question paper: what the student wrote, what is correct, what is missing, and the marks it should get.",
} as const;

type MarksRow = {
  key: string;
  label: string;
  text: string;
  max: number;
  /** A parent that only groups sub-questions (e.g. Q1 over (a)+(b)) is a
   *  header, not an answerable question — no input, excluded from totals. */
  header: boolean;
};

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Flatten the nested question tree: parents with sub-questions become
 *  header rows; only leaf (answerable) questions get marks inputs. */
function flattenQuestions(
  qs: QPQuestion[],
  parentKey = "",
  parentLabel = "",
): MarksRow[] {
  const out: MarksRow[] = [];
  qs.forEach((q, i) => {
    const n = (q.q_no || String(i + 1)).trim();
    const key = `${parentKey}${normKey(n)}`;
    const label = parentLabel ? `${parentLabel}(${n})` : `Q${n}`;
    const hasSubs = (q.sub_questions ?? []).length > 0;
    out.push({
      key,
      label,
      text: q.text ?? "",
      max: hasSubs ? 0 : (q.marks ?? 0),
      header: hasSubs,
    });
    out.push(...flattenQuestions(q.sub_questions ?? [], key, label));
  });
  return out;
}

const numOrZero = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const inputCls =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function AnswerSheetAnalysisPage() {
  const { id, studentIdx } = useParams<{ id: string; studentIdx: string }>();
  const navigate = useNavigate();
  const examId = Number(id);
  const rowIdx = Number(studentIdx);

  const [exam, setExam] = useState<FinalExamDetail | null>(null);
  const [studentName, setStudentName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noSheets, setNoSheets] = useState(false);

  // pages (in-memory files from the upload step)
  const [files, setFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState(0);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [qpSheetOpen, setQpSheetOpen] = useState(false);

  // per-page AI results (latest grading per page, fed by the chat)
  const [results, setResults] = useState<Record<number, AnswerSheetAnalysis>>({});

  // chat / marks tabs
  const [panelTab, setPanelTab] = useState<"chat" | "marks">("chat");
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // answer-sheet image menus: right-click actions + left-click quick marks.
  // The quick-marks card is fixed-positioned so the preview scroller can never
  // clip it.
  const [queued, setQueued] = useState<ChatRequest | null>(null);
  const [quickMarks, setQuickMarks] = useState<{ x: number; y: number } | null>(null);
  const [quickQ, setQuickQ] = useState("");
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!Number.isFinite(examId) || !Number.isFinite(rowIdx) || rowIdx < 0) {
      setError("Invalid exam or student.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchFinalExamDetail(examId);
      setExam(detail);
      if (!detail.student_dataset_id) {
        throw new Error("No student list linked to this exam.");
      }
      const [ds, full] = await Promise.all([
        fetchStudentDataset(detail.student_dataset_id),
        fetchStudentRows(detail.student_dataset_id),
      ]);
      const row = full.rows[rowIdx];
      if (!row) throw new Error("Student not found.");
      setStudentName(
        (row[ds.mapping.student_name] ?? "").trim() || `Student ${rowIdx + 1}`,
      );
      setDatasetId(ds.id);
      // previously saved teacher marks for this student, if any
      try {
        const all = await fetchExamMarks(examId, ds.id);
        const mine = all.find((m) => m.row_index === rowIdx);
        if (mine) {
          const map: Record<string, string> = {};
          mine.marks.forEach((m) => {
            map[m.q_no] = String(m.obtained);
          });
          setInputs(map);
        } else {
          setInputs({});
        }
      } catch {
        // no saved marks yet — start blank
      }
      const picked = getAnswerSheets(sheetKey(examId, rowIdx));
      if (picked.length === 0) {
        setNoSheets(true);
      } else {
        setNoSheets(false);
        setFiles(picked);
        setSelected(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [examId, rowIdx]);

  useEffect(() => {
    load();
  }, [load]);

  // keyboard shortcuts: P toggles pages, Q toggles question paper,
  // C/S switch the chat / marks tabs,
  // ←/→ switch the previewed page (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setPagesOpen((v) => !v);
      } else if (k === "q") {
        e.preventDefault();
        setQpSheetOpen((v) => !v);
      } else if (k === "c") {
        e.preventDefault();
        setPanelTab("chat");
      } else if (k === "s") {
        e.preventDefault();
        setPanelTab("marks");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelected((prev) => Math.min(prev + 1, files.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected((prev) => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length]);

  const previews = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files],
  );

  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

  // ---- marks tab (leaf questions only — parent headers don't count) ----
  const marksRows = useMemo(
    () => flattenQuestions(exam?.questions ?? []),
    [exam],
  );
  const leafRows = useMemo(
    () => marksRows.filter((r) => !r.header),
    [marksRows],
  );
  const totalMax = useMemo(
    () => leafRows.reduce((s, r) => s + (r.max || 0), 0),
    [leafRows],
  );
  const totalObtained = useMemo(
    () => leafRows.reduce((s, r) => s + numOrZero(inputs[r.key] ?? ""), 0),
    [leafRows, inputs],
  );

  const fillFromAI = () => {
    setSaveOk(false);
    setInputs((prev) => {
      const next = { ...prev };
      Object.values(results).forEach((r) => {
        const k = normKey(r.matched_question || "");
        if (!k) return;
        const exact = leafRows.find((m) => m.key === k);
        if (exact) {
          next[exact.key] = String(r.awarded_marks);
          return;
        }
        // AI may answer with just the sub-part (e.g. "a" for "Q1(a)") —
        // use it only when it matches exactly one leaf.
        const cands = leafRows.filter(
          (m) => m.key !== k && m.key.endsWith(k),
        );
        if (cands.length === 1) next[cands[0].key] = String(r.awarded_marks);
      });
      return next;
    });
  };

  /** Latest grading per page, derived from the AI results map (page badges). */
  const applyGrading = useCallback((pageIdxs: number[], g: AnswerSheetAnalysis) => {
    setResults((prev) => {
      const next = { ...prev };
      pageIdxs.forEach((i) => {
        next[i] = g;
      });
      return next;
    });
  }, []);

  /** Accept a chat grading card: fill the marks input for the matched question. */
  const onAcceptMarks = useCallback(
    (g: ChatGrading) => {
      setSaveOk(false);
      const k = normKey(g.matchedQuestion || "");
      if (!k) return;
      setInputs((prev) => {
        const next = { ...prev };
        const exact = leafRows.find((m) => m.key === k);
        if (exact) {
          next[exact.key] = String(g.awardedMarks);
          return next;
        }
        // AI may answer with just the sub-part (e.g. "a" for "Q1(a)") —
        // apply only when it matches exactly one leaf.
        const cands = leafRows.filter((m) => m.key !== k && m.key.endsWith(k));
        if (cands.length === 1) next[cands[0].key] = String(g.awardedMarks);
        return next;
      });
    },
    [leafRows],
  );

  const questionOptions = useMemo(
    () =>
      leafRows.map((r) => ({
        value: r.key,
        label: r.max > 0 ? `${r.label} · ${r.max}m` : r.label,
      })),
    [leafRows],
  );

  /** Send one of the image-menu actions into the chat panel. */
  const queueChat = useCallback(
    (kind: keyof typeof CHAT_PROMPTS, pageIdx: number) => {
      setPanelTab("chat");
      setQueued({
        id: (requestSeq.current += 1),
        text: CHAT_PROMPTS[kind],
        pageIdx,
        attachOnly: kind === "attach",
      });
    },
    [],
  );

  /** Marks row the quick-marks popup fills (null until a question is picked). */
  const quickRow = useMemo(
    () => leafRows.find((r) => r.key === quickQ) ?? null,
    [leafRows, quickQ],
  );

  const applyQuickMarks = (n: number) => {
    if (!quickQ) return;
    setSaveOk(false);
    setInputs((prev) => ({ ...prev, [quickQ]: String(n) }));
    setQuickMarks(null);
  };

  const openQuickMarks = (e: React.MouseEvent<HTMLElement>) => {
    const w = 236;
    const h = 132;
    setQuickMarks({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)),
    });
    setQuickQ((prev) => prev || leafRows[0]?.key || "");
  };

  // Escape closes the quick-marks popup.
  useEffect(() => {
    if (!quickMarks) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuickMarks(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickMarks]);

  const onUpdateMarks = async () => {
    if (!exam || datasetId === null) return;
    setSaveError(null);
    setSaveOk(false);
    setSaving(true);
    try {
      const items = leafRows.map((r) => ({
        q_no: r.key,
        max_marks: r.max || 0,
        obtained: numOrZero(inputs[r.key] ?? ""),
      }));
      const saved = await saveStudentMarks({
        exam_id: exam.id,
        student_dataset_id: datasetId,
        row_index: rowIdx,
        student_name: studentName,
        marks: items,
        total_obtained: totalObtained,
      });
      const map: Record<string, string> = {};
      saved.marks.forEach((m) => {
        map[m.q_no] = String(m.obtained);
      });
      setInputs(map);
      setSaveOk(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-full w-full flex-col gap-6 p-6">
        <PageLoader message="Loading answer sheets…" />
      </main>
    );
  }

  if (error || !exam) {
    return (
      <main className="flex min-h-full w-full flex-col gap-6 p-6">
        <button
          type="button"
          onClick={() => navigate(`/check-exam/${examId}/check/${rowIdx}`)}
          className="flex w-fit cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to upload
        </button>
        <p className="text-sm text-destructive">{error ?? "Not found."}</p>
      </main>
    );
  }

  if (noSheets) {
    return (
      <main className="flex min-h-full w-full flex-col gap-6 p-6">
        <button
          type="button"
          onClick={() => navigate(`/check-exam/${examId}/check/${rowIdx}`)}
          className="flex w-fit cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to upload
        </button>
        <p className="text-sm text-muted-foreground">
          No answer-sheet images found (they are kept in memory — please go
          back and drop the images again, then press Next).
        </p>
      </main>
    );
  }


  return (
    <main className="flex min-h-full w-full flex-col">
      {/* top nav */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate(`/check-exam/${examId}/check/${rowIdx}`)}
          className="h-8 shrink-0 cursor-pointer px-2 text-xs"
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <span className="h-5 w-px shrink-0 bg-border" />
        <h1 className="font-title min-w-0 flex-1 truncate text-base font-bold tracking-tight">
          {studentName}{" "}
          <span className="font-normal text-muted-foreground">
            — Answer sheets
          </span>
        </h1>
        <Badge variant="secondary" className="shrink-0">
          {exam.subject_name}
        </Badge>
        <span className="shrink-0 text-xs text-muted-foreground">
          Page {selected + 1} of {files.length}
        </span>
      </header>

      <div className="flex min-h-[480px] flex-1 flex-col gap-3 p-3 lg:h-[calc(100vh-6.5rem)] lg:flex-row lg:gap-0 lg:overflow-hidden lg:py-3 lg:pl-3 lg:pr-0">
        {/* middle: selected page fullscreen + floating pages dock */}
        <div className="relative flex min-w-0 flex-1 flex-col lg:min-h-0">
          <section className="flex min-h-[320px] min-w-0 flex-1 items-center justify-center overflow-auto rounded-2xl bg-accent p-2 lg:min-h-0">
            {previews[selected] ? (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <img
                    src={previews[selected]}
                    alt={`Answer sheet page ${selected + 1} fullscreen`}
                    onClick={openQuickMarks}
                    className="max-h-full w-full cursor-pointer object-contain"
                  />
                </ContextMenuTrigger>
                <ContextMenuContent className="w-52">
                  <ContextMenuLabel>Page {selected + 1}</ContextMenuLabel>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => queueChat("attach", selected)}>
                    <MessageSquarePlus className="size-4" />
                    Add to chat
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => queueChat("askMarks", selected)}>
                    <BadgeCheck className="size-4" />
                    Ask marks
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => queueChat("increase", selected)}>
                    <TrendingUp className="size-4" />
                    Increase marks
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => queueChat("analyze", selected)}>
                    <Sparkles className="size-4" />
                    Analyze
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              <p className="text-sm text-muted-foreground">No page selected.</p>
            )}
          </section>

          <div className="absolute bottom-3 left-3 z-20 flex gap-2">
            <button
              type="button"
              onClick={() => setPagesOpen((v) => !v)}
              aria-expanded={pagesOpen}
              aria-label={pagesOpen ? "Hide pages panel" : "Show pages panel"}
              title="Answer sheets"
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background/95 px-2.5 text-xs font-medium shadow-lg backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
            >
            <PanelLeft className="size-4" />
            Pages
            <Kbd className="h-4 px-1 text-[9px]">P</Kbd>
          </button>
            <button
              type="button"
              onClick={() => setQpSheetOpen((v) => !v)}
              aria-expanded={qpSheetOpen}
              aria-label={qpSheetOpen ? "Hide question paper" : "Show question paper"}
              title="Question paper"
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background/95 px-2.5 text-xs font-medium shadow-lg backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FileText className="size-4" />
              Paper
              <Kbd className="h-4 px-1 text-[9px]">Q</Kbd>
            </button>
          </div>

          {pagesOpen && (
            <div className="absolute bottom-14 left-3 z-10 max-w-[75%] rounded-xl border bg-background/95 px-2 pt-2 pb-1 shadow-lg backdrop-blur">
              <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                {files.map((_f, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelected(i)}
                    title={`Page ${i + 1}`}
                    className={`w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border bg-background text-left transition-colors ${
                      i === selected
                        ? "border-primary ring-2 ring-primary/40"
                        : "hover:border-ring"
                    }`}
                  >
                    <img
                      src={previews[i]}
                      alt={`Page ${i + 1}`}
                      loading="lazy"
                      className="aspect-[3/4] w-full object-cover"
                    />
                    <span className="block truncate px-1 py-0.5 text-center text-[10px] text-muted-foreground">
                      {i + 1}
                      {results[i] ? (
                        <span className="font-semibold text-green-600">
                          {" "}
                          · {results[i].awarded_marks}/{results[i].max_marks}
                        </span>
                      ) : null}
                    </span>
                    {i === selected && (
                      <span className="sr-only">(selected)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* left-click quick marks — fixed so the preview scroller can't clip it */}
          {quickMarks && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setQuickMarks(null)}
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-label={`Quick marks for page ${selected + 1}`}
                className="fixed z-50 flex w-[236px] flex-col gap-2 rounded-xl border bg-background p-2 shadow-xl"
                style={{ left: quickMarks.x, top: quickMarks.y }}
              >
                <div className="flex items-center gap-1.5">
                  <Select value={quickQ} onValueChange={setQuickQ}>
                    <SelectTrigger
                      size="sm"
                      className="h-6 flex-1 rounded-md px-2 py-0 text-[11px] data-[size=sm]:h-6"
                    >
                      <SelectValue placeholder="Select question…" />
                    </SelectTrigger>
                    <SelectContent>
                      {questionOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setQuickMarks(null)}
                    aria-label="Close quick marks"
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {[1, 2, 3, 4, 5, 6].map((n) => {
                    const capped = quickRow !== null && quickRow.max > 0 && n > quickRow.max;
                    const chosen = quickRow !== null && inputs[quickRow.key] === String(n);
                    return (
                      <button
                        key={n}
                        type="button"
                        disabled={!quickQ || capped}
                        onClick={() => applyQuickMarks(n)}
                        title={
                          quickRow
                            ? `${quickRow.label} · max ${quickRow.max || "—"}`
                            : "Pick a question"
                        }
                        className={`h-7 cursor-pointer rounded-md border text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          chosen
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                <p className="px-0.5 text-[10px] text-muted-foreground">
                  {quickQ
                    ? `${quickRow?.label ?? quickQ}${
                        quickRow && quickRow.max > 0 ? ` · max ${quickRow.max}` : ""
                      } — click a number to set marks`
                    : "Pick a question to set marks"}
                </p>
              </div>
            </>
          )}
        </div>

        {/* right: chat panel — flush against the top nav, no card chrome */}
        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t bg-sidebar p-4 lg:-my-3 lg:min-h-0 lg:w-[48rem] lg:border-l lg:border-t-0">
          <Tabs
            value={panelTab}
            onValueChange={(v) => setPanelTab(v as "chat" | "marks")}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <TabsList className="self-start">
              <TabsTrigger value="chat" className="cursor-pointer">
                Chat
                <Kbd className="h-4 px-1 text-[9px]">C</Kbd>
              </TabsTrigger>
              <TabsTrigger value="marks" className="cursor-pointer">
                Marks
                <Kbd className="h-4 px-1 text-[9px]">S</Kbd>
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="chat"
              forceMount
              className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
            >
              <AnswerSheetChat
                subject={exam.subject_name}
                questions={exam.questions}
                questionOptions={questionOptions}
                files={files}
                previews={previews}
                currentPage={selected}
                onGrading={(g) =>
                  applyGrading(g.pageIdxs, {
                    model: "chat",
                    matched_question: g.matchedQuestion,
                    max_marks: g.maxMarks,
                    awarded_marks: g.awardedMarks,
                    expected_answer: "",
                    strengths: "",
                    improvements: "",
                  })
                }
                onAcceptMarks={onAcceptMarks}
                onJumpToPage={setSelected}
                onReviewMarks={() => setPanelTab("marks")}
                queued={queued}
                onQueuedHandled={() => setQueued(null)}
              />
            </TabsContent>
            <TabsContent
              value="marks"
              className="flex flex-col gap-3 text-sm"
            >
            <div className="flex items-center gap-2">
              <span className="font-title text-lg font-bold tracking-tight">
                Marks
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                Total {totalObtained} / {totalMax}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the marks obtained for each question and sub-question —
              the total is calculated automatically.
            </p>
            {Object.keys(results).length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={fillFromAI}
                className="h-7 w-fit cursor-pointer text-xs"
              >
                <Wand2 className="size-3.5" />
                Fill from AI analysis
              </Button>
            )}
            {leafRows.length > 0 ? (
              <div className="flex flex-col overflow-hidden rounded-md border bg-background">
                <div className="grid grid-cols-[1fr_52px_76px] items-center gap-2 bg-muted px-3 py-1.5 text-xs font-semibold">
                  <span>Question</span>
                  <span className="text-center">Max</span>
                  <span className="text-center">Obtained</span>
                </div>
                {marksRows.map((r) =>
                  r.header ? (
                    <div
                      key={r.key}
                      className="border-t bg-muted/40 px-3 py-1.5 first:border-t-0"
                    >
                      <span className="text-sm font-bold">{r.label}</span>
                      {r.text ? (
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={r.text}
                        >
                          {r.text}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      key={r.key}
                      className="grid grid-cols-[1fr_52px_76px] items-center gap-2 border-t px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-semibold">{r.label}</span>
                        {r.text ? (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={r.text}
                          >
                            {r.text}
                          </p>
                        ) : null}
                      </div>
                      <span className="text-center text-sm text-muted-foreground">
                        {r.max}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={r.max > 0 ? r.max : undefined}
                        step="any"
                      value={inputs[r.key] ?? ""}
                      onChange={(e) => {
                        setSaveOk(false);
                        const raw = e.target.value;
                        const clamped =
                          r.max > 0 && raw !== "" && Number(raw) > r.max
                            ? String(r.max)
                            : raw;
                        setInputs((p) => ({ ...p, [r.key]: clamped }));
                      }}
                        aria-label={`Marks obtained for ${r.label}`}
                        className={inputCls}
                      />
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No questions in this exam.
              </p>
            )}
            {saveError && (
              <p className="text-sm text-destructive">{saveError}</p>
            )}
            {saveOk && (
              <p className="text-sm font-medium text-green-600">
                Marks updated.
              </p>
            )}
            <Button
              type="button"
              onClick={onUpdateMarks}
              disabled={saving || leafRows.length === 0}
              className="w-fit cursor-pointer p-1 pr-4"
            >
              <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
              </span>
              {saving ? "Updating…" : `Update marks (${totalObtained})`}
            </Button>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {/* question paper sheet from the right */}
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
    </main>
  );
}
