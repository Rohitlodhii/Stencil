import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldSelect } from "@/components/FieldSelect";
import {
  fetchStudentDataset,
  fetchStudentRows,
  loadLocalDataset,
  parseCsvLocal,
  updateLocalDataset,
  updateStudentDataset,
  type StudentDataset,
  type StudentMapping,
} from "@/lib/students";

const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const mappingFields: { key: keyof StudentMapping; label: string }[] = [
  { key: "student_name", label: "Student name column" },
  { key: "total_marks", label: "Total marks column" },
  { key: "obtained_marks", label: "Obtained marks column" },
  { key: "attendance", label: "Attendance column" },
];

export function StudentsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const datasetId = Number(id);

  const [dataset, setDataset] = useState<StudentDataset | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // edit state
  const [editing, setEditing] = useState(false);
  const [branch, setBranch] = useState("");
  const [semester, setSemester] = useState("");
  const [assignedTeacher, setAssignedTeacher] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [mapping, setMapping] = useState<StudentMapping>({
    student_name: "",
    total_marks: "",
    obtained_marks: "",
    attendance: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(datasetId)) {
      setError("Invalid dataset id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let ds: StudentDataset;
    try {
      ds = await fetchStudentDataset(datasetId);
    } catch (err) {
      const local = loadLocalDataset(datasetId);
      if (!local) {
        setError(err instanceof Error ? err.message : "Failed to load dataset.");
        setLoading(false);
        return;
      }
      ds = local;
    }
    setDataset(ds);
    setBranch(ds.branch);
    setSemester(ds.semester);
    setAssignedTeacher(ds.assigned_teacher);
    setSubjectName(ds.subject_name);
    setMapping(ds.mapping);
    setColumns(ds.columns);
    setRows(ds.preview ?? []);
    setTotal(ds.row_count);
    setLoading(false);

    // now fetch ALL rows
    setRowsLoading(true);
    try {
      const full = await fetchStudentRows(ds.id);
      setColumns(full.columns);
      setRows(full.rows);
      setTotal(full.total);
      setTruncated(full.truncated);
    } catch {
      // backend rows endpoint failed — try the public S3 csv directly
      if (ds.s3_url) {
        try {
          const res = await fetch(ds.s3_url);
          if (res.ok) {
            const text = await res.text();
            const parsed = parseCsvLocal(text, 5000);
            setColumns(parsed.columns);
            setRows(parsed.rows);
            setTotal(parsed.total);
            setTruncated(parsed.total > parsed.rows.length);
          }
        } catch {
          // keep preview
        }
      }
    } finally {
      setRowsLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = () => {
    if (!dataset) return;
    setBranch(dataset.branch);
    setSemester(dataset.semester);
    setAssignedTeacher(dataset.assigned_teacher);
    setSubjectName(dataset.subject_name);
    setMapping(dataset.mapping);
    setSaveError(null);
    setEditing(true);
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dataset) return;
    if (
      !branch.trim() ||
      !semester.trim() ||
      !assignedTeacher.trim() ||
      !subjectName.trim()
    ) {
      setSaveError("Branch, Semester, Assigned teacher and Subject are required.");
      return;
    }
    if (
      !mapping.student_name ||
      !mapping.total_marks ||
      !mapping.obtained_marks ||
      !mapping.attendance
    ) {
      setSaveError("Map all four columns before saving.");
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await updateStudentDataset(dataset.id, {
        branch: branch.trim(),
        semester: semester.trim(),
        assigned_teacher: assignedTeacher.trim(),
        subject_name: subjectName.trim(),
        mapping,
      });
      setDataset(updated);
      setEditing(false);
    } catch (err) {
      // backend down — persist locally
      const updated = updateLocalDataset(dataset.id, {
        branch: branch.trim(),
        semester: semester.trim(),
        assigned_teacher: assignedTeacher.trim(),
        subject_name: subjectName.trim(),
        mapping,
      });
      if (updated) {
        setDataset(updated);
        setEditing(false);
        setSaveError(
          err instanceof Error
            ? `${err.message} — saved locally instead.`
            : "Backend unreachable — saved locally instead.",
        );
      } else {
        setSaveError(err instanceof Error ? err.message : "Save failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="app-page max-w-6xl">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (error || !dataset) {
    return (
      <main className="app-page max-w-6xl">
        <button
          type="button"
          onClick={() => navigate("/students")}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to students
        </button>
        <p className="text-sm text-destructive">{error ?? "Not found."}</p>
      </main>
    );
  }

  return (
    <main className="app-page max-w-6xl">
      <button
        type="button"
        onClick={() => navigate("/students")}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to students
      </button>

      <div className="flex items-center gap-2">
        <h1 className="font-title text-2xl font-semibold leading-tight sm:text-[1.75rem]">
          {dataset.subject_name}
        </h1>
        <Button
          type="button"
          onClick={startEdit}
          className="ml-auto cursor-pointer p-1 pr-4"
        >
          <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
            <Pencil className="size-4" />
          </span>
          Edit
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {dataset.branch} · Sem {dataset.semester} · {dataset.assigned_teacher} ·{" "}
        {total} rows
      </p>

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded-md border px-2 py-1">
          Name: {dataset.mapping.student_name}
        </span>
        <span className="rounded-md border px-2 py-1">
          Total: {dataset.mapping.total_marks}
        </span>
        <span className="rounded-md border px-2 py-1">
          Obtained: {dataset.mapping.obtained_marks}
        </span>
        <span className="rounded-md border px-2 py-1">
          Attendance: {dataset.mapping.attendance}
        </span>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          <form onSubmit={onSave} className="flex flex-col">
            <div className="bg-accent px-6 pt-6 pr-12 pb-4">
              <DialogTitle>Edit details</DialogTitle>
            </div>
            <div className="grid gap-4 px-6 py-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Branch</span>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Semester</span>
                <input
                  type="text"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Assigned teacher</span>
                <input
                  type="text"
                  value={assignedTeacher}
                  onChange={(e) => setAssignedTeacher(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Subject name</span>
                <input
                  type="text"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  className={inputCls}
                />
              </label>
              {mappingFields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{f.label}</span>
                  <FieldSelect
                    value={mapping[f.key]}
                    onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                    placeholder="Select column…"
                    options={dataset.columns}
                    ariaLabel={f.label}
                  />
                </div>
              ))}
            </div>
            {saveError && (
              <p className="px-6 pb-2 text-sm text-destructive">{saveError}</p>
            )}
            <div className="bg-accent flex items-center justify-between px-6 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="cursor-pointer p-1 pr-4"
              >
                <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                </span>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-title text-xl font-bold tracking-tight">
            All student data
          </h2>
          <p className="text-sm text-muted-foreground">
            {rowsLoading
              ? "Loading all rows…"
              : `${rows.length} of ${total} rows shown${truncated ? " (truncated)" : ""}`}
          </p>
        </div>
        <div className="no-scrollbar max-h-[420px] overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted text-left">
                {columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap px-3 py-2 font-semibold"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t align-top">
                  {columns.map((c) => (
                    <td
                      key={c}
                      className="whitespace-nowrap px-3 py-2"
                    >
                      {r[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rowsLoading && rows.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No rows found.</p>
          )}
        </div>
      </section>
    </main>
  );
}
