import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileUp,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  analyzeAnswerSheet,
  fetchFinalExamDetail,
  fetchMarksProgress,
  fetchStudentMark,
  saveStudentMark,
  uploadImage,
  type AnswerEvaluationItem,
  type AnswerSheetAnalysis,
  type EvaluationWarning,
  type FinalExamDetail,
  type MarksProgress,
  type UploadedImage,
} from "@/lib/exam";
import { fetchStudentDataset, fetchStudentRows } from "@/lib/students";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type QualityResult = {
  name: string;
  passed: boolean;
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  blurScore: number;
  borderInkRatio: number;
  messages: string[];
};

async function validateImageQuality(file: File): Promise<QualityResult> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image quality check is unavailable.");
    context.drawImage(image, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    const values: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) {
      values.push((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
    }
    const brightness = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - brightness) ** 2, 0) / values.length;
    const contrast = Math.sqrt(variance);
    let edgeTotal = 0;
    let edgeSamples = 0;
    for (let y = 1; y < 63; y += 1) {
      for (let x = 1; x < 63; x += 1) {
        const index = y * 64 + x;
        edgeTotal += Math.abs(values[index] - values[index - 1]);
        edgeTotal += Math.abs(values[index] - values[index - 64]);
        edgeSamples += 2;
      }
    }
    const blurScore = edgeTotal / edgeSamples;
    let borderInk = 0;
    let borderSamples = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        if (x < 2 || x >= 62 || y < 2 || y >= 62) {
          borderSamples += 1;
          if (values[y * 64 + x] < brightness - 35) borderInk += 1;
        }
      }
    }
    const borderInkRatio = borderInk / borderSamples;
    const messages: string[] = [];
    if (image.width < 900 || image.height < 900) messages.push("Resolution is below 900 x 900");
    if (brightness < 45) messages.push("Image appears too dark");
    if (brightness > 245) messages.push("Image appears overexposed");
    if (contrast < 18) messages.push("Image has very low contrast");
    if (blurScore < 7 && contrast >= 18) messages.push("Image appears blurry");
    if (borderInkRatio > 0.08 || Math.min(image.width, image.height) / Math.max(image.width, image.height) < 0.5) {
      messages.push("Page may be cropped or incomplete");
    }
    return {
      name: file.name,
      passed: messages.length === 0,
      width: image.width,
      height: image.height,
      brightness: Math.round(brightness),
      contrast: Math.round(contrast),
      blurScore: Math.round(blurScore * 10) / 10,
      borderInkRatio: Math.round(borderInkRatio * 1000) / 1000,
      messages,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function expectedQuestionIds(questions: FinalExamDetail["questions"]): string[] {
  const ids: string[] = [];
  const walk = (question: FinalExamDetail["questions"][number], parent = "") => {
    const qNo = String(question.q_no || "");
    const label = parent && qNo ? `${parent}.${qNo}` : qNo || parent;
    if (question.marks !== null && question.marks !== undefined || question.sub_questions.length === 0) {
      ids.push(label || String(ids.length + 1));
    }
    question.sub_questions.forEach((subQuestion) => walk(subQuestion, label));
  };
  questions.forEach((question) => walk(question));
  return ids;
}

export function CheckPaperPage() {
  const { id, studentIdx } = useParams<{ id: string; studentIdx: string }>();
  const navigate = useNavigate();
  const examId = Number(id);
  const rowIdx = Number(studentIdx);

  const [exam, setExam] = useState<FinalExamDetail | null>(null);
  const [studentName, setStudentName] = useState("");
  const [obtained, setObtained] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // answer-sheet images
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [analysis, setAnalysis] = useState<AnswerSheetAnalysis | null>(null);
  const [evaluations, setEvaluations] = useState<AnswerEvaluationItem[]>([]);
  const [awardedMarks, setAwardedMarks] = useState("");
  const [feedback, setFeedback] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [hasSavedMark, setHasSavedMark] = useState(false);
  const [qualityResults, setQualityResults] = useState<QualityResult[]>([]);
  const [validatingQuality, setValidatingQuality] = useState(false);
  const [progress, setProgress] = useState<MarksProgress | null>(null);

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
      setObtained((row[ds.mapping.obtained_marks] ?? "").trim());
      setProgress(await fetchMarksProgress(examId).catch(() => null));
      const saved = await fetchStudentMark(examId, rowIdx).catch(() => null);
      if (saved) {
        setHasSavedMark(true);
        setUploaded(
          (saved.answer_sheet_urls ?? []).map((url, i) => ({
            url,
            key: `saved-${i}`,
            bucket: "",
            region: "",
            content_type: "image/*",
            size_bytes: 0,
          })),
        );
        setEvaluations(
          (saved.evaluations_json ?? []).map((item) => ({
            ...item,
            final_marks: item.final_marks ?? item.suggested_marks,
            override_reason: item.override_reason ?? "",
          })),
        );
        setAwardedMarks(String(saved.awarded_marks ?? ""));
        setFeedback(saved.feedback ?? "");
        setSavedAt(saved.updated_at ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load student.");
    } finally {
      setLoading(false);
    }
  }, [examId, rowIdx]);

  useEffect(() => {
    load();
  }, [load]);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );

  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const pickFiles = (picked: FileList | File[] | null | undefined) => {
    setUploadError(null);
    if (!picked) return;
    const list = Array.from(picked);
    if (list.length === 0) {
      setUploadError("Select at least one answer-sheet image.");
      return;
    }
    for (const f of list) {
      const isImage =
        ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type) ||
        /\.(jpe?g|png|webp|gif)$/i.test(f.name);
      if (!isImage) {
        setUploadError(`Not an image: ${f.name}`);
        return;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setUploadError(`${f.name} is larger than 10 MB.`);
        return;
      }
      if (f.size === 0) {
        setUploadError(`${f.name} is empty.`);
        return;
      }
    }
    setQualityResults([]);
    setFiles((prev) => [...prev, ...list]);
  };

  const removeFile = (index: number) => {
    setQualityResults([]);
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const runQualityValidation = async () => {
    if (files.length === 0) return;
    setUploadError(null);
    setValidatingQuality(true);
    try {
      setQualityResults(await Promise.all(files.map(validateImageQuality)));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Quality validation failed.");
    } finally {
      setValidatingQuality(false);
    }
  };

  const onUpload = async () => {
    if (files.length === 0) return;
    if (qualityResults.length !== files.length) {
      setUploadError("Run quality validation before uploading.");
      return;
    }
    if (qualityResults.some((result) => !result.passed)) {
      setUploadError("Replace images that failed quality validation before uploading.");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const results: UploadedImage[] = [];
      for (const f of files) {
        const uploadedImage = await uploadImage(f);
        if (uploadedImage.quality && !uploadedImage.quality.passed) {
          throw new Error(
            uploadedImage.quality.warnings.map((warning) => warning.message).join(" "),
          );
        }
        results.push(uploadedImage);
      }
      setUploaded((prev) => [...prev, ...results]);
      setFiles([]);
      setQualityResults([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const analyzeUploaded = async () => {
    if (!exam || uploaded.length === 0) return;
    setUploadError(null);
    setAnalyzing(true);
    try {
      const result = await analyzeAnswerSheet({
        final_exam_id: exam.id,
        student_index: rowIdx,
        student_name: studentName,
        image_urls: uploaded.map((u) => u.url),
      });
      setAnalysis(result);
      setEvaluations(
        result.evaluations.map((item) => ({
          ...item,
          final_marks: item.final_marks ?? item.suggested_marks,
          override_reason: item.override_reason ?? "",
        })),
      );
      setAwardedMarks(String(result.suggested_marks));
      setFeedback(
        [result.strengths, result.improvements].filter(Boolean).join("\n\n"),
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const saveMarks = async () => {
    if (!exam) return;
    setUploadError(null);
    const finalMarks = Number(awardedMarks);
    if (!Number.isFinite(finalMarks) || finalMarks < 0 || finalMarks > exam.total_marks) {
      setUploadError(`Final marks must be between 0 and ${exam.total_marks}.`);
      return;
    }
    const invalid = evaluations.find(
      (item) => (item.final_marks ?? item.suggested_marks) < 0 || (item.final_marks ?? item.suggested_marks) > item.max_marks,
    );
    if (invalid) {
      setUploadError(`Question ${invalid.q_no} exceeds its maximum of ${invalid.max_marks}.`);
      return;
    }
    const questionTotal = evaluations.reduce(
      (sum, item) => sum + (item.final_marks ?? item.suggested_marks),
      0,
    );
    if (evaluations.length > 0 && Math.abs(questionTotal - finalMarks) > 0.001) {
      setUploadError(`Final marks must equal the question total (${questionTotal}).`);
      return;
    }
    setSaving(true);
    try {
      const saved = await saveStudentMark({
        final_exam_id: exam.id,
        student_index: rowIdx,
        student_name: studentName,
        answer_sheet_urls: uploaded.map((u) => u.url),
        evaluations,
        awarded_marks: finalMarks,
        max_marks: exam.total_marks,
        feedback,
        updated_by: exam.assigned_teacher,
      });
      setSavedAt(saved.updated_at);
      setHasSavedMark(true);
      setObtained(String(saved.awarded_marks));
      setProgress(await fetchMarksProgress(exam.id).catch(() => progress));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const updateQuestionMarks = (index: number, rawValue: string) => {
    const value = rawValue === "" ? 0 : Number(rawValue);
    setEvaluations((current) => {
      const next = current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, final_marks: Number.isFinite(value) ? value : 0 }
          : item,
      );
      setAwardedMarks(String(next.reduce((sum, item) => sum + (item.final_marks ?? item.suggested_marks), 0)));
      return next;
    });
    setSavedAt("");
  };

  const nudgeQuestionMarks = (index: number, delta: number) => {
    const item = evaluations[index];
    if (!item) return;
    const current = item.final_marks ?? item.suggested_marks;
    const next = Math.min(item.max_marks, Math.max(0, current + delta));
    updateQuestionMarks(index, String(next));
  };

  const updateOverrideReason = (index: number, overrideReason: string) => {
    setEvaluations((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, override_reason: overrideReason } : item,
      ),
    );
    setSavedAt("");
  };

  const evaluationWarnings = useMemo<EvaluationWarning[]>(() => {
    if (!exam || evaluations.length === 0) return [];
    const warnings: EvaluationWarning[] = [];
    const expected = new Set(expectedQuestionIds(exam.questions));
    const seen = new Set<string>();
    let computedTotal = 0;
    evaluations.forEach((item) => {
      const qNo = item.q_no.trim();
      const finalMarks = item.final_marks ?? item.suggested_marks;
      if (seen.has(qNo)) warnings.push({ code: "DUPLICATE_QUESTION_ASSOCIATION", severity: "error", q_no: qNo, message: `Question ${qNo} is associated more than once.` });
      seen.add(qNo);
      if (!expected.has(qNo)) warnings.push({ code: "UNEXPECTED_QUESTION", severity: "error", q_no: qNo, message: `Question ${qNo} is not in the marking scheme.` });
      if (item.unchecked) warnings.push({ code: "UNANSWERED_QUESTION", severity: "warning", q_no: qNo, message: `Question ${qNo} is unanswered.` });
      if (item.unchecked && finalMarks !== 0) warnings.push({ code: "UNANSWERED_WITH_MARKS", severity: "error", q_no: qNo, message: `Unanswered question ${qNo} must have 0 marks.` });
      if (finalMarks < 0) warnings.push({ code: "NEGATIVE_MARKS", severity: "error", q_no: qNo, message: `Question ${qNo} has negative marks.` });
      if (finalMarks > item.max_marks) warnings.push({ code: "MARKS_ABOVE_MAXIMUM", severity: "error", q_no: qNo, message: `Question ${qNo} exceeds ${item.max_marks} marks.` });
      computedTotal += finalMarks;
    });
    expected.forEach((qNo) => {
      if (!seen.has(qNo)) warnings.push({ code: "MISSING_EXPECTED_QUESTION", severity: "error", q_no: qNo, message: `Expected question ${qNo} is missing.` });
    });
    if (Math.abs(computedTotal - Number(awardedMarks)) > 0.001) {
      warnings.push({ code: "TOTAL_MISMATCH", severity: "error", message: "Displayed total does not match the question marks." });
    }
    return warnings;
  }, [awardedMarks, evaluations, exam]);

  const hasEvaluationErrors = evaluationWarnings.some((warning) => warning.severity === "error");

  if (loading) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 p-3 sm:gap-6 sm:p-6">
        <p className="text-sm text-muted-foreground">Loading student…</p>
      </main>
    );
  }

  if (error || !exam) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 p-3 sm:gap-6 sm:p-6">
        <button
          type="button"
          onClick={() => navigate(`/check-exam/${examId}`)}
          className="flex w-fit cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to exam
        </button>
        <p className="text-sm text-destructive">{error ?? "Not found."}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 overflow-x-hidden p-3 sm:gap-6 sm:p-6">
      <button
        type="button"
        onClick={() => navigate(`/check-exam/${exam.id}`)}
        className="flex min-h-11 w-fit cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0"
      >
        <ArrowLeft className="size-4" />
        Back to {exam.subject_name}
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="sm:hidden">Mobile examiner view</Badge>
        <h1 className="w-full font-title text-xl font-bold leading-tight tracking-normal sm:w-auto sm:text-3xl sm:leading-none">
          Check paper — {studentName}
        </h1>
        {hasSavedMark ? (
          <Badge className="bg-green-600 text-white">Checked: True</Badge>
        ) : (
          <Badge variant="destructive">Checked: False</Badge>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={load}
          className="ml-auto h-11 cursor-pointer text-xs sm:h-7"
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {exam.subject_name} · {exam.assigned_teacher || "—"} · Marks obtained:{" "}
        {obtained || "—"}
      </p>
      {progress && (
        <div className="flex items-center gap-2 text-xs sm:gap-3 sm:text-sm">
          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full bg-green-600"
              style={{ width: `${Math.min(100, progress.percent)}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-muted-foreground">
            <span className="sm:hidden">{progress.evaluated_students}/{progress.total_students} · {progress.percent}%</span>
            <span className="hidden sm:inline">{progress.evaluated_students}/{progress.total_students} evaluated ({progress.percent}%)</span>
          </span>
        </div>
      )}

      <Card className="border-0 bg-sidebar shadow-none">
        <CardHeader className="px-3 sm:px-6">
          <CardTitle className="font-title flex items-center gap-2 text-xl font-bold tracking-tight">
            <FileUp className="size-5" />
            Answer sheet images
          </CardTitle>
          <CardDescription>
            Upload photos/scans of {studentName}&rsquo;s answer sheet — each
            image is stored and appears below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-3 sm:px-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => pickFiles(e.target.files)}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => pickFiles(e.target.files)}
            className="hidden"
          />
          <Button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="h-12 w-full touch-manipulation cursor-pointer text-sm sm:hidden"
          >
            <Camera className="size-5" />
            Capture/Upload Answer Sheet
          </Button>
          {files.length === 0 ? (
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
                pickFiles(e.dataTransfer.files);
              }}
              className={`hidden h-48 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 text-center transition-colors sm:flex ${
                dragging
                  ? "border-primary bg-accent"
                  : "text-muted-foreground hover:border-ring hover:bg-accent/50"
              }`}
            >
              <span className="flex aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                <Upload className="size-5" />
              </span>
              <p className="text-sm">
                Drop answer sheet images here · max 10 MB each
              </p>
              <p className="text-xs">or click to browse</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {previews.map((p, i) => (
                  <div
                    key={i}
                    className="group relative overflow-hidden rounded-md border bg-background"
                  >
                    <img
                      src={p.url}
                      alt={`Answer sheet ${i + 1}`}
                      className="aspect-[3/4] w-full object-cover"
                    />
                    <span className="block truncate px-2 py-1 text-xs text-muted-foreground">
                      {p.file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${p.file.name}`}
                      className="absolute top-2 right-2 cursor-pointer rounded-sm bg-background/90 p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-11 cursor-pointer text-xs sm:h-8"
                  >
                    + Add more
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={runQualityValidation}
                    disabled={validatingQuality}
                    className="h-11 cursor-pointer text-xs sm:h-8"
                  >
                    {validatingQuality ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    {validatingQuality ? "Validating" : "Validate quality"}
                  </Button>
                </div>
                <Button
                  type="button"
                  onClick={onUpload}
                  disabled={uploading || qualityResults.length !== files.length || qualityResults.some((result) => !result.passed)}
                  className="cursor-pointer p-1 pr-4"
                >
                  <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                  </span>
                  {uploading ? "Uploading…" : `Upload ${files.length} image${files.length > 1 ? "s" : ""}`}
                </Button>
              </div>
              {qualityResults.length > 0 && (
                <div className="divide-y rounded-md border bg-background">
                  {qualityResults.map((result) => (
                    <div key={result.name} className="flex items-start gap-2 px-3 py-2 text-xs">
                      {result.passed ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      )}
                      <div>
                        <p className="font-medium">{result.name}: {result.passed ? "Passed" : "Needs replacement"}</p>
                        <p className="text-muted-foreground">
                          {result.width} x {result.height} · blur {result.blurScore} · contrast {result.contrast}
                          {result.messages.length > 0 ? ` · ${result.messages.join("; ")}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {uploadError && (
            <p className="text-sm text-destructive">{uploadError}</p>
          )}

          {uploaded.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                Uploaded ({uploaded.length})
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {uploaded.map((u, i) => (
                  <a
                    key={`${u.key}-${i}`}
                    href={u.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-md border bg-background"
                  >
                    <img
                      src={u.url}
                      alt={`Uploaded answer sheet ${i + 1}`}
                      loading="lazy"
                      className="aspect-[3/4] w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                    <span className="block truncate px-2 py-1 text-xs text-muted-foreground">
                      Sheet {i + 1} · click to open
                    </span>
                    {u.quality && (
                      <div className="flex flex-wrap gap-1 px-2 pb-2">
                        <Badge variant={u.quality.passed ? "secondary" : "destructive"}>
                          {u.quality.passed ? "Quality passed" : "Quality failed"}
                        </Badge>
                        {u.quality.warnings.map((warning) => (
                          <Badge key={warning.code} variant={warning.severity === "error" ? "destructive" : "secondary"}>
                            {warning.code.split("_").join(" ")}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {uploaded.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center">
              <Button
                type="button"
                onClick={analyzeUploaded}
                disabled={analyzing}
                className="h-11 w-full cursor-pointer p-1 pr-4 sm:w-auto"
              >
                <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                  {analyzing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileUp className="size-4" />
                  )}
                </span>
                {analyzing ? "Analyzing..." : "Run answer analysis"}
              </Button>
              {savedAt && (
                <span className="text-xs text-muted-foreground">
                  Saved {new Date(savedAt).toLocaleString()}
                </span>
              )}
            </div>
          )}

          {(analysis || evaluations.length > 0 || awardedMarks !== "") && (
            <div className="flex flex-col gap-4 rounded-md border bg-background p-3 sm:p-4">
              {analysis && (
                <div className={`rounded-md border p-3 text-sm ${analysis.mode === "demo" ? "border-amber-500 bg-amber-50 text-amber-950" : "bg-muted/40"}`}>
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    {analysis.mode === "demo" && <AlertTriangle className="size-4" />}
                    {analysis.mode === "demo" ? "DEMO analysis" : `AI analysis · ${analysis.model}`}
                  </div>
                  <p>{analysis.notice}</p>
                  {analysis.warnings?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {analysis.warnings.map((warning, index) => (
                        <Badge key={`${warning.code}-${warning.q_no ?? index}`} variant="destructive">
                          {warning.code.split("_").join(" ")}{warning.q_no ? ` · Q${warning.q_no}` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <label className="text-sm font-medium" htmlFor="awarded-marks">
                  Computed total
                </label>
                <input
                  id="awarded-marks"
                  value={awardedMarks}
                  readOnly
                  inputMode="decimal"
                  className="h-11 rounded-md border bg-background px-3 text-base sm:h-9 sm:text-sm"
                  placeholder={`0 to ${exam.total_marks}`}
                />
                <label className="text-sm font-medium" htmlFor="feedback">
                  Feedback
                </label>
                <textarea
                  id="feedback"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="Teacher feedback"
                />
              </div>

              {analysis?.expected_answer && (
                <div className="text-sm">
                  <p className="font-medium">Expected answer</p>
                  <p className="mt-1 text-muted-foreground">
                    {analysis.expected_answer}
                  </p>
                </div>
              )}

              {evaluationWarnings.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {evaluationWarnings.map((warning, index) => (
                    <Badge
                      key={`${warning.code}-${warning.q_no ?? index}`}
                      variant={warning.severity === "error" ? "destructive" : "secondary"}
                      title={warning.message}
                    >
                      {warning.code.split("_").join(" ")}{warning.q_no ? ` · Q${warning.q_no}` : ""}
                    </Badge>
                  ))}
                </div>
              )}

              {evaluations.length > 0 && (
                <div className="rounded-md border text-sm">
                  <div className="hidden bg-muted text-left font-semibold lg:grid lg:grid-cols-[1.1fr_.8fr_1fr_1fr]">
                    <div className="px-3 py-2">Question</div>
                    <div className="px-3 py-2">Association</div>
                    <div className="px-3 py-2">Marks</div>
                    <div className="px-3 py-2">Evidence</div>
                  </div>
                  {evaluations.map((item, i) => {
                    const finalMarks = item.final_marks ?? item.suggested_marks;
                    const invalidMarks = finalMarks < 0 || finalMarks > item.max_marks;
                    return (
                      <div
                        key={`${item.q_no}-${i}`}
                        className="grid grid-cols-1 gap-3 border-t p-3 first:border-t-0 lg:grid-cols-[1.1fr_.8fr_1fr_1fr] lg:gap-0 lg:p-0 lg:first:border-t"
                      >
                        <div className="min-w-0 lg:px-3 lg:py-3">
                          <p className="text-xs font-medium text-muted-foreground lg:hidden">Question</p>
                          <p className="font-semibold">Q{item.q_no || i + 1} · {item.max_marks} marks maximum</p>
                          {item.question_text && <p className="mt-1 break-words text-xs text-muted-foreground">{item.question_text}</p>}
                        </div>
                        <div className="min-w-0 text-xs lg:px-3 lg:py-3">
                          <p className="font-medium text-muted-foreground lg:hidden">Association</p>
                          <p className="break-words">{item.association || "No association supplied"}</p>
                          <p className="mt-1 text-muted-foreground">Confidence {Math.round((item.confidence ?? 0) * 100)}%</p>
                        </div>
                        <div className="min-w-0 lg:px-3 lg:py-3">
                          <div className="mb-2 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">AI suggestion</span>
                            <span className="font-medium">{item.suggested_marks} / {item.max_marks}</span>
                          </div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Final mark</p>
                          <div className="grid grid-cols-[44px_minmax(0,1fr)_44px_auto] items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Decrease marks for question ${item.q_no}`}
                              onClick={() => nudgeQuestionMarks(i, -0.5)}
                              className="flex h-11 w-11 touch-manipulation cursor-pointer items-center justify-center rounded-md border bg-background hover:bg-accent sm:h-8 sm:w-8"
                            >
                              <Minus className="size-4" />
                            </button>
                            <input
                              aria-label={`Final marks for question ${item.q_no}`}
                              type="number"
                              min="0"
                              max={item.max_marks}
                              step="0.5"
                              value={finalMarks}
                              onChange={(event) => updateQuestionMarks(i, event.target.value)}
                              className={`h-11 min-w-0 rounded-md border bg-background px-2 text-center text-base tabular-nums sm:h-8 sm:text-sm ${invalidMarks ? "border-destructive" : ""}`}
                            />
                            <button
                              type="button"
                              aria-label={`Increase marks for question ${item.q_no}`}
                              onClick={() => nudgeQuestionMarks(i, 0.5)}
                              className="flex h-11 w-11 touch-manipulation cursor-pointer items-center justify-center rounded-md border bg-background hover:bg-accent sm:h-8 sm:w-8"
                            >
                              <Plus className="size-4" />
                            </button>
                            <span className="whitespace-nowrap text-xs">/ {item.max_marks}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(item.unchecked || item.flags?.includes("UNCHECKED_ANSWER")) && <Badge variant="destructive">Unchecked</Badge>}
                            {finalMarks > item.max_marks && <Badge variant="destructive">Above maximum</Badge>}
                            {finalMarks < 0 && <Badge variant="destructive">Negative marks</Badge>}
                          </div>
                          {finalMarks !== item.suggested_marks && (
                            <input
                              aria-label={`Override reason for question ${item.q_no}`}
                              value={item.override_reason ?? ""}
                              onChange={(event) => updateOverrideReason(i, event.target.value)}
                              placeholder="Override reason (optional)"
                              className="mt-2 h-11 w-full rounded-md border bg-background px-2 text-base sm:h-8 sm:text-xs"
                            />
                          )}
                        </div>
                        <div className="min-w-0 text-xs lg:px-3 lg:py-3">
                          <p className="font-medium text-muted-foreground lg:hidden">Evidence</p>
                          <p className="break-words"><span className="font-medium">Reason:</span> {item.reason || item.feedback || "No reason supplied"}</p>
                          {item.strengths && <p className="mt-1 break-words text-green-700"><span className="font-medium">Strength:</span> {item.strengths}</p>}
                          {item.improvements && <p className="mt-1 break-words text-amber-700"><span className="font-medium">Improve:</span> {item.improvements}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={saveMarks}
                  disabled={saving || hasEvaluationErrors}
                  className="h-12 w-full cursor-pointer p-1 pr-4 sm:h-9 sm:w-auto"
                >
                  <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                  </span>
                  {saving ? "Saving..." : "Save final marks"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
