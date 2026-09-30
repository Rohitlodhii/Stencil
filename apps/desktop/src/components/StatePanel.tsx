import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

const icons = { loading: Loader2, error: AlertCircle, empty: Inbox };

export function StatePanel({
  state,
  title,
  description,
  action,
}: {
  state: keyof typeof icons;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const Icon = icons[state];
  return (
    <div
      role={state === "error" ? "alert" : "status"}
      className={`flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-5 py-8 text-center ${
        state === "error" ? "border-destructive/40" : ""
      }`}
    >
      <Icon className={`mb-3 size-5 ${state === "loading" ? "animate-spin text-primary" : state === "error" ? "text-destructive" : "text-muted-foreground"}`} />
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-lg text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
