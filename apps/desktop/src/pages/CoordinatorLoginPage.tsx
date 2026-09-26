import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { coordinatorLogin, fetchSeededCoordinators } from "@/lib/auth";

const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function CoordinatorLoginPage({ onLogin }: { onLogin: () => void }) {
  const navigate = useNavigate();
  const [coordinatorId, setCoordinatorId] = useState("");
  const [password, setPassword] = useState("");
  const [ids, setIds] = useState<{ coordinator_id: string; college: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSeededCoordinators().then(setIds).catch(() => {});
  }, []);

  // Backspace goes back (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      navigate("/", { state: { dir: -1 } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!coordinatorId.trim() || !password) {
      setError("Enter coordinator ID and password.");
      return;
    }
    setLoading(true);
    try {
      await coordinatorLogin(coordinatorId.trim(), password);
      onLogin();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Coordinator login"
      description="Coordinators are pre-seeded per college — there is no coordinator registration."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Coordinator ID</span>
          <input
            value={coordinatorId}
            onChange={(e) => setCoordinatorId(e.target.value)}
            placeholder="e.g. coord_rgpv"
            list="coordinator-ids"
            className={inputCls}
          />
          <datalist id="coordinator-ids">
            {ids.map((c) => (
              <option key={c.coordinator_id} value={c.coordinator_id}>
                {c.college}
              </option>
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputCls}
          />
        </label>
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
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("/", { state: { dir: -1 } })}
            className="cursor-pointer"
          >
            ← Back
            <Kbd>Bck</Kbd>
          </Button>
          <Button type="submit" disabled={loading} className="cursor-pointer">
            {loading ? "Logging in…" : "Login"}
            <Kbd className="h-4 border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] text-primary-foreground">
              Enter
            </Kbd>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Demo IDs: coord_rgpv / coord_davv / coord_manit (password: coord123).
        </p>
      </form>
    </AuthLayout>
  );
}
