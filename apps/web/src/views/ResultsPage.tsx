import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Award, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchReleasedExams, lookupReleasedResult } from "@/lib/exam";
import type { ReleasedExam, ResultLookup } from "@/lib/exam";

const inputCls =
  "h-10 flex-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Public results route (/results) — web only, no login required. */
export function ResultsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = Number(searchParams.get("exam") ?? "");
  const hasSelection = Number.isFinite(selectedId) && selectedId > 0;
  const [exams, setExams] = useState<ReleasedExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultLookup | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setExams(await fetchReleasedExams());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load results.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setQuery("");
    setResult(null);
    setLookupError(null);
  }, [selectedId]);
  const selected = useMemo(
    () => exams.find((e) => e.id === selectedId) ?? null,
    [exams, selectedId],
  );
  const onSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!hasSelection || !query.trim()) {
      setLookupError("Type your roll no / enrollment no to search.");
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    setResult(null);
    try {
      setResult(await lookupReleasedResult(selectedId, query.trim()));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setLookupLoading(false);
    }
  };
  const pickCandidate = (value: string) => {
    setQuery(value);
    lookupReleasedResult(selectedId, value)
      .then(setResult)
      .catch((err) => setLookupError(err instanceof Error ? err.message : "Search failed."));
  };
  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <Award className="size-7" />
        <h1 className="font-title text-3xl font-bold leading-none tracking-tight">Results</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Released results. Pick an exam, then search by the unique field (e.g. roll no).
      </p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && exams.length === 0 && (
        <Card className="border-0 bg-sidebar shadow-none">
          <CardHeader>
            <CardTitle className="font-title text-xl font-bold tracking-tight">No results yet</CardTitle>
            <CardDescription>Results appear here once released.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!loading && !error && exams.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-title text-xl font-bold tracking-tight">Released exams</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-3 py-2 font-semibold">Subject</th>
                  <th className="px-3 py-2 font-semibold">Max</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="px-3 py-2 font-medium">{e.subject_name}</td>
                    <td className="px-3 py-2">{e.total_marks}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant={e.id === selectedId ? "secondary" : "default"}
                        onClick={() => setSearchParams(e.id === selectedId ? {} : { exam: String(e.id) })}
                        className="h-7 cursor-pointer text-xs"
                      >
                        {e.id === selectedId ? "Selected" : "View result"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {hasSelection && (
        <section className="flex flex-col gap-3">
          <Card className="border-0 bg-sidebar shadow-none">
            <CardHeader>
              <CardTitle className="font-title text-xl font-bold tracking-tight">
                {selected ? selected.subject_name : `Exam #${selectedId}`}
              </CardTitle>
              <CardDescription>
                {selected?.unique_field ? `Search by ${selected.unique_field}.` : "Search by unique field."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <form onSubmit={onSearch} className="flex gap-2">
                <input value={query} onChange={(e) => setQuery(e.target.value)} className={inputCls} />
                <Button type="submit" disabled={lookupLoading || !query.trim()} className="cursor-pointer">
                  {lookupLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  Search
                </Button>
              </form>
              {lookupError && <p className="text-sm text-destructive">{lookupError}</p>}
              {result?.match === "single" && (
                <div className="flex flex-col gap-2 rounded-md border bg-background p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">{result.student.student_name || result.student.unique_value}</h3>
                    {result.student.updated_by_teacher && <Badge variant="secondary">teacher updated</Badge>}
                  </div>
                  <p className="text-sm">Max marks: {result.student.max_marks ?? "—"}</p>
                  <p className="text-sm">Obtained: {result.student.obtained_marks ?? "Not entered"}</p>
                </div>
              )}
              {result?.match === "candidates" && (
                <div className="flex flex-wrap gap-2">
                  {result.candidates.map((c) => (
                    <Button key={c.row_index} type="button" variant="secondary" onClick={() => pickCandidate(String(c[result.search_column] ?? ""))} className="h-7 text-xs">
                      {String(c[result.search_column] ?? "")}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Button type="button" variant="ghost" onClick={() => navigate("/results")} className="w-fit text-xs">
            <ArrowLeft className="size-3.5" /> Back
          </Button>
        </section>
      )}
    </main>
  );
}