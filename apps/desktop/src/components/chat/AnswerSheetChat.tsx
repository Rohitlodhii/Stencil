"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  ChevronUp,
  ImagePlus,
  Loader2,
  MessageSquareText,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  chatAnswerSheet,
  type AnswerSheetChatMessage,
  type AnswerSheetChatResponse,
} from "@/lib/exam";

export type ChatGrading = {
  /** Page indexes (into the answer-sheet file list) the grading was based on. */
  pageIdxs: number[];
  matchedQuestion: string;
  maxMarks: number;
  awardedMarks: number;
  accepted: boolean;
};

/** An action requested from outside the chat (answer-sheet image menu) that
 *  must run exactly like a teacher turn. `id` must be unique per request. */
export type ChatRequest = {
  id: number;
  text: string;
  /** Page to attach to this turn (null = no page attached). */
  pageIdx: number | null;
  /** Attach the page and focus the input, without sending anything yet. */
  attachOnly?: boolean;
};

type Bubble =
  | {
      id: number;
      role: "user";
      text: string;
      /** Preview URLs + page indexes of pages attached to this message. */
      images: { url: string; pageIdx: number }[];
    }
  | {
      id: number;
      role: "assistant";
      text: string;
      grading: ChatGrading | null;
      /** Qualitative feedback that accompanies a grading card. */
      analysis: { expected_answer: string; strengths: string; improvements: string } | null;
      suggestions: string[];
    }
  | { id: number; role: "error"; text: string };

let nextId = 1;

/** Shown in the composer until a response reports the model actually used. */
const DEFAULT_MODEL = "gpt-6-luna";

/** Phrases the assistant cycles through while a turn is in flight. */
const THINKING_STEPS = [
  "Thinking…",
  "Evaluating…",
  "Analyzing…",
  "Reading the page…",
  "Matching the question…",
  "Working out the marks…",
];

