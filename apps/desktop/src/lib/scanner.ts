/** Typed client for the OpenCV sheet-scanner backend (FastAPI). */

function defaultScannerUrl() {
  if (typeof window === "undefined") return "http://localhost:8000";
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  return localHosts.has(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : `${window.location.origin}/scanner`;
}

export const SCANNER_URL =
  import.meta.env.VITE_SCANNER_URL ?? defaultScannerUrl();

export type ScannerStatus = {
  sheet_detected: boolean;
  stable: boolean;
  stable_count: number;
  required_frames: number;
  corners: number[][] | null;
  camera_index: number;
};

export type Scan = {
  filename: string;
  timestamp: string;
};

export type Camera = {
  index: number;
  label: string;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SCANNER_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchStatus() {
  return get<ScannerStatus>("/status");
}

export async function fetchScans(): Promise<Scan[]> {
  const data = await get<{ scans: Scan[] }>("/scans");
  return data.scans ?? [];
}

export async function fetchCameras(): Promise<{
  cameras: Camera[];
  current: number | null;
}> {
  const data = await get<{ cameras: Camera[]; current: unknown }>("/cameras");
  return {
    cameras: data.cameras ?? [],
    current: typeof data.current === "number" ? data.current : null,
  };
}

export async function selectCamera(index: number): Promise<number> {
  const res = await fetch(`${SCANNER_URL}/camera`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  if (!res.ok) throw new Error(`select camera failed: ${res.status}`);
  const data = (await res.json()) as { camera_index: number };
  return data.camera_index;
}

export async function captureScan(): Promise<string> {
  const res = await fetch(`${SCANNER_URL}/capture`, { method: "POST" });
  if (!res.ok) throw new Error(`capture failed: ${res.status}`);
  const data = (await res.json()) as { filename: string };
  return data.filename;
}

export function streamUrl() {
  return `${SCANNER_URL}/stream`;
}

export function scanImageUrl(filename: string) {
  return `${SCANNER_URL}/scans/${filename}`;
}
