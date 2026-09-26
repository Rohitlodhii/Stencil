import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FileUp,
  Loader2,
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
  fetchFinalExamDetail,
  uploadImage,
  type FinalExamDetail,
  type UploadedImage,
} from "@/lib/exam";
import { fetchStudentDataset, fetchStudentRows } from "@/lib/students";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
    for (const f of list) {
      const isImage =
        f.type.startsWith("image/") ||
        /\.(jpe?g|png|webp|gif)$/i.test(f.name);
      if (!isImage) {
        setUploadError(`Not an image: ${f.name}`);
        return;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setUploadError(`${f.name} is larger than 10 MB.`);
        return;
      }
    }
    setFiles((prev) => [...prev, ...list]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const onUpload = async () => {
    if (files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      const results: UploadedImage[] = [];
      for (const f of files) {
        results.push(await uploadImage(f));
      }
      setUploaded((prev) => [...prev, ...results]);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 p-6">
        <p className="text-sm text-muted-foreground">Loading student…</p>
      </main>
    );
  }

  if (error || !exam) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 p-6">
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
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 p-6">
      <button
        type="button"
        onClick={() => navigate(`/check-exam/${exam.id}`)}
        className="flex w-fit cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to {exam.subject_name}
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-title text-3xl font-bold leading-none tracking-tight">
          Check paper — {studentName}
        </h1>
        {obtained !== "" ? (
          <Badge className="bg-green-600 text-white">Checked: True</Badge>
        ) : (
          <Badge variant="destructive">Checked: False</Badge>
        )}
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
        {exam.subject_name} · {exam.assigned_teacher || "—"} · Marks obtained:{" "}
        {obtained || "—"}
      </p>

      <Card className="border-0 bg-sidebar shadow-none">
        <CardHeader>
          <CardTitle className="font-title flex items-center gap-2 text-xl font-bold tracking-tight">
            <FileUp className="size-5" />
            Answer sheet images
          </CardTitle>
          <CardDescription>
            Upload photos/scans of {studentName}&rsquo;s answer sheet — each
            image goes to S3 and appears below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => pickFiles(e.target.files)}
            className="hidden"
          />
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
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 cursor-pointer text-xs"
                >
                  + Add more
                </Button>
                <Button
                  type="button"
                  onClick={onUpload}
                  disabled={uploading}
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
                  </a>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
