import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-primary shadow-xs">
              <Icon className="size-4.5" />
            </span>
          )}
          <h1 className="font-title text-2xl font-semibold leading-tight sm:text-[1.75rem]">
            {title}
          </h1>
        </div>
        {description && (
          <p className={`max-w-3xl text-sm leading-relaxed text-muted-foreground ${Icon ? "mt-2 sm:ml-11" : "mt-1"}`}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
