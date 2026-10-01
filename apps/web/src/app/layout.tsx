import type { Metadata } from "next";
import "./globals.css";
import { ClientOnly } from "./ClientOnly";

// Absolute base for og/twitter image URLs: NEXT_PUBLIC_SITE_URL (custom
// domain) > VERCEL_URL (auto on Vercel) > localhost (dev).
const metadataBase = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"),
);

export const metadata: Metadata = {
  metadataBase,
  title: "Stencil — Exam management",
  description:
    "AI-powered exam management: question-paper extraction, syllabus analysis and answer-sheet checking.",
  // Relative /og.png resolves against metadataBase above → https://<domain>/og.png
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
