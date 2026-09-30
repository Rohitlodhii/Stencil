import { CheckCircle2, Download, Laptop, ScanLine, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DESKTOP_DOWNLOADS, RELEASE_VERSIONS, SCANNER_DOWNLOADS, type ProductDownload } from "@/lib/desktop-downloads";
import { isTauriRuntime } from "@/lib/desktop-scanner";

function ProductReleases({ title, description, version, items }: { title: string; description: string; version: string; items: ProductDownload[] }) {
  const headingId = `${title.replace(/\s+/g, "-")}-heading`;
  const availableItems = items.filter((item) => item.url);
  return (
    <section className="app-section" aria-labelledby={headingId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 id={headingId} className="section-heading">{title}</h2><p className="section-description">{description}</p></div>
        <Badge variant="outline">Version {version}</Badge>
      </div>
      {availableItems.length > 0 ? <div className="divide-y rounded-lg border bg-card">
        {availableItems.map((item) => (
          <div key={item.platform} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{item.label}</p><p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
              {item.checksum && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">SHA-256: {item.checksum}</p>}
            </div>
            <Button asChild><a href={item.url} target="_blank" rel="noreferrer"><Download /> Download</a></Button>
          </div>
        ))}
      </div> : <div className="rounded-lg border border-dashed bg-card p-5"><p className="font-medium">No public installer is available for this application.</p><p className="mt-1 text-sm text-muted-foreground">Use the browser version until a signed release is published.</p></div>}
    </section>
  );
}

export function DesktopDownloadPage() {
  return (
    <main className="app-page max-w-5xl">
      <header className="border-b pb-6">
        <div className="mb-3 flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground"><Download className="size-5" /></div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">Applications</p>
        <h1 className="mt-1 font-title text-2xl font-semibold sm:text-[1.75rem]">Download Stencil</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Install the desktop workspace, the local scanner companion, or both. Downloads appear only after a release URL is configured.</p>
      </header>

      {isTauriRuntime() && <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-950"><Laptop className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">Stencil Desktop is running</p><p className="mt-1 text-sm">Install the scanner companion separately to capture pages with a local webcam.</p></div></div>}

      <ProductReleases title="Stencil Desktop App" description="The examination workspace in a dedicated desktop window." version={RELEASE_VERSIONS.desktop} items={DESKTOP_DOWNLOADS} />
      <ProductReleases title="Local Scanner Companion" description="Local camera, page detection, preview, and capture service. No database, S3, or AI credentials required." version={RELEASE_VERSIONS.scanner} items={SCANNER_DOWNLOADS} />

      <section className="app-section grid gap-6 border-t pt-6 md:grid-cols-2">
        <div><h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-primary" /> Installation</h2><ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground"><li>1. Download a published build for your operating system.</li><li>2. Verify the SHA-256 checksum when one is shown.</li><li>3. Install and open Stencil Scanner Companion.</li><li>4. Return to Sheet scanner and select Check connection.</li></ol></div>
        <div><h2 className="flex items-center gap-2 font-semibold"><ScanLine className="size-4 text-primary" /> Scanner setup</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground"><li>Connect the webcam before starting the companion.</li><li>Allow camera access in operating-system privacy settings.</li><li>Place the whole page on a contrasting, evenly lit surface.</li><li>The companion listens only on 127.0.0.1.</li></ul></div>
      </section>

      <section className="app-section border-t pt-6">
        <h2 className="flex items-center gap-2 font-semibold"><Wrench className="size-4 text-primary" /> Troubleshooting</h2>
        <div className="mt-3 grid gap-4 text-sm md:grid-cols-2"><div><p className="font-medium">Scanner disconnected</p><p className="mt-1 text-muted-foreground">Start the companion, then check the connection. If Stencil is hosted, add its exact origin to the companion trusted-origin configuration.</p></div><div><p className="font-medium">Camera unavailable</p><p className="mt-1 text-muted-foreground">Close other camera applications, reconnect the device, and confirm camera privacy permission.</p></div></div>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" /> Release links and checksums are supplied by deployment configuration; this page does not invent assets.</p>
      </section>
    </main>
  );
}
