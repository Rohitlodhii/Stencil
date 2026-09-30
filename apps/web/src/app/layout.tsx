import type { Metadata } from "next";
import "./globals.css";
import { ClientOnly } from "./ClientOnly";

export const metadata: Metadata = {
  title: "Stencil — Exam management",
  description:
    "AI-powered exam management: question-paper extraction, syllabus analysis and answer-sheet checking.",
  // Relative path resolves to an absolute URL via metadataBase
  // (auto = VERCEL_URL on Vercel) → https://<domain>/og.png
  openGraph: {
    title: "Stencil — Exam management",
    description:
      "AI-powered exam management: question-paper extraction, syllabus analysis and answer-sheet checking.",
    images: [{ url: "/og.png", width: 2400, height: 1260, alt: "Stencil" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        {/* The whole app is one client-side SPA (session in localStorage,
            hash routing), identical to the desktop app. */}
        <ClientOnly>{children}</ClientOnly>
      </body>
    </html>
  );
}
