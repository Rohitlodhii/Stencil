export type DesktopPlatform = "windows" | "macos" | "linux";

export type DesktopDownload = {
  platform: DesktopPlatform;
  label: string;
  detail: string;
  url: string;
};

export const DESKTOP_DOWNLOADS: DesktopDownload[] = [
  {
    platform: "windows",
    label: "Windows",
    detail: "Windows 10 or later",
    url: import.meta.env.VITE_DESKTOP_WINDOWS_URL?.trim() ?? "",
  },
  {
    platform: "macos",
    label: "macOS",
    detail: "Apple silicon or Intel",
    url: import.meta.env.VITE_DESKTOP_MACOS_URL?.trim() ?? "",
  },
  {
    platform: "linux",
    label: "Linux",
    detail: "AppImage or Debian package",
    url: import.meta.env.VITE_DESKTOP_LINUX_URL?.trim() ?? "",
  },
];
