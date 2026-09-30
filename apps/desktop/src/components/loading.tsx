import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

/* ---------- Centered page loader (simple spinner) ---------- */

export function PageLoader({
  message = "Loading…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-[40vh] w-full flex-col items-center justify-center gap-3 py-16 text-center",
        className,
      )}
    >
      <Loader2 className="size-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function InlineLoader({
  message = "Loading…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center justify-center gap-2 py-6", className)}
    >
      <Loader2 className="size-4 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}

/* ---------- Route transition ---------- */

export function RouteProgress() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 450);
    return () => window.clearTimeout(t);
  }, [pathname]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <motion.div
        initial={{ x: "-40%", width: "30%" }}
        animate={{ x: "250%", width: "45%" }}
        transition={{ duration: 0.45, ease: "easeInOut" }}
        className="h-full rounded-full bg-primary"
      />
    </div>
  );
}

export function PageTransition({
  children,
  routeKey,
}: {
  children: ReactNode;
  routeKey: string;
}) {
  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex min-h-full flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
