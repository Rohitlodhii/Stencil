import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvaluationDashboard } from "@/components/EvaluationDashboard";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import type { Session } from "@/lib/auth";
import { fetchFinalExams, type FinalExam } from "@/lib/exam";

export function TeacherDashboardPage({ session }: { session: Session }) {
  const [exams, setExams] = useState<FinalExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A teacher only ever sees exams assigned to them.
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
    <main className="app-page">
      <PageHeader title="Examiner dashboard" description={`${session.user.name} · ${session.user.teacher_id ?? "Examiner"} · ${session.user.college}`} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="section-heading">
            My exams
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

        {loading && <StatePanel state="loading" title="Loading assigned examinations" />}
        {error && <StatePanel state="error" title="Assignments unavailable" description={error} action={<Button variant="outline" onClick={load}>Try again</Button>} />}

        {!loading && !error && exams.length === 0 && (
          <StatePanel state="empty" title="No assigned examinations" description="New assignments will appear here when a coordinator allocates them to you." />
        )}

        {exams.length > 0 && (
          <div className="table-panel">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-3 py-2 font-semibold">Subject</th>
                  <th className="px-3 py-2 font-semibold">Questions</th>
                  <th className="px-3 py-2 font-semibold">Marks</th>
                  <th className="px-3 py-2 font-semibold">Students</th>
                  <th className="px-3 py-2 font-semibold">Created</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <EvaluationDashboard teacher={session.user.name} />
    </main>
  );
}
