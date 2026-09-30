"use client";

import { useCallback, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { TopBar } from "@/components/TopBar";
import { AuthHeader } from "@/components/AuthLayout";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { LandingPage } from "@/views/LandingPage";
import { OnboardingPage } from "@/views/OnboardingPage";
import { LoginPage } from "@/views/LoginPage";
import { RegisterPage } from "@/views/RegisterPage";
import { CoordinatorDashboardPage } from "@/views/CoordinatorDashboardPage";
import { TeachersPage } from "@/views/TeachersPage";
import { StudentsPage } from "@/views/StudentsPage";
import { StudentsDetailPage } from "@/views/StudentsDetailPage";
import { StudentsUploadPage } from "@/views/StudentsUploadPage";
import { TeacherDashboardPage } from "@/views/TeacherDashboardPage";
import { ExamPage } from "@/views/ExamPage";
import { ResultsPage } from "@/views/ResultsPage";
import { CheckExamsPage } from "@/views/CheckExamsPage";
import { CheckExamDetailPage } from "@/views/CheckExamDetailPage";
import { CheckPaperPage } from "@/views/CheckPaperPage";
import { AnswerSheetAnalysisPage } from "@/views/AnswerSheetAnalysisPage";
import { ScannerPage } from "@/views/ScannerPage";
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
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <AppSidebar session={session} onLogout={onLogout} />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Routes>
              {role === "coordinator" ? (
                <>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<CoordinatorDashboardPage session={session} />} />
                  <Route path="/exam" element={<ExamPage session={session} />} />
                  <Route path="/results" element={<ResultsPage />} />
                  <Route path="/teachers" element={<TeachersPage session={session} />} />
                  <Route path="/students" element={<StudentsPage />} />
                  <Route path="/students/new" element={<StudentsUploadPage session={session} />} />
                  <Route path="/students/:id" element={<StudentsDetailPage />} />
                  <Route path="/scanner" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/teacher" element={<Navigate to="/dashboard" replace />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </>
              ) : (
                <>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<TeacherDashboardPage session={session} />} />
                  <Route path="/check-exam" element={<CheckExamsPage session={session} />} />
                  <Route path="/check-exam/:id" element={<CheckExamDetailPage />} />
                  <Route path="/check-exam/:id/check/:studentIdx" element={<CheckPaperPage />} />
                  <Route path="/check-exam/:id/check/:studentIdx/analysis" element={<AnswerSheetAnalysisPage />} />
                  <Route path="/results" element={<ResultsPage />} />
                  <Route path="/exam" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/scanner" element={<ScannerPage />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
  // The landing + results pages render full-bleed; every other public step
  // uses the centered auth-card shell with the slide transition.
  const isFullBleed = location.pathname === "/" || location.pathname === "/results";

  if (isFullBleed) {
    return (
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
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
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/login" element={<LoginPage onLogin={onLogin} />} />
              <Route path="/register" element={<RegisterPage onLogin={onLogin} />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="*" element={<Navigate to="/onboarding" replace />} />
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
