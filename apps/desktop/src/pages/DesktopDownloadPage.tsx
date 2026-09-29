import { Download, Laptop, MonitorDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DESKTOP_DOWNLOADS } from "@/lib/desktop-downloads";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function DesktopDownloadPage() {
  const desktopRuntime = isTauri();
  const configuredBuilds = DESKTOP_DOWNLOADS.filter((item) => item.url).length;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-8 p-4 sm:p-6 lg:p-8">
      <header className="border-b pb-6">
        <div className="mb-3 flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <MonitorDown className="size-5" />
        </div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">Desktop application</p>
        <h1 className="mt-1 font-title text-3xl font-semibold tracking-normal">Get Stencil for desktop</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Use the same examination workspace in a dedicated desktop window. Scanner access remains available from the examiner navigation when its local service is running.
        </p>
      </header>

      {desktopRuntime && (
        <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
          <Laptop className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">You are using the desktop application</p>
            <p className="mt-1 text-sm">This page remains available so release links can be shared with other examiners.</p>
          </div>
        </div>
      )}

      <section aria-labelledby="platforms-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="platforms-heading" className="font-title text-xl font-semibold tracking-normal">Available platforms</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Download buttons appear only when a release URL is configured.
            </p>
          </div>
          <Badge variant="outline">{configuredBuilds} configured</Badge>
        </div>
        <div className="divide-y rounded-lg border bg-card">
          {DESKTOP_DOWNLOADS.map((item) => (
            <div key={item.platform} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
              </div>
              {item.url ? (
                <Button asChild>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <Download /> Download
                  </a>
                </Button>
              ) : (
                <Badge variant="secondary">Coming soon</Badge>
              )}
            </div>
          ))}
        </div>
      </section>

      <p className="rounded-md border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
        Release maintainers can configure <code>VITE_DESKTOP_WINDOWS_URL</code>, <code>VITE_DESKTOP_MACOS_URL</code>, and <code>VITE_DESKTOP_LINUX_URL</code>. No installer is advertised until its URL exists.
      </p>
    </main>
  );
}
