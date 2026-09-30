import { useCallback, useEffect, useRef, useState } from "react";
import { Camera as CameraIcon, Download, RefreshCw, ScanLine, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/FieldSelect";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SCANNER_EXPECTED_VERSION, SCANNER_URL, captureScan, fetchCameras, fetchHealth,
  fetchScans, fetchStatus, scanImageUrl, selectCamera, streamUrl,
  type Camera, type Scan, type ScannerStatus,
} from "@/lib/scanner";
import { isTauriRuntime, launchScannerCompanion } from "@/lib/desktop-scanner";

type ConnectionState = "checking" | "connected" | "disconnected" | "camera-unavailable";
type LocalPage = { name: string; url: string };

function connectionCopy(state: ConnectionState) {
  if (state === "checking") return "Checking scanner";
  if (state === "connected") return "Connected";
  if (state === "camera-unavailable") return "Camera unavailable";
  return "Disconnected";
}

export function ScannerView() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [version, setVersion] = useState("");
  const [scans, setScans] = useState<Scan[]>([]);
  const [localPages, setLocalPages] = useState<LocalPage[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [currentCamera, setCurrentCamera] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [switching, setSwitching] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const localPagesRef = useRef<LocalPage[]>([]);

  const loadScans = useCallback(async () => {
    try { setScans(await fetchScans()); } catch { /* Keep the last successful gallery. */ }
  }, []);

  const loadCameras = useCallback(async () => {
    try {
      const result = await fetchCameras();
      setCameras(result.cameras);
      setCurrentCamera(result.current);
    } catch { setCameras([]); }
  }, []);

  const checkScanner = useCallback(async () => {
    try {
      const [health, nextStatus] = await Promise.all([fetchHealth(), fetchStatus()]);
      setVersion(health.version);
      setStatus(nextStatus);
      setCurrentCamera(nextStatus.camera_index);
      setConnection(nextStatus.camera_available ? "connected" : "camera-unavailable");
      setMessage(nextStatus.camera_error || "");
      return true;
    } catch {
      setStatus(null);
      setConnection("disconnected");
      setMessage("The local scanner companion is not running or this site is not in its trusted origins.");
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setConnection("checking");
    if (await checkScanner()) await Promise.all([loadCameras(), loadScans()]);
  }, [checkScanner, loadCameras, loadScans]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void checkScanner(), 1500);
    return () => window.clearInterval(id);
  }, [checkScanner, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (connection !== "disconnected") void loadScans();
    }, 4000);
    return () => window.clearInterval(id);
  }, [connection, loadScans]);

  useEffect(() => { localPagesRef.current = localPages; }, [localPages]);
  useEffect(() => () => localPagesRef.current.forEach((page) => URL.revokeObjectURL(page.url)), []);

  const onSelectCamera = async (index: number) => {
    setSwitching(true);
    try {
      setCurrentCamera(await selectCamera(index));
      setMessage("Camera changed. Waiting for the first frame.");
      window.setTimeout(() => void checkScanner(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Camera selection failed.");
    } finally { setSwitching(false); }
  };

  const onCapture = async () => {
    setCapturing(true);
    try {
      const filename = await captureScan();
      setMessage(`Captured ${filename}`);
      await loadScans();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Capture failed. Check that the full page is visible.");
    } finally { setCapturing(false); }
  };

  const onLocalUpload = (files: FileList | null) => {
    if (!files) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      setMessage("Choose one or more JPG, PNG, or WebP answer-sheet images.");
      return;
    }
    setLocalPages((current) => [...current, ...images.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))]);
    setMessage(`${images.length} page${images.length === 1 ? "" : "s"} added from this device.`);
  };

  const onStartScanner = async () => {
    setStarting(true);
    try {
      const result = await launchScannerCompanion();
      setMessage(result.already_running ? "Scanner companion is already starting." : "Scanner companion started. Connecting...");
      window.setTimeout(() => void refresh(), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scanner companion could not be started.");
    } finally { setStarting(false); }
  };

  const connected = connection === "connected";
  const versionMismatch = Boolean(version && version !== SCANNER_EXPECTED_VERSION);

  return (
    <main className="app-page max-w-6xl">
      <PageHeader title="Sheet scanner" description="Capture answer sheets with the local companion, or add images from this device." icon={ScanLine}
        actions={<Button variant="outline" onClick={() => void refresh()}><RefreshCw /> Check connection</Button>} />

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className={`size-2.5 rounded-full ${connected ? "bg-emerald-500" : connection === "camera-unavailable" ? "bg-amber-500" : "bg-slate-400"}`} />
              {connectionCopy(connection)}
            </CardTitle>
            <CardDescription className="mt-1">
              {connected ? `Scanner ${version} at ${SCANNER_URL}` : connection === "camera-unavailable" ? message : `Camera scanning requires the companion on this computer (${SCANNER_URL}).`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {versionMismatch && <Badge variant="outline">Expected version {SCANNER_EXPECTED_VERSION}</Badge>}
            <Badge variant={connected ? "secondary" : "outline"}>{connectionCopy(connection)}</Badge>
          </div>
        </CardHeader>
        {connection === "disconnected" && (
          <CardContent className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-sm text-muted-foreground">Install and start Stencil Scanner Companion, then return here and check the connection. The hosted API remains available without it.</p>
            {isTauriRuntime() ? (
              <Button onClick={() => void onStartScanner()} disabled={starting}><CameraIcon /> {starting ? "Starting..." : "Start scanner"}</Button>
            ) : (
              <Button asChild><a href="#/download"><Download /> Download scanner</a></Button>
            )}
          </CardContent>
        )}
      </Card>

      {(connected || connection === "camera-unavailable") && (
        <Card>
          <CardHeader><CardTitle>Camera and capture</CardTitle><CardDescription>Page detection and image processing remain on this computer.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-64">
                <label className="mb-1.5 block text-sm font-medium">Camera</label>
                <FieldSelect value={currentCamera === null ? "" : String(currentCamera)} onChange={(value) => void onSelectCamera(Number(value))}
                  placeholder="Select camera" options={cameras.map((camera) => ({ value: String(camera.index), label: camera.label }))}
                  disabled={switching || cameras.length === 0} ariaLabel="Camera" />
              </div>
              {status?.sheet_detected && <Badge variant="secondary">Sheet detected: {status.stable_count}/{status.required_frames}</Badge>}
            </div>
            {connected ? <img key={currentCamera ?? "preview"} src={streamUrl()} alt="Live local scanner preview" className="aspect-[4/3] w-full rounded-md border bg-muted object-contain" />
              : <StatePanel state="error" title="Scanner connected, but no camera is available" description={message || "Connect a camera, allow operating-system camera access, and refresh devices."} />}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" className="text-sm text-muted-foreground">{message || "Place the complete page on a contrasting surface and hold it steady."}</p>
              <Button size="lg" onClick={() => void onCapture()} disabled={capturing || !connected} className="w-full sm:w-auto"><CameraIcon /> {capturing ? "Capturing..." : "Capture answer sheet"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="app-section">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="section-heading">Browser upload fallback</h2><p className="section-description">Use existing answer-sheet images when the scanner companion or camera is unavailable.</p></div>
          <Button variant="outline" asChild><label className="cursor-pointer"><Upload /> Add images<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => onLocalUpload(event.target.files)} /></label></Button>
        </div>
        {localPages.length > 0 && <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{localPages.map((page) => (
          <Card key={page.url} className="gap-0 overflow-hidden py-0"><img src={page.url} alt={`Uploaded page ${page.name}`} className="aspect-[3/4] w-full bg-muted object-contain" /><CardContent className="py-2"><p className="truncate text-xs text-muted-foreground">{page.name}</p></CardContent></Card>
        ))}</div>}
      </section>

      <section className="app-section">
        <div><h2 className="section-heading">Scanner captures</h2><p className="section-description">Pages stored by the local companion on this computer.</p></div>
        {scans.length === 0 ? <StatePanel state="empty" title="No scanner captures" description="Captured pages will appear here after the companion saves them." />
          : <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{scans.map((scan) => (
            <Card key={scan.filename} className="gap-0 overflow-hidden py-0"><img src={scanImageUrl(scan.filename)} alt={scan.filename} className="w-full" loading="lazy" /><CardContent className="py-2"><p className="truncate text-xs text-muted-foreground">{scan.filename}</p></CardContent></Card>
          ))}</div>}
      </section>
    </main>
  );
}
