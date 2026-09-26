import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HINTS: Record<string, string> = {
  coordinator: "Coordinators are pre-seeded — login with your coordinator ID and password.",
  teacher: "Teachers can register with their college, then login once approved.",
};

export function OnboardingPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    go();
  };

  const go = () => {
    if (!role) {
      setError("Please select who you are to continue.");
      return;
    }
    navigate(role === "coordinator" ? "/login/coordinator" : "/login/teacher", {
      state: { dir: 1 },
    });
  };

  // Enter anywhere continues (the select-only form has no text inputs for
  // native submit). Skipped while the dropdown is open so Enter can pick.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[aria-expanded="true"]')) return;
      e.preventDefault();
      go();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <AuthLayout title="Who are you?" description="Select how you want to continue.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">I am a…</span>
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v);
              setError(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select your role…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="coordinator">Coordinator</SelectItem>
              <SelectItem value="teacher">Teacher</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <AnimatePresence mode="wait" initial={false}>
          {role && HINTS[role] && (
            <motion.p
              key={role}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="text-sm text-muted-foreground"
            >
              {HINTS[role]}
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-sm text-destructive"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <div className="flex justify-start">
          <Button type="submit" className="cursor-pointer">
            Continue
            <Kbd className="h-4 border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] text-primary-foreground">
              Enter
            </Kbd>
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
