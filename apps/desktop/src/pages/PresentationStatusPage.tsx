import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  Printer,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadSession } from "@/lib/auth";
import {
  API_URL,
  fetchDemoReport,
  fetchStencilStatus,
  type DemoReport,
  type StencilStatus,
} from "@/lib/exam";

type ServiceState = "available" | "unavailable" | "enabled" | "disabled" | "checking";

const METRIC_LABELS: Record<keyof DemoReport["metrics"], string> = {
  test_pages: "Test pages",
  successful_captures: "Successful captures",
  rejected_images: "Rejected images",
  question_matching: "Question matching",
  validation_warnings: "Validation warnings",
  saved_evaluations: "Saved evaluations",
};

function StateBadge({ state }: { state: ServiceState }) {
  if (state === "checking") {
    return (
      <Badge variant="secondary">
        <Loader2 className="animate-spin" /> Checking
      </Badge>
    );
  }
  const positive = state === "available" || state === "enabled";
  return (
    <Badge variant={positive ? "secondary" : "destructive"}>
      {positive ? <CheckCircle2 /> : <AlertTriangle />}
      {state[0].toUpperCase() + state.slice(1)}
    </Badge>
  );
}

function SequenceBadge({ status }: { status: DemoReport["sequence"][number]["status"] }) {
  const label = {
    complete: "Complete",
    ready: "Ready",
    available: "Available",
    live_ai: "Live AI",
    demo: "Demo fallback",
  }[status];
  return (
    <Badge variant={status === "demo" ? "outline" : "secondary"}>
      {status === "complete" && <CheckCircle2 />}
      {label}
    </Badge>
  );
}

