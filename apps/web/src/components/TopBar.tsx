"use client";

import { useCallback, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon, Sun } from "lucide-react";
import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { useTheme } from "@/lib/theme";
import { useSidebar } from "@/components/ui/sidebar";

/** Web top bar — mirrors the desktop TitleBar layout (sidebar toggle left,
 *  theme toggle right) but without the Tauri window controls. */
export function TopBar() {
  const { toggleSidebar } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const [ready] = useState(true);

  const handleSidebar = useCallback(() => {
    toggleSidebar();
  }, [toggleSidebar]);

  const btn =
    "flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none";

  return (
    <header
      className="flex h-8 w-full shrink-0 items-center justify-between border-b border-border bg-background select-none"
      suppressHydrationWarning
    >
      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          onClick={handleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          className={btn}
        >
          <HugeiconsIcon
            icon={SidebarLeftIcon}
            size={16}
            strokeWidth={1.75}
            color="currentColor"
          />
        </button>
      </div>
      <div className="min-w-0 flex-1 self-stretch" />
      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className={btn}
        >
          {ready && (theme === "dark" ? <Sun size={14} /> : <Moon size={14} />)}
        </button>
      </div>
    </header>
  );
}