/** Typing bubble — the dots are replaced by a live status label. */
function ThinkingBubble() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = window.setInterval(
      () => setStep((v) => (v + 1) % THINKING_STEPS.length),
      1600,
    );
    return () => window.clearInterval(t);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex"
    >
      <div
        aria-live="polite"
        className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary px-3 py-2 text-sm text-secondary-foreground"
      >
        <Loader2 className="size-3.5 shrink-0 animate-spin opacity-70" />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={step}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {THINKING_STEPS[step]}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function AnswerSheetChat({
  subject,
  questions,
  questionOptions,
  files,
  previews,
  currentPage,
  queued,
  onGrading,
  onAcceptMarks,
  onJumpToPage,
  onReviewMarks,
  onQueuedHandled,
}: {
  subject: string;
  questions: unknown[];
  /** Leaf question options for the pin select: value = q key, label = Q…. */
  questionOptions: { value: string; label: string }[];
  /** The answer-sheet File objects, indexed by page. */
  files: File[];
  /** Object URLs for every answer-sheet page, indexed by page. */
  previews: string[];
  /** Index of the page currently shown in the left preview. */
  currentPage: number;
  /** External action queued by the page (answer-sheet image menu). */
  queued?: ChatRequest | null;
  /** Fired after each response so the page can remember latest gradings. */
  onGrading?: (g: ChatGrading) => void;
  /** Fired when the teacher accepts a grading card's marks. */
  onAcceptMarks: (g: ChatGrading) => void;
  /** Jump the left preview to a page. */
  onJumpToPage: (idx: number) => void;
  /** Switch the right panel to the marks tab. */
  onReviewMarks: () => void;
  /** Called once a queued request has been turned into a turn. */
  onQueuedHandled?: (id: number) => void;
}) {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState<number[]>([]);
  const [target, setTarget] = useState<string>("auto");
  const [sending, setSending] = useState(false);
  // Model label shown next to the question pin (refreshed from each response).
  const [modelLabel, setModelLabel] = useState(DEFAULT_MODEL);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to the newest message whenever the thread grows.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const attachCurrent = useCallback(() => {
    setAttached((prev) =>
      prev.includes(currentPage) || currentPage < 0 || currentPage >= previews.length
        ? prev
        : [...prev, currentPage].sort((a, b) => a - b),
    );
  }, [currentPage, previews.length]);

  const send = useCallback(
    async (overrideText?: string, overridePages?: number[]) => {
      const text = (overrideText ?? input).trim();
      // An external request (image menu) may pin its own page for this turn;
      // otherwise the composer's attachments ride along.
      const pages = overridePages ?? attached;
      if (sending) return;
      if (!text && pages.length === 0) return;

      const userImages = pages.map((i) => ({ url: previews[i], pageIdx: i }));
      const userFiles = pages
        .map((i) => files[i])
        .filter((f): f is File => f instanceof File);
      // History for the model: text-only transcript (images only ride the
      // current turn, mirroring the API contract).
      const history: AnswerSheetChatMessage[] = messages
        .filter((m) => m.role !== "error")
        .map((m) => ({
          role: m.role,
          content:
            m.role === "user"
              ? m.text || "(attached answer-sheet pages)"
              : m.grading
                ? // Carry the marks context so follow-ups like "why not full
                  // marks?" can be answered from the thread itself.
                  `[You graded this answer: question ${m.grading.matchedQuestion || "?"}, awarded ${m.grading.awardedMarks} of ${m.grading.maxMarks} marks.] ${m.text}`
                : m.text,
        }))
        .filter((m) => m.content.trim() !== "");

      const userBubble: Bubble = {
        id: nextId++,
        role: "user",
        text,
        images: userImages,
      };
      setMessages((prev) => [...prev, userBubble]);
      setInput("");
      // A page pinned by an external request is not a composer attachment.
      if (!overridePages) setAttached([]);
      setSending(true);

      try {
        const res: AnswerSheetChatResponse = await chatAnswerSheet({
          subject,
          questions: questions as never[],
          messages: [
            ...history,
            { role: "user", content: text || "(attached answer-sheet pages)" },
          ],
          targetQuestion: target === "auto" ? "" : target,
          images: userFiles,
        });
        // The backend reports the model it ran (e.g. "free/gpt-6-luna").
        if (res.model) setModelLabel(res.model.split("/").pop() || res.model);
        const grading: ChatGrading | null =
          res.kind === "grading"
            ? {
                pageIdxs: userImages.map((im) => im.pageIdx),
                matchedQuestion: res.matched_question,
                maxMarks: res.max_marks,
                awardedMarks: res.awarded_marks,
                accepted: false,
              }
            : null;
        if (grading) onGrading?.(grading);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId++,
            role: "assistant",
            text: res.reply || (grading ? "Graded." : ""),
            grading,
            analysis:
              res.kind === "grading"
                ? {
                    expected_answer: res.expected_answer,
                    strengths: res.strengths,
                    improvements: res.improvements,
                  }
                : null,
            suggestions: res.suggestions ?? [],
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId++,
            role: "error",
            text:
              err instanceof Error
                ? err.message
                : "Something went wrong. Please try again.",
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [attached, files, input, messages, onGrading, previews, questions, sending, subject, target],
  );

  const accept = (g: ChatGrading) => {
    onAcceptMarks(g);
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "assistant" && m.grading && m.grading.pageIdxs === g.pageIdxs
          ? { ...m, grading: { ...m.grading, accepted: true } }
          : m,
      ),
    );
  };

  // Run page-level requests (image menu / quick marks) as a normal turn.
  const handledRequest = useRef(0);
  useEffect(() => {
    if (!queued || queued.id === handledRequest.current) return;
    handledRequest.current = queued.id;
    if (queued.attachOnly) {
      const page = queued.pageIdx;
      if (page !== null) {
        setAttached((prev) =>
          prev.includes(page) ? prev : [...prev, page].sort((a, b) => a - b),
        );
      }
      taRef.current?.focus();
    } else {
      void send(
        queued.text,
        queued.pageIdx === null ? undefined : [queued.pageIdx],
      );
    }
    onQueuedHandled?.(queued.id);
  }, [queued, send, onQueuedHandled]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Send stays hidden until there is something to send (text or a page).
  const canSend = input.trim().length > 0 || attached.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* thread */}
      <div
        ref={threadRef}
        className="no-scrollbar flex min-h-[280px] flex-1 flex-col gap-3 overflow-y-auto p-1 lg:min-h-0"
      >
        {messages.length === 0 && !sending && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
            <MessageSquareText className="size-8 text-muted-foreground/50" />
            <p className="max-w-[240px] text-sm text-muted-foreground">
              Attach a page or ask about this student&apos;s answers — the AI
              grades them against the question paper.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) =>
            m.role === "user" ? (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-end gap-1"
              >
                {m.images.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {m.images.map((im) => (
                      <button
                        key={im.pageIdx}
                        type="button"
                        onClick={() => onJumpToPage(im.pageIdx)}
                        title={`Jump to page ${im.pageIdx + 1}`}
                        className="cursor-pointer overflow-hidden rounded-md border transition-colors hover:border-primary"
                      >
                        <img
                          src={im.url}
                          alt={`Attached page ${im.pageIdx + 1}`}
                          className="h-16 w-12 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
                {m.text && (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {m.text}
                  </div>
                )}
              </motion.div>
            ) : m.role === "assistant" ? (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex max-w-[92%] flex-col items-start gap-1"
              >
                {m.grading ? (
                  <div className="flex w-full flex-col gap-2 rounded-2xl rounded-bl-sm bg-secondary p-3 text-secondary-foreground">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        Q{m.grading.matchedQuestion || "—"}
                      </Badge>
                      <span className="text-lg font-bold">
                        {m.grading.awardedMarks}
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}
                          / {m.grading.maxMarks} marks
                        </span>
                      </span>
                      {m.grading.accepted && (
                        <Badge className="ml-auto gap-1 bg-green-600 text-white">
                          <Check className="size-3" />
                          Accepted
                        </Badge>
                      )}
                    </div>
                    {m.text && <p className="text-sm leading-relaxed">{m.text}</p>}
                    {m.analysis?.expected_answer ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-muted-foreground">
                          What a full-marks answer should contain
                        </span>
                        <p className="text-sm leading-relaxed">
                          {m.analysis.expected_answer}
                        </p>
                      </div>
                    ) : null}
                    {m.analysis?.strengths ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-muted-foreground">
                          What is good in this answer
                        </span>
                        <p className="text-sm leading-relaxed">{m.analysis.strengths}</p>
                      </div>
                    ) : null}
                    {m.analysis?.improvements ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-muted-foreground">
                          What would gain marks
                        </span>
                        <p className="text-sm leading-relaxed">
                          {m.analysis.improvements}
                        </p>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2 pt-1">
                      {m.grading.accepted ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={onReviewMarks}
                          className="h-7 cursor-pointer text-xs"
                        >
                          Review in Marks
                          <ArrowRight className="size-3.5" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="button"
                            onClick={() => accept(m.grading!)}
                            className="h-7 cursor-pointer text-xs"
                          >
                            <Check className="size-3.5" />
                            Accept marks
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => taRef.current?.focus()}
                            className="h-7 cursor-pointer text-xs"
                          >
                            Discuss
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  m.text && (
                    <div className="rounded-2xl rounded-bl-sm bg-secondary px-3 py-2 text-sm leading-relaxed text-secondary-foreground">
                      {m.text}
                    </div>
                  )
                )}
                {m.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {m.suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => send(s)}
                        className="cursor-pointer rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex max-w-[92%] flex-col gap-1"
              >
                <div className="flex items-start gap-2 rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{m.text}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => send()}
                  className="h-6 w-fit cursor-pointer px-2 text-xs text-muted-foreground"
                >
                  <RotateCcw className="size-3" />
                  Retry
                </Button>
              </motion.div>
            ),
          )}
        </AnimatePresence>

        {sending && <ThinkingBubble />}
      </div>

      {/* composer — one floating card: add-image · input · send (on demand) */}
      <div className="mt-1 flex shrink-0 flex-col gap-1.5 rounded-2xl border bg-background p-1.5 shadow-lg">
        {attached.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
            {attached.map((i) => (
              <div
                key={i}
                className="group relative overflow-hidden rounded-md border"
                title={`Page ${i + 1}`}
              >
                <img src={previews[i]} alt={`Page ${i + 1}`} className="h-14 w-11 object-cover" />
                <span className="absolute bottom-0 left-0 right-0 bg-background/80 text-center text-[9px]">
                  Page {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setAttached((prev) => prev.filter((x) => x !== i))}
                  aria-label={`Remove page ${i + 1} from message`}
                  className="absolute right-0 top-0 flex h-4 w-4 cursor-pointer items-center justify-center rounded-bl bg-background/90 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={attachCurrent}
            disabled={attached.includes(currentPage)}
            aria-label="Add image"
            title={`Attach page ${currentPage + 1}`}
            className="h-9 w-9 shrink-0 cursor-pointer rounded-xl text-muted-foreground hover:text-foreground"
          >
            <ImagePlus className="size-4" />
          </Button>
          <Textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about the marks, or attach a page to grade…"
            rows={1}
            className="max-h-32 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 shadow-none focus-visible:ring-0"
          />
          {(canSend || sending) && (
            <Button
              type="button"
              size="icon"
              onClick={() => send()}
              disabled={sending}
              aria-label="Send message"
              className="h-9 w-9 shrink-0 cursor-pointer rounded-xl"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ChevronUp className="size-5" />
              )}
            </Button>
          )}
        </div>

        {/* divider: composer input above, question pin / model below */}
        <div className="h-px w-full bg-border" />

        <div className="flex items-center gap-2 px-0.5 pb-0.5">
          <span className="text-[11px] text-muted-foreground">Question</span>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger
              size="sm"
              className="h-6 w-[180px] rounded-md px-2 py-0 text-[11px] data-[size=sm]:h-6"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect from page</SelectItem>
              {questionOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span
            className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
            title="Model"
          >
            <Bot className="size-3" />
            {modelLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
