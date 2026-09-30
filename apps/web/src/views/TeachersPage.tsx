import { useCallback, useEffect, useState } from "react";
import {
  decideTeacherRequest,
  fetchTeacherRequests,
  type Session,
  type TeacherRequest,
} from "@/lib/auth";

export function TeachersPage({ session }: { session: Session }) {
  const [requests, setRequests] = useState<TeacherRequest[]>([]);
  const [filter, setFilter] = useState("pending");
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
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Teachers</h1>
        <p className="text-sm text-muted-foreground">
          Approve teacher registrations for {session.user.college}.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`inline-flex h-7 items-center rounded-md border px-2 text-xs capitalize ${
              filter === s ? "bg-primary text-primary-foreground" : "bg-background"
            }`}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={load}
          className="ml-auto inline-flex h-7 items-center rounded-md border px-2 text-xs"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && requests.length === 0 && (
        <p className="text-sm text-muted-foreground">No {filter} requests.</p>
      )}
      <div className="flex flex-col gap-3">
        {requests.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {r.name} <span className="font-normal text-muted-foreground">({r.teacher_id})</span>
              </p>
              <p className="truncate text-sm text-muted-foreground">{r.email}</p>
              <p className="text-xs text-muted-foreground">
                {r.college} · {r.status} · {new Date(r.created_at).toLocaleString()}
              </p>
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={acting === r.id}
                  onClick={() => decide(r.id, "approved")}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={acting === r.id}
                  onClick={() => decide(r.id, "rejected")}
                  className="inline-flex h-8 items-center rounded-md border border-destructive px-3 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
