import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus2, Megaphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Session } from "@/lib/auth";
import {
  fetchFinalExams,
  fetchSavedExams,
  releaseFinalExam,
  unreleaseFinalExam,
  type FinalExam,
  type SavedExam,
} from "@/lib/exam";

export function CoordinatorDashboardPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [exams, setExams] = useState<SavedExam[]>([]);
  const [finalExams, setFinalExams] = useState<FinalExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [releaseBusy, setReleaseBusy] = useState<number | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [syllabus, finals] = await Promise.all([
        fetchSavedExams(),
        fetchFinalExams(),
      ]);
      setExams(syllabus);
      setFinalExams(finals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load exams.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRelease = async (exam: FinalExam) => {
    setReleaseBusy(exam.id);
    setReleaseError(null);
    try {
      const res = exam.is_released
        ? await unreleaseFinalExam(exam.id)
        : await releaseFinalExam(exam.id);
      setFinalExams((prev) =>
        prev.map((e) =>
          e.id === exam.id
            ? { ...e, is_released: res.is_released, released_at: res.released_at }
            : e,
        ),
      );
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : "Release failed.");
    } finally {
      setReleaseBusy(null);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold tracking-tight">Coordinator dashboard</h1>
      <p className="text-sm text-muted-foreground">
        Welcome {session.user.name} — {session.user.college}.
      </p>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-title text-xl font-bold tracking-tight">
            Created exams
          </h2>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={load}
              className="h-7 cursor-pointer text-xs"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
            <Button
              type="button"
              onClick={() => navigate("/exam")}
              className="h-7 cursor-pointer p-1 pr-3 text-xs"
            >
              <span className="flex h-full aspect-square items-center justify-center rounded-sm bg-secondary p-1 text-secondary-foreground">
                <FilePlus2 className="size-3.5" />
              </span>
              New exam
            </Button>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {releaseError && <p className="text-sm text-destructive">{releaseError}</p>}

        {!loading && !error && finalExams.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No created exams yet — build one from the exam page.
          </p>
        )}

        {finalExams.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-3 py-2 font-semibold">Subject</th>
                  <th className="px-3 py-2 font-semibold">Questions</th>
                  <th className="px-3 py-2 font-semibold">Marks</th>
                  <th className="px-3 py-2 font-semibold">Teacher</th>
                  <th className="px-3 py-2 font-semibold">Students</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Results</th>
                </tr>
              </thead>
              <tbody>
                {finalExams.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="px-3 py-2 font-medium">{e.subject_name}</td>
                    <td className="px-3 py-2">{e.total_questions}</td>
                    <td className="px-3 py-2">{e.total_marks}</td>
                    <td className="px-3 py-2">{e.assigned_teacher}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.student_label || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {e.is_released ? (
                        <Badge className="bg-green-600 text-white">Released</Badge>
                      ) : (
                        <Badge variant="secondary">Not released</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant={e.is_released ? "secondary" : "default"}
                        disabled={releaseBusy === e.id || (!e.is_released && !e.student_dataset_id)}
                        title={!e.is_released && !e.student_dataset_id ? "Link a student list first" : undefined}
                        onClick={() => toggleRelease(e)}
                        className="h-7 cursor-pointer text-xs"
                      >
                        <Megaphone className="size-3.5" />
                        {releaseBusy === e.id
                          ? "Working…"
                          : e.is_released
                            ? "Unrelease"
                            : "Release results"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-title text-xl font-bold tracking-tight">
            Saved exams
          </h2>
          <p className="text-sm text-muted-foreground">
            Syllabus analyses saved from the exam page.
          </p>
        </div>

        {!loading && !error && exams.length === 0 && (
          <p className="text-sm text-muted-foreground">No saved exams yet.</p>
        )}

        {exams.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Pages</th>
                  <th className="px-3 py-2 font-semibold">Saved</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="px-3 py-2 font-medium">{e.name}</td>
                    <td className="px-3 py-2">{e.num_images}</td>
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
    </main>
  );
}