export function PresentationStatusPage() {
  const navigate = useNavigate();
  const session = loadSession();
  const [status, setStatus] = useState<StencilStatus | null>(null);
  const [report, setReport] = useState<DemoReport | null>(null);
  const [statusError, setStatusError] = useState("");
  const [reportError, setReportError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setStatusError("");
    setReportError("");
    const [statusResult, reportResult] = await Promise.allSettled([
      fetchStencilStatus(),
      fetchDemoReport(),
    ]);
    if (statusResult.status === "fulfilled") {
      setStatus(statusResult.value);
    } else {
      setStatus(null);
      setStatusError(
        statusResult.reason instanceof Error
          ? statusResult.reason.message
          : "Exam API status is unavailable.",
      );
    }
    if (reportResult.status === "fulfilled") {
      setReport(reportResult.value);
    } else {
      setReport(null);
      setReportError(
        reportResult.reason instanceof Error
          ? reportResult.reason.message
          : "Demo report is unavailable.",
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const services = useMemo<Array<{ name: string; state: ServiceState; detail: string }>>(
    () => [
      {
        name: "Frontend",
        state: "available" as ServiceState,
        detail: `Rendered from ${window.location.origin}`,
      },
      {
        name: "Exam API",
        state: status ? ("available" as ServiceState) : loading ? "checking" : "unavailable",
        detail: status ? `${API_URL} (${status.status})` : statusError || API_URL,
      },
      {
        name: "Scanner",
        state: loading
          ? "checking"
          : status?.scanner.available
            ? "available"
            : "unavailable",
        detail: status?.scanner.available
          ? `Health probe passed at ${status.scanner.url}`
          : status?.scanner.error || "Scanner service is not running.",
      },
      {
        name: "Database",
        state: loading
          ? "checking"
          : status?.database.available
            ? "available"
            : "unavailable",
        detail: status?.database.available
          ? "Connection probe passed."
          : status?.database.error || "Database status unavailable.",
      },
      {
        name: "AI provider",
        state: loading
          ? "checking"
          : status?.ai.available
            ? "available"
            : "unavailable",
        detail: status?.ai.available
          ? `Configured model: ${status.ai.model}`
          : `Not configured. Evaluation uses an explicitly labelled demo fallback (${status?.ai.model ?? "model unknown"}).`,
      },
      {
        name: "Storage",
        state: loading
          ? "checking"
          : status?.storage.available
            ? "available"
            : "unavailable",
        detail: status?.storage.available
          ? status.storage.mode === "local"
            ? "Local demo storage available; S3 is not required for this demo."
            : `S3 bucket available: ${status.storage.bucket}`
          : status?.storage.error || "Storage status unavailable.",
      },
      {
        name: "Demo mode",
        state: loading ? "checking" : status?.demo_mode ? "enabled" : "disabled",
        detail: status?.demo_mode
          ? "Seeded exam, students, rubric, local uploads, and labelled demo analysis are enabled."
          : "Production paths remain active; local demo data is disabled.",
      },
    ],
    [loading, status, statusError],
  );

  const exportReport = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      frontend: {
        available: true,
        origin: window.location.origin,
      },
      exam_api: {
        url: API_URL,
        status,
        error: statusError || null,
      },
      demo_report: report,
      demo_report_error: reportError || null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stencil-demo-report-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-page print:max-w-none print:p-0">
      <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Activity className="size-6 text-primary" />
            <h1 className="font-title text-2xl font-semibold sm:text-[1.75rem]">
              Technology status and demo evidence
            </h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Live service probes and locally recorded MVP evidence for architecture and prototype presentations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button type="button" variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
          <Button type="button" variant="secondary" onClick={exportReport} disabled={loading}>
            <Download /> Export JSON
          </Button>
          <Button type="button" variant="secondary" onClick={() => window.print()}>
            <Printer /> Print / PDF
          </Button>
        </div>
      </header>

      <section aria-labelledby="services-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="services-heading" className="font-title text-xl font-bold tracking-normal">
            System health
          </h2>
          <p className="text-sm text-muted-foreground">
            Availability is probed when this page loads or refreshes.
          </p>
        </div>
        <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {services.map((service) => (
            <article key={service.name} className="min-w-0 bg-background p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{service.name}</h3>
                <StateBadge state={service.state} />
              </div>
              <p className="mt-3 break-words text-xs leading-relaxed text-muted-foreground">
                {service.detail}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="sequence-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="sequence-heading" className="font-title text-xl font-bold tracking-normal">
              Demo sequence
            </h2>
            <p className="text-sm text-muted-foreground">
              Follow these seven steps during the prototype demonstration.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => navigate(session ? "/check-exam/900001/check/0" : "/")}
            className="print:hidden"
          >
            <Play /> {session ? "Open demo evaluation" : "Open DEMO MODE first"}
          </Button>
        </div>
        {report ? (
          <ol className="divide-y rounded-md border bg-background">
            {report.sequence.map((step, index) => (
              <li key={step.key} className="grid gap-3 p-4 sm:grid-cols-[32px_1fr_auto] sm:items-center">
                <span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{step.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                </div>
                <SequenceBadge status={step.status} />
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {loading ? "Loading demo sequence..." : reportError || "Demo sequence unavailable."}
          </div>
        )}
      </section>

      <section aria-labelledby="metrics-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="metrics-heading" className="font-title text-xl font-bold tracking-normal">
            Test and metrics summary
          </h2>
          <p className="text-sm text-muted-foreground">
            Counts come from current local uploads and saved evaluation records. No performance claim is inferred.
          </p>
        </div>
        {report ? (
          <>
            <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {(Object.entries(report.metrics) as Array<[keyof DemoReport["metrics"], DemoReport["metrics"][keyof DemoReport["metrics"]]]>).map(
                ([key, metric]) => (
                  <article key={key} className="bg-background p-4">
                    <p className="text-xs font-medium uppercase text-muted-foreground">{METRIC_LABELS[key]}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-normal">{metric.display}</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{metric.note}</p>
                  </article>
                ),
              )}
            </div>
            <div className="rounded-md border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">Measurement notes</p>
              {report.measurement_notes.map((note) => (
                <p key={note} className="mt-1">{note}</p>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Report generated {new Date(report.generated_at).toLocaleString()} · {report.scope}
            </p>
          </>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {loading ? "Loading metrics..." : reportError || "Metrics unavailable."}
          </div>
        )}
      </section>
    </main>
  );
}
