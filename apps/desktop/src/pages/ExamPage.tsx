import { ExamView } from "@/components/ExamView";
import type { Session } from "@/lib/auth";

export function ExamPage({ session }: { session: Session }) {
  return <ExamView token={session.token} />;
}
