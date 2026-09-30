import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type GradientBackgroundProps = {
  className?: string;
  children?: ReactNode;
};

/** A content-ready amber radial-gradient background. */
export function GradientBackground({ className, children }: GradientBackgroundProps) {
  return (
    <div
      className={cn("relative min-h-screen w-full overflow-hidden", className)}
      style={{
        backgroundImage:
          "radial-gradient(125% 125% at 50% 10%, #ffffff 40%, #f59e0b 100%)",
        backgroundSize: "100% 100%",
      }}
    >
      {children}
    </div>
  );
}

export const Component = GradientBackground;
