import { useCallback, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { TitleBar } from "@/components/TitleBar";
import { AuthHeader } from "@/components/AuthLayout";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { HomePage } from "@/pages/HomePage";
import { ScannerPage } from "@/pages/ScannerPage";
import { ExamPage } from "@/pages/ExamPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { CoordinatorLoginPage } from "@/pages/CoordinatorLoginPage";
import { TeacherAuthPage } from "@/pages/TeacherAuthPage";
import { CoordinatorDashboardPage } from "@/pages/CoordinatorDashboardPage";
import { TeachersPage } from "@/pages/TeachersPage";
import { StudentsPage } from "@/pages/StudentsPage";
import { StudentsDetailPage } from "@/pages/StudentsDetailPage";
import { StudentsUploadPage } from "@/pages/StudentsUploadPage";
import { TeacherDashboardPage } from "@/pages/TeacherDashboardPage";
import { CheckExamsPage } from "@/pages/CheckExamsPage";
import { CheckExamDetailPage } from "@/pages/CheckExamDetailPage";
import { CheckPaperPage } from "@/pages/CheckPaperPage";
import { clearSession, loadSession, type Session } from "@/lib/auth";

function AuthedShell({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const role = session.user.role;
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <AppSidebar session={session} onLogout={onLogout} />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Routes>
              {role === "coordinator" ? (
                <>
                  <Route path="/" element={<CoordinatorDashboardPage session={session} />} />
                  <Route path="/home" element={<HomePage />} />
                  <Route path="/exam" element={<ExamPage session={session} />} />
                  <Route path="/teachers" element={<TeachersPage session={session} />} />
                  <Route path="/students" element={<StudentsPage />} />
                  <Route path="/students/new" element={<StudentsUploadPage session={session} />} />
                  <Route path="/students/:id" element={<StudentsDetailPage />} />
                  <Route path="/scanner" element={<Navigate to="/" replace />} />
                  <Route path="/teacher" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              ) : (
                <>
                  <Route path="/" element={<TeacherDashboardPage session={session} />} />
                  <Route path="/teacher" element={<TeacherDashboardPage session={session} />} />
                  <Route path="/check-exam" element={<CheckExamsPage session={session} />} />
                  <Route path="/check-exam/:id" element={<CheckExamDetailPage />} />
                  <Route path="/check-exam/:id/check/:studentIdx" element={<CheckPaperPage />} />
                  <Route path="/exam" element={<Navigate to="/" replace />} />
                  <Route path="/scanner" element={<ScannerPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>
        </div>
      </div>
    </div>
  );
}

function PublicShell({ onLogin }: { onLogin: () => void }) {
  const location = useLocation();
  // Slide direction is set explicitly by navigations: Continue -> +1, Back -> -1.
  const dir = (location.state as { dir?: number } | null)?.dir ?? 1;
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
        <AuthHeader />
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={location.pathname}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: d >= 0 ? 60 : -60 }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: d >= 0 ? -60 : 60 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full max-w-md"
          >
            <Routes location={location}>
              <Route path="/" element={<OnboardingPage onLogin={onLogin} />} />
              <Route path="/login/coordinator" element={<CoordinatorLoginPage onLogin={onLogin} />} />
              <Route path="/login/teacher" element={<TeacherAuthPage onLogin={onLogin} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Shell() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const navigate = useNavigate();

  const refresh = useCallback(() => setSession(loadSession()), []);
  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    navigate("/", { replace: true });
  }, [navigate]);

  if (!session) return <PublicShell onLogin={refresh} />;
  return <AuthedShell session={session} onLogout={logout} />;
}

function App() {
  return (
    <HashRouter>
      <SidebarProvider defaultOpen>
        <Shell />
      </SidebarProvider>
    </HashRouter>
  );
}

export default App;
