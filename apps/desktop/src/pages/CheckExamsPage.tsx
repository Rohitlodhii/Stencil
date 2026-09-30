import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
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
    <main className="app-page max-w-6xl">
      <PageHeader title="Assigned examinations" icon={ClipboardCheck} description={`Review question papers, rubrics, and student scripts assigned to ${session.user.name}.`} actions={<Button type="button" variant="outline" onClick={load}><RefreshCw /> Refresh</Button>} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="section-heading">Examination queue</h2>
        </div>

        {loading && <StatePanel state="loading" title="Loading examination queue" />}
        {error && <StatePanel state="error" title="Queue unavailable" description={error} action={<Button variant="outline" onClick={load}>Try again</Button>} />}

        {!loading && !error && exams.length === 0 && (
          <StatePanel state="empty" title="No assigned examinations" description="Assigned examinations will appear here when they are ready for evaluation." />
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
                        className="h-8 cursor-pointer text-xs"
                      >
                        <ClipboardCheck className="size-3.5" /> Evaluate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
