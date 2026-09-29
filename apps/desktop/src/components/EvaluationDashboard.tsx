import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchEvaluationDashboard,
  updateModerationStatus,
  type EvaluationDashboard as DashboardData,
  type ModerationStatus,
} from "@/lib/exam";

const METRICS: Array<{
  key: keyof DashboardData["summary"];
  label: string;
}> = [
  { key: "total_assigned_students", label: "Assigned students" },
  { key: "completed_evaluations", label: "Completed" },
  { key: "pending_evaluations", label: "Pending" },
  { key: "evaluations_with_warnings", label: "With warnings" },
  { key: "average_awarded_marks", label: "Average marks" },
  { key: "scripts_needing_review", label: "Needs review" },
];

export function EvaluationDashboard({
  teacher = "",
}: {
  teacher?: string;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchEvaluationDashboard(teacher));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evaluation dashboard.");
    } finally {
      setLoading(false);
    }
  }, [teacher]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (
    examId: number,
    studentIndex: number,
    status: ModerationStatus,
  ) => {
    const key = `${examId}-${studentIndex}`;
    setUpdating(key);
    setError(null);
    try {
      await updateModerationStatus(examId, studentIndex, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update moderation status.");
    } finally {
      setUpdating("");
    }
  };

  return (
    <section className="flex flex-col gap-4 border-t pt-5">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-5" />
        <div>
          <h2 className="font-title text-xl font-bold tracking-tight">Evaluation overview</h2>
          <p className="text-sm text-muted-foreground">Progress and scripts routed for human moderation.</p>
        </div>
        <Button type="button" variant="secondary" onClick={load} disabled={loading} className="ml-auto h-8 cursor-pointer text-xs">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && !data && <p className="py-6 text-sm text-muted-foreground">Loading evaluation metrics…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {METRICS.map((metric) => (
              <div key={metric.key} className="rounded-md border bg-background p-3">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{data.summary[metric.key]}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Examiner progress</h3>
            {data.examiner_progress.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No examiner assignments are available yet.</p>
            ) : (
              <div className="divide-y rounded-md border bg-background">
                {data.examiner_progress.map((examiner) => (
                  <div key={examiner.examiner} className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[180px_1fr_auto] sm:items-center">
                    <span className="font-medium">{examiner.examiner}</span>
                    <div className="h-2 overflow-hidden rounded-sm bg-muted">
                      <div className="h-full bg-green-600" style={{ width: `${Math.min(100, examiner.percent)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{examiner.completed}/{examiner.assigned} · {examiner.percent}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            <span className="font-semibold">Human review only.</span> {data.notice}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Moderation queue</h3>
            {data.moderation.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center">
                <p className="text-sm font-medium">No completed evaluations yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Completed scripts and explainable review flags will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border bg-background">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted text-left">
                      <th className="px-3 py-2 font-semibold">Student / session</th>
                      <th className="px-3 py-2 font-semibold">Marks</th>
                      <th className="px-3 py-2 font-semibold">Warning type</th>
                      <th className="px-3 py-2 font-semibold">Examiner</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Script</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.moderation.map((row) => {
                      const key = `${row.final_exam_id}-${row.student_index}`;
                      return (
                        <tr key={key} className="border-t align-top">
                          <td className="px-3 py-2">
                            <p className="font-medium">{row.student_name || `Student ${row.student_index + 1}`}</p>
                            <p className="text-xs text-muted-foreground">{row.student_session_id} · {row.subject_name}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{row.final_marks} / {row.maximum_marks}</td>
                          <td className="max-w-72 px-3 py-2">
                            {row.warning_types.length === 0 ? (
                              <span className="text-xs text-muted-foreground">No rule flags</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {row.warning_details.map((warning) => (
                                  <Badge key={warning.code} variant="destructive" title={warning.message} className="gap-1">
                                    <AlertTriangle className="size-3" />
                                    {warning.code.split("_").join(" ")}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">{row.examiner}</td>
                          <td className="min-w-32 px-3 py-2">
                            <Select
                              value={row.status}
                              disabled={updating === key}
                              onValueChange={(value) => changeStatus(row.final_exam_id, row.student_index, value as ModerationStatus)}
                            >
                              <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="reviewed">Reviewed</SelectItem>
                                <SelectItem value="resolved">Resolved</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button type="button" variant="secondary" className="h-8 cursor-pointer text-xs" onClick={() => navigate(`/check-exam/${row.final_exam_id}/check/${row.student_index}`)}>
                              Open
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
