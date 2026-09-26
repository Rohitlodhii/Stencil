import { useCallback, useEffect, useRef, useState } from "react";
import { Camera as CameraIcon, RefreshCw, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/FieldSelect";
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
    <main className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <ScanLine className="size-7" />
        <h1 className="text-3xl font-bold tracking-tight">Sheet Scanner</h1>
      </div>

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
          <Button
            variant="outline"
            size="sm"
            onClick={loadCameras}
            disabled={switching}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
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

      <Card>
        <CardContent className="pt-6">
          {/* Live MJPEG preview served by the Python scanner. */}
          <img
            key={currentCamera ?? "preview"}
            src={streamUrl()}
            alt="Live scanner preview"
            className="w-full rounded-md border"
          />
          <div className="mt-4">
            <Button onClick={onCapture} disabled={capturing}>
              <CameraIcon className="size-4" />
              {capturing ? "Capturing…" : "Capture"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Scans</h2>
        {scans.length === 0 ? (
          <p className="text-muted-foreground">No scans yet.</p>
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
