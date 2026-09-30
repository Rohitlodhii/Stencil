import { useCallback, useEffect, useRef, useState } from "react";
import { Camera as CameraIcon, RefreshCw, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/FieldSelect";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  SCANNER_URL,
  captureScan,
  fetchCameras,
  fetchScans,
  fetchStatus,
  scanImageUrl,
  selectCamera,
  streamUrl,
  type Camera,
  type Scan,
  type ScannerStatus,
} from "@/lib/scanner";

function statusLabel(status: ScannerStatus | null, lastCapture: string | null) {
  if (!status) return "Connecting to scanner…";
  if (status.stable) return "Stable — capturing…";
  if (status.sheet_detected)
    return `Sheet detected — hold still (${status.stable_count}/${status.required_frames})`;
  if (lastCapture) return lastCapture;
  return "No sheet detected";
}

export function ScannerView() {
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [currentCamera, setCurrentCamera] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const lastCaptureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadScans = useCallback(async () => {
    try {
      setScans(await fetchScans());
    } catch {
      // Scanner offline — gallery simply stays as-is.
    }
  }, []);

  const loadCameras = useCallback(async () => {
    try {
      const { cameras: found, current } = await fetchCameras();
      setCameras(found);
      if (current !== null) setCurrentCamera(current);
    } catch {
      // Scanner offline — selector simply stays as-is.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const data = await fetchStatus();
        setStatus(data);
        setCurrentCamera(data.camera_index);
      } catch {
        setStatus(null);
      }
    }, 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadScans();
    loadCameras();
    const id = setInterval(loadScans, 3000); // picks up auto-captures
    return () => clearInterval(id);
  }, [loadScans, loadCameras]);

  useEffect(() => {
    return () => {
      if (lastCaptureTimer.current) clearTimeout(lastCaptureTimer.current);
    };
  }, []);

  const onSelectCamera = async (index: number) => {
    setSwitching(true);
    try {
      setCurrentCamera(await selectCamera(index));
    } catch {
      // Scanner offline — selection stays as-is.
    } finally {
      setSwitching(false);
    }
  };

  const onCapture = async () => {
    setCapturing(true);
    try {
      const filename = await captureScan();
      setLastCapture(`Captured ${filename}`);
      if (lastCaptureTimer.current) clearTimeout(lastCaptureTimer.current);
      lastCaptureTimer.current = setTimeout(() => setLastCapture(null), 5000);
      await loadScans();
    } catch {
      setLastCapture("Capture failed — no sheet in view");
    } finally {
      setCapturing(false);
    }
  };

  const badgeVariant = !status
    ? "secondary"
    : status.stable
      ? "default"
      : status.sheet_detected
        ? "outline"
        : "secondary";

  const dot = !status
    ? "bg-gray-400"
    : status.stable
      ? "bg-green-500"
      : status.sheet_detected
        ? "bg-yellow-400"
        : "bg-gray-400";

  return (
    <main className="app-page max-w-6xl">
      <PageHeader
        title="Sheet scanner"
        description="Capture aligned answer-sheet pages from a connected camera before evaluation."
        icon={ScanLine}
        actions={<Button variant="outline" onClick={() => { loadCameras(); loadScans(); }}><RefreshCw /> Refresh devices</Button>}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <span className={`inline-block size-3 rounded-full ${dot}`} />
            <span>{statusLabel(status, lastCapture)}</span>
          </CardTitle>
          <CardDescription>
            {status
              ? `Camera ${status.camera_index} · ${status.stable_count}/${status.required_frames} stable frames`
              : `Waiting for the scanner at ${SCANNER_URL}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <label htmlFor="camera" className="text-sm font-medium">
            Camera
          </label>
          <div className="w-48">
            <FieldSelect
              value={currentCamera === null ? "" : String(currentCamera)}
              onChange={(v) => onSelectCamera(Number(v))}
              placeholder="Select…"
              options={cameras.map((cam) => ({
                value: String(cam.index),
                label: cam.label,
              }))}
              disabled={switching || cameras.length === 0}
              ariaLabel="Camera"
            />
          </div>
          {status && (
            <Badge variant={badgeVariant}>
              {status.stable
                ? "stable"
                : status.sheet_detected
                  ? "sheet detected"
                  : "no sheet"}
            </Badge>
          )}
          {cameras.length === 0 && (
            <span className="text-sm text-muted-foreground">
              No cameras found — check the scanner server.
            </span>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent>
          {/* Live MJPEG preview served by the Python scanner. */}
          {status ? <img
              key={currentCamera ?? "preview"}
              src={streamUrl()}
              alt="Live scanner preview"
              className="aspect-[4/3] w-full rounded-md border bg-muted object-contain"
            /> : <StatePanel state="error" title="Scanner service is offline" description={`Start the scanner service and confirm it is reachable at ${SCANNER_URL}. The browser does not activate a camera on this page by itself.`} />}
          <div className="mt-4 flex justify-end">
            <Button size="lg" onClick={onCapture} disabled={capturing || !status} className="w-full sm:w-auto">
              <CameraIcon className="size-4" />
              {capturing ? "Capturing…" : "Capture answer sheet"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="app-section">
        <div><h2 className="section-heading">Recent captures</h2><p className="section-description">Captured pages remain available for review in this scanner session.</p></div>
        {scans.length === 0 ? (
          <StatePanel state="empty" title="No captured pages" description="Captured answer-sheet pages will appear here." />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {scans.map((scan) => (
              <Card key={scan.filename} className="gap-0 overflow-hidden py-0">
                <img
                  src={scanImageUrl(scan.filename)}
                  alt={scan.filename}
                  className="w-full"
                  loading="lazy"
                />
                <CardContent className="py-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {scan.filename}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
