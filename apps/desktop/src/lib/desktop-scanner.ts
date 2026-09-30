export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type ScannerLaunchResult = { started: boolean; already_running: boolean; executable: string | null };

export async function launchScannerCompanion(): Promise<ScannerLaunchResult> {
  if (!isTauriRuntime()) throw new Error("Scanner launch is available in Stencil Desktop.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ScannerLaunchResult>("start_scanner_companion");
}
