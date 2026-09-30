import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, UserCheck, UsersRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import {
  decideTeacherRequest,
  fetchTeacherRequests,
  type Session,
  type TeacherRequest,
} from "@/lib/auth";

const filters = ["pending", "approved", "rejected", "all"] as const;

export function TeachersPage({ session }: { session: Session }) {
  const [requests, setRequests] = useState<TeacherRequest[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number]>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTeacherRequests(session.token, filter);
      setRequests(data.requests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load requests.");
    } finally {
      setLoading(false);
    }
  }, [session.token, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: number, decision: "approved" | "rejected") => {
    setActing(id);
    setError(null);
    try {
      await decideTeacherRequest(session.token, id, decision);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed.");
    } finally {
      setActing(null);
    }
  };

  return (
    <main className="app-page max-w-6xl">
      <PageHeader
        title="Examiner management"
        description={`Review access requests and examiner status for ${session.user.college}.`}
        icon={UsersRound}
        actions={<Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</Button>}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="segmented-control" aria-label="Filter examiner requests">
          {filters.map((status) => (
            <button key={status} type="button" aria-pressed={filter === status} onClick={() => setFilter(status)}>
              {status}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{requests.length} {filter === "all" ? "record" : `${filter} request`}{requests.length === 1 ? "" : "s"}</p>
      </div>

      {loading && <StatePanel state="loading" title="Loading examiner requests" />}
      {error && <StatePanel state="error" title="Examiner requests unavailable" description={error} action={<Button variant="outline" onClick={load}>Try again</Button>} />}
      {!loading && !error && requests.length === 0 && (
        <StatePanel state="empty" title={`No ${filter} requests`} description="Requests matching this status will appear here." />
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="table-panel">
          <table>
            <thead>
              <tr><th>Examiner</th><th>Teacher ID</th><th>Status</th><th>Requested</th><th className="text-right">Action</th></tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td><p className="font-semibold">{request.name}</p><p className="text-xs text-muted-foreground">{request.email}</p></td>
                  <td className="whitespace-nowrap font-mono text-xs">{request.teacher_id}</td>
                  <td><Badge variant={request.status === "approved" ? "secondary" : request.status === "rejected" ? "destructive" : "outline"}><UserCheck /> {request.status}</Badge></td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{new Date(request.created_at).toLocaleDateString()}</td>
                  <td>
                    {request.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" disabled={acting === request.id} onClick={() => decide(request.id, "approved")}><Check /> Approve</Button>
                        <Button size="sm" variant="outline" disabled={acting === request.id} onClick={() => decide(request.id, "rejected")}><X /> Decline</Button>
                      </div>
                    ) : <span className="block text-right text-xs text-muted-foreground">No action required</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
