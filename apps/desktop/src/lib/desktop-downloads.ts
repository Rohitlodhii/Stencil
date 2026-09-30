export type DownloadPlatform = "windows" | "macos" | "linux";

export type ProductDownload = {
  platform: DownloadPlatform;
  label: string;
  detail: string;
  url: string;
  checksum: string;
};

const details: Record<DownloadPlatform, string> = {
  windows: "Windows 10 or later, 64-bit",
  macos: "macOS 12 or later",
  linux: "64-bit Linux desktop",
};

export const RELEASE_VERSIONS = {
  desktop: import.meta.env.VITE_DESKTOP_VERSION?.trim() || "0.1.0",
  scanner: import.meta.env.VITE_SCANNER_VERSION?.trim() || "0.2.0",
};

export const DESKTOP_DOWNLOADS: ProductDownload[] = [
  { platform: "windows", label: "Windows", detail: details.windows, url: import.meta.env.VITE_DESKTOP_WINDOWS_URL?.trim() || "", checksum: import.meta.env.VITE_DESKTOP_WINDOWS_SHA256?.trim() || "" },
  { platform: "macos", label: "macOS", detail: details.macos, url: import.meta.env.VITE_DESKTOP_MACOS_URL?.trim() || "", checksum: import.meta.env.VITE_DESKTOP_MACOS_SHA256?.trim() || "" },
  { platform: "linux", label: "Linux", detail: details.linux, url: import.meta.env.VITE_DESKTOP_LINUX_URL?.trim() || "", checksum: import.meta.env.VITE_DESKTOP_LINUX_SHA256?.trim() || "" },
];

export const SCANNER_DOWNLOADS: ProductDownload[] = [
  { platform: "windows", label: "Windows", detail: `${details.windows}; webcam required`, url: import.meta.env.VITE_SCANNER_WINDOWS_URL?.trim() || "", checksum: import.meta.env.VITE_SCANNER_WINDOWS_SHA256?.trim() || "" },
  { platform: "macos", label: "macOS", detail: `${details.macos}; webcam required`, url: import.meta.env.VITE_SCANNER_MACOS_URL?.trim() || "", checksum: import.meta.env.VITE_SCANNER_MACOS_SHA256?.trim() || "" },
  { platform: "linux", label: "Linux", detail: `${details.linux}; webcam required`, url: import.meta.env.VITE_SCANNER_LINUX_URL?.trim() || "", checksum: import.meta.env.VITE_SCANNER_LINUX_SHA256?.trim() || "" },
];
