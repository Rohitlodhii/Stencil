import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/loading";
import type { Session } from "@/lib/auth";
import { fetchFinalExams, type FinalExam } from "@/lib/exam";

export function CheckExamsPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [exams, setExams] = useState<FinalExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setExams(await fetchFinalExams(session.user.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load exams.");
    } finally {
      setLoading(false);
    }
  }, [session.user.name]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-7" />
        <h1 className="font-title text-3xl font-bold leading-none tracking-tight">
          Check Exam
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        All exams assigned to {session.user.name} — press Check on any row to
        open its question paper, syllabus and students.
      </p>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-title text-xl font-bold tracking-tight">
            Assigned exams
          </h2>
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

        {loading ? (
          <InlineLoader message="Loading exams…" />
        ) : (
          <>
            {error && <p className="text-sm text-destructive">{error}</p>}

            {!error && exams.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No exams assigned to you yet.
              </p>
            )}

            {exams.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted text-left">
                      <th className="px-3 py-2 font-semibold">Subject</th>
                      <th className="px-3 py-2 font-semibold">Questions</th>
                      <th className="px-3 py-2 font-semibold">Marks</th>
                      <th className="px-3 py-2 font-semibold">Students</th>
                      <th className="px-3 py-2 font-semibold">Created</th>
                      <th className="px-3 py-2 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exams.map((e) => (
                      <tr key={e.id} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{e.subject_name}</td>
                        <td className="px-3 py-2">{e.total_questions}</td>
                        <td className="px-3 py-2">{e.total_marks}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {e.student_label || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            onClick={() => navigate(`/check-exam/${e.id}`)}
                            className="h-7 cursor-pointer p-1 pr-3 text-xs"
                          >
                            <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                              <ClipboardCheck className="size-3.5" />
                            </span>
                            Check
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
