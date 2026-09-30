/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCANNER_URL?: string;
  readonly VITE_SCANNER_VERSION?: string;
  readonly VITE_DESKTOP_WINDOWS_URL?: string;
  readonly VITE_DESKTOP_MACOS_URL?: string;
  readonly VITE_DESKTOP_LINUX_URL?: string;
  readonly VITE_DESKTOP_VERSION?: string;
  readonly VITE_DESKTOP_WINDOWS_SHA256?: string;
  readonly VITE_DESKTOP_MACOS_SHA256?: string;
  readonly VITE_DESKTOP_LINUX_SHA256?: string;
  readonly VITE_SCANNER_WINDOWS_URL?: string;
  readonly VITE_SCANNER_MACOS_URL?: string;
  readonly VITE_SCANNER_LINUX_URL?: string;
  readonly VITE_SCANNER_WINDOWS_SHA256?: string;
  readonly VITE_SCANNER_MACOS_SHA256?: string;
  readonly VITE_SCANNER_LINUX_SHA256?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
