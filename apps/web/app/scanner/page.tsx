"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SCANNER_URL =
  process.env.NEXT_PUBLIC_SCANNER_URL ?? "http://localhost:8000";

type Status = {
  sheet_detected: boolean;
  stable: boolean;
  stable_count: number;
  required_frames: number;
  corners: number[][] | null;
  camera_index: number;
};

type Scan = {
  filename: string;
  timestamp: string;
};

type Camera = {
  index: number;
  label: string;
};

function statusLabel(status: Status | null, lastCapture: string | null) {
  if (!status) return "Connecting to scanner…";
  if (status.stable) return "Stable — capturing…";
  if (status.sheet_detected)
    return `Sheet detected — hold still (${status.stable_count}/${status.required_frames})`;
  if (lastCapture) return lastCapture;
  return "No sheet detected";
}

export default function ScannerPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [currentCamera, setCurrentCamera] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const lastCaptureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchScans = useCallback(async () => {
    try {
      const res = await fetch(`${SCANNER_URL}/scans`);
      if (!res.ok) return;
      const data = await res.json();
      setScans(data.scans ?? []);
    } catch {
      // Scanner offline — gallery simply stays as-is.
    }
  }, []);

  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch(`${SCANNER_URL}/cameras`);
      if (!res.ok) return;
      const data = await res.json();
      setCameras(data.cameras ?? []);
      if (typeof data.current === "number") setCurrentCamera(data.current);
    } catch {
      // Scanner offline — selector simply stays as-is.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${SCANNER_URL}/status`);
        if (!res.ok) return;
        const data: Status = await res.json();
        setStatus(data);
        setCurrentCamera(data.camera_index);
      } catch {
        setStatus(null);
      }
    }, 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchScans();
    fetchCameras();
    const id = setInterval(fetchScans, 3000); // picks up auto-captures
    return () => clearInterval(id);
  }, [fetchScans, fetchCameras]);

  useEffect(() => {
    return () => {
      if (lastCaptureTimer.current) clearTimeout(lastCaptureTimer.current);
    };
  }, []);

  const onSelectCamera = async (index: number) => {
    setSwitching(true);
    try {
      const res = await fetch(`${SCANNER_URL}/camera`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentCamera(data.camera_index);
      }
    } catch {
      // Scanner offline — selection stays as-is.
    } finally {
      setSwitching(false);
    }
  };

  const onCapture = async () => {
    setCapturing(true);
    try {
      const res = await fetch(`${SCANNER_URL}/capture`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setLastCapture(`Captured ${data.filename}`);
        if (lastCaptureTimer.current) clearTimeout(lastCaptureTimer.current);
        lastCaptureTimer.current = setTimeout(() => setLastCapture(null), 5000);
        await fetchScans();
      } else {
        setLastCapture("Capture failed — no sheet in view");
      }
    } catch {
      setLastCapture("Capture failed — scanner unreachable");
    } finally {
      setCapturing(false);
    }
  };

  const indicator = !status
    ? "bg-gray-400"
    : status.stable
      ? "bg-green-500"
      : status.sheet_detected
        ? "bg-yellow-400"
        : "bg-gray-400";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <h1 className="text-3xl font-bold">Sheet Scanner</h1>

      <div className="flex items-center gap-3">
        <span className={`inline-block h-3 w-3 rounded-full ${indicator}`} />
        <p className="text-lg">{statusLabel(status, lastCapture)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="camera" className="font-medium">
          Camera
        </label>
        <select
          id="camera"
          value={currentCamera ?? ""}
          onChange={(e) => onSelectCamera(Number(e.target.value))}
          disabled={switching || cameras.length === 0}
          className="rounded border px-3 py-1.5"
        >
          {currentCamera === null && <option value="">Select…</option>}
          {cameras.map((cam) => (
            <option key={cam.index} value={cam.index}>
              {cam.label}
            </option>
          ))}
        </select>
        <button
          onClick={fetchCameras}
          className="rounded border px-3 py-1.5 text-sm"
        >
          Refresh
        </button>
        {cameras.length === 0 && (
          <span className="text-sm text-gray-500">
            No cameras found — check the scanner server.
          </span>
        )}
      </div>

      {/* Live MJPEG preview served by the Python scanner (no browser camera). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${SCANNER_URL}/stream`}
        alt="Live scanner preview"
        className="w-full rounded border"
      />

      <button
        onClick={onCapture}
        disabled={capturing}
        className="w-fit rounded bg-blue-600 px-6 py-2 font-semibold text-white disabled:opacity-50"
      >
        {capturing ? "Capturing…" : "Capture"}
      </button>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Scans</h2>
        {scans.length === 0 ? (
          <p className="text-gray-500">No scans yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {scans.map((scan) => (
              <figure key={scan.filename} className="rounded border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${SCANNER_URL}/scans/${scan.filename}`}
                  alt={scan.filename}
                  className="w-full rounded"
                  loading="lazy"
                />
                <figcaption className="mt-1 text-xs text-gray-600">
                  {scan.filename}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
