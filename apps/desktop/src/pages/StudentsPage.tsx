import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/loading";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-7" />
        <h1 className="font-title text-3xl font-bold leading-none tracking-tight">
          Students
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={() => navigate("/students/new")}
          className="cursor-pointer"
        >
          <span className="flex aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
            <Plus className="size-4" />
          </span>
          Add student data
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={load}
          className="ml-auto cursor-pointer"
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <InlineLoader message="Loading students…" />
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}

          {datasets.length === 0 && !error && (
            <Card className="border-0 bg-sidebar shadow-none">
              <CardHeader>
                <CardTitle className="font-title text-xl font-bold tracking-tight">
                  No student data yet
                </CardTitle>
                <CardDescription>
                  Upload a CSV with student marks and attendance to get started.
                </CardDescription>
              </CardHeader>
            </Card>
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
              <div className="overflow-x-auto rounded-md border">
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
        </>
      )}
    </main>
  );
}
