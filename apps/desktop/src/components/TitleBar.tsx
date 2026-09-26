import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Maximize01Icon,
  Minimize02Icon,
  MinimizeScreenIcon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useSidebar } from "@/components/ui/sidebar";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const { toggleSidebar } = useSidebar();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    win
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => {});
    win
      .onResized(() => {
        win
          .isMaximized()
          .then(setIsMaximized)
          .catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    if (!isTauri()) return;
    await getCurrentWindow().minimize().catch(() => {});
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    if (!isTauri()) return;
    await getCurrentWindow().toggleMaximize().catch(() => {});
    // State syncs via onResized; optimistically refresh too.
    const maximized = await getCurrentWindow()
      .isMaximized()
      .catch(() => null);
    if (maximized !== null) setIsMaximized(maximized);
  }, []);

  const handleClose = useCallback(async () => {
    if (!isTauri()) return;
    await getCurrentWindow().close().catch(() => {});
  }, []);

  const btn =
    "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none";

  const sidebarBtn =
    "flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none";

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleToggleMaximize}
      className="flex h-8 w-full shrink-0 items-center justify-between border-b border-border bg-background select-none"
    >
      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          className={cn(sidebarBtn)}
        >
          <HugeiconsIcon
            icon={SidebarLeftIcon}
            size={16}
            strokeWidth={1.75}
            color="currentColor"
          />
        </button>
      </div>
      <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" />

      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className={cn(btn)}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimize"
          title="Minimize"
          className={cn(btn)}
        >
          <HugeiconsIcon
            icon={Minimize02Icon}
            size={14}
            strokeWidth={1.75}
            color="currentColor"
          />
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          title={isMaximized ? "Restore" : "Maximize"}
          className={cn(btn)}
        >
          <HugeiconsIcon
            icon={isMaximized ? MinimizeScreenIcon : Maximize01Icon}
            size={13}
            strokeWidth={1.75}
            color="currentColor"
          />
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          title="Close"
          className={cn(btn, "hover:bg-red-500 hover:text-white")}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            size={15}
            strokeWidth={1.75}
            color="currentColor"
          />
        </button>
      </div>
    </header>
  );
}
