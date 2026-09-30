"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Renders children only after mount. The app is a localStorage-session SPA
 *  (same as the desktop app), so SSR rendering would either mismatch or
 *  flash an empty shell — mount-gating keeps the first paint correct. */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}
