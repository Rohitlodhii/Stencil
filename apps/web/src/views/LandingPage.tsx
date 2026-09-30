"use client";

import { Link, useNavigate } from "react-router-dom";
import { GradientBackground } from "@/components/ui/gradient-backgrounds";

/** Public landing route (/). */
export function LandingPage() {
  const navigate = useNavigate();

  return (
    <main className="font-inter min-h-screen bg-white px-0 pt-0 md:px-32 md:pt-4">
      <GradientBackground className="h-screen min-h-0 w-full rounded-none md:rounded-2xl">
        <nav className="mx-auto grid w-full max-w-7xl grid-cols-2 items-center px-6 py-6 md:grid-cols-3 md:px-8">
          <Link
            to="/"
            className="flex w-fit items-center gap-2 text-2xl font-semibold tracking-tight"
          >
            <span className="rounded-xl bg-background p-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 256 256"
                fill="none"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path
                  d="M 144 256 L 27.598 256 L 144 139.598 Z M 256 207.5 L 200 256 L 200 56 L 0 56 L 48 0 L 256 0 Z M 0 204.402 L 0 112 L 92.402 112 Z"
                  fill="var(--primary)"
                />
              </svg>
            </span>
            Stencil
          </Link>

          <div className="hidden items-center justify-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#why" className="transition-colors hover:text-slate-950">Why it exists</a>
            <a href="#features" className="transition-colors hover:text-slate-950">Features</a>
            <a href="#how-to-use" className="transition-colors hover:text-slate-950">How to use</a>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => navigate("/onboarding")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get started
            </button>
          </div>
        </nav>

        <section className="mx-auto flex max-w-5xl flex-col items-center px-6 pt-24 text-center sm:pt-32">
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
            AI-Powered Exam Evaluation, From Paper to Results
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Stencil transforms traditional paper-based examinations into a streamlined digital workflow. Scan handwritten answer sheets, understand questions with AI, assist teachers with evaluation, and manage marks — all from one platform.
          </p>
        </section>
      </GradientBackground>
    </main>
  );
}
