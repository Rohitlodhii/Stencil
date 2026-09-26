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
import { fetchColleges, isBanned, teacherLogin, teacherRegister } from "@/lib/auth";

const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function TeacherAuthPage({ onLogin }: { onLogin: () => void }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [colleges, setColleges] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [college, setCollege] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchColleges().then(setColleges).catch(() => {});
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

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (isBanned(email)) {
      setError("This account was declined by the coordinator and is banned.");
      return;
    }
    if (!email.trim() || !password) {
      setError("Enter email and password.");
      return;
    }
    setLoading(true);
    try {
      await teacherLogin(email.trim(), password);
      onLogin();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!name.trim() || !email.trim() || !password || !teacherId.trim() || !college) {
      setError("Fill name, email, password, teacher ID and college.");
      return;
    }
    setLoading(true);
    try {
      const res = await teacherRegister({
        name: name.trim(),
        email: email.trim(),
        password,
        teacher_id: teacherId.trim(),
        college,
      });
      setInfo(`${res.message} (status: ${res.status})`);
      setMode("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={mode === "login" ? "Teacher login" : "Teacher register"}
      description={
        mode === "login"
          ? "Login with the same credentials after your coordinator approves you."
          : "Registration goes to your college coordinator for approval."
      }
    >
      <div className="flex flex-col gap-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, x: mode === "login" ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: mode === "login" ? 12 : -12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {mode === "login" ? (
              <form onSubmit={submitLogin} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@college.edu"
                    className={inputCls}
                  />
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
              </form>
            ) : (
              <form onSubmit={submitRegister} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@college.edu"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Teacher ID</span>
                  <input
                    value={teacherId}
                    onChange={(e) => setTeacherId(e.target.value)}
                    placeholder="e.g. TCH-042"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">College</span>
                  <Select value={college} onValueChange={setCollege}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select college…" />
                    </SelectTrigger>
                    <SelectContent>
                      {colleges.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
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
                    {loading ? "Registering…" : "Register"}
                    <Kbd className="h-4 border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] text-primary-foreground">
                      Enter
                    </Kbd>
                  </Button>
                </div>
              </form>
            )}
          </motion.div>
        </AnimatePresence>

        <p className="mt-2 text-left text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setError(null);
                  setInfo(null);
                }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                  setInfo(null);
                }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Login
              </button>
            </>
          )}
        </p>

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
          {info && (
            <motion.p
              key="info"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-sm text-green-600"
            >
              {info}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </AuthLayout>
  );
}
