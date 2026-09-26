import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  Loader2,
  Table2,
  Upload,
  X,
} from "lucide-react";
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
import { FieldSelect } from "@/components/FieldSelect";
import { fetchTeacherRequests, type Session } from "@/lib/auth";
import {
  guessMapping,
  parseCsvLocal,
  saveLocalDataset,
  uploadStudentDataset,
  type StudentDataset,
  type StudentMapping,
} from "@/lib/students";

const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function StudentsUploadPage({ session }: { session: Session }) {
  const navigate = useNavigate();

  // ---- step 1: metadata + file ----
  const [branch, setBranch] = useState("");
  const [semester, setSemester] = useState("");
  const [assignedTeacher, setAssignedTeacher] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [teachers, setTeachers] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // ---- step 2: columns + mapping ----
  const [step, setStep] = useState<1 | 2>(1);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<StudentMapping>({
    student_name: "",
    total_marks: "",
    obtained_marks: "",
    attendance: "",
  });
  const [previewOpen, setPreviewOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<StudentDataset | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // approved teachers of this college -> "Assigned Teacher" dropdown
    fetchTeacherRequests(session.token, "approved")
      .then((d) => setTeachers(d.requests.map((r) => r.name)))
      .catch(() => setTeachers([]));
  }, [session.token]);

  const analyseFile = async (picked: File) => {
    setError(null);
    setLoading(true);
    try {
      const text = await picked.text();
      const parsed = parseCsvLocal(text);
      if (parsed.columns.length === 0) throw new Error("No columns found.");
      setColumns(parsed.columns);
      setRows(parsed.rows);
      setTotalRows(parsed.total);
      setMapping(guessMapping(parsed.columns));
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read CSV.");
    } finally {
      setLoading(false);
    }
  };

  const pickCsv = (picked: File | null | undefined) => {
    setError(null);
    if (!picked) return;
    const isCsv =
      picked.type.includes("csv") ||
      picked.name.toLowerCase().endsWith(".csv");
    if (!isCsv) {
      setError("Only CSV files are allowed.");
      return;
    }
    if (picked.size > 10 * 1024 * 1024) {
      setError("CSV must be 10 MB or smaller.");
      return;
    }
    setFile(picked);
    setSaved(null);
  };

  const clearFile = () => {
    setFile(null);
    setColumns([]);
    setRows([]);
    setStep(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canContinue =
    branch.trim() !== "" &&
    semester.trim() !== "" &&
    assignedTeacher.trim() !== "" &&
    subjectName.trim() !== "" &&
    file !== null;

  const onContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canContinue || !file) {
      setError("Fill Branch, Semester, Assigned teacher, Subject and CSV file.");
      return;
    }
    await analyseFile(file);
  };

  const mappingValid =
    mapping.student_name !== "" &&
    mapping.total_marks !== "" &&
    mapping.obtained_marks !== "" &&
    mapping.attendance !== "";

  const previewCols = useMemo(() => columns.slice(0, 8), [columns]);

  const onSave = async () => {
    if (!file || !mappingValid) {
      setError("Map all four columns before saving.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const ds = await uploadStudentDataset({
        branch: branch.trim(),
        semester: semester.trim(),
        assigned_teacher: assignedTeacher.trim(),
        subject_name: subjectName.trim(),
        mapping,
        file,
      });
      saveLocalDataset(ds);
      setSaved(ds);
    } catch (err) {
      // backend down — still keep a local copy so the list page shows it
      const local: StudentDataset = {
        id: Date.now(),
        branch: branch.trim(),
        semester: semester.trim(),
        assigned_teacher: assignedTeacher.trim(),
        subject_name: subjectName.trim(),
        original_filename: file.name,
        s3_url: "",
        s3_key: "",
        columns,
        mapping,
        row_count: totalRows,
        preview: rows.slice(0, 10),
        created_at: new Date().toISOString(),
      };
      saveLocalDataset(local);
      setSaved(local);
      setError(
        err instanceof Error
          ? `${err.message} — saved locally instead.`
          : "Backend unreachable — saved locally instead.",
      );
    } finally {
      setSaving(false);
    }
  };

  const mappingFields: {
    key: keyof StudentMapping;
    label: string;
    hint: string;
  }[] = [
    { key: "student_name", label: "Student name column", hint: "e.g. Name / Student" },
    { key: "total_marks", label: "Total marks column", hint: "e.g. Max Marks / Total" },
    { key: "obtained_marks", label: "Obtained marks column", hint: "e.g. Scored / Obtained" },
    { key: "attendance", label: "Attendance column", hint: "e.g. Attendance / Present %" },
  ];

  if (saved) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-6">
        <Card className="border-0 bg-sidebar shadow-none">
          <CardHeader>
            <CardTitle className="font-title text-xl font-bold tracking-tight">
              Students saved
            </CardTitle>
            <CardDescription>
              “{saved.subject_name}” · {saved.branch} · Sem {saved.semester} ·{" "}
              {saved.row_count} rows stored
              {saved.s3_url ? " in the database with the CSV on S3." : " locally."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => navigate("/students")}
                className="cursor-pointer"
              >
                <Check className="size-4" />
                View students
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  clearFile();
                  setBranch("");
                  setSemester("");
                  setSubjectName("");
                  setSaved(null);
                }}
                className="cursor-pointer"
              >
                Add another
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="size-7" />
        <h1 className="font-title text-3xl font-bold leading-none tracking-tight">
          Add student data
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Step {step} of 2 — {step === 1 ? "details & CSV file" : "match CSV columns"}
      </p>

      {step === 1 && (
        <Card className="border-0 bg-sidebar shadow-none">
          <CardHeader>
            <CardTitle className="font-title text-xl font-bold tracking-tight">
              Student details
            </CardTitle>
            <CardDescription>
              Fill the class details and upload the marks CSV file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onContinue} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Branch</span>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="e.g. CSE"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Semester</span>
                  <input
                    type="text"
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    placeholder="e.g. 5"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Assigned teacher</span>
                  {teachers.length > 0 ? (
                    <FieldSelect
                      value={assignedTeacher}
                      onChange={setAssignedTeacher}
                      placeholder="Select teacher…"
                      options={teachers}
                      ariaLabel="Assigned teacher"
                    />
                  ) : (
                    <input
                      type="text"
                      value={assignedTeacher}
                      onChange={(e) => setAssignedTeacher(e.target.value)}
                      placeholder="e.g. Prof. Sharma"
                      className={inputCls}
                    />
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Subject name</span>
                  <input
                    type="text"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    placeholder="e.g. Data Structures"
                    className={inputCls}
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Marks CSV file</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => pickCsv(e.target.files?.[0])}
                  className="hidden"
                />
                {file ? (
                  <Card className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="rounded-sm bg-secondary p-2 text-secondary-foreground">
                          <FileSpreadsheet className="size-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {file.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB
                          </span>
                        </span>
                      </span>
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
                      pickCsv(e.dataTransfer.files?.[0]);
                    }}
                    className={`flex h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 text-center transition-colors ${
                      dragging
                        ? "border-primary bg-accent"
                        : "text-muted-foreground hover:border-ring hover:bg-accent/50"
                    }`}
                  >
                    <span className="flex aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                      <Upload className="size-5" />
                    </span>
                    <p className="text-sm">
                      Drop marks file in CSV format · max size 10 MB
                    </p>
                    <p className="text-xs">or click to browse</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate("/students")}
                  className="cursor-pointer"
                >
                  ← Back
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !canContinue}
                  className="cursor-pointer p-1 pr-4"
                >
                  <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowRight className="size-4" />
                    )}
                  </span>
                  {loading ? "Analysing CSV…" : "Next: match columns"}
                  <Kbd className="h-4 border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] text-primary-foreground">
                    Enter
                  </Kbd>
                </Button>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <>
          <Card className="border-0 bg-sidebar shadow-none">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="font-title text-xl font-bold tracking-tight">
                  Match CSV columns
                </CardTitle>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPreviewOpen(true)}
                  className="ml-auto h-7 cursor-pointer text-xs"
                >
                  <Table2 className="size-3.5" />
                  Full preview
                </Button>
              </div>
              <CardDescription>
                {file?.name} · {totalRows} rows · {columns.length} columns found —
                tell us which column is which.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {mappingFields.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">{f.label}</span>
                    <FieldSelect
                      value={mapping[f.key]}
                      onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                      placeholder="Select column…"
                      options={columns}
                      ariaLabel={f.label}
                    />
                    <span className="text-xs text-muted-foreground">{f.hint}</span>
                  </div>
                ))}
              </div>

              {/* inline sheet-style preview */}
              <div>
                <p className="mb-2 text-sm font-medium">
                  Preview (first {Math.min(rows.length, 8)} rows)
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted text-left">
                        {columns.map((c) => (
                          <th
                            key={c}
                            className={`whitespace-nowrap px-2 py-1.5 font-semibold ${
                              Object.values(mapping).includes(c)
                                ? "text-primary"
                                : ""
                            }`}
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-t">
                          {columns.map((c) => (
                            <td
                              key={c}
                              className="max-w-40 truncate whitespace-nowrap px-2 py-1.5"
                            >
                              {r[c]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {columns.length > 8 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Showing {previewCols.length} of {columns.length} columns —
                    open full preview for all.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStep(1)}
                  className="cursor-pointer"
                >
                  ← Back
                </Button>
                <Button
                  type="button"
                  onClick={onSave}
                  disabled={saving || !mappingValid}
                  className="cursor-pointer"
                >
                  <span className="flex aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                  </span>
                  {saving ? "Saving…" : "Save students"}
                </Button>
              </div>
              {!mappingValid && (
                <p className="text-sm text-muted-foreground">
                  Select all four columns to enable saving.
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>

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
                <SheetTitle className="truncate">
                  {file?.name ?? "CSV preview"}
                </SheetTitle>
                <SheetDescription>
                  {totalRows} rows · {columns.length} columns · sheet preview
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-4">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left">
                      {columns.map((c) => (
                        <th
                          key={c}
                          className="whitespace-nowrap border px-2 py-1.5 font-semibold"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td
                            key={c}
                            className="max-w-48 truncate whitespace-nowrap border px-2 py-1"
                          >
                            {r[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </main>
  );
}
