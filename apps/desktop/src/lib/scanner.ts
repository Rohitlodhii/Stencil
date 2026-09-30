/** Typed client for the local Stencil Scanner Companion. */

function configuredScannerUrl() {
  const configured = import.meta.env.VITE_SCANNER_URL?.trim();
  return (configured || "http://127.0.0.1:8000").replace(/\/$/, "");
}

export const SCANNER_URL = configuredScannerUrl();
export const SCANNER_EXPECTED_VERSION =
  import.meta.env.VITE_SCANNER_VERSION?.trim() || "0.2.0";

export type ScannerStatus = {
  sheet_detected: boolean;
  stable: boolean;
  stable_count: number;
  required_frames: number;
  corners: number[][] | null;
  camera_index: number;
  camera_available: boolean;
  camera_error: string | null;
};

export type ScannerHealth = {
  status: "ok";
  version: string;
  camera_available: boolean;
  service: "stencil-scanner-companion";
};

export type Scan = { filename: string; timestamp: string };
export type Camera = { index: number; label: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SCANNER_URL}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(2500),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Scanner request failed with HTTP ${res.status}.`);
  }
  return res.json() as Promise<T>;
}

export function fetchHealth() { return request<ScannerHealth>("/health"); }
export function fetchStatus() { return request<ScannerStatus>("/status"); }

export async function fetchScans(): Promise<Scan[]> {
  const data = await request<{ scans: Scan[] }>("/scans");
  return data.scans ?? [];
}

export async function fetchCameras(): Promise<{ cameras: Camera[]; current: number | null }> {
  const data = await request<{ cameras: Camera[]; current: unknown }>("/cameras");
  return { cameras: data.cameras ?? [], current: typeof data.current === "number" ? data.current : null };
}

export async function selectCamera(index: number): Promise<number> {
  const data = await request<{ camera_index: number }>("/camera", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  return data.camera_index;
}

export async function captureScan(): Promise<string> {
  const data = await request<{ filename: string }>("/capture", { method: "POST" });
  return data.filename;
}

export function streamUrl() { return `${SCANNER_URL}/stream`; }
export function scanImageUrl(filename: string) { return `${SCANNER_URL}/scans/${encodeURIComponent(filename)}`; }
