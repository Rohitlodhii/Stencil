/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_WINDOWS_URL?: string;
  readonly VITE_DESKTOP_MACOS_URL?: string;
  readonly VITE_DESKTOP_LINUX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
