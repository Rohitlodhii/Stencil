import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import {
  fetchStudentDatasets,
  loadLocalDatasets,
  type StudentDataset,
} from "@/lib/students";

export function StudentsPage() {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<StudentDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStudentDatasets();
      setDatasets(data);
    } catch (err) {
      // API down — fall back to locally saved uploads so the page still works.
      const local = loadLocalDatasets();
      setDatasets(local);
      setError(
        local.length > 0
          ? "Backend unreachable — showing locally saved uploads."
          : err instanceof Error
            ? err.message
            : "Failed to load students.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="app-page max-w-6xl">
      <PageHeader
        title="Student records"
        description="Manage examination rosters, identifiers, and marks datasets."
        icon={GraduationCap}
        actions={<><Button
          type="button"
          onClick={() => navigate("/students/new")}
          className="cursor-pointer"
        >
          <Plus />
          Add student data
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={load}
          className="cursor-pointer"
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button></>}
      />

      {loading && <StatePanel state="loading" title="Loading student datasets" />}
      {error && <div className="notice-error">{error}</div>}

      {!loading && datasets.length === 0 && !error && (
        <StatePanel state="empty" title="No student data yet" description="Upload a CSV with student marks and attendance to get started." />
      )}

      {datasets.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-title text-xl font-bold tracking-tight">
              Saved students
            </h2>
            <p className="text-sm text-muted-foreground">
              {datasets.length} upload{datasets.length === 1 ? "" : "s"} · stored
              in the database with the CSV on S3.
            </p>
          </div>
          <div className="table-panel">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted text-left">
                    <th className="px-3 py-2 font-semibold">Subject</th>
                    <th className="px-3 py-2 font-semibold">Branch</th>
                    <th className="px-3 py-2 font-semibold">Sem</th>
                    <th className="px-3 py-2 font-semibold">Teacher</th>
                    <th className="px-3 py-2 font-semibold">Rows</th>
                    <th className="px-3 py-2 font-semibold">File</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((d) => (
                    <tr key={d.id} className="border-t align-top">
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => navigate(`/students/${d.id}`)}
                          className="cursor-pointer text-primary underline-offset-4 hover:underline"
                        >
                          {d.subject_name}
                        </button>
                      </td>
                      <td className="px-3 py-2">{d.branch}</td>
                      <td className="px-3 py-2">{d.semester}</td>
                      <td className="px-3 py-2">{d.assigned_teacher}</td>
                      <td className="px-3 py-2">{d.row_count}</td>
                      <td className="px-3 py-2 text-xs">
                        {d.s3_url ? (
                          <a
                            href={d.s3_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {d.original_filename || "csv"}
                          </a>
                        ) : (
                          d.original_filename
                        )}
                        <span className="block text-muted-foreground">
                          {new Date(d.created_at).toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        </section>
      )}
    </main>
  );
}
