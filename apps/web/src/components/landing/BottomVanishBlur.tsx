"use client";

import { cn } from "@/lib/utils";

type BottomVanishBlurProps = {
  className?: string;
};

/**
 * Bottom fade for the speed screenshot.
 * Sits on the bottom of the image and blurs + fades it into the page
 * background so the screenshot looks like it vanishes.
 */
export function BottomVanishBlur({ className }: BottomVanishBlurProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 h-40 select-none sm:h-56 lg:h-64",
        className,
      )}
    >
      <div className="absolute inset-0 backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent,black_55%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-white/0 via-white/70 to-white" />
    </div>
  );
}
