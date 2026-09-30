"use client";

import { useNavigate } from "react-router-dom";
import { ExamView } from "@/components/ExamView";
import type { Session } from "@/lib/auth";

/** Web wrapper around the shared ExamView (create-exam wizard). */
export function ExamPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  void navigate; // parity with the desktop page signature
  return <ExamView token={session.token} />;
}
